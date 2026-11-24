"""End-to-end integration tests across 5-page, 100-page, scanned PDF, two-column, rewrite engine & verify."""
from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import fitz
from PIL import Image, ImageDraw

from app.services.analyze import analyze_file
from app.services.blocks import Block, blocks_to_dicts
from app.services.extract_pdf import extract_pdf, needs_ocr, ocr_pdf
from app.services.qa import build_report
from app.services.rebuild_pdf import rebuild_pdf
from app.services.rewrite import RewriteEngine
from app.services.verify import verify_document


def _make_scanned_pdf(path: Path) -> None:
    """Create an image-only (scanned) 2-page PDF with zero embedded text."""
    doc = fitz.open()
    for pno in range(2):
        img = Image.new("RGB", (600, 800), (255, 255, 255))
        draw = ImageDraw.Draw(img)
        draw.text((60, 100), f"Scanned page {pno + 1}: Q3 2024 revenue was $42k.", fill=(10, 10, 10))
        tmp = path.with_name(f"scan_{pno}.png")
        img.save(tmp)
        page = doc.new_page(width=595, height=842)
        page.insert_image(page.rect, filename=str(tmp))
        tmp.unlink(missing_ok=True)
    doc.save(path)
    doc.close()


def test_scanned_pdf_detection_and_ocr_pipeline(tmp_path: Path):
    scanned = tmp_path / "scanned.pdf"
    _make_scanned_pdf(scanned)

    pages, _ = extract_pdf(scanned)
    assert needs_ocr(pages, len(pages)) is True

    analysis = analyze_file(str(scanned), "pdf", "application/pdf", "scanned.pdf", {})
    assert analysis.needs_ocr is True
    assert analysis.selectable is False

    fake_ocr_text = (
        "Scanned page content: Q3 2024 revenue was $42k and churn dropped to 1.8% across all enterprise "
        "accounts during the third fiscal quarter, exceeding the forecast target by four percentage points."
    )
    with patch("pytesseract.image_to_string", return_value=fake_ocr_text):
        ocr_out = Path(ocr_pdf(scanned))

    assert ocr_out.exists()
    ocr_pages, _ = extract_pdf(ocr_out)
    assert len(ocr_pages) == 2
    assert needs_ocr(ocr_pages, len(ocr_pages)) is False
    assert any("Q3 2024" in b.text for page in ocr_pages for b in page)


def test_two_column_reading_order_left_before_right(tmp_path: Path):
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    for i in range(5):
        page.insert_textbox(
            fitz.Rect(45, 90 + i * 95, 280, 165 + i * 95),
            f"Left column paragraph {i + 1} discusses method step {i + 1}.",
            fontsize=10,
        )
        page.insert_textbox(
            fitz.Rect(315, 90 + i * 95, 550, 165 + i * 95),
            f"Right column paragraph {i + 1} reports result metric {i + 1}.",
            fontsize=10,
        )
    pdf_path = tmp_path / "two_col.pdf"
    doc.save(pdf_path)
    doc.close()

    pages, _ = extract_pdf(pdf_path)
    texts = [b.text for b in pages[0] if not b.skip]
    left_indices = [idx for idx, t in enumerate(texts) if "Left column" in t]
    right_indices = [idx for idx, t in enumerate(texts) if "Right column" in t]
    assert len(left_indices) == 5 and len(right_indices) == 5
    assert max(left_indices) < min(right_indices), "All left-column blocks should precede right-column blocks"


def test_end_to_end_5_page_rewrite_rebuild_verify(sample_pdf: Path, tmp_path: Path):
    pages, _ = extract_pdf(sample_pdf)
    engine = RewriteEngine(style="professional", strength="medium", language="en")

    def fake_call(_system: str, user: str, _max_tokens: int) -> tuple[str, int, int]:
        bid_m = re.search(r"BLOCK ID:\s*(\S+)", user)
        block_id = bid_m.group(1) if bid_m else "p1b0"
        orig_m = re.search(r"<<<\n(.*?)\n>>>", user, re.S)
        orig = orig_m.group(1).strip() if orig_m else user
        rewritten = orig.replace("explains how the sample document is structured", "outlines the layout of this sample file")
        rewritten = rewritten.replace("more naturally than a machine summary", "clearly and plainly for human readers")
        payload = json.dumps({
            "block_id": block_id,
            "rewritten": rewritten,
            "terms": {"Sample Document": "Sample Document"},
            "notes": "",
        })
        return payload, 120, 95

    with patch.object(engine, "_call", side_effect=fake_call):
        for page_blocks in pages:
            for b in page_blocks:
                engine.rewrite_block(b)

    out_pdf = tmp_path / "rewritten_5p.pdf"
    rb = rebuild_pdf(str(sample_pdf), str(out_pdf), pages)
    verify = verify_document(str(sample_pdf), str(out_pdf), "pdf")
    assert verify["ok"] is True, verify["issues"]
    assert verify["details"]["before_pages"] == 5
    assert verify["details"]["after_pages"] == 5

    fake_job = SimpleNamespace(
        id="00000000-0000-0000-0000-000000000005",
        source_filename="sample.pdf",
        finished_at=None,
        total_pages=5,
        total_blocks=sum(len(p) for p in pages),
        total_words=sum(b.word_count for p in pages for b in p),
        tokens_in=1200,
        tokens_out=950,
        cost_usd=0.01,
    )
    qa = build_report(
        fake_job,
        [blocks_to_dicts(p) for p in pages],
        {"overflow_fixes": rb.overflow_fixes},
        verify,
        {"kind": "pdf"},
    )
    assert qa["summary"]["pages"] == 5
    assert qa["summary"]["rewritten"] > 0
    assert qa["verification"]["ok"] is True


def test_rewrite_engine_retries_on_stock_ai_phrase_then_keeps_original():
    b = Block(
        id="p1b1",
        page=1,
        type="paragraph",
        text="Our team shipped 14 features in Q3 2024 and cut latency by 22% across three regions.",
    )
    engine = RewriteEngine(style="professional", strength="medium")
    bad = json.dumps({
        "block_id": "p1b1",
        "rewritten": "Let us delve into how our team shipped 14 features in Q3 2024 and cut latency by 22%.",
        "terms": {},
        "notes": "",
    })
    with patch.object(engine, "_call", return_value=(bad, 80, 60)) as mocked:
        res = engine.rewrite_block(b)
    assert mocked.call_count == 3  # initial + 2 retries
    assert res.flagged is True
    assert b.flag == "kept-original"
    assert b.new_text == b.text

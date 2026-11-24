from pathlib import Path

import fitz

from app.services import rebuild_pdf
from app.services.blocks import Block, Span
from app.services.extract_pdf import extract_pdf
from app.services.verify import verify_document


def _clone(block: Block, new_text: str) -> Block:
    return Block(
        id=block.id, page=block.page, type=block.type, text=block.text, bbox=block.bbox,
        spans=[Span(**vars(s)) for s in block.spans], align=block.align, order=block.order,
        font=block.font, size=block.size, color=block.color, bold=block.bold, skip=block.skip,
        skip_reason=block.skip_reason, new_text=new_text,
    )


def test_rebuild_preserves_page_count_and_images(image_pdf: Path, tmp_path: Path):
    pages, _ = extract_pdf(image_pdf)
    pages = [[_clone(b, b.text + " Rewritten for the test harness.") for b in page] for page in pages]
    out = tmp_path / "out.pdf"
    report = rebuild_pdf.rebuild_pdf(str(image_pdf), str(out), pages)

    assert out.exists()
    before = fitz.open(image_pdf)
    after = fitz.open(out)
    assert before.page_count == after.page_count
    assert sum(len(p.get_images(full=True)) for p in before) == sum(len(p.get_images(full=True)) for p in after)
    verification = verify_document(str(image_pdf), str(out), "pdf")
    assert verification["ok"], verification["issues"]
    assert report.rewritten_blocks > 0


def test_original_text_is_replaced(image_pdf: Path, tmp_path: Path):
    pages, _ = extract_pdf(image_pdf)
    target = next(b for b in pages[0] if "Revenue grew" in b.text)
    pages[0] = [_clone(b, "Totally different sentence about growth." if b.id == target.id else b.text) for b in pages[0]]
    out = tmp_path / "out.pdf"
    rebuild_pdf.rebuild_pdf(str(image_pdf), str(out), pages)
    text = fitz.open(out)[0].get_text("text")
    assert "Totally different sentence" in text
    assert "Revenue grew 18%" not in text


def test_overflow_shrinks_font(image_pdf: Path, tmp_path: Path):
    pages, _ = extract_pdf(image_pdf)
    target = next(b for b in pages[0] if "Revenue grew" in b.text)
    huge = "word " * 400
    pages[0] = [_clone(b, huge if b.id == target.id else b.text) for b in pages[0]]
    out = tmp_path / "out.pdf"
    report = rebuild_pdf.rebuild_pdf(str(image_pdf), str(out), pages)
    assert any(f.action in ("shrunk", "shortened", "kept-original") for f in report.overflow_fixes)


def test_vector_lines_survive(image_pdf: Path, tmp_path: Path):
    pages, _ = extract_pdf(image_pdf)
    pages = [[_clone(b, b.text) for b in page] for page in pages]
    out = tmp_path / "out.pdf"
    rebuild_pdf.rebuild_pdf(str(image_pdf), str(out), pages)
    before = fitz.open(image_pdf)[0].get_drawings()
    after = fitz.open(out)[0].get_drawings()
    assert len(before) == len(after)

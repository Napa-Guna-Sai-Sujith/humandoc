from pathlib import Path

from app.services.blocks import Block
from app.services.extract_pdf import extract_pdf


def test_extracts_pages_and_blocks(sample_pdf: Path):
    pages, metrics = extract_pdf(sample_pdf)
    assert len(pages) == 5
    assert len(metrics) == 5
    assert all(isinstance(b, Block) for page in pages for b in page)
    assert any("Page 1" in b.text for b in pages[0])


def test_block_metadata_is_populated(sample_pdf: Path):
    pages, _ = extract_pdf(sample_pdf)
    heading = next(b for b in pages[0] if "Sample Document" in b.text)
    assert heading.type == "heading"
    assert heading.size >= 16
    assert heading.bbox and len(heading.bbox) == 4
    assert heading.font


def test_page_numbers_are_skipped(sample_pdf: Path):
    pages, _ = extract_pdf(sample_pdf)
    page_no = [b for b in pages[0] if b.text.strip() == "1"]
    assert page_no and page_no[0].skip and page_no[0].skip_reason == "page_number"


def test_images_are_not_blocks(image_pdf: Path):
    pages, metrics = extract_pdf(image_pdf)
    assert not any(b.type == "image" for page in pages for b in page)
    assert metrics[0].image_hashes, "image fingerprint should be recorded"


def test_reading_order_is_top_to_bottom(image_pdf: Path):
    pages, _ = extract_pdf(image_pdf)
    ys = [b.bbox[1] for b in pages[0]]
    assert ys == sorted(ys)


def test_two_column_paper(tmp_path: Path):
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    left = "Left column text about alpha beta gamma delta epsilon zeta eta theta."
    right = "Right column text about one two three four five six seven eight nine."
    for i in range(6):
        page.insert_textbox(fitz.Rect(40, 60 + i * 90, 285, 140 + i * 90), left, fontsize=10)
        page.insert_textbox(fitz.Rect(310, 60 + i * 90, 555, 140 + i * 90), right, fontsize=10)
    path = tmp_path / "twocol.pdf"
    doc.save(path)
    doc.close()

    pages, _ = extract_pdf(path)
    blocks = pages[0]
    assert blocks, "blocks should be detected"
    assert any("Left column" in b.text for b in blocks)
    assert any("Right column" in b.text for b in blocks)

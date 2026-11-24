from pathlib import Path

from app.services.analyze import analyze_file
from app.services.extract_pdf import extract_pdf


def test_hundred_page_document_extracts_quickly(fixtures_dir: Path):
    path = fixtures_dir / "hundred.pdf"
    if not path.exists():
        from tests.make_fixtures import make_sample_pdf

        make_sample_pdf(path, pages=100)
    pages, metrics = extract_pdf(path)
    assert len(pages) == 100
    assert sum(len(p) for p in pages) >= 400  # 4 paragraphs + heading + page number per page
    assert len(metrics) == 100


def test_page_range_selection(fixtures_dir: Path):
    path = fixtures_dir / "sample.pdf"
    analysis = analyze_file(str(path), "pdf", "application/pdf", "sample.pdf", {"page_range": "1-2,4"})
    assert analysis.total_pages == 5
    assert len(analysis.selected_pages) == 3
    assert all(b.skip for b in analysis.pages[4])


def test_estimate_is_populated(fixtures_dir: Path):
    analysis = analyze_file(str(fixtures_dir / "sample.pdf"), "pdf", "application/pdf", "sample.pdf", {})
    assert analysis.est_cost_usd > 0
    assert analysis.blocks_rewrite > 0
    assert analysis.words == sum(b.word_count for page in analysis.pages for b in page)

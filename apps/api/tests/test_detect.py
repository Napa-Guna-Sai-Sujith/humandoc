from pathlib import Path

import pytest

from app.services.detect import UnsupportedFileError, sniff


def test_sniffs_real_pdf(sample_pdf: Path):
    kind, mime = sniff(sample_pdf, "sample.pdf")
    assert kind == "pdf"
    assert mime == "application/pdf"


def test_ignores_misleading_extension(sample_pdf: Path):
    kind, _ = sniff(sample_pdf, "totally-a.docx")
    assert kind == "pdf"


def test_rejects_binary_junk(tmp_path: Path):
    p = tmp_path / "junk.pdf"
    p.write_bytes(b"\x00\x01\x02\x03" * 64)
    with pytest.raises(UnsupportedFileError):
        sniff(p, "junk.pdf")


def test_detects_markdown(tmp_path: Path):
    p = tmp_path / "notes.md"
    p.write_text("# Heading\n\nSome text.\n")
    kind, _ = sniff(p, "notes.md")
    assert kind == "md"

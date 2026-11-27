"""Tests for .doc / .docx parsing, pagination, rebuild, and 4-format export."""
from __future__ import annotations

import io
import struct
from pathlib import Path

import fitz
import pytest
from docx import Document
from docx.oxml import parse_xml
from fastapi.testclient import TestClient

from app.main import app
from app.services import doc_convert, rebuild_docx
from app.services.detect import sniff
from app.services.extract_docx import extract_docx


def _build_minimal_ole2_doc(paragraphs: list[str]) -> bytes:
    """Build a valid MS-CFB OLE2 binary .doc containing compressed + UTF-16LE piece text."""
    text = "\r".join(paragraphs) + "\r"
    raw_u16 = text.encode("utf-16-le")
    # Put text at offset 0x400 in WordDocument stream; FIB lives in 0x000..0x400
    fc_min = 0x400
    word_doc = bytearray(fc_min + len(raw_u16))
    struct.pack_into("<H", word_doc, 0, 0xA5EC)  # wIdent Word97
    struct.pack_into("<H", word_doc, 10, 0x0200)  # fWhichTblStm = 1Table
    struct.pack_into("<II", word_doc, 0x18, fc_min, fc_min + len(raw_u16))
    pos = 32
    struct.pack_into("<H", word_doc, pos, 14)  # csw
    pos += 2 + 14 * 2
    struct.pack_into("<H", word_doc, pos, 22)  # cslw
    struct.pack_into("<I", word_doc, pos + 2 + 3 * 4, len(text))  # ccpText
    pos += 2 + 22 * 4
    struct.pack_into("<H", word_doc, pos, 40)  # cbRgFcLcb
    pos += 2

    # Build 1Table Clx: Pcdt(0x02) + lcb(4 + 8 + 8 = 20)
    plc = struct.pack("<II", 0, len(text)) + struct.pack("<HIH", 0, fc_min, 0)
    clx = b"\x02" + struct.pack("<I", len(plc)) + plc
    struct.pack_into("<II", word_doc, pos + 33 * 8, 0, len(clx))
    word_doc[fc_min:] = raw_u16

    # Assemble 512-byte sectors: sec0=WordDocument (>=4096 bytes), secN=1Table (>=4096), secDir, secFAT
    def pad512(b: bytes, min_len: int = 4096) -> bytearray:
        target = max(min_len, ((len(b) + 511) // 512) * 512)
        return bytearray(b.ljust(target, b"\x00"))

    wd_buf = pad512(bytes(word_doc), 4096)
    tb_buf = pad512(clx, 4096)
    n_wd = len(wd_buf) // 512
    n_tb = len(tb_buf) // 512

    wd_start = 0
    tb_start = n_wd
    dir_start = n_wd + n_tb
    fat_start = dir_start + 1

    # FAT sector (128 uint32 entries)
    fat = [0xFFFFFFFF] * 128
    for i in range(n_wd):
        fat[wd_start + i] = (wd_start + i + 1) if i + 1 < n_wd else 0xFFFFFFFE
    for i in range(n_tb):
        fat[tb_start + i] = (tb_start + i + 1) if i + 1 < n_tb else 0xFFFFFFFE
    fat[dir_start] = 0xFFFFFFFE
    fat[fat_start] = 0xFFFFFFFD  # FATSECT

    def dir_entry(name: str, obj_type: int, start_sect: int, size: int) -> bytes:
        e = bytearray(128)
        if name:
            enc = name.encode("utf-16-le") + b"\x00\x00"
            e[: len(enc)] = enc
            struct.pack_into("<H", e, 64, len(enc))
        e[66] = obj_type
        e[67] = 1
        struct.pack_into("<iii", e, 68, -1, -1, 1 if obj_type == 5 else -1)
        struct.pack_into("<IQ", e, 116, start_sect, size)
        return bytes(e)

    dir_sec = (
        dir_entry("Root Entry", 5, 0xFFFFFFFE, 0)
        + dir_entry("WordDocument", 2, wd_start, len(word_doc))
        + dir_entry("1Table", 2, tb_start, len(clx))
        + b"\x00" * 128
    )

    header = bytearray(512)
    header[:8] = doc_convert.OLE2_MAGIC
    struct.pack_into("<HHHH", header, 24, 0x003E, 0x0003, 0xFFFE, 0x0009)
    struct.pack_into("<H", header, 32, 6)
    struct.pack_into("<I", header, 44, 1)  # csectFat
    struct.pack_into("<I", header, 48, dir_start)
    struct.pack_into("<I", header, 56, 4096)  # miniStreamCutoffSize
    struct.pack_into("<II", header, 60, 0xFFFFFFFE, 0)
    struct.pack_into("<II", header, 68, 0xFFFFFFFE, 0)
    for i in range(109):
        struct.pack_into("<I", header, 76 + i * 4, fat_start if i == 0 else 0xFFFFFFFF)

    fat_sec = struct.pack("<128I", *fat)
    return bytes(header + wd_buf + tb_buf + dir_sec + fat_sec)


def test_ole2_doc_sniff_extract_and_rebuild(tmp_path: Path):
    doc_bytes = _build_minimal_ole2_doc(
        [
            "Quarterly Revenue Summary — 2026",
            "Our engineering platform processed documents reliably without layout drift.",
        ]
    )
    src = tmp_path / "legacy.doc"
    src.write_bytes(doc_bytes)

    kind, mime = sniff(src, "legacy.doc")
    assert kind == "doc"
    assert mime == "application/msword"

    paras, variant = doc_convert.extract_word_paragraphs(doc_bytes, "legacy.doc")
    assert variant == "ole2"
    assert any("Quarterly Revenue Summary" in p for p in paras)
    assert any("processed documents reliably" in p for p in paras)

    pages, meta = extract_docx(src)
    assert meta["word_variant"] == "ole2"
    flat = [b for p in pages for b in p]
    for b in flat:
        b.new_text = f"Humanized: {b.text}"

    out = tmp_path / "legacy.humanized.doc"
    info = rebuild_docx.rebuild_doc(src, out, pages)
    assert info["replaced_blocks"] >= 2
    out_paras, out_var = doc_convert.extract_word_paragraphs(out, out.name)
    assert out_var == "rtf"
    assert any("Humanized: Our engineering platform" in p for p in out_paras)


def test_rtf_and_html_doc_variants(tmp_path: Path):
    rtf = (
        rb"{\rtf1\ansi\deff0 {\fonttbl{\f0 Arial;}}"
        rb"\pard Heading Line\par "
        rb"\pard First paragraph with em-dash \u8212? works smoothly.\par}"
    )
    rtf_file = tmp_path / "draft.doc"
    rtf_file.write_bytes(rtf)
    kind, _ = sniff(rtf_file, "draft.doc")
    assert kind == "doc"
    paras, variant = doc_convert.extract_word_paragraphs(rtf, "draft.doc")
    assert variant == "rtf"
    assert paras[0] == "Heading Line"
    assert "\u2014" in paras[1]

    html_doc = (
        b"<!DOCTYPE html><html><body><h1>Project Scope</h1>"
        b"<p>Introductory overview paragraph.</p>"
        b"<table><tr><td>Metric</td><td>99.4%</td></tr></table>"
        b"</body></html>"
    )
    html_file = tmp_path / "webexport.doc"
    html_file.write_bytes(html_doc)
    kind2, _ = sniff(html_file, "webexport.doc")
    assert kind2 == "doc"
    paras2, variant2 = doc_convert.extract_word_paragraphs(html_doc, "webexport.doc")
    assert variant2 == "html"
    assert any("Project Scope" in p for p in paras2)
    assert any("99.4%" in p for p in paras2)


def test_docx_pagination_tables_and_textboxes(tmp_path: Path):
    doc = Document()
    doc.add_heading("Multi-Page Word Report", level=1)
    for i in range(18):
        doc.add_paragraph(
            f"Paragraph {i}: "
            + "Structured engineering validation ensures every sentence preserves formatting, styles, and tables. " * 4
        )
    tbl = doc.add_table(rows=2, cols=2)
    tbl.cell(0, 0).text = "Header A"
    tbl.cell(0, 1).text = "Header B"
    tbl.cell(1, 0).text = "Table row content preserved."
    tbl.cell(1, 1).text = "Verified."

    # Add a paragraph containing a Word textbox (<w:txbxContent>)
    p_outer = doc.add_paragraph("Outer caption container")
    txbx = parse_xml(
        '<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox>'
        "<w:txbxContent><w:p><w:r><w:t>Callout box paragraph text.</w:t></w:r></w:p></w:txbxContent>"
        "</v:textbox></v:shape></w:pict></w:r>"
    )
    p_outer._p.append(txbx)

    src = tmp_path / "multi.docx"
    doc.save(str(src))

    pages, meta = extract_docx(src)
    assert len(pages) >= 2, f"Expected multi-page split, got {len(pages)}"
    flat = [b for p in pages for b in p]
    texts = [b.text for b in flat]
    assert "Table row content preserved." in texts
    assert "Callout box paragraph text." in texts
    assert "Outer caption container" in texts

    # Rewrite callout box AND outer paragraph independently
    for b in flat:
        if "Callout box" in b.text:
            b.new_text = "Rewritten callout box copy."
        elif "Table row" in b.text:
            b.new_text = "Rewritten table cell value."
        elif "Outer caption" in b.text:
            b.new_text = "Updated outer container text."

    out = tmp_path / "multi.out.docx"
    rebuild_docx.rebuild_docx(src, out, pages)
    rebuilt_pages, _ = extract_docx(out)
    rebuilt_texts = [b.text for p in rebuilt_pages for b in p]
    assert "Rewritten callout box copy." in rebuilt_texts
    assert "Rewritten table cell value." in rebuilt_texts
    assert "Updated outer container text." in rebuilt_texts


@pytest.mark.parametrize("fmt", ["pdf", "docx", "doc", "txt"])
def test_export_all_four_formats(fmt: str):
    title = "IEEE Paper Draft"
    content = "Introduction to HumanDoc.\n\nOur architecture preserves layout across Word and PDF documents."
    raw, media = doc_convert.export_document_bytes(title, content, fmt)
    assert len(raw) > 50
    assert media == doc_convert.FORMAT_MEDIA_TYPES[fmt]

    if fmt == "pdf":
        d = fitz.open(stream=raw, filetype="pdf")
        txt = "".join(p.get_text() for p in d)
        d.close()
        assert "Introduction to HumanDoc" in txt
    elif fmt == "docx":
        d = Document(io.BytesIO(raw))
        txt = "\n".join(p.text for p in d.paragraphs)
        assert "preserves layout" in txt
    elif fmt == "doc":
        paras, variant = doc_convert.extract_word_paragraphs(raw, "export.doc")
        assert variant == "rtf"
        assert any("preserves layout" in p for p in paras)
    elif fmt == "txt":
        assert "preserves layout" in raw.decode("utf-8")


def test_drillbit_extract_and_export_endpoints(tmp_path: Path):
    client = TestClient(app)

    # Extract legacy OLE2 .doc
    ole2 = _build_minimal_ole2_doc(["Academic Abstract", "This experiment evaluates multi-format Word parsing."])
    res = client.post("/drillbit/extract", files={"file": ("paper.doc", ole2, "application/msword")})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert "evaluates multi-format Word parsing" in body["text"]

    # Extract DOCX containing table text (previously missing from drillbit)
    d = Document()
    d.add_paragraph("Body paragraph one.")
    tbl = d.add_table(rows=1, cols=2)
    tbl.cell(0, 0).text = "Table column one"
    tbl.cell(0, 1).text = "Table column two"
    buf = io.BytesIO()
    d.save(buf)

    res2 = client.post(
        "/drillbit/extract",
        files={
            "file": (
                "report.docx",
                buf.getvalue(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert res2.status_code == 200, res2.text
    assert "Table column one" in res2.json()["text"]

    # Export in all 4 formats
    for fmt in ("pdf", "docx", "doc", "txt"):
        exp = client.post(
            "/drillbit/export",
            json={"title": "Test Doc", "text": "Hello exported world.\n\nSecond paragraph.", "format": fmt},
        )
        assert exp.status_code == 200, f"Export failed for {fmt}: {exp.text}"
        assert len(exp.content) > 20

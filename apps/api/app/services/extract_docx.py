"""Word (.docx and .doc) extraction.

Paragraph and run objects inside .docx are never recreated — the rebuild engine
edits text inside existing runs so styles, images, tables and numbering stay.
Legacy .doc variants (OLE2 binary, RTF, HTML/WordXML) are converted cleanly
through doc_convert while preserving logical page chunking for worker progress.
"""
from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from docx import Document
from docx.document import Document as _Document
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph

from app.services import doc_convert
from app.services.blocks import Block, Span

BOLD_FLAG = 16
ITALIC_FLAG = 2

WORDS_PER_PAGE = 350
MAX_BLOCKS_PER_PAGE = 25


def _iter_block_items(parent: _Document | _Cell) -> Iterator[Paragraph | Table]:
    from docx.oxml.ns import qn

    parent_elm = parent.element.body if isinstance(parent, _Document) else parent._tc
    for child in parent_elm.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def _iter_textbox_paragraphs(elm, doc: _Document, seen_p: set[int]) -> list[Paragraph]:
    """Extract paragraphs nested inside Word drawing/textbox shapes (skipping mc:Fallback)."""
    from docx.oxml.ns import qn

    found: list[Paragraph] = []
    mc_fallback = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"

    def scan(node) -> None:
        for child in node:
            if child.tag == mc_fallback:
                continue
            if child.tag == qn("w:txbxContent"):
                for p_elm in child.iterchildren(qn("w:p")):
                    if id(p_elm) not in seen_p:
                        seen_p.add(id(p_elm))
                        found.append(Paragraph(p_elm, doc))
            else:
                scan(child)

    scan(elm)
    return found


def _iter_paragraphs(doc: _Document) -> list[Paragraph]:
    out: list[Paragraph] = []
    seen_cells: set[int] = set()
    seen_p: set[int] = set()

    def walk(container: _Document | _Cell) -> None:
        for item in _iter_block_items(container):
            if isinstance(item, Paragraph):
                if id(item._p) not in seen_p:
                    seen_p.add(id(item._p))
                    out.append(item)
                out.extend(_iter_textbox_paragraphs(item._p, doc, seen_p))
            elif isinstance(item, Table):
                for row in item.rows:
                    for cell in row.cells:
                        if id(cell._tc) in seen_cells:  # merged cells repeat
                            continue
                        seen_cells.add(id(cell._tc))
                        walk(cell)

    walk(doc)
    return out


def _has_page_break(para: Paragraph) -> bool:
    from docx.oxml.ns import qn

    for el in para._p.iter():
        if el.tag == qn("w:br") and el.get(qn("w:type")) == "page":
            return True
        if el.tag == qn("w:lastRenderedPageBreak"):
            return True
    return False


def _classify(text: str, style_name: str, runs: list[Any]) -> tuple[str, str]:
    stripped = text.strip()
    if not stripped:
        return "empty", "empty"
    style = (style_name or "").lower()
    if style.startswith("heading") or style in ("title", "subtitle"):
        return "heading", ""
    if style.startswith("caption"):
        return "caption", "caption"
    if style.startswith("list"):
        return "list_item", ""
    if stripped.startswith(("http://", "https://")):
        return "url", "url"
    if stripped.startswith("[") and stripped.endswith("]") and len(stripped) < 80:
        return "reference", "reference"
    if stripped.startswith(("def ", "class ", "import ", "```")):
        return "code", "code"
    if len(stripped) < 6 and stripped.replace(".", "").isdigit():
        return "page_number", "page_number"
    return "paragraph", ""


def _build_word_document(path: str | Path) -> tuple[_Document, str]:
    raw = Path(path).read_bytes()
    variant = doc_convert.sniff_word_variant(raw)
    if variant == "docx":
        return Document(io.BytesIO(raw)), "docx"

    paras, detected = doc_convert.extract_word_paragraphs(raw, Path(path).name)
    doc = Document()
    for idx, para in enumerate(paras):
        if idx == 0 and len(para) <= 120 and "\n" not in para and not para.endswith("."):
            doc.add_heading(para, level=1)
        else:
            doc.add_paragraph(para)
    return doc, detected


def extract_docx(path: str | Path) -> tuple[list[list[Block]], dict[str, Any]]:
    doc, doc_variant = _build_word_document(path)
    paragraphs = _iter_paragraphs(doc)

    pages: list[list[Block]] = []
    cur_blocks: list[Block] = []
    cur_words = 0

    def flush_page() -> None:
        nonlocal cur_blocks, cur_words
        if cur_blocks:
            pages.append(cur_blocks)
            cur_blocks = []
            cur_words = 0

    for idx, para in enumerate(paragraphs):
        explicit_break = _has_page_break(para)
        if explicit_break and cur_words >= 40:
            flush_page()

        text = para.text
        if not text.strip():
            continue

        runs = [r for r in para.runs if r.text]
        first = runs[0] if runs else None
        bold = bool(first and first.bold)
        italic = bool(first and first.italic)
        size = float(first.font.size.pt) if first and first.font.size else 11.0
        font_name = (first.font.name or "Calibri") if first else "Calibri"
        color = 0
        try:
            if first and first.font.color and first.font.color.rgb:
                rgb = str(first.font.color.rgb)
                color = int(rgb, 16)
        except Exception:
            color = 0

        btype, skip = _classify(text, para.style.name if para.style else "", runs)
        word_count = len(text.split())
        if cur_blocks and (cur_words + word_count > WORDS_PER_PAGE or len(cur_blocks) >= MAX_BLOCKS_PER_PAGE):
            flush_page()

        page_num = len(pages) + 1
        cur_blocks.append(
            Block(
                id=f"p{page_num}b{idx}",
                page=page_num,
                type=btype,
                text=text,
                bbox=[],
                spans=[
                    Span(
                        text=text,
                        font=font_name,
                        size=round(size, 2),
                        color=color,
                        bold=bold,
                        italic=italic,
                        flags=(16 if bold else 0) | (2 if italic else 0),
                    )
                ],
                align=str(para.alignment or "left")
                .lower()
                .replace("wdalignalignment.", "")
                .replace("wd_align_paragraph.", ""),
                order=idx,
                font=font_name,
                size=round(size, 2),
                color=color,
                bold=bold,
                skip=bool(skip),
                skip_reason=skip,
                source=f"docx:idx:{idx}",
            )
        )
        cur_words += word_count

    flush_page()

    meta = {
        "sections": len(doc.sections),
        "inline_shapes": len(doc.inline_shapes),
        "tables": len(doc.tables),
        "paragraphs": len(doc.paragraphs),
        "word_variant": doc_variant,
        "pages": len(pages),
    }
    return pages, meta


def paragraphs_list(path: str | Path) -> list[Paragraph]:
    doc, _ = _build_word_document(path)
    return _iter_paragraphs(doc)

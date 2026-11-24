"""python-docx extraction. Paragraph and run objects are never recreated — the rebuild
engine edits text inside the existing runs so styles, images, tables and numbering stay."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

from docx import Document
from docx.document import Document as _Document
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph

from app.services.blocks import Block, Span

BOLD_FLAG = 16
ITALIC_FLAG = 2


def _iter_block_items(parent: _Document | _Cell) -> Iterator[Paragraph | Table]:
    from docx.oxml.ns import qn

    if isinstance(parent, _Document):
        parent_elm = parent.element.body
    else:
        parent_elm = parent._tc
    for child in parent_elm.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def _iter_paragraphs(doc: _Document) -> list[Paragraph]:
    out: list[Paragraph] = []

    seen_cells: set[int] = set()

    def walk(container: _Document | _Cell) -> None:
        for item in _iter_block_items(container):
            if isinstance(item, Paragraph):
                out.append(item)
            elif isinstance(item, Table):
                for row in item.rows:
                    for cell in row.cells:
                        if id(cell._tc) in seen_cells:  # merged cells repeat
                            continue
                        seen_cells.add(id(cell._tc))
                        walk(cell)

    walk(doc)
    return out


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


def extract_docx(path: str | Path) -> tuple[list[list[Block]], dict[str, Any]]:
    doc = Document(path)
    paragraphs = _iter_paragraphs(doc)

    blocks: list[Block] = []
    for idx, para in enumerate(paragraphs):
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
        blocks.append(
            Block(
                id=f"p1b{idx}",
                page=1,
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
                align=str(para.alignment or "left").lower().replace("wdalignalignment.", "").replace("wd_align_paragraph.", ""),
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

    meta = {
        "sections": len(doc.sections),
        "inline_shapes": len(doc.inline_shapes),
        "tables": len(doc.tables),
        "paragraphs": len(doc.paragraphs),
    }
    return [blocks], meta


def paragraphs_list(path: str | Path) -> list[Paragraph]:
    return _iter_paragraphs(Document(path))

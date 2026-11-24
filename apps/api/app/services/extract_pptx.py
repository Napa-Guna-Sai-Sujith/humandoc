"""python-pptx extraction: slides → shapes → paragraphs → runs, with stable paragraph paths."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.enum.text import PP_ALIGN

from app.services.blocks import Block, Span

ALIGN_MAP = {
    PP_ALIGN.LEFT: "left",
    PP_ALIGN.CENTER: "center",
    PP_ALIGN.RIGHT: "right",
    PP_ALIGN.JUSTIFY: "justify",
}


def iter_paragraph_paths(prs: Any) -> Iterator[tuple[int, Any, Any, str]]:
    """Deterministic (slide_number, shape, paragraph, path) walk used by BOTH extraction and rebuild."""
    for slide_number, slide in enumerate(prs.slides, start=1):
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para_index, para in enumerate(shape.text_frame.paragraphs):
                    yield slide_number, shape, para, f"pptx:s{slide_number}:sh{shape.shape_id}:p{para_index}"
            if getattr(shape, "has_table", False) and shape.has_table:
                for row_index, row in enumerate(shape.table.rows):
                    for col_index, cell in enumerate(row.cells):
                        for para_index, para in enumerate(cell.text_frame.paragraphs):
                            yield (
                                slide_number,
                                shape,
                                para,
                                f"pptx:s{slide_number}:sh{shape.shape_id}:t:{row_index}:{col_index}:{para_index}",
                            )


def _run_meta(para: Any) -> tuple[str, float, bool, int]:
    first = para.runs[0] if para.runs else None
    size = float(first.font.size.pt) if first and first.font.size else 18.0
    name = (first.font.name or "Calibri") if first else "Calibri"
    bold = bool(first and first.font.bold)
    color = 0
    try:
        if first and first.font.color and first.font.color.rgb:
            color = int(str(first.font.color.rgb), 16)
    except Exception:
        color = 0
    return name, size, bold, color


def extract_pptx(path: str | Path) -> tuple[list[list[Block]], dict[str, Any]]:
    prs = Presentation(path)
    page_map: dict[int, list[Block]] = {}
    total_shapes = 0

    for slide_number, _shape, para, path in iter_paragraph_paths(prs):
        total_shapes += 1
        text = "".join(run.text for run in para.runs).strip()
        if not text:
            continue
        name, size, bold, color = _run_meta(para)
        is_table = ":t:" in path
        btype = "table_cell" if is_table else ("heading" if size >= 24 else "paragraph")
        page_map.setdefault(slide_number, []).append(
            Block(
                id=f"p{slide_number}b{len(page_map.get(slide_number, []))}",
                page=slide_number,
                type=btype,
                text=text,
                spans=[Span(text=text, font=name, size=round(size, 2), color=color, bold=bold)],
                align=ALIGN_MAP.get(para.alignment, "left"),
                order=len(page_map.get(slide_number, [])),
                font=name,
                size=round(size, 2),
                color=color,
                bold=bold,
                skip=is_table,
                skip_reason="table" if is_table else "",
                source=path,
            )
        )

    page_count = len(prs.slides)
    pages = [page_map.get(i, []) for i in range(1, page_count + 1)]
    return pages, {"slides": page_count, "shapes": total_shapes}


def load_presentation(path: str | Path) -> Any:
    return Presentation(path)

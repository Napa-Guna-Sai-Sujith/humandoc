"""DOCX rebuild: edit text inside existing runs. The package is never rebuilt from scratch,
so styles, numbering, images, tables, headers and footers stay byte-for-byte intact."""
from __future__ import annotations

import logging
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.run import Run

from app.services.blocks import Block
from app.services.extract_docx import _iter_paragraphs

log = logging.getLogger(__name__)


def _all_runs(paragraph) -> list[Run]:
    """Runs in true document order, including runs nested inside w:hyperlink."""
    runs: list[Run] = []
    for element in paragraph._p.iter():
        if element.tag == qn("w:r"):
            runs.append(Run(element, paragraph))
    return runs


def _distribute(text: str, runs: list[Run]) -> list[str]:
    """Split `text` across runs proportionally to their original lengths."""
    lengths = [max(1, len(r.text)) for r in runs]
    total = sum(lengths) or 1
    out: list[str] = []
    cursor = 0
    for index, (_run, length) in enumerate(zip(runs, lengths, strict=False)):
        if index == len(runs) - 1:
            out.append(text[cursor:])
        else:
            share = min(len(text) - cursor, max(0, round(len(text) * length / total)))
            out.append(text[cursor : cursor + share])
            cursor += share
    # guard: concatenation must be exact
    if "".join(out) != text:
        out = [text] + [""] * (len(runs) - 1)
    return out


def set_paragraph_text(paragraph, new_text: str) -> tuple[bool, str]:
    runs = _all_runs(paragraph)
    if not runs:
        paragraph.add_run(new_text)
        return True, "paragraph had no runs"
    if not paragraph.text:
        return False, "paragraph has no text"
    pieces = _distribute(new_text, runs)
    for run, piece in zip(runs, pieces, strict=False):
        run.text = piece
    return True, ""


def rebuild_docx(src: str | Path, dst: str | Path, pages: list[list[Block]]) -> dict:
    doc = Document(src)
    paragraphs = _iter_paragraphs(doc)
    by_index: dict[int, Block] = {}
    for page in pages:
        for block in page:
            if block.source.startswith("docx:idx:"):
                try:
                    by_index[int(block.source.rsplit(":", 1)[1])] = block
                except ValueError:
                    continue

    replaced = flagged = 0
    for index, paragraph in enumerate(paragraphs):
        block = by_index.get(index)
        if not block or not block.new_text or block.new_text == block.text:
            continue
        try:
            ok, note = set_paragraph_text(paragraph, block.new_text)
            if ok:
                replaced += 1
                if note:
                    flagged += 1
            else:
                block.flag = "docx-run-edit-failed"
                flagged += 1
        except Exception as exc:  # never lose the file over one paragraph
            log.warning("docx paragraph %s failed: %s", index, exc)
            block.flag = "docx-run-edit-failed"
            flagged += 1

    doc.save(dst)
    return {"replaced_blocks": replaced, "flagged": flagged, "paragraphs": len(paragraphs)}

"""PPTX rebuild: replace text inside existing runs, keyed by the same paths as extraction."""
from __future__ import annotations

from pathlib import Path

from app.services.blocks import Block
from app.services.extract_pptx import iter_paragraph_paths, load_presentation


def _distribute(text: str, runs) -> list[str]:
    lengths = [max(1, len(r.text)) for r in runs]
    total = sum(lengths) or 1
    out: list[str] = []
    cursor = 0
    for index, length in enumerate(lengths):
        if index == len(lengths) - 1:
            out.append(text[cursor:])
        else:
            share = min(len(text) - cursor, max(0, round(len(text) * length / total)))
            out.append(text[cursor : cursor + share])
            cursor += share
    if "".join(out) != text:
        out = [text] + [""] * (len(runs) - 1)
    return out


def rebuild_pptx(src: str | Path, dst: str | Path, pages: list[list[Block]]) -> dict:
    prs = load_presentation(src)
    by_path = {b.source: b for page in pages for b in page}
    replaced = flagged = total = 0

    for _slide_number, _shape, para, path in iter_paragraph_paths(prs):
        total += 1
        block = by_path.get(path)
        if not block or not block.new_text or block.new_text == block.text:
            continue
        runs = list(para.runs)
        if not runs:
            para.add_run(block.new_text)
            replaced += 1
            continue
        for run, piece in zip(runs, _distribute(block.new_text, runs), strict=False):
            run.text = piece
        replaced += 1

    prs.save(dst)
    return {"replaced_blocks": replaced, "flagged": flagged, "paragraphs": total}

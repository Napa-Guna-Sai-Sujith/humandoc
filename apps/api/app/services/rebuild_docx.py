"""DOCX rebuild: edit text inside existing runs. The package is never rebuilt from scratch,
so styles, numbering, images, tables, headers and footers stay byte-for-byte intact."""
from __future__ import annotations

import logging
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.run import Run

from app.services import doc_convert
from app.services.blocks import Block
from app.services.extract_docx import _iter_paragraphs

log = logging.getLogger(__name__)

_SKIP_CONTAINERS = {
    "drawing",
    "pict",
    "txbxContent",
    "Fallback",
}


_MEDIA_TAGS = {"drawing", "pict", "object", "AlternateContent", "fldChar", "instrText"}


def _all_runs(paragraph) -> list[Run]:
    """Runs belonging to this paragraph (including w:hyperlink), excluding drawings/textboxes/fields."""
    runs: list[Run] = []

    def walk(node) -> None:
        for child in node:
            local = child.tag.rsplit("}", 1)[-1] if "}" in child.tag else child.tag
            if local in _SKIP_CONTAINERS:
                continue
            if child.tag == qn("w:r"):
                has_media = any(
                    (gc.tag.rsplit("}", 1)[-1] if "}" in gc.tag else gc.tag) in _MEDIA_TAGS
                    for gc in child
                )
                has_text = child.find(qn("w:t")) is not None
                if has_text and not has_media:
                    runs.append(Run(child, paragraph))
            else:
                walk(child)

    walk(paragraph._p)
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


def rebuild_doc(src: str | Path, dst: str | Path, pages: list[list[Block]]) -> dict:
    """Rebuild legacy .doc input back into a Word-compatible .doc file."""
    raw = Path(src).read_bytes()
    variant = doc_convert.sniff_word_variant(raw)

    by_index: dict[int, Block] = {}
    ordered_blocks: list[Block] = []
    for page in pages:
        for block in page:
            ordered_blocks.append(block)
            if block.source.startswith("docx:idx:"):
                try:
                    by_index[int(block.source.rsplit(":", 1)[1])] = block
                except ValueError:
                    continue

    # If the uploaded .doc was actually a misnamed .docx ZIP, rebuild OOXML first, then export .doc
    if variant == "docx":
        import io

        doc = Document(io.BytesIO(raw))
        paragraphs = _iter_paragraphs(doc)
        replaced = flagged = 0
        final_paras: list[str] = []
        for index, paragraph in enumerate(paragraphs):
            block = by_index.get(index)
            text_val = (block.new_text or block.text) if block else paragraph.text
            if block and block.new_text and block.new_text != block.text:
                ok, _note = set_paragraph_text(paragraph, block.new_text)
                if ok:
                    replaced += 1
                else:
                    flagged += 1
            if text_val.strip():
                final_paras.append(text_val.strip())
        doc_bytes, _ = doc_convert.export_document_bytes(Path(src).stem, final_paras, "doc")
        Path(dst).write_bytes(doc_bytes)
        return {"replaced_blocks": replaced, "flagged": flagged, "paragraphs": len(paragraphs)}

    paras, _ = doc_convert.extract_word_paragraphs(raw, Path(src).name)
    replaced = 0
    final_paras: list[str] = []
    for idx, orig in enumerate(paras):
        block = by_index.get(idx)
        if block and block.new_text and block.new_text != block.text:
            final_paras.append(block.new_text)
            replaced += 1
        elif block and block.text:
            final_paras.append(block.text)
        elif orig.strip():
            final_paras.append(orig.strip())

    if not final_paras:
        final_paras = [b.new_text or b.text for b in ordered_blocks if (b.new_text or b.text).strip()]

    doc_bytes, _ = doc_convert.export_document_bytes(Path(src).stem, final_paras, "doc")
    Path(dst).write_bytes(doc_bytes)
    return {"replaced_blocks": replaced, "flagged": 0, "paragraphs": len(final_paras)}

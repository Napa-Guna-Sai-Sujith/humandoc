"""TXT / Markdown rebuild: exact-substring replacement so code fences, front matter and
inline syntax stay untouched."""
from __future__ import annotations

from pathlib import Path

from app.services.blocks import Block


def rebuild_text(src: str | Path, dst: str | Path, pages: list[list[Block]]) -> dict:
    text = Path(src).read_text(encoding="utf-8", errors="replace")
    replaced = 0
    for page in pages:
        for block in page:
            if not block.new_text or block.new_text == block.text or not block.text.strip():
                continue
            needle = block.text.strip()
            if needle and needle in text:
                text = text.replace(needle, block.new_text.strip(), 1)
                replaced += 1
            elif needle:
                block.flag = "text-anchor-missing"
    Path(dst).write_text(text, encoding="utf-8")
    return {"replaced_blocks": replaced}

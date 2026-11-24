"""TXT / Markdown extraction: block-level, with code fences and front matter protected."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.services.blocks import Block, Span

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
LIST_RE = re.compile(r"^(\s*)([-*+]|\d+\.)\s+")
URL_RE = re.compile(r"https?://\S+")


def split_markdown(text: str) -> list[str]:
    lines = text.splitlines()
    blocks: list[str] = []
    buf: list[str] = []
    in_fence = False

    for line in lines:
        if line.strip().startswith("```"):
            if buf:
                blocks.append("\n".join(buf))
                buf = []
            in_fence = not in_fence
            blocks.append(line)
            continue
        if in_fence:
            blocks.append(line)
            continue
        if not line.strip():
            if buf:
                blocks.append("\n".join(buf))
                buf = []
            continue
        if HEADING_RE.match(line.strip()):
            if buf:
                blocks.append("\n".join(buf))
                buf = []
            blocks.append(line.strip())
            continue
        buf.append(line)
    if buf:
        blocks.append("\n".join(buf))
    return blocks


def extract_text_file(path: str | Path, is_markdown: bool) -> tuple[list[list[Block]], dict[str, Any]]:
    raw = Path(path).read_text(encoding="utf-8", errors="replace")
    chunks = split_markdown(raw) if is_markdown else re.split(r"\n\s*\n", raw)
    blocks: list[Block] = []
    in_fence = False
    order = 0

    for chunk in chunks:
        text = chunk.strip("\n")
        if not text.strip():
            continue
        if text.strip().startswith("```"):
            in_fence = not in_fence
            blocks.append(
                Block(id=f"p1b{order}", page=1, type="code", text=text, skip=True, skip_reason="code",
                      spans=[Span(text=text, font="monospace", size=11)],
                      source=f"txt:idx:{order}", order=order)
            )
            order += 1
            continue
        if in_fence:
            blocks.append(
                Block(id=f"p1b{order}", page=1, type="code", text=text, skip=True, skip_reason="code",
                      spans=[Span(text=text, font="monospace", size=11)],
                      source=f"txt:idx:{order}", order=order)
            )
            order += 1
            continue
        heading = HEADING_RE.match(text.strip())
        is_list = bool(LIST_RE.match(text))
        is_url = bool(URL_RE.fullmatch(text.strip()))
        btype = "heading" if heading else "list_item" if is_list else "paragraph"
        skip = "url" if is_url else ""
        blocks.append(
            Block(
                id=f"p1b{order}",
                page=1,
                type=btype,
                text=text,
                spans=[Span(text=text, font="monospace" if is_list else "sans", size=11)],
                order=order,
                font="sans",
                size=11,
                skip=bool(skip),
                skip_reason=skip,
                source=f"txt:idx:{order}",
            )
        )
        order += 1

    return [blocks], {"chars": len(raw), "words": len(raw.split())}

"""Neutral block model shared by every extractor and the rewrite/rebuild engines."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

SKIP_REASONS = {
    "image": "image",
    "chart": "chart",
    "equation": "equation",
    "code": "code block",
    "url": "URL",
    "reference": "reference/citation",
    "page_number": "page number",
    "header_footer": "header/footer",
    "table": "table",
    "caption": "caption",
    "locked": "locked by user",
    "empty": "empty",
    "protected": "protected term",
}


@dataclass
class Span:
    text: str
    font: str = "Helvetica"
    size: float = 11.0
    color: int = 0
    bold: bool = False
    italic: bool = False
    flags: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Span:
        known = {k: d[k] for k in cls.__dataclass_fields__ if k in d}  # type: ignore[attr-defined]
        known.setdefault("text", "")
        return cls(**known)


@dataclass
class Block:
    id: str
    page: int
    type: str = "paragraph"
    text: str = ""
    bbox: list[float] = field(default_factory=list)
    spans: list[Span] = field(default_factory=list)
    align: str = "left"
    order: int = 0
    font: str = "Helvetica"
    size: float = 11.0
    color: int = 0
    bold: bool = False
    skip: bool = False
    skip_reason: str = ""
    locked: bool = False
    source: str = ""
    new_text: str = ""
    flag: str = ""
    retry_count: int = 0

    # ---------- helpers
    @property
    def word_count(self) -> int:
        return len(self.text.split())

    @property
    def char_count(self) -> int:
        return len(self.text)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["spans"] = [s.to_dict() for s in self.spans]
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Block:
        known = {k: d[k] for k in cls.__dataclass_fields__ if k in d}  # type: ignore[attr-defined]
        known["spans"] = [Span.from_dict(s) for s in d.get("spans", [])]
        return cls(**known)

    def primary_span(self) -> Span | None:
        if not self.spans:
            return None
        return max(self.spans, key=lambda s: len(s.text))


def blocks_from_dicts(items: list[dict[str, Any]]) -> list[Block]:
    return [Block.from_dict(d) for d in items]


def blocks_to_dicts(blocks: list[Block]) -> list[dict[str, Any]]:
    return [b.to_dict() for b in blocks]

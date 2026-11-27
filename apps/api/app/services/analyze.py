"""Pre-job report: type detection, page count, selectability, languages, fonts, cost estimate."""
from __future__ import annotations

import datetime as dt
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.services import extract_docx, extract_pdf, extract_pptx, extract_text
from app.services.blocks import Block, blocks_to_dicts
from app.services.detect import UnsupportedFileError, sniff

log = logging.getLogger(__name__)

RANGE_RE = re.compile(r"^\s*(\d+)\s*(?:-\s*(\d+))?\s*$")


@dataclass
class Analysis:
    kind: str
    mime: str
    total_pages: int
    selected_pages: list[int]
    pages: list[list[Block]] = field(default_factory=list)
    page_metrics: list[Any] = field(default_factory=list)
    words: int = 0
    languages: list[str] = field(default_factory=list)
    fonts: list[str] = field(default_factory=list)
    selectable: bool = True
    needs_ocr: bool = False
    blocks_total: int = 0
    blocks_rewrite: int = 0
    blocks_skipped: int = 0
    words_rewrite: int = 0
    est_tokens_in: int = 0
    est_tokens_out: int = 0
    est_cost_usd: float = 0.0
    warnings: list[str] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "mime": self.mime,
            "total_pages": self.total_pages,
            "selected_pages": len(self.selected_pages),
            "words": self.words,
            "words_rewrite": self.words_rewrite,
            "languages": self.languages,
            "fonts": self.fonts[:24],
            "selectable": self.selectable,
            "needs_ocr": self.needs_ocr,
            "blocks_total": self.blocks_total,
            "blocks_rewrite": self.blocks_rewrite,
            "blocks_skipped": self.blocks_skipped,
            "est_tokens_in": self.est_tokens_in,
            "est_tokens_out": self.est_tokens_out,
            "est_cost_usd": round(self.est_cost_usd, 4),
            "warnings": self.warnings,
            "meta": self.meta,
        }


def parse_page_ranges(spec: str | None, total: int) -> list[int]:
    if not spec or spec.strip().lower() in ("all", "", "none"):
        return list(range(1, total + 1))
    pages: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        m = RANGE_RE.match(part)
        if not m:
            raise ValueError(f"Invalid page range: {part!r}")
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else start
        if start > end:
            start, end = end, start
        for n in range(max(1, start), min(total, end) + 1):
            pages.add(n)
    return sorted(pages) or list(range(1, total + 1))


def _detect_language(sample: str) -> list[str]:
    try:
        from langdetect import detect_langs

        clean = re.sub(r"\s+", " ", sample)[:4000]
        if len(clean) < 12:
            return []
        return sorted({item.lang for item in detect_langs(clean) if item.prob > 0.2}) or []
    except Exception:
        return []


def _apply_options(blocks: list[Block], options: dict[str, Any]) -> None:
    skip = options.get("skip") or {}
    if skip.get("tables") is False:
        for b in blocks:
            if b.skip_reason == "table":
                b.skip, b.skip_reason = False, ""
    if skip.get("captions") is False:
        for b in blocks:
            if b.skip_reason == "caption":
                b.skip, b.skip_reason = False, ""
    if skip.get("headers_footers") is False:
        for b in blocks:
            if b.skip_reason == "header_footer":
                b.skip, b.skip_reason = False, ""
    if skip.get("references") is False:
        for b in blocks:
            if b.skip_reason == "reference":
                b.skip, b.skip_reason = False, ""
    protected = [t.strip().lower() for t in (options.get("protected_terms") or []) if t.strip()]
    if protected:
        for b in blocks:
            low = b.text.lower()
            hits = [t for t in protected if t in low]
            if hits and len(hits) >= max(1, len(protected) // 2):
                b.skip, b.skip_reason = True, "protected"


def analyze_file(path: str, kind: str, mime: str, filename: str, options: dict[str, Any]) -> Analysis:
    sniffed_kind, sniffed_mime = sniff(path, filename)
    if sniffed_kind != kind:
        kind, mime = sniffed_kind, sniffed_mime

    page_metrics: list[Any] = []
    meta: dict[str, Any] = {}
    if kind == "pdf":
        pages, page_metrics = extract_pdf.extract_pdf(path)
    elif kind in ("docx", "doc"):
        pages, meta = extract_docx.extract_docx(path)
    elif kind == "pptx":
        pages, meta = extract_pptx.extract_pptx(path)
    else:
        pages, meta = extract_text.extract_text_file(path, is_markdown=(kind == "md"))

    total_pages = len(pages)
    if total_pages == 0:
        raise UnsupportedFileError("Document contains no readable pages")

    selected = parse_page_ranges(options.get("page_range"), total_pages)
    if options.get("page_range") not in (None, "", "all"):
        for number in range(1, total_pages + 1):
            if number not in set(selected):
                for b in pages[number - 1]:
                    b.skip, b.skip_reason = True, "out_of_range"

    for page_blocks in pages:
        _apply_options(page_blocks, options)

    flat = [b for page in pages for b in page]
    words = sum(b.word_count for b in flat)
    rewrite_blocks = [b for b in flat if not b.skip and b.word_count >= 2]
    rewrite_words = sum(b.word_count for b in rewrite_blocks)

    sample = "\n".join(b.text for b in flat)[:20000]
    languages = _detect_language(sample)
    fonts = sorted({s.font for b in flat for s in b.spans}) or sorted({b.font for b in flat})

    text_chars = sum(len(b.text) for b in flat)
    selectable = text_chars / max(total_pages, 1) >= 120 if kind == "pdf" else True
    needs_ocr = kind == "pdf" and extract_pdf.needs_ocr(pages, total_pages)

    warnings: list[str] = []
    if needs_ocr:
        warnings.append(
            "This PDF has little selectable text — it will be OCR'd with Tesseract before rewriting. "
            "Layout fidelity for scanned pages depends on the original scan quality."
        )
    if not languages:
        warnings.append("Could not confidently detect the document language; the original language will be kept.")
    if total_pages > settings.job_max_pages:
        raise UnsupportedFileError(f"Document has {total_pages} pages; the limit is {settings.job_max_pages}")

    tokens_in = int(rewrite_words * 1.35) + 220 * len(rewrite_blocks)
    tokens_out = int(rewrite_words * 1.15) + 40 * len(rewrite_blocks)
    cost = ((tokens_in + tokens_out) / 1_000_000) * settings.price_per_1m_tokens

    return Analysis(
        kind=kind,
        mime=mime,
        total_pages=total_pages,
        selected_pages=selected,
        pages=pages,
        page_metrics=page_metrics,
        words=words,
        languages=languages,
        fonts=fonts,
        selectable=selectable,
        needs_ocr=needs_ocr,
        blocks_total=len(flat),
        blocks_rewrite=len(rewrite_blocks),
        blocks_skipped=len(flat) - len(rewrite_blocks),
        words_rewrite=rewrite_words,
        est_tokens_in=tokens_in,
        est_tokens_out=tokens_out,
        est_cost_usd=cost,
        warnings=warnings,
        meta={k: v for k, v in meta.items() if isinstance(v, int | float | str | bool)},
    )


def analysis_pages_payload(analysis: Analysis) -> list[dict[str, Any]]:
    return [
        {"page_number": i + 1, "blocks": blocks_to_dicts(blocks)}
        for i, blocks in enumerate(analysis.pages)
    ]


def estimate_tokens(words: int, blocks: int) -> tuple[int, int]:
    return int(words * 1.35 + 220 * blocks), int(words * 1.15 + 40 * blocks)


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def human_pages(n: int) -> str:
    return f"{n} page{'s' if n != 1 else ''}"

"""Layout-preserving PDF rebuild.

1. Add redaction annotations over ONLY the text blocks we rewrote.
2. Apply redactions with images and vector graphics preserved (PDF_REDACT_*_NONE).
3. Re-insert the new text into the exact same bbox, reusing the embedded font when possible
   and matching size / colour / alignment otherwise.
4. If the text overflows: shrink the font up to 8%, then ask the model for a shorter version.
   Never move or resize images.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import fitz

from app.services.blocks import Block

log = logging.getLogger(__name__)

BOLD_FLAG = 16
ITALIC_FLAG = 2
SERIF_FLAG = 4
MONO_FLAG = 8

BASE14 = {
    ("sans", False, False): "helv",
    ("sans", True, False): "hebo",
    ("sans", False, True): "heit",
    ("sans", True, True): "hebi",
    ("serif", False, False): "tiro",
    ("serif", True, False): "tibo",
    ("serif", False, True): "tiit",
    ("serif", True, True): "tibi",
    ("mono", False, False): "cour",
    ("mono", True, False): "cobo",
    ("mono", False, True): "coit",
    ("mono", True, True): "cobi",
}

ALIGN_MAP = {
    "left": fitz.TEXT_ALIGN_LEFT,
    "center": fitz.TEXT_ALIGN_CENTER,
    "right": fitz.TEXT_ALIGN_RIGHT,
    "justify": fitz.TEXT_ALIGN_JUSTIFY,
}

SANS_HINTS = ("helv", "arial", "calibri", "roboto", "inter", "open", "noto sans", "segoe", "sans")
SERIF_HINTS = ("times", "garamond", "georgia", "serif", "cambria", "book", "palatino", "minion")
MONO_HINTS = ("courier", "mono", "consol", "menlo", "code", "source code")


def _norm_font(name: str) -> str:
    name = name.split("+")[-1]
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _font_family(name: str, flags: int = 0) -> str:
    low = name.lower()
    if flags & MONO_FLAG or any(h in low for h in MONO_HINTS):
        return "mono"
    if flags & SERIF_FLAG or any(h in low for h in SERIF_HINTS):
        return "serif"
    return "sans"


def _color_tuple(color: int) -> tuple[float, float, float]:
    return (((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255)


@dataclass
class PageFix:
    block_id: str
    action: str  # shrunk | shortened | kept-original
    from_size: float
    to_size: float
    detail: str = ""


@dataclass
class RebuildReport:
    pages: int = 0
    rewritten_blocks: int = 0
    overflow_fixes: list[PageFix] = field(default_factory=list)
    fonts_reused: int = 0
    fonts_substituted: int = 0
    warnings: list[str] = field(default_factory=list)


class _FontResolver:
    def __init__(self, doc: fitz.Document, page: fitz.Page):
        self.doc = doc
        self.page = page
        self.embedded: dict[str, tuple[int, str]] = {}
        self._counter = 0
        self._resolved_cache: dict[int, str] = {}
        self._failed_xrefs: set[int] = set()
        self._font_objs: dict[str, fitz.Font] = {}
        try:
            fonts = page.get_fonts(full=True)
        except Exception:
            fonts = []
        for entry in fonts:
            try:
                xref, _ext, _ftype, basefont, _name, _enc, _ref = entry
            except (ValueError, TypeError):
                continue
            key = _norm_font(basefont)
            if key:
                self.embedded.setdefault(key, (xref, basefont))
            # also index by full name without normalization
            self.embedded.setdefault(basefont.lower(), (xref, basefont))

    def fallback_for(self, block: Block) -> str:
        family = _font_family(block.font, block.spans[0].flags if block.spans else 0)
        bold = bool(block.bold) or (block.spans[0].flags & BOLD_FLAG if block.spans else False)
        italic = bool(block.spans[0].italic if block.spans else False) or (
            block.spans[0].flags & ITALIC_FLAG if block.spans else False
        )
        return BASE14.get((family, bold, italic), "helv")

    def resolve(self, block: Block) -> tuple[str, bool]:
        target = _norm_font(block.font)
        for key in (target, block.font.lower()):
            if key in self.embedded:
                xref, basefont = self.embedded[key]
                if xref in self._resolved_cache:
                    return self._resolved_cache[xref], True
                if xref in self._failed_xrefs:
                    continue
                try:
                    info = self.doc.extract_font(xref)
                    ext = (info[1] or "").lower() if info and len(info) > 1 else ""
                    buf = info[3] if info and len(info) > 3 else b""
                    if buf and ext in ("ttf", "otf"):
                        font_obj = fitz.Font(fontbuffer=buf)
                        alias = f"HBF{self._counter}"
                        self._counter += 1
                        self.page.insert_font(fontname=alias, fontbuffer=buf)
                        self._resolved_cache[xref] = alias
                        self._font_objs[alias] = font_obj
                        return alias, True
                    self._failed_xrefs.add(xref)
                except Exception as exc:  # font extraction can fail for Type3 / CFF / subset fonts
                    self._failed_xrefs.add(xref)
                    log.debug("font reuse failed for %s: %s", basefont, exc)
        return self.fallback_for(block), False


def _insert(page: fitz.Page, rect: fitz.Rect, text: str, fontname: str, size: float,
            color: tuple[float, float, float], align: int, lineheight: float,
            fallback_font: str = "helv") -> float:
    for candidate_font in (fontname, fallback_font, "helv"):
        try:
            try:
                return page.insert_textbox(
                    rect, text, fontsize=size, fontname=candidate_font, color=color, align=align,
                    lineheight=lineheight, overlay=True,
                )
            except TypeError:
                return page.insert_textbox(
                    rect, text, fontsize=size, fontname=candidate_font, color=color, align=align, overlay=True
                )
        except Exception as exc:
            if candidate_font == "helv":
                raise
            log.debug("insert_textbox failed with font %s (%s), falling back", candidate_font, exc)
    return -1.0


def _fits_in_box(
    text: str,
    box: fitz.Rect,
    size: float,
    lineheight: float,
    fontname: str,
    font_obj: fitz.Font | None = None,
) -> bool:
    """Fast in-memory line-wrap estimator to avoid expensive apply_redactions() retries."""
    max_w = max(10.0, box.width - 2.0)
    max_h = max(8.0, box.height)
    line_h = size * lineheight
    max_lines = max(1, int(max_h // line_h))

    def _measure(s: str) -> float:
        if font_obj is not None:
            return font_obj.text_length(s, fontsize=size)
        try:
            return fitz.get_text_length(s, fontname=fontname, fontsize=size)
        except Exception:
            return len(s) * size * 0.52

    lines = 0
    for para in text.split("\n"):
        words = para.split()
        if not words:
            lines += 1
            continue
        cur = words[0]
        for w in words[1:]:
            if _measure(f"{cur} {w}") <= max_w:
                cur = f"{cur} {w}"
            else:
                lines += 1
                if lines > max_lines:
                    return False
                cur = w
        lines += 1
        if lines > max_lines:
            return False
    return True


def _fit_and_insert(
    page: fitz.Page,
    rect: fitz.Rect,
    text: str,
    fontname: str,
    base_size: float,
    color: tuple[float, float, float],
    align: int,
    lineheight: float = 1.18,
    fallback_font: str = "helv",
    font_obj: fitz.Font | None = None,
) -> tuple[float, float]:
    """Fit text into rect adjusting font size dynamically in memory before inserting once."""
    norm_text = " ".join(text.split()) if "\n" in text and len(text) > 40 else text.strip()

    v_pad = max(4.0, base_size * 0.35)
    page_w = page.rect.width
    r_x1 = max(rect.x1 + 4.0, page_w - 60.0 if rect.x1 > page_w * 0.72 else rect.x1 + 4.0)
    box = fitz.Rect(rect.x0, rect.y0 - 0.5, r_x1, rect.y1 + v_pad)

    candidates = [
        base_size,
        base_size * 0.96,
        base_size * 0.92,
        base_size * 0.86,
        base_size * 0.80,
        base_size * 0.75,
        7.5,
    ]

    chosen = candidates[-1]
    for sz in candidates:
        if _fits_in_box(norm_text, box, sz, lineheight, fontname, font_obj):
            chosen = sz
            break

    spare = _insert(page, box, norm_text, fontname, chosen, color, align, lineheight, fallback_font=fallback_font)
    if spare < 0 and chosen > candidates[-1]:
        # Single fast retry at smallest readable size only if PyMuPDF's exact glyph kerning overflowed
        page.add_redact_annot(box + (-1, -1, 1, 1), fill=False, text="")
        page.apply_redactions(
            images=fitz.PDF_REDACT_IMAGE_NONE,
            graphics=fitz.PDF_REDACT_LINE_ART_NONE,
            text=fitz.PDF_REDACT_TEXT_REMOVE,
        )
        spare = _insert(page, box, norm_text, fontname, candidates[-1], color, align, lineheight, fallback_font=fallback_font)
        return candidates[-1], spare
    return chosen, spare


def rebuild_pdf(
    src: str | Path,
    dst: str | Path,
    pages: list[list[Block]],
    *,
    shorter: Callable[[Block, int], str | None] | None = None,
    report: RebuildReport | None = None,
) -> RebuildReport:
    report = report or RebuildReport()
    doc = fitz.open(src)
    report.pages = doc.page_count

    for page_index, page in enumerate(doc):
        blocks = pages[page_index] if page_index < len(pages) else []
        targets = [b for b in blocks if b.new_text and b.new_text != b.text and not b.skip]
        if not targets:
            continue

        resolver = _FontResolver(doc, page)
        rotation = page.rotation_matrix

        for block in targets:
            try:
                rect = fitz.Rect(block.bbox) * rotation
            except Exception:
                rect = fitz.Rect(block.bbox)
            if rect.is_empty or rect.width < 4 or rect.height < 4:
                continue
            pad = 0.6
            page.add_redact_annot(rect + (-pad, -pad, pad, pad), fill=False, text="")

        page.apply_redactions(
            images=fitz.PDF_REDACT_IMAGE_NONE,
            graphics=fitz.PDF_REDACT_LINE_ART_NONE,
            text=fitz.PDF_REDACT_TEXT_REMOVE,
        )

        for block in targets:
            rect = fitz.Rect(block.bbox) * rotation
            if rect.is_empty or rect.width < 4 or rect.height < 4:
                continue
            fontname, reused = resolver.resolve(block)
            fallback_font = resolver.fallback_for(block)
            if reused:
                report.fonts_reused += 1
            else:
                report.fonts_substituted += 1

            orig_size = float(block.size) if block.size else 11.0
            size = max(6.0, orig_size)
            color = _color_tuple(block.color or 0)
            align = ALIGN_MAP.get(block.align, fitz.TEXT_ALIGN_LEFT)
            text = block.new_text

            font_obj = resolver._font_objs.get(fontname)
            used_size, spare = _fit_and_insert(
                page, rect, text, fontname, size, color, align, fallback_font=fallback_font, font_obj=font_obj
            )
            if used_size < size:
                report.overflow_fixes.append(
                    PageFix(block.id, "shrunk", size, used_size, f"{round((1 - used_size / size) * 100)}% font fitted")
                )
            if spare < 0 and shorter:
                max_chars = max(20, int(len(text) * 0.82))
                shorter_text = shorter(block, max_chars)
                if shorter_text and len(shorter_text) < len(text):
                    used_size, spare = _fit_and_insert(page, rect, shorter_text, fontname, size, color, align, fallback_font=fallback_font)
                    if spare >= 0:
                        block.new_text = shorter_text
                        report.overflow_fixes.append(
                            PageFix(block.id, "shortened", size, used_size, f"{len(text)}→{len(shorter_text)} chars")
                        )
            report.rewritten_blocks += 1

    doc.save(dst, garbage=2, deflate=True, clean=False)
    doc.close()
    return report


def page_metrics(path: str | Path, max_pages: int | None = None) -> dict[str, Any]:
    """Cheap structural fingerprint used by the verifier."""
    doc = fitz.open(path)
    pages = []
    for index, page in enumerate(doc):
        if max_pages and index >= max_pages:
            break
        images = []
        for img in page.get_images(full=True):
            try:
                info = doc.extract_image(img[0])
                if info and info.get("image"):
                    import hashlib

                    images.append(hashlib.sha256(info["image"]).hexdigest()[:32])
            except Exception:
                continue
        pages.append(
            {
                "number": index + 1,
                "width": round(page.rect.width, 2),
                "height": round(page.rect.height, 2),
                "rotation": page.rotation,
                "images": sorted(images),
                "drawings": len(page.get_drawings()) if index < 60 else -1,
                "fonts": sorted({f[3] for f in page.get_fonts(full=True)}),
                "chars": len(page.get_text("text")),
            }
        )
    total = doc.page_count
    doc.close()
    return {"page_count": total, "pages": pages}

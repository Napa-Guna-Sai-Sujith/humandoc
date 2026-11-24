"""PyMuPDF-based PDF extraction.

Produces per-page blocks with bbox, font, size, colour, alignment and reading order.
Vector graphics and images are *never* returned as blocks — only their geometry is
recorded so the rebuild engine can prove they survived untouched.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz

from app.services.blocks import Block, Span

URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
CITATION_RE = re.compile(r"\[\d+(?:[,\-–]\s*\d+)*\]|\(\s*[A-Z][A-Za-z]+(?:\s+et\s+al\.)?,?\s*\d{4}[a-z]?\s*\)")
DOI_RE = re.compile(r"\b10\.\d{4,9}/[^\s]+", re.I)
PAGENO_RE = re.compile(r"^\s*(?:page\s*)?(\d{1,4})\s*(?:of\s*\d{1,4})?\s*$", re.I)
EQUATION_FONT_HINTS = ("cmr", "cmmi", "cmsy", "cmex", "math", "symbol", "msam", "euclid")
CODE_FONT_HINTS = ("courier", "mono", "consol", "menlo", "cour", "code")

BOLD_FLAG = 16
ITALIC_FLAG = 2
SERIF_FLAG = 4
MONO_FLAG = 8


@dataclass
class PageMetrics:
    page_number: int
    width: float
    height: float
    rotation: int
    image_hashes: list[str]
    drawing_count: int
    fonts: list[str]
    text_chars: int


def _color_tuple(color: int) -> tuple[float, float, float]:
    return ((color >> 16) & 255, (color >> 8) & 255, color & 255)


def _align_from(line: dict[str, Any], page_width: float) -> str:
    bbox = line.get("bbox") or [0, 0, 0, 0]
    width = bbox[2] - bbox[0]
    left = bbox[0]
    right = page_width - bbox[2]
    if left > 0.25 * page_width and right > 0.25 * page_width and width < 0.7 * page_width:
        return "center"
    if right < max(12.0, 0.03 * page_width):
        return "right"
    if abs(left - right) < max(8.0, 0.02 * page_width):
        return "justify"
    return "left"


def _page_image_hashes(page: fitz.Page) -> list[str]:
    hashes: list[str] = []
    for img in page.get_images(full=True):
        xref = img[0]
        try:
            info = page.parent.extract_image(xref)
        except Exception:
            continue
        if info and info.get("image"):
            hashes.append(hashlib.sha256(info["image"]).hexdigest()[:32])
    return sorted(hashes)


def _is_equation_line(spans: list[Span], text: str) -> bool:
    if not spans:
        return False
    if any(any(h in s.font.lower() for h in EQUATION_FONT_HINTS) for s in spans):
        return True
    symbols = sum(text.count(c) for c in "∑∫∂√≈≤≥±×÷→←↔∞αβγδεθλμπσφω")
    return symbols >= 2 and len(text) < 400


def _classify(block: dict[str, Any], page_height: float, page_width: float, in_table: bool) -> tuple[str, str]:
    """Return (block_type, skip_reason)."""
    text = (block.get("text") or "").strip()
    spans = [s for line in block.get("lines", []) for s in line.get("spans", [])]
    first = spans[0] if spans else None
    y0 = block["bbox"][1]
    y1 = block["bbox"][3]
    top_margin = page_height * 0.075
    bottom_margin = page_height * 0.06

    if not text:
        return "empty", "empty"
    if PAGENO_RE.match(text) and len(text) <= 12:
        return "page_number", "page_number"
    if URL_RE.fullmatch(text) or (EMAIL_RE.fullmatch(text)):
        return "url", "url"
    if DOI_RE.search(text) and len(text) < 220:
        return "reference", "reference"
    if CITATION_RE.search(text) and len(text) < 160 and text.count("[") >= 2:
        return "reference", "reference"
    if _is_equation_line([Span(font=s.get("font", ""), text=s.get("text", "")) for s in spans], text):
        return "equation", "equation"
    if first and any(h in first.get("font", "").lower() for h in CODE_FONT_HINTS) and "\n" in text:
        return "code", "code"
    if in_table:
        return "table_cell", "table"
    if y1 < top_margin or y0 > page_height - bottom_margin:
        if len(text) < 240:
            return "header_footer", "header_footer"
    if re.match(r"^(chapter\s+\d+|[0-9]+(\.[0-9]+)*\s+[A-Z]|table\s+of\s+contents|certificate|declaration|acknowledgement|submitted\s+by|under\s+the\s+guidance|signature\s+of)", text, re.I):
        if len(text) < 180 or (text.count("\n") <= 4 and len(text) < 250):
            return "heading", "structural_template"
    if first:
        size = first.get("size", 11)
        if size >= 16 or (first.get("flags", 0) & BOLD_FLAG and size >= 12.5 and len(text) < 160):
            return "heading", "heading"
    if re.match(r"^(figure|fig\.|table|tab\.)\s*\d+", text, re.I) and len(text) < 300:
        return "caption", "caption"
    if re.match(r"^(\d+\.|[a-z]\)|[•·–—-])\s+", text):
        return "list_item", ""
    return "paragraph", ""


def _detect_columns(blocks: list[dict[str, Any]], page_width: float, page_height: float) -> bool:
    """Two-column heuristic: blocks avoid the horizontal centre and fill both halves."""
    _ = page_height
    if len(blocks) < 4:
        return False
    centre = page_width / 2
    spanning = 0
    left = right = 0
    for b in blocks:
        x0, x1 = b["bbox"][0], b["bbox"][2]
        if x1 - x0 > page_width * 0.62:
            spanning += 1
        elif x1 <= centre + 20:
            left += 1
        elif x0 >= centre - 20:
            right += 1
        else:
            spanning += 1
    return left >= 2 and right >= 2 and spanning <= max(1, len(blocks) // 6)


def _order_blocks(blocks: list[dict[str, Any]], page_width: float, page_height: float) -> list[dict[str, Any]]:
    if not _detect_columns(blocks, page_width, page_height):
        return sorted(blocks, key=lambda b: (round(b["bbox"][1], 1), b["bbox"][0]))
    centre = page_width / 2
    left = [b for b in blocks if b["bbox"][2] <= centre + 20]
    right = [b for b in blocks if b["bbox"][0] >= centre - 20]
    rest = [b for b in blocks if b not in left and b not in right]
    key = lambda b: (round(b["bbox"][1], 1), b["bbox"][0])  # noqa: E731
    return sorted(left, key=key) + sorted(right, key=key) + sorted(rest, key=key)


def _split_gutter_blocks(raw_blocks: list[dict[str, Any]], page_width: float) -> list[dict[str, Any]]:
    """Split blocks where PyMuPDF merged side-by-side column lines across the page centre."""
    centre = page_width / 2
    out: list[dict[str, Any]] = []
    for b in raw_blocks:
        left_lines: list[dict[str, Any]] = []
        right_lines: list[dict[str, Any]] = []
        spanning_lines: list[dict[str, Any]] = []
        for line in b.get("lines", []):
            spans = [sp for sp in line.get("spans", []) if sp.get("text")]
            if not spans:
                continue
            lspans = [sp for sp in spans if sp["bbox"][2] <= centre + 16]
            rspans = [sp for sp in spans if sp["bbox"][0] >= centre - 16]
            if lspans and rspans and len(lspans) + len(rspans) == len(spans):
                lbbox = [min(x["bbox"][0] for x in lspans), min(x["bbox"][1] for x in lspans),
                         max(x["bbox"][2] for x in lspans), max(x["bbox"][3] for x in lspans)]
                rbbox = [min(x["bbox"][0] for x in rspans), min(x["bbox"][1] for x in rspans),
                         max(x["bbox"][2] for x in rspans), max(x["bbox"][3] for x in rspans)]
                left_lines.append({**line, "spans": lspans, "bbox": lbbox})
                right_lines.append({**line, "spans": rspans, "bbox": rbbox})
            elif lspans and len(lspans) == len(spans):
                left_lines.append(line)
            elif rspans and len(rspans) == len(spans):
                right_lines.append(line)
            else:
                spanning_lines.append(line)
        if left_lines and right_lines and not spanning_lines:
            for grp in (left_lines, right_lines):
                gbbox = [min(ln["bbox"][0] for ln in grp), min(ln["bbox"][1] for ln in grp),
                         max(ln["bbox"][2] for ln in grp), max(ln["bbox"][3] for ln in grp)]
                out.append({"type": 0, "bbox": gbbox, "lines": grp})
        else:
            out.append(b)
    return out


def extract_pdf(path: str | Path) -> tuple[list[list[Block]], list[PageMetrics]]:
    """Return (pages, metrics). pages[i] is the list of blocks on page i (0-based)."""
    doc = fitz.open(path)
    all_pages: list[list[Block]] = []
    metrics: list[PageMetrics] = []

    for index, page in enumerate(doc):
        page_width, page_height = page.rect.width, page.rect.height
        raw = page.get_text("dict", sort=False)
        raw_blocks = _split_gutter_blocks([b for b in raw.get("blocks", []) if b.get("type", 0) == 0], page_width)

        table_regions: list[fitz.Rect] = []
        try:
            found = page.find_tables()
            if found and found.tables:
                table_regions = [fitz.Rect(t.bbox) for t in found.tables]
        except Exception:
            table_regions = []

        prepared: list[dict[str, Any]] = []
        for b in raw_blocks:
            text = "\n".join(
                "".join(span.get("text", "") for span in line.get("spans", [])) for line in b.get("lines", [])
            ).strip()
            if not text:
                continue
            rect = fitz.Rect(b["bbox"])
            b["text"] = text
            in_table = any(rect.intersects(tr) and (rect & tr).get_area() > 0.5 * rect.get_area() for tr in table_regions)
            btype, skip_reason = _classify(b, page_height, page_width, in_table)
            spans = [
                Span(
                    text=span.get("text", ""),
                    font=span.get("font", "Helvetica"),
                    size=round(float(span.get("size", 11)), 2),
                    color=int(span.get("color", 0)),
                    bold=bool(span.get("flags", 0) & BOLD_FLAG),
                    italic=bool(span.get("flags", 0) & ITALIC_FLAG),
                    flags=int(span.get("flags", 0)),
                )
                for line in b.get("lines", [])
                for span in line.get("spans", [])
                if span.get("text")
            ]
            primary = max(spans, key=lambda s: len(s.text)) if spans else Span(text=text)
            line = (b.get("lines") or [{}])[0]
            prepared.append(
                {
                    "text": text,
                    "bbox": [round(v, 3) for v in b["bbox"]],
                    "spans": spans,
                    "align": _align_from(line, page_width),
                    "font": primary.font,
                    "size": primary.size,
                    "color": primary.color,
                    "bold": primary.bold,
                    "type": btype,
                    "skip_reason": skip_reason,
                }
            )

        ordered = _order_blocks(prepared, page_width, page_height)
        blocks: list[Block] = []
        for order, item in enumerate(ordered):
            skip_reason = item["skip_reason"]
            blocks.append(
                Block(
                    id=f"p{index + 1}b{order}",
                    page=index + 1,
                    type=item["type"],
                    text=item["text"],
                    bbox=item["bbox"],
                    spans=item["spans"],
                    align=item["align"],
                    order=order,
                    font=item["font"],
                    size=item["size"],
                    color=item["color"],
                    bold=item["bold"],
                    skip=bool(skip_reason),
                    skip_reason=skip_reason,
                    source=f"pdf:page{index + 1}:block{order}",
                )
            )

        all_pages.append(blocks)
        fonts = sorted({s.font for b in blocks for s in b.spans})
        metrics.append(
            PageMetrics(
                page_number=index + 1,
                width=round(page_width, 3),
                height=round(page_height, 3),
                rotation=int(page.rotation),
                image_hashes=_page_image_hashes(page),
                drawing_count=len(page.get_drawings()) if index < 40 else -1,
                fonts=fonts,
                text_chars=sum(len(b.text) for b in blocks),
            )
        )

    doc.close()
    return all_pages, metrics


def needs_ocr(pages: list[list[Block]], total_pages: int) -> bool:
    if total_pages == 0:
        return False
    chars = sum(len(b.text) for page in pages for b in page)
    return chars / max(total_pages, 1) < 120


def ocr_pdf(path: str | Path) -> str:
    """Rasterise pages without text and OCR them with Tesseract, then rebuild a text PDF."""
    import pytesseract
    from PIL import Image

    doc = fitz.open(path)
    out = fitz.open()
    for page in doc:
        text = page.get_text("text", sort=True).strip()
        pix = page.get_pixmap(dpi=200)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        if len(text) < 40:
            text = pytesseract.image_to_string(img)
        new_page = out.new_page(width=page.rect.width, height=page.rect.height)
        new_page.insert_image(new_page.rect, pixmap=pix)
        if text.strip():
            new_page.insert_textbox(fitz.Rect(40, 40, page.rect.width - 40, page.rect.height - 40), text, fontsize=8)
    tmp = Path(path).with_suffix(".ocr.pdf")
    out.save(tmp)
    out.close()
    doc.close()
    return str(tmp)

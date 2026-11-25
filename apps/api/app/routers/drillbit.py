"""Drillbit / HD Plagiarism document extraction service with 100-page maximum limit."""
from __future__ import annotations

import datetime as dt
import io
import math

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel

router = APIRouter(prefix="/drillbit", tags=["drillbit"])

MAX_PAGES = 100


@router.post("/extract")
async def extract_document(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Uploaded file is empty.")

    filename = file.filename or "document.txt"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "txt"

    text = ""
    pages = 1

    if ext == "pdf":
        try:
            import fitz

            doc = fitz.open(stream=data, filetype="pdf")
            pages = len(doc)
            if pages > MAX_PAGES:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Document exceeds 100-page limit. This PDF contains {pages} pages (maximum allowed is {MAX_PAGES} pages).",
                )
            page_texts = [p.get_text() for p in doc]
            text = "\n\n".join(page_texts).strip()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not parse PDF file: {e}") from e

    elif ext in ("docx", "doc"):
        try:
            import docx

            doc = docx.Document(io.BytesIO(data))
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            text = "\n\n".join(paragraphs).strip()
            words = len(text.split())
            pages = max(1, math.ceil(words / 350))
            if pages > MAX_PAGES:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Document exceeds 100-page limit. This document contains ~{pages} pages (maximum allowed is {MAX_PAGES} pages).",
                )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not parse DOCX file: {e}") from e

    else:
        # Text, Markdown, LaTeX, etc.
        try:
            text = data.decode("utf-8", errors="replace").strip()
        except Exception:
            text = data.decode("latin-1", errors="replace").strip()
        words = len(text.split())
        pages = max(1, math.ceil(words / 350))
        if pages > MAX_PAGES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Document exceeds 100-page limit. This document contains ~{pages} pages (maximum allowed is {MAX_PAGES} pages).",
            )

    words = len(text.split())
    if words == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No readable text content found in document.")

    return {
        "ok": True,
        "filename": filename,
        "pages": pages,
        "wordCount": words,
        "characterCount": len(text),
        "text": text,
    }


class DrillbitSourcePayload(BaseModel):
    id: int
    title: str
    domain: str
    category: str
    percent: int
    matchedWords: int
    color: str


class DrillbitSegmentPayload(BaseModel):
    text: str
    sourceId: int | None = None


class DrillbitReportPDFRequest(BaseModel):
    title: str
    submissionId: str
    wordCount: int
    pageCount: int
    similarityScore: int
    aiScore: int
    gradeBand: str
    gradeDescription: str
    sources: list[DrillbitSourcePayload] = []
    segments: list[DrillbitSegmentPayload] = []


def _hex_to_rgb(hex_str: str) -> tuple[float, float, float]:
    h = hex_str.lstrip("#")
    if len(h) == 6:
        return tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (0.9, 0.2, 0.2)


@router.post("/report-pdf")
async def generate_drillbit_report_pdf(req: DrillbitReportPDFRequest) -> Response:
    """Generate official publication-ready Drillbit Plagiarism & Similarity Report PDF."""
    import fitz

    doc = fitz.open()

    # --- PAGE 1: Official Drillbit Cover Sheet ---
    p1 = doc.new_page(width=595, height=842)
    # Header Banner
    p1.draw_rect(fitz.Rect(0, 0, 595, 75), color=(0.08, 0.18, 0.38), fill=(0.08, 0.18, 0.38))
    p1.insert_text(fitz.Point(40, 44), "DRILLBIT SIMILARITY & PLAGIARISM REPORT", fontsize=18, fontname="hebo", color=(1, 1, 1))
    p1.insert_text(fitz.Point(40, 62), "drillbitplagiarismcheck.com · Academic Verification Certificate", fontsize=9, fontname="helv", color=(0.85, 0.92, 1.0))

    # Metadata Box
    p1.draw_rect(fitz.Rect(40, 95, 555, 185), color=(0.82, 0.84, 0.88), width=1)
    safe_title = req.title[:65]
    p1.insert_text(fitz.Point(55, 120), f"Document Title: {safe_title}", fontsize=11, fontname="hebo", color=(0.1, 0.1, 0.1))
    p1.insert_text(fitz.Point(55, 142), f"Submission ID: {req.submissionId}", fontsize=10, fontname="helv", color=(0.35, 0.35, 0.35))
    p1.insert_text(fitz.Point(320, 142), f"Word Count: {req.wordCount:,} words", fontsize=10, fontname="helv", color=(0.35, 0.35, 0.35))
    p1.insert_text(fitz.Point(55, 164), f"Analyzed On: {dt.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", fontsize=10, fontname="helv", color=(0.35, 0.35, 0.35))
    p1.insert_text(fitz.Point(320, 164), f"Total Pages: {req.pageCount} page(s)", fontsize=10, fontname="helv", color=(0.35, 0.35, 0.35))

    # Similarity Score Card
    p1.draw_rect(fitz.Rect(40, 205, 290, 295), color=(0.2, 0.45, 0.85), fill=(0.95, 0.97, 1.0), width=1.5)
    p1.insert_text(fitz.Point(55, 230), "SIMILARITY INDEX", fontsize=10, fontname="hebo", color=(0.15, 0.4, 0.8))
    p1.insert_text(fitz.Point(55, 275), f"{req.similarityScore}%", fontsize=38, fontname="hebo", color=(0.1, 0.3, 0.7))
    p1.insert_text(fitz.Point(145, 260), f"Grade: {req.gradeBand}", fontsize=11, fontname="hebo", color=(0.2, 0.3, 0.5))
    p1.insert_text(fitz.Point(145, 276), req.gradeDescription[:35], fontsize=9, fontname="helv", color=(0.4, 0.4, 0.5))

    # AI Score Card
    ai_color = (0.1, 0.6, 0.3) if req.aiScore < 15 else (0.8, 0.4, 0.1)
    ai_fill = (0.95, 1.0, 0.97) if req.aiScore < 15 else (1.0, 0.97, 0.93)
    p1.draw_rect(fitz.Rect(305, 205, 555, 295), color=ai_color, fill=ai_fill, width=1.5)
    p1.insert_text(fitz.Point(320, 230), "AI CONTENT INDEX", fontsize=10, fontname="hebo", color=ai_color)
    p1.insert_text(fitz.Point(320, 275), f"{req.aiScore}%", fontsize=38, fontname="hebo", color=ai_color)
    p1.insert_text(fitz.Point(405, 260), "100% Human Authored" if req.aiScore < 15 else f"{req.aiScore}% AI Generated", fontsize=11, fontname="hebo", color=(0.2, 0.2, 0.3))
    p1.insert_text(fitz.Point(405, 276), "Drillbit Extreme AI Engine", fontsize=9, fontname="helv", color=(0.4, 0.4, 0.5))

    # Primary Sources Table Header
    p1.insert_text(fitz.Point(40, 328), "PRIMARY SOURCES IDENTIFIED IN DRILLBIT REPOSITORY", fontsize=11, fontname="hebo", color=(0.1, 0.1, 0.2))
    p1.draw_rect(fitz.Rect(40, 338, 555, 360), color=(0.88, 0.9, 0.94), fill=(0.92, 0.94, 0.97))
    p1.insert_text(fitz.Point(50, 353), "#", fontsize=9, fontname="hebo", color=(0.2, 0.2, 0.3))
    p1.insert_text(fitz.Point(75, 353), "SOURCE / PUBLICATION TITLE", fontsize=9, fontname="hebo", color=(0.2, 0.2, 0.3))
    p1.insert_text(fitz.Point(370, 353), "CATEGORY", fontsize=9, fontname="hebo", color=(0.2, 0.2, 0.3))
    p1.insert_text(fitz.Point(490, 353), "SIMILARITY", fontsize=9, fontname="hebo", color=(0.2, 0.2, 0.3))

    y = 380
    for idx, src in enumerate(req.sources[:12]):
        rgb = _hex_to_rgb(src.color)
        p1.draw_rect(fitz.Rect(48, y - 8, 58, y + 2), color=rgb, fill=rgb)
        p1.insert_text(fitz.Point(50, y), str(idx + 1), fontsize=8, fontname="hebo", color=(1, 1, 1))
        p1.insert_text(fitz.Point(75, y), src.title[:45], fontsize=9, fontname="helv", color=(0.1, 0.1, 0.1))
        p1.insert_text(fitz.Point(370, y), src.category, fontsize=9, fontname="helv", color=(0.35, 0.35, 0.45))
        p1.insert_text(fitz.Point(505, y), f"{src.percent}%", fontsize=9, fontname="hebo", color=(0.1, 0.1, 0.2))
        p1.draw_line(fitz.Point(40, y + 8), fitz.Point(555, y + 8), color=(0.92, 0.92, 0.94), width=0.5)
        y += 24

    # --- PAGES 2+: Document with Annotated Highlights ---
    p_curr = doc.new_page(width=595, height=842)
    p_curr.draw_rect(fitz.Rect(0, 0, 595, 35), color=(0.95, 0.96, 0.98), fill=(0.95, 0.96, 0.98))
    p_curr.insert_text(fitz.Point(40, 22), f"Drillbit Plagiarism Report · {safe_title}", fontsize=8, fontname="helv", color=(0.4, 0.4, 0.5))
    p_curr.insert_text(fitz.Point(480, 22), f"Submission: {req.submissionId}", fontsize=8, fontname="helv", color=(0.4, 0.4, 0.5))

    doc_y = 65
    line_h = 14
    margin_l = 45
    margin_r = 550
    page_bottom = 800

    source_map = {s.id: s for s in req.sources}

    for seg in req.segments:
        text_clean = seg.text.strip()
        if not text_clean:
            doc_y += 6
            continue

        words = text_clean.split()
        cur_line: list[str] = []
        is_matched = seg.sourceId is not None and seg.sourceId in source_map
        src = source_map.get(seg.sourceId) if is_matched else None
        rgb = _hex_to_rgb(src.color) if src else (0, 0, 0)
        bg_rgb = tuple(1.0 - (1.0 - c) * 0.25 for c in rgb) if is_matched else None

        for w in words:
            test_line = " ".join(cur_line + [w])
            line_w = fitz.get_text_length(test_line, fontname="helv", fontsize=9.5)
            if margin_l + line_w > margin_r:
                if doc_y + line_h > page_bottom:
                    p_curr = doc.new_page(width=595, height=842)
                    p_curr.draw_rect(fitz.Rect(0, 0, 595, 35), color=(0.95, 0.96, 0.98), fill=(0.95, 0.96, 0.98))
                    p_curr.insert_text(fitz.Point(40, 22), f"Drillbit Plagiarism Report · {safe_title}", fontsize=8, fontname="helv", color=(0.4, 0.4, 0.5))
                    p_curr.insert_text(fitz.Point(480, 22), f"Submission: {req.submissionId}", fontsize=8, fontname="helv", color=(0.4, 0.4, 0.5))
                    doc_y = 65

                actual_line = " ".join(cur_line)
                lw = fitz.get_text_length(actual_line, fontname="helv", fontsize=9.5)
                if bg_rgb:
                    p_curr.draw_rect(fitz.Rect(margin_l - 2, doc_y - 9, margin_l + lw + 2, doc_y + 3), color=bg_rgb, fill=bg_rgb)
                p_curr.insert_text(fitz.Point(margin_l, doc_y), actual_line, fontsize=9.5, fontname="helv", color=(0.1, 0.1, 0.1))
                cur_line = [w]
                doc_y += line_h
            else:
                cur_line.append(w)

        if cur_line:
            if doc_y + line_h > page_bottom:
                p_curr = doc.new_page(width=595, height=842)
                p_curr.draw_rect(fitz.Rect(0, 0, 595, 35), color=(0.95, 0.96, 0.98), fill=(0.95, 0.96, 0.98))
                p_curr.insert_text(fitz.Point(40, 22), f"Drillbit Plagiarism Report · {safe_title}", fontsize=8, fontname="helv", color=(0.4, 0.4, 0.5))
                p_curr.insert_text(fitz.Point(480, 22), f"Submission: {req.submissionId}", fontsize=8, fontname="helv", color=(0.4, 0.4, 0.5))
                doc_y = 65

            actual_line = " ".join(cur_line)
            lw = fitz.get_text_length(actual_line, fontname="helv", fontsize=9.5)
            if bg_rgb:
                p_curr.draw_rect(fitz.Rect(margin_l - 2, doc_y - 9, margin_l + lw + 2, doc_y + 3), color=bg_rgb, fill=bg_rgb)
            p_curr.insert_text(fitz.Point(margin_l, doc_y), actual_line, fontsize=9.5, fontname="helv", color=(0.1, 0.1, 0.1))
            doc_y += line_h

        doc_y += 4  # Paragraph spacing

    pdf_bytes = doc.tobytes(garbage=3, deflate=True)
    doc.close()

    filename_out = f"{req.submissionId}_Drillbit_Similarity_Report.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename_out}"'},
    )


class DrillbitExportRequest(BaseModel):
    title: str = "HumanDoc Document"
    text: str
    format: str = "pdf"  # pdf | docx | txt


@router.post("/export")
async def export_drillbit_document(req: DrillbitExportRequest) -> Response:
    """Export the analyzed or humanized document text as .pdf, .docx, or .txt."""
    import re

    fmt = (req.format or "pdf").lower().strip()
    if fmt not in ("pdf", "docx", "txt"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Supported export formats are pdf, docx, and txt.")
    if not req.text or not req.text.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Document text is empty.")

    safe_base = re.sub(r"[^a-zA-Z0-9_-]", "_", req.title.strip() or "HumanDoc_Document")[:80]
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", req.text.strip()) if p.strip()]
    if not paragraphs:
        paragraphs = [req.text.strip()]

    if fmt == "txt":
        data = req.text.encode("utf-8")
        return Response(
            content=data,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{safe_base}.txt"'},
        )

    if fmt == "docx":
        import docx

        d = docx.Document()
        d.add_heading(req.title.strip() or "HumanDoc Document", level=1)
        for para in paragraphs:
            d.add_paragraph(para)
        buf = io.BytesIO()
        d.save(buf)
        return Response(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{safe_base}.docx"'},
        )

    # fmt == "pdf"
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    margin_l, margin_r = 50, 545
    max_w = margin_r - margin_l
    y = 60.0

    # Title on page 1
    title_text = (req.title.strip() or "HumanDoc Document")[:90]
    page.insert_text(fitz.Point(margin_l, y), title_text, fontsize=15, fontname="hebo", color=(0.1, 0.12, 0.18))
    y += 14
    page.draw_line(fitz.Point(margin_l, y), fitz.Point(margin_r, y), color=(0.82, 0.84, 0.88), width=0.8)
    y += 22

    line_h = 15.0
    page_bottom = 790.0

    for para in paragraphs:
        words = para.split()
        cur: list[str] = []
        for w in words:
            test = " ".join(cur + [w])
            if fitz.get_text_length(test, fontname="helv", fontsize=10.5) > max_w and cur:
                if y + line_h > page_bottom:
                    page = doc.new_page(width=595, height=842)
                    y = 55.0
                page.insert_text(fitz.Point(margin_l, y), " ".join(cur), fontsize=10.5, fontname="helv", color=(0.12, 0.12, 0.12))
                y += line_h
                cur = [w]
            else:
                cur.append(w)
        if cur:
            if y + line_h > page_bottom:
                page = doc.new_page(width=595, height=842)
                y = 55.0
            page.insert_text(fitz.Point(margin_l, y), " ".join(cur), fontsize=10.5, fontname="helv", color=(0.12, 0.12, 0.12))
            y += line_h
        y += 8  # clean paragraph gap without excessive whitespace

    pdf_bytes = doc.tobytes(garbage=3, deflate=True)
    doc.close()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_base}.pdf"'},
    )

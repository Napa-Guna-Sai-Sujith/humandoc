"""Drillbit / HD Plagiarism document extraction service with 100-page maximum limit."""
from __future__ import annotations

import io
import math

from fastapi import APIRouter, File, HTTPException, UploadFile, status

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

import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/session";

export const maxDuration = 60; // Allow 60s for PDF parsing if needed

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ detail: "No file was uploaded." }, { status: 400 });
    }

    const filename = file.name || "document.txt";
    const ext = filename.split(".").pop()?.toLowerCase() || "txt";

    // Fast-path for plain text and markdown files
    if (ext === "txt" || ext === "md") {
      const text = (await file.text()).trim();
      const words = text ? text.split(/\s+/).length : 0;
      const pages = Math.max(1, Math.ceil(words / 350));

      if (pages > 100) {
        return NextResponse.json(
          {
            detail: `Document exceeds the 100-page limit for HD Plagiarism. This document contains ~${pages} pages (maximum allowed is 100 pages).`,
          },
          { status: 400 },
        );
      }

      return NextResponse.json({
        ok: true,
        filename,
        pages,
        wordCount: words,
        characterCount: text.length,
        text,
      });
    }

    // For PDF, DOCX, DOC: forward to FastAPI backend with PyMuPDF / python-docx engine
    const backendBase =
      process.env.API_INTERNAL_URL ||
      (process.env.NODE_ENV === "production" ? "https://humandoc.onrender.com" : "http://localhost:8000");

    const forwardData = new FormData();
    forwardData.append("file", file);

    try {
      const response = await fetch(`${backendBase}/drillbit/extract`, {
        method: "POST",
        body: forwardData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return NextResponse.json(
          { detail: data.detail || `Extraction failed with status ${response.status}` },
          { status: response.status },
        );
      }

      return NextResponse.json(data);
    } catch (backendErr) {
      console.warn("[drillbit/extract] Backend proxy failed, attempting fallback:", backendErr);
      return NextResponse.json(
        {
          detail: "Could not connect to document parsing engine. Please paste the document text directly or retry in a few moments.",
        },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("[drillbit/extract] Error:", err);
    return NextResponse.json({ detail: "Failed to process document." }, { status: 500 });
  }
}

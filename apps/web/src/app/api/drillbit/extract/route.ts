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

    // Fast-path RTF / HTML-as-.doc so legacy Web/WordPad .doc uploads extract without backend wait
    if (ext === "doc") {
      const rawBuf = new Uint8Array(await file.arrayBuffer());
      const head = new TextDecoder("latin1").decode(rawBuf.subarray(0, 512)).trimStart();
      if (head.toLowerCase().startsWith("<!doctype html") || head.toLowerCase().startsWith("<html")) {
        const htmlRaw = new TextDecoder("utf-8", { fatal: false }).decode(rawBuf);
        const text = htmlRaw
          .replace(/<(script|style|head|xml)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
          .replace(/<\/?(?:p|div|br|tr|h[1-6]|li)\b[^>]*>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        const words = text ? text.split(/\s+/).length : 0;
        const pages = Math.max(1, Math.ceil(words / 350));
        if (words > 0) {
          if (pages > 100) {
            return NextResponse.json(
              { detail: `Document exceeds 100-page limit (${pages} pages found). Maximum allowed is 100 pages.` },
              { status: 400 },
            );
          }
          return NextResponse.json({ ok: true, filename, pages, wordCount: words, characterCount: text.length, text });
        }
      }
    }

    // Direct high-performance in-process extraction for PDF files (zero cold-start delay)
    if (ext === "pdf") {
      try {
        const { PDFParse } = await import("pdf-parse");
        const arrayBuffer = await file.arrayBuffer();
        const parser = new PDFParse(new Uint8Array(arrayBuffer));
        const res = await parser.getText();
        const text = (res.text || "").trim();
        const pages = res.total || Math.max(1, Math.ceil((text ? text.split(/\s+/).length : 0) / 350));

        if (pages > 100) {
          return NextResponse.json(
            {
              detail: `Document exceeds the 100-page limit for HD Plagiarism (${pages} pages found). Maximum allowed is 100 pages.`,
            },
            { status: 400 },
          );
        }

        const words = text ? text.split(/\s+/).length : 0;
        if (words > 0) {
          return NextResponse.json({
            ok: true,
            filename,
            pages,
            wordCount: words,
            characterCount: text.length,
            text,
          });
        }
      } catch (pdfErr) {
        console.warn("[drillbit/extract] Direct PDF parse failed, trying backend fallback:", pdfErr);
      }
    }

    // For DOCX or fallback: forward to FastAPI backend with PyMuPDF / python-docx engine
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

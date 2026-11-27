import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/session";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
    }

    const payload = await req.json().catch(() => ({}));
    const title = String(payload?.title || "HumanDoc_Document");
    const text = String(payload?.text || "");
    const format = String(payload?.format || "pdf").toLowerCase();

    if (!text.trim()) {
      return NextResponse.json({ detail: "Document text is empty." }, { status: 400 });
    }
    if (!["pdf", "docx", "doc", "txt"].includes(format)) {
      return NextResponse.json({ detail: "Unsupported export format." }, { status: 400 });
    }

    const safeBase = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "HumanDoc_Document";

    if (format === "txt") {
      const txtBytes = new TextEncoder().encode(text);
      return new NextResponse(txtBytes, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeBase}.txt"`,
          "Content-Length": txtBytes.byteLength.toString(),
        },
      });
    }

    const backendBase =
      process.env.API_INTERNAL_URL ||
      (process.env.NODE_ENV === "production" ? "https://humandoc.onrender.com" : "http://localhost:8000");

    const response = await fetch(`${backendBase}/drillbit/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, text, format }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { detail: `Export failed: ${errText || response.statusText}` },
        { status: response.status },
      );
    }

    const buf = await response.arrayBuffer();
    const contentType =
      format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : format === "doc"
          ? "application/msword"
          : "application/pdf";

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeBase}.${format}"`,
        "Content-Length": buf.byteLength.toString(),
      },
    });
  } catch (err) {
    console.error("[drillbit/export] Error:", err);
    return NextResponse.json({ detail: "Failed to export document." }, { status: 500 });
  }
}

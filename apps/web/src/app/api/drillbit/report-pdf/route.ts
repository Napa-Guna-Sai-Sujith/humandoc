import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/session";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
    }

    const payload = await req.json();
    if (!payload || !payload.title || !payload.submissionId) {
      return NextResponse.json({ detail: "Missing required report data." }, { status: 400 });
    }

    const backendBase =
      process.env.API_INTERNAL_URL ||
      (process.env.NODE_ENV === "production" ? "https://humandoc.onrender.com" : "http://localhost:8000");

    const response = await fetch(`${backendBase}/drillbit/report-pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { detail: `Report generation failed: ${errText || response.statusText}` },
        { status: response.status },
      );
    }

    const pdfBuffer = await response.arrayBuffer();
    const filename = `${payload.submissionId}_Drillbit_Similarity_Report.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdfBuffer.byteLength.toString(),
      },
    });
  } catch (err) {
    console.error("[drillbit/report-pdf] Error:", err);
    return NextResponse.json({ detail: "Failed to generate report PDF." }, { status: 500 });
  }
}

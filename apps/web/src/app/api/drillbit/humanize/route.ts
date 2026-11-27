import { NextResponse } from "next/server";

import { analyzeDrillbitLive, humanizeForDrillbit } from "@/lib/drillbit";
import { getSession } from "@/lib/session";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { text, title } = body as {
      text?: string;
      title?: string;
    };

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ detail: "Text is required to humanize." }, { status: 400 });
    }

    let rewritten = text;
    let wordsChanged = 0;

    // 1. Call FastAPI RewriteEngine (/drillbit/rewrite-text) for full LLM + syntactic rewriting
    const backendBase =
      process.env.API_INTERNAL_URL ||
      (process.env.NODE_ENV === "production" ? "https://humandoc.onrender.com" : "http://localhost:8000");

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${backendBase}/drillbit/rewrite-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          style: "academic",
          strength: "strong",
          tone: 55,
          language: "auto",
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean; humanizedText?: string; paragraphsChanged?: number };
        if (data.humanizedText && data.humanizedText.trim()) {
          rewritten = data.humanizedText;
          wordsChanged = Math.max(1, data.paragraphsChanged || 0);
        }
      }
    } catch (err) {
      console.warn("[drillbit/humanize] Backend rewrite fallback to local engine:", err);
    }

    // 2. Apply local participial/AI-cliché polish pass to catch any remaining markers
    const localPass = humanizeForDrillbit(rewritten);
    if (localPass.humanizedText && localPass.humanizedText.trim()) {
      rewritten = localPass.humanizedText;
      wordsChanged += localPass.wordsChanged;
    }

    // 3. Re-score honestly with live Drillbit analyzer — never fabricate 0% or <=4% scores
    const postReport = await analyzeDrillbitLive(rewritten, {
      title: title ? `${title} (Humanized)` : "Humanized Document",
      excludeQuotes: true,
      excludeBibliography: true,
      excludeSmallMatches: true,
    });

    return NextResponse.json({
      ok: true,
      humanizedText: rewritten,
      wordsChanged,
      report: postReport,
    });
  } catch (err) {
    console.error("[drillbit/humanize] Error:", err);
    return NextResponse.json({ detail: "Failed to humanize text." }, { status: 500 });
  }
}

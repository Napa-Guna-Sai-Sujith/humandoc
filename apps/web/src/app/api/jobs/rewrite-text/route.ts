import { NextResponse } from "next/server";

import { getUserQuota, recordDrillbitUsage } from "@/lib/quota";
import { getSession } from "@/lib/session";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const text = String(body?.text || "").trim();
    const title = String(body?.title || "Pasted Document").trim() || "Pasted Document";
    const style = String(body?.style || "professional");
    const strength = String(body?.strength || "medium");
    const tone = Number(body?.tone ?? 50);
    const language = String(body?.language || "auto");
    const protectedTerms = Array.isArray(body?.protected_terms) ? body.protected_terms : [];
    const customInstructions = String(body?.custom_instructions || "");

    if (!text) {
      return NextResponse.json({ detail: "Please paste text to convert and humanize." }, { status: 400 });
    }

    const words = text.split(/\s+/).length;
    const docPages = Math.max(1, Math.ceil(words / 350));

    // Enforce plan-based limits cleanly
    const quota = await getUserQuota(session.user.id, session.user.role);
    if (quota.uploadsRemaining <= 0) {
      return NextResponse.json(
        {
          detail: `Upload limit reached (${quota.uploadsUsed}/${quota.maxUploads} uploads used on the ${quota.tier} plan). Upgrade your plan to convert more text.`,
          code: "UPLOAD_LIMIT_EXCEEDED",
          quota,
        },
        { status: 402 },
      );
    }

    if (docPages > quota.maxCheckPages) {
      return NextResponse.json(
        {
          detail: `Your ${quota.tier} plan supports up to ${quota.maxCheckPages} pages per request (this text is ~${docPages} pages). Upgrade your plan for higher limits.`,
          code: "PAGE_LIMIT_EXCEEDED",
          quota,
        },
        { status: 402 },
      );
    }

    if (docPages > quota.pagesRemaining) {
      return NextResponse.json(
        {
          detail: `Monthly page quota exceeded (${quota.pagesRemaining} pages left out of ${quota.pagesPerMonth}). Upgrade your plan for more pages.`,
          code: "QUOTA_EXCEEDED",
          quota,
        },
        { status: 402 },
      );
    }

    const backendBase =
      process.env.API_INTERNAL_URL ||
      (process.env.NODE_ENV === "production" ? "https://humandoc.onrender.com" : "http://localhost:8000");

    const response = await fetch(`${backendBase}/drillbit/rewrite-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        style,
        strength,
        tone,
        language,
        protected_terms: protectedTerms,
        custom_instructions: customInstructions,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { detail: data.detail || "Could not rewrite pasted text." },
        { status: response.status },
      );
    }

    await recordDrillbitUsage(session.user.id, docPages, words, title);
    const updatedQuota = await getUserQuota(session.user.id, session.user.role);

    return NextResponse.json({
      ...data,
      pageCount: docPages,
      quota: updatedQuota,
    });
  } catch (err) {
    console.error("[jobs/rewrite-text] Error:", err);
    return NextResponse.json({ detail: "Failed to convert text." }, { status: 500 });
  }
}

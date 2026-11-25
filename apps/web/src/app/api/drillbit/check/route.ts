import { NextResponse } from "next/server";

import { analyzeDrillbit } from "@/lib/drillbit";
import { getUserQuota, recordDrillbitUsage } from "@/lib/quota";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { text, title, pageCount, filters } = body as {
      text?: string;
      title?: string;
      pageCount?: number;
      filters?: {
        excludeQuotes?: boolean;
        excludeBibliography?: boolean;
        excludeSmallMatches?: boolean;
      };
    };

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ detail: "Text content is required for Drillbit analysis." }, { status: 400 });
    }

    const words = text.trim().split(/\s+/).length;
    const docPages = Math.max(1, pageCount && pageCount > 0 ? Math.round(pageCount) : Math.ceil(words / 350));

    const quota = await getUserQuota(session.user.id, session.user.role);

    if (quota.uploadsRemaining <= 0) {
      return NextResponse.json(
        {
          detail: `Upload limit reached (${quota.uploadsUsed}/${quota.maxUploads} uploads used on the ${quota.tier} plan). Upgrade your plan to unlock more uploads.`,
          code: "UPLOAD_LIMIT_EXCEEDED",
          quota,
        },
        { status: 402 },
      );
    }

    if (docPages > quota.maxCheckPages) {
      return NextResponse.json(
        {
          detail: `Your ${quota.tier} plan supports up to ${quota.maxCheckPages} pages per check (this document has ${docPages} pages). Upgrade your plan for higher page limits.`,
          code: "PAGE_LIMIT_EXCEEDED",
          quota,
        },
        { status: 402 },
      );
    }

    if (docPages > quota.pagesRemaining) {
      return NextResponse.json(
        {
          detail: `Monthly page quota exceeded (${quota.pagesRemaining} pages left out of ${quota.pagesPerMonth}, document requires ${docPages} pages). Upgrade your plan for more pages.`,
          code: "QUOTA_EXCEEDED",
          quota,
        },
        { status: 402 },
      );
    }

    const report = analyzeDrillbit(text, {
      title,
      excludeQuotes: filters?.excludeQuotes,
      excludeBibliography: filters?.excludeBibliography,
      excludeSmallMatches: filters?.excludeSmallMatches,
    });
    report.pageCount = docPages;

    await recordDrillbitUsage(session.user.id, docPages, words, title || "Untitled Document");
    const updatedQuota = await getUserQuota(session.user.id, session.user.role);

    return NextResponse.json({ ok: true, report, quota: updatedQuota });
  } catch (err) {
    console.error("[drillbit/check] Error:", err);
    return NextResponse.json({ detail: "Failed to generate Drillbit report." }, { status: 500 });
  }
}

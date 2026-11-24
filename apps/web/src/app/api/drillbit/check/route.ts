import { NextResponse } from "next/server";

import { analyzeDrillbit } from "@/lib/drillbit";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { text, title, filters } = body as {
      text?: string;
      title?: string;
      filters?: {
        excludeQuotes?: boolean;
        excludeBibliography?: boolean;
        excludeSmallMatches?: boolean;
      };
    };

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ detail: "Text content is required for Drillbit analysis." }, { status: 400 });
    }

    const report = analyzeDrillbit(text, {
      title,
      excludeQuotes: filters?.excludeQuotes,
      excludeBibliography: filters?.excludeBibliography,
      excludeSmallMatches: filters?.excludeSmallMatches,
    });

    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("[drillbit/check] Error:", err);
    return NextResponse.json({ detail: "Failed to generate Drillbit report." }, { status: 500 });
  }
}

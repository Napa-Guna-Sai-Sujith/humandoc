import { NextResponse } from "next/server";

import { one } from "@/lib/db";
import { getSession } from "@/lib/session";
import { TIER_PAGES } from "@/lib/stripe";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  const period = new Date().toISOString().slice(0, 7);
  const subscription = await one<{
    tier: string;
    status: string;
    pages_per_month: number;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  }>(
    "SELECT tier, status, pages_per_month, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id = $1",
    [session.user.id],
  );

  const usage = await one<{ pages: string; words: string }>(
    "SELECT coalesce(sum(pages), 0)::text AS pages, coalesce(sum(words), 0)::text AS words FROM usage_records WHERE user_id = $1 AND period = $2",
    [session.user.id, period],
  );

  const active = subscription && subscription.status === "active" ? subscription : null;
  const pagesPerMonth = active?.pages_per_month ?? TIER_PAGES.free;
  const pagesUsed = Number(usage?.pages ?? 0);

  return NextResponse.json({
    period,
    tier: active?.tier ?? "free",
    status: active?.status ?? "active",
    pagesPerMonth,
    pagesUsed,
    pagesRemaining: Math.max(0, pagesPerMonth - pagesUsed),
    wordsUsed: Number(usage?.words ?? 0),
    currentPeriodEnd: active?.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(active?.cancel_at_period_end),
  });
}

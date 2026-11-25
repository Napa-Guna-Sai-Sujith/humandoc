import "server-only";

import { one, query } from "@/lib/db";
import { getPlanLimits } from "@/lib/plans";
import { TIER_PAGES } from "@/lib/stripe";

export type UserQuota = {
  period: string;
  tier: string;
  status: string;
  pagesPerMonth: number;
  pagesUsed: number;
  pagesRemaining: number;
  wordsUsed: number;
  maxCheckPages: number;
  maxUploads: number;
  uploadsUsed: number;
  uploadsRemaining: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export async function getUserQuota(userId: string, role?: string): Promise<UserQuota> {
  const period = new Date().toISOString().slice(0, 7);

  const subscription = await one<{
    tier: string;
    status: string;
    pages_per_month: number;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  }>(
    "SELECT tier, status, pages_per_month, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id = $1",
    [userId],
  );

  const usage = await one<{ pages: string; words: string }>(
    "SELECT coalesce(sum(pages), 0)::text AS pages, coalesce(sum(words), 0)::text AS words FROM usage_records WHERE user_id = $1 AND period = $2",
    [userId, period],
  );

  const uploadCounts = await one<{ job_uploads: string; check_uploads: string }>(
    `SELECT
       (SELECT count(*)::text FROM uploads WHERE user_id = $1 AND to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = $2) AS job_uploads,
       (SELECT count(*)::text FROM audit_logs WHERE user_id = $1 AND action = 'drillbit.checked' AND to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = $2) AS check_uploads`,
    [userId, period],
  );

  const active = subscription && subscription.status === "active" ? subscription : null;
  const tier = active?.tier ?? "free";
  const pagesPerMonth = active?.pages_per_month ?? TIER_PAGES.free;
  const pagesUsed = Number(usage?.pages ?? 0);
  const limits = getPlanLimits(tier, pagesPerMonth, role);
  const uploadsUsed = Number(uploadCounts?.job_uploads ?? 0) + Number(uploadCounts?.check_uploads ?? 0);

  return {
    period,
    tier: limits.tier,
    status: active?.status ?? "active",
    pagesPerMonth,
    pagesUsed,
    pagesRemaining: Math.max(0, pagesPerMonth - pagesUsed),
    wordsUsed: Number(usage?.words ?? 0),
    maxCheckPages: limits.maxCheckPages,
    maxUploads: limits.maxUploads,
    uploadsUsed,
    uploadsRemaining: Math.max(0, limits.maxUploads - uploadsUsed),
    currentPeriodEnd: active?.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(active?.cancel_at_period_end),
  };
}

export async function recordDrillbitUsage(
  userId: string,
  pages: number,
  words: number,
  title: string,
): Promise<void> {
  const period = new Date().toISOString().slice(0, 7);
  const updated = await query<{ id: string }>(
    `UPDATE usage_records
     SET pages = pages + $3, words = words + $4
     WHERE ctid IN (
       SELECT ctid FROM usage_records WHERE user_id = $1 AND period = $2 LIMIT 1
     )
     RETURNING id`,
    [userId, period, pages, words],
  );
  if (updated.length === 0) {
    await query(
      `INSERT INTO usage_records (id, user_id, period, pages, words, tokens, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, NOW())`,
      [userId, period, pages, words],
    );
  }

  await query(
    `INSERT INTO audit_logs (id, user_id, action, meta, created_at)
     VALUES (gen_random_uuid(), $1, 'drillbit.checked', $2, NOW())`,
    [userId, JSON.stringify({ title: title.slice(0, 120), pages, words })],
  );
}

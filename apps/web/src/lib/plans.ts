export type PlanLimits = {
  tier: string;
  pagesPerMonth: number;
  maxCheckPages: number;
  maxUploads: number;
};

export const PLAN_LIMITS: Record<string, { maxCheckPages: number; maxUploads: number }> = {
  free: { maxCheckPages: 10, maxUploads: 2 },
  starter: { maxCheckPages: 30, maxUploads: 15 },
  pro: { maxCheckPages: 60, maxUploads: 50 },
  studio: { maxCheckPages: 100, maxUploads: 200 },
  enterprise: { maxCheckPages: 100, maxUploads: 10000 },
};

export function getPlanLimits(tier: string, pagesPerMonth: number, role?: string): PlanLimits {
  const normalized = (tier || "free").toLowerCase();
  if (role === "admin" || pagesPerMonth >= 10000) {
    return {
      tier: normalized,
      pagesPerMonth,
      maxCheckPages: 100,
      maxUploads: 10000,
    };
  }
  const base = PLAN_LIMITS[normalized] ?? PLAN_LIMITS.free;
  return {
    tier: normalized,
    pagesPerMonth,
    maxCheckPages: base.maxCheckPages,
    maxUploads: base.maxUploads,
  };
}

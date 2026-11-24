import "server-only";

import Stripe from "stripe";

export const PRICE_BY_TIER: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || "",
  pro: process.env.STRIPE_PRICE_PRO || "",
  studio: process.env.STRIPE_PRICE_STUDIO || "",
};

export const TIER_PAGES: Record<string, number> = {
  free: Number(process.env.TIER_FREE_PAGES || 20),
  starter: Number(process.env.TIER_STARTER_PAGES || 100),
  pro: Number(process.env.TIER_PRO_PAGES || 500),
  studio: Number(process.env.TIER_STUDIO_PAGES || 2000),
};

export const TIER_PRICES: Record<string, number> = {
  free: 0,
  starter: 12,
  pro: 29,
  studio: 79,
};

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

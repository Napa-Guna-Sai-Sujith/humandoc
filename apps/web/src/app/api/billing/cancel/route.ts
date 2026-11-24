import { NextRequest } from "next/server";

import { one, pool } from "@/lib/db";
import { error, json, requireCsrf } from "@/lib/http";
import { getSession } from "@/lib/session";
import { getStripe } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  const csrfErr = requireCsrf(request);
  if (csrfErr) return csrfErr;

  const session = await getSession();
  if (!session) return error(401, "Not authenticated");

  const sub = await one<{ stripe_subscription_id: string | null; tier: string }>(
    "SELECT stripe_subscription_id, tier FROM subscriptions WHERE user_id = $1",
    [session.user.id],
  );
  if (!sub || sub.tier === "free") {
    return error(400, "No active subscription to cancel.");
  }

  if (!process.env.STRIPE_SECRET_KEY || !sub.stripe_subscription_id) {
    await pool.query(
      "UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE user_id = $1",
      [session.user.id],
    );
    return json({ cancelAtPeriodEnd: true });
  }

  try {
    const stripe = getStripe();
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
    await pool.query(
      "UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE user_id = $1",
      [session.user.id],
    );
    return json({ cancelAtPeriodEnd: true });
  } catch (err) {
    console.error("[stripe] cancel failed", err);
    return error(502, "Could not cancel subscription.");
  }
}

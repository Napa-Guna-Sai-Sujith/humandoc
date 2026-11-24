import { NextRequest } from "next/server";

import { one, pool } from "@/lib/db";
import { error, json, publicUrl, readJson, requireCsrf } from "@/lib/http";
import { getSession } from "@/lib/session";
import { getStripe, PRICE_BY_TIER, TIER_PAGES, TIER_PRICES } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  const csrfErr = requireCsrf(request);
  if (csrfErr) return csrfErr;

  const session = await getSession();
  if (!session) return error(401, "Not authenticated");

  const body = await readJson<{ tier?: string }>(request);
  const tier = (body?.tier || "").toLowerCase();
  if (!["starter", "pro", "studio"].includes(tier)) {
    return error(400, "Choose Starter, Pro, or Studio.");
  }

  // Local / preview mode without Stripe keys: activate plan directly so billing works end-to-end
  if (!process.env.STRIPE_SECRET_KEY) {
    const pagesPerMonth = TIER_PAGES[tier] ?? TIER_PAGES.pro;
    const periodEnd = new Date(Date.now() + 30 * 86_400_000);
    await pool.query(
      `INSERT INTO subscriptions (user_id, tier, status, pages_per_month, current_period_end, cancel_at_period_end)
       VALUES ($1, $2, 'active', $3, $4, false)
       ON CONFLICT (user_id) DO UPDATE SET
         tier = EXCLUDED.tier,
         status = 'active',
         pages_per_month = EXCLUDED.pages_per_month,
         current_period_end = EXCLUDED.current_period_end,
         cancel_at_period_end = false,
         updated_at = now()`,
      [session.user.id, tier, pagesPerMonth, periodEnd],
    );
    const amountCents = (TIER_PRICES[tier] ?? 29) * 100;
    await pool.query(
      `INSERT INTO invoices (user_id, stripe_invoice_id, amount, currency, status)
       VALUES ($1, $2, $3, 'usd', 'paid')`,
      [session.user.id, `inv_local_${Date.now()}`, amountCents],
    );
    return json({ url: "/pricing?upgraded=1" });
  }

  const priceId = PRICE_BY_TIER[tier];
  if (!priceId) return error(502, "Stripe price ID is not configured for this tier.");

  try {
    const stripe = getStripe();
    const existing = await one<{ stripe_customer_id: string | null }>(
      "SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1",
      [session.user.id],
    );
    let customerId = existing?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.user.email,
        name: session.user.name,
        metadata: { userId: session.user.id },
      });
      customerId = customer.id;
      await pool.query(
        `INSERT INTO subscriptions (user_id, stripe_customer_id, tier, status, pages_per_month)
         VALUES ($1, $2, 'free', 'active', $3)
         ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id`,
        [session.user.id, customerId, TIER_PAGES.free],
      );
    }

    const successUrl = publicUrl(request, "/pricing?upgraded=1").toString();
    const cancelUrl = publicUrl(request, "/pricing?canceled=1").toString();
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId: session.user.id, tier },
      subscription_data: { metadata: { userId: session.user.id, tier } },
    });
    return json({ url: checkout.url });
  } catch (err) {
    console.error("[stripe] checkout failed", err);
    return error(502, "Could not start checkout. Is Stripe configured?");
  }
}

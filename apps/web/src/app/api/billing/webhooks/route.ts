import { NextRequest } from "next/server";
import Stripe from "stripe";

import { one, pool } from "@/lib/db";
import { getStripe, TIER_PAGES, WEBHOOK_SECRET } from "@/lib/stripe";

export const runtime = "nodejs";

function tierForPrice(priceId: string | undefined | null): string | null {
  if (!priceId) return null;
  const map: Record<string, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER,
    pro: process.env.STRIPE_PRICE_PRO,
    studio: process.env.STRIPE_PRICE_STUDIO,
  };
  for (const [tier, id] of Object.entries(map)) {
    if (id && id === priceId) return tier;
  }
  return null;
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const userId = (subscription.metadata?.userId as string) || undefined;

  const row = await one<{ user_id: string }>(
    "SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 OR (user_id::text = $2)",
    [customerId, userId ?? ""],
  );
  if (!row) return;

  const priceId = subscription.items.data[0]?.price.id;
  const tier = (subscription.metadata?.tier as string) || tierForPrice(priceId) || "free";
  const periodEnd = (subscription as unknown as { current_period_end?: number }).current_period_end;

  await pool.query(
    `UPDATE subscriptions
        SET stripe_subscription_id = $2, tier = $3, status = $4,
            pages_per_month = $5, current_period_end = to_timestamp($6), cancel_at_period_end = $7,
            updated_at = now()
      WHERE user_id = $1`,
    [
      row.user_id,
      subscription.id,
      tier,
      subscription.status,
      TIER_PAGES[tier] ?? TIER_PAGES.free,
      periodEnd ?? Math.floor(Date.now() / 1000),
      Boolean(subscription.cancel_at_period_end),
    ],
  );
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!WEBHOOK_SECRET || !signature) {
    return new Response("Webhook not configured", { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error("stripe signature verification failed", err);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = session.subscription as string | null;
        if (subscriptionId) {
          const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
          await syncSubscription(subscription);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        const row = await one<{ user_id: string }>("SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1", [
          customerId,
        ]);
        if (row) {
          await pool.query(
            `INSERT INTO invoices (user_id, stripe_invoice_id, amount, currency, status, hosted_url, pdf_url)
             VALUES ($1, $2, $3, $4, 'paid', $5, $6)
             ON CONFLICT (stripe_invoice_id) DO UPDATE SET status = EXCLUDED.status`,
            [
              row.user_id,
              invoice.id,
              invoice.amount_paid,
              invoice.currency,
              invoice.hosted_invoice_url,
              invoice.invoice_pdf,
            ],
          );
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("stripe webhook handler failed", err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

import { NextRequest } from "next/server";

import { one } from "@/lib/db";
import { error, json, publicUrl, requireCsrf } from "@/lib/http";
import { getSession } from "@/lib/session";
import { getStripe } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  const csrfErr = requireCsrf(request);
  if (csrfErr) return csrfErr;

  const session = await getSession();
  if (!session) return error(401, "Not authenticated");

  if (!process.env.STRIPE_SECRET_KEY) {
    return json({ url: "/pricing" });
  }

  const sub = await one<{ stripe_customer_id: string | null }>(
    "SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1",
    [session.user.id],
  );
  if (!sub?.stripe_customer_id) {
    return error(400, "No billing account yet — choose a plan first.");
  }

  try {
    const stripe = getStripe();
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: publicUrl(request, "/pricing").toString(),
    });
    return json({ url: portal.url });
  } catch (err) {
    console.error("[stripe] portal failed", err);
    return error(502, "Could not open billing portal.");
  }
}

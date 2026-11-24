import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import {
  sendPlanRequestAdminEmail,
  sendPlanRequestUserConfirmationEmail,
} from "@/lib/mail";
import { getSession } from "@/lib/session";
import { TIER_PAGES, TIER_PRICES } from "@/lib/stripe";

const TIER_NAMES: Record<string, string> = {
  starter: "Starter",
  pro: "Pro",
  studio: "Studio",
};

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { tier, phone, name, notes } = body as {
      tier?: string;
      phone?: string;
      name?: string;
      notes?: string;
    };

    if (!tier || !TIER_NAMES[tier]) {
      return NextResponse.json(
        { detail: "Please select a valid plan (Starter, Pro, or Studio)." },
        { status: 400 },
      );
    }

    const trimmedPhone = (phone || "").trim();
    // Validate phone number: mandatory, at least 7 digits, valid phone characters
    const digitsOnly = trimmedPhone.replace(/\D/g, "");
    if (!trimmedPhone || digitsOnly.length < 7 || digitsOnly.length > 15) {
      return NextResponse.json(
        { detail: "A valid mobile phone number is mandatory so our team can contact you to activate your plan." },
        { status: 400 },
      );
    }

    const userName = (name || session.user.name || "").trim() || "User";
    const userEmail = session.user.email;
    const tierName = TIER_NAMES[tier];
    const tierPrice = TIER_PRICES[tier] ?? 0;
    const pages = TIER_PAGES[tier] ?? 100;
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER || "napagunasaisujith@gmail.com";

    // 1. Send Admin Email Notification
    await sendPlanRequestAdminEmail({
      adminEmail,
      userName,
      userEmail,
      phone: trimmedPhone,
      tier,
      tierName,
      tierPrice,
      pages,
      notes: (notes || "").trim(),
    });

    // 2. Send User Confirmation Email
    try {
      await sendPlanRequestUserConfirmationEmail({
        to: userEmail,
        userName,
        tierName,
        tierPrice,
        pages,
      });
    } catch (userMailErr) {
      console.warn("[request-plan] User confirmation email error:", userMailErr);
    }

    // 3. Log to audit_logs
    try {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, meta, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
        [
          session.user.id,
          "billing.plan_requested",
          JSON.stringify({
            tier,
            tierName,
            price: tierPrice,
            phone: trimmedPhone,
            userName,
            userEmail,
            notes: (notes || "").trim(),
          }),
        ],
      );
    } catch (auditErr) {
      console.warn("[request-plan] Audit log insert failed:", auditErr);
    }

    return NextResponse.json({
      ok: true,
      message: `Your request for the ${tierName} plan has been received! Our team will contact you at ${trimmedPhone} shortly to activate your plan.`,
    });
  } catch (error) {
    console.error("[request-plan] Error processing plan request:", error);
    return NextResponse.json(
      { detail: (error as Error).message || "Failed to submit plan request." },
      { status: 500 },
    );
  }
}

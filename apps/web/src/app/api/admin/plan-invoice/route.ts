import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import { sendPlanActivatedInvoiceEmail } from "@/lib/mail";
import { getPlanLimits } from "@/lib/plans";
import { getSession } from "@/lib/session";
import { TIER_PRICES } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ detail: "Admin access required." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const userId = String(body?.userId || "");
    const userName = String(body?.userName || "Customer");
    const userEmail = String(body?.userEmail || "").trim();
    const tier = String(body?.tier || "starter").toLowerCase();
    const pagesPerMonth = Number(body?.pagesPerMonth || 100);

    if (!userEmail) {
      return NextResponse.json({ detail: "User email is required." }, { status: 400 });
    }

    const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
    const tierPrice = TIER_PRICES[tier] ?? (tier === "enterprise" ? 199 : 0);
    const limits = getPlanLimits(tier, pagesPerMonth);
    const invoiceId = "INV-" + Date.now().toString().slice(-6);
    const periodEnd = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    // Generate PDF invoice via FastAPI backend
    let invoicePdfBuffer: Buffer | undefined;
    try {
      const backendBase =
        process.env.API_INTERNAL_URL ||
        (process.env.NODE_ENV === "production" ? "https://humandoc.onrender.com" : "http://localhost:8000");

      const pdfRes = await fetch(`${backendBase}/drillbit/invoice-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          userName,
          userEmail,
          tierName,
          tierPrice,
          pagesPerMonth,
          maxUploads: limits.maxUploads,
          maxCheckPages: limits.maxCheckPages,
          periodEnd,
        }),
      });
      if (pdfRes.ok) {
        invoicePdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
      }
    } catch (pdfErr) {
      console.warn("[admin/plan-invoice] PDF invoice generation fallback:", pdfErr);
    }

    await sendPlanActivatedInvoiceEmail({
      to: userEmail,
      userName,
      tierName,
      tierPrice,
      pagesPerMonth,
      maxUploads: limits.maxUploads,
      maxCheckPages: limits.maxCheckPages,
      invoiceId,
      periodEnd,
      invoicePdfBuffer,
    });

    if (userId) {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, meta, created_at)
         VALUES (gen_random_uuid(), $1, 'billing.invoice_sent', $2, NOW())`,
        [
          userId,
          JSON.stringify({
            invoiceId,
            tier,
            tierName,
            tierPrice,
            pagesPerMonth,
            sentBy: session.user.email,
          }),
        ],
      ).catch(() => undefined);
    }

    return NextResponse.json({ ok: true, invoiceId });
  } catch (err) {
    console.error("[admin/plan-invoice] Error:", err);
    return NextResponse.json({ detail: "Failed to send plan invoice email." }, { status: 500 });
  }
}

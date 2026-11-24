import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  const invoices = await query<{
    id: string;
    stripe_invoice_id: string;
    amount: number;
    currency: string;
    status: string;
    hosted_url: string | null;
    created_at: string;
  }>(
    `SELECT id, stripe_invoice_id, amount, currency, status, hosted_url, created_at
       FROM invoices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [session.user.id],
  );

  return NextResponse.json({
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.stripe_invoice_id,
      amount: invoice.amount,
      currency: invoice.currency,
      status: invoice.status,
      url: invoice.hosted_url,
      createdAt: invoice.created_at,
    })),
  });
}

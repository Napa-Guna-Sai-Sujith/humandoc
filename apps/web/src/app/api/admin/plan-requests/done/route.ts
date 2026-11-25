import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ detail: "Admin access required." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.requestId || "").trim();
    if (!requestId) {
      return NextResponse.json({ detail: "requestId is required." }, { status: 400 });
    }

    await query(
      `INSERT INTO audit_logs (id, user_id, action, meta, created_at)
       VALUES (gen_random_uuid(), $1, 'billing.plan_request_completed', $2, NOW())`,
      [session.user.id, JSON.stringify({ request_id: requestId })],
    );

    return NextResponse.json({ ok: true, requestId });
  } catch (err) {
    console.error("[admin/plan-requests/done] Error:", err);
    return NextResponse.json({ detail: "Failed to mark request as done." }, { status: 500 });
  }
}

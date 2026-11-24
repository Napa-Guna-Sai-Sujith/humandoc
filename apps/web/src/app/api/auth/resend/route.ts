import { NextRequest } from "next/server";

import { emailExists, resendVerification } from "@/lib/auth";
import { error, json, readJson, requireCsrf } from "@/lib/http";
import { getSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const body = await readJson<{ email?: string }>(request);
  const session = await getSession();
  const email = body?.email?.trim().toLowerCase() || session?.user.email;

  if (!email) return error(400, "Enter your email address.");
  if (!(await emailExists(email))) return json({ ok: true });

  const user = session?.user.email === email ? session.user : null;
  if (user) {
    await resendVerification(user.id, user.email);
  } else {
    const { one } = await import("@/lib/db");
    const row = await one<{ id: string; email: string }>("SELECT id, email FROM users WHERE lower(email) = lower($1)", [email]);
    if (row) await resendVerification(row.id, row.email);
  }
  return json({ ok: true });
}

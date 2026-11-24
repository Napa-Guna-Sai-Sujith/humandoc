import { NextRequest } from "next/server";

import { requestPasswordReset } from "@/lib/auth";
import { checkIpThrottle } from "@/lib/auth";
import { clientIp, error, json, readJson, requireCsrf } from "@/lib/http";
import { isValidEmail } from "@/lib/validate";

export async function POST(request: NextRequest) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const body = await readJson<{ email?: string }>(request);
  const email = String(body?.email ?? "").trim();
  if (!isValidEmail(email)) return error(422, "Enter a valid email address.");

  try {
    checkIpThrottle(clientIp(request), 10);
    await requestPasswordReset(email);
  } catch (err) {
    if ((err as { status?: number }).status === 429) return error(429, (err as Error).message);
    console.error(err);
  }
  return json({ ok: true, message: "If that address exists, a reset link is on its way." });
}

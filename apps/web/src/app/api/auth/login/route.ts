import { NextRequest } from "next/server";

import { AuthError, checkIpThrottle, loginUser } from "@/lib/auth";
import { clientIp, error, json, readJson, requireCsrf } from "@/lib/http";
import { createSession } from "@/lib/session";
import { validateLogin } from "@/lib/validate";

export async function POST(request: NextRequest) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const body = await readJson<{ email?: string; password?: string; remember?: boolean }>(request);
  if (!body) return error(400, "Invalid request body.");

  const input = { email: String(body.email ?? ""), password: String(body.password ?? "") };
  const errors = validateLogin(input);
  if (Object.keys(errors).length) return error(422, Object.values(errors)[0], errors);

  try {
    checkIpThrottle(clientIp(request), 30);
    const result = await loginUser({ ...input, ip: clientIp(request) });
    const session = await createSession(result.userId, {
      remember: Boolean(body.remember),
      userAgent: request.headers.get("user-agent"),
      ip: clientIp(request),
    });
    return json({
      ok: true,
      sessionToken: session.token,
      csrfToken: session.csrf,
      user: { id: result.userId, role: result.role, emailVerified: result.emailVerified },
    });
  } catch (err) {
    if (err instanceof AuthError) return error(err.status, err.message);
    console.error(err);
    return error(500, "Login failed. Please try again.");
  }
}

import { NextRequest } from "next/server";

import { AuthError, checkIpThrottle, loginUser, registerUser, sendVerification } from "@/lib/auth";
import { clientIp, error, json, readJson, requireCsrf } from "@/lib/http";
import { createSession } from "@/lib/session";
import { validateRegistration } from "@/lib/validate";

export async function POST(request: NextRequest) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const body = await readJson<Parameters<typeof validateRegistration>[0] & Record<string, unknown>>(request);
  if (!body) return error(400, "Invalid request body.");

  const errors = validateRegistration({
    name: String(body.name ?? ""),
    email: String(body.email ?? ""),
    password: String(body.password ?? ""),
    confirmPassword: String(body.confirmPassword ?? ""),
    terms: Boolean(body.terms),
  });
  if (Object.keys(errors).length) {
    return error(422, Object.values(errors)[0], errors);
  }

  try {
    checkIpThrottle(clientIp(request), 20);
    const email = String(body.email).trim().toLowerCase();
    let userId: string;
    let role: "user" | "admin" = "user";
    let isNewUser = false;
    let verifyToken = "";

    try {
      const created = await registerUser({
        name: String(body.name),
        email,
        password: String(body.password),
      });
      userId = created.userId;
      role = created.role;
      verifyToken = created.token;
      isNewUser = true;
    } catch (regErr) {
      if (regErr instanceof AuthError && regErr.status === 409) {
        try {
          const existing = await loginUser({ email, password: String(body.password), ip: clientIp(request) });
          userId = existing.userId;
          role = existing.role;
        } catch {
          throw regErr;
        }
      } else {
        throw regErr;
      }
    }

    if (isNewUser && verifyToken) {
      try {
        await sendVerification(userId, email, verifyToken);
      } catch (mailErr) {
        console.error("[register] Failed to dispatch verification email:", mailErr);
      }
    }

    const session = await createSession(userId, {
      remember: true,
      userAgent: request.headers.get("user-agent"),
      ip: clientIp(request),
    });

    const isVerified = role === "admin" || !isNewUser;

    return json(
      {
        ok: true,
        email,
        sessionToken: session.token,
        csrfToken: session.csrf,
        user: { id: userId, role, emailVerified: isVerified },
      },
      { status: 201 },
    );
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = (err as Error).message || "Registration failed.";
    const field = (err as { field?: string }).field;
    if (status >= 500) console.error(err);
    return error(status, message, field ? { [field]: message } : undefined);
  }
}

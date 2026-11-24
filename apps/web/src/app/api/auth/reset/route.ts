import { NextRequest } from "next/server";

import { resetPasswordWithToken } from "@/lib/auth";
import { error, json, readJson, requireCsrf } from "@/lib/http";
import { validatePassword } from "@/lib/validate";

export async function POST(request: NextRequest) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const body = await readJson<{ token?: string; password?: string; confirmPassword?: string }>(request);
  const token = String(body?.token ?? "");
  const password = String(body?.password ?? "");

  if (!token) return error(400, "Missing reset token.");
  const passwordError = validatePassword(password);
  if (passwordError) return error(422, passwordError, { password: passwordError });
  if (password !== String(body?.confirmPassword ?? "")) {
    return error(422, "Passwords do not match.", { confirmPassword: "Passwords do not match." });
  }

  const userId = await resetPasswordWithToken(token, password);
  if (!userId) return error(400, "This reset link is invalid or has expired.");

  return json({ ok: true });
}

import { NextRequest } from "next/server";

import { AuthError, changePassword } from "@/lib/auth";
import { error, json, readJson, requireCsrf } from "@/lib/http";
import { getSession } from "@/lib/session";
import { validatePassword } from "@/lib/validate";

export async function PATCH(request: NextRequest) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const session = await getSession();
  if (!session) return error(401, "Not authenticated");

  const body = await readJson<{ currentPassword?: string; newPassword?: string }>(request);
  const next = String(body?.newPassword ?? "");
  const nextError = validatePassword(next);
  if (nextError) return error(422, nextError, { newPassword: nextError });
  if (!body?.currentPassword) return error(422, "Enter your current password.", { currentPassword: "Required" });

  try {
    await changePassword(session.user.id, String(body.currentPassword), next);
  } catch (err) {
    if (err instanceof AuthError) return error(err.status, err.message);
    throw err;
  }
  return json({ ok: true });
}

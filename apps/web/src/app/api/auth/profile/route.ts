import { NextRequest } from "next/server";

import { updateProfile } from "@/lib/auth";
import { error, json, readJson, requireCsrf } from "@/lib/http";
import { getSession } from "@/lib/session";
import { validateName } from "@/lib/validate";

export async function PATCH(request: NextRequest) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const session = await getSession();
  if (!session) return error(401, "Not authenticated");

  const body = await readJson<{ name?: string }>(request);
  const name = String(body?.name ?? "");
  const nameError = validateName(name);
  if (nameError) return error(422, nameError, { name: nameError });

  await updateProfile(session.user.id, name);
  return json({ ok: true, name: name.trim() });
}

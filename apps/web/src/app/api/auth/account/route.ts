import { NextRequest } from "next/server";

import { error, json, requireCsrf } from "@/lib/http";
import { destroySession, getSession } from "@/lib/session";

export async function DELETE(request: NextRequest) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const session = await getSession();
  if (!session) return error(401, "Not authenticated");

  const api = process.env.API_INTERNAL_URL || "http://localhost:8000";
  const response = await fetch(`${api}/account`, {
    method: "DELETE",
    headers: {
      cookie: request.headers.get("cookie") || "",
      "x-csrf-token": request.headers.get("x-csrf-token") || "",
      "x-hd-session": request.headers.get("x-hd-session") || "",
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return error(502, `Could not delete account data: ${detail.slice(0, 200)}`);
  }

  await destroySession();
  return json({ ok: true });
}

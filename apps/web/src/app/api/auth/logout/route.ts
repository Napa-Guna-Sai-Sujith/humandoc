import { NextRequest } from "next/server";

import { error, json, requireCsrf } from "@/lib/http";
import { destroySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;
  await destroySession();
  return json({ ok: true });
}

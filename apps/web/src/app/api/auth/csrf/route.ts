import { NextRequest, NextResponse } from "next/server";

import { CSRF_COOKIE, randomToken } from "@/lib/session";

export async function GET(request: NextRequest) {
  const existing = request.cookies.get(CSRF_COOKIE)?.value;
  const token = existing || randomToken(24);
  const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  const isHttps = proto === "https";

  const response = NextResponse.json(
    { csrf: token },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(CSRF_COOKIE, token, {
    path: "/",
    httpOnly: false,
    sameSite: isHttps ? "none" : "lax",
    secure: isHttps,
    ...(isHttps ? { partitioned: true } : {}),
    maxAge: 30 * 24 * 3600,
  });
  return response;
}

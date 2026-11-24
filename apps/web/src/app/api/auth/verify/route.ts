import { NextRequest, NextResponse } from "next/server";

import { verifyEmailToken } from "@/lib/auth";
import { publicUrl } from "@/lib/http";
import { createSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const userId = token ? await verifyEmailToken(token) : null;

  if (userId) {
    await createSession(userId, {
      remember: true,
      userAgent: request.headers.get("user-agent"),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    });
    return NextResponse.redirect(publicUrl(request, "/dashboard?verified=1"));
  }
  return NextResponse.redirect(publicUrl(request, "/verify-email?error=invalid"));
}

import "server-only";

import crypto from "crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { CSRF_COOKIE } from "@/lib/session";
import { randomToken } from "@/lib/session";

export function getCsrfCookie(): string | undefined {
  return cookies().get(CSRF_COOKIE)?.value;
}

/** Called from middleware / route handlers: guarantees a double-submit token exists. */
export function ensureCsrfCookie(): string {
  const jar = cookies();
  const existing = jar.get(CSRF_COOKIE)?.value;
  if (existing) return existing;
  const token = randomToken(24);
  jar.set(CSRF_COOKIE, token, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 3600,
  });
  return token;
}

/** Double-submit check for every mutating request. */
export function assertCsrf(request: NextRequest, cookieToken?: string | null): boolean {
  const header = request.headers.get("x-csrf-token");
  const cookie = cookieToken ?? request.cookies.get(CSRF_COOKIE)?.value ?? null;
  if (!header || !cookie) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(cookie);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

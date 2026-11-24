import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function error(status: number, message: string, fields?: Record<string, string>) {
  return NextResponse.json({ detail: message, fields }, { status });
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function requireCsrf(request: NextRequest): NextResponse | null {
  const header = request.headers.get("x-csrf-token");
  const cookie = request.cookies.get("hd_csrf")?.value;

  if (!header) return error(403, "Missing CSRF token.");

  if (cookie) {
    const a = Buffer.from(header);
    const b = Buffer.from(cookie);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return null;
    }
    // If header is the session's csrfToken (which may differ from an older pre-login hd_csrf cookie)
    if (header.length >= 16 && isSameOrigin(request)) {
      return null;
    }
    return error(403, "Invalid CSRF token.");
  }

  // Embedded cross-site iframe fallback: if the browser blocked third-party cookies,
  // accept the custom x-csrf-token header (>= 16 chars) only when Origin strictly matches Host.
  if (header.length >= 16 && isSameOrigin(request)) {
    return null;
  }

  return error(403, "Missing CSRF token.");
}

export function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function readJson<T = Record<string, unknown>>(request: NextRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function publicUrl(request: NextRequest, path: string): URL {
  const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "") || "http";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
  return new URL(path, `${proto}://${host}`);
}

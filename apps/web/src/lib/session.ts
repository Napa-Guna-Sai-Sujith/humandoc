import "server-only";

import { cookies, headers } from "next/headers";
import crypto from "crypto";

import { one, pool } from "@/lib/db";

export const SESSION_COOKIE = "hd_session";
export const CSRF_COOKIE = "hd_csrf";

export type SafeUser = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  emailVerifiedAt: string | null;
  createdAt: string;
};

type SessionRow = {
  session_id: string;
  csrf_token: string;
  expires_at: string;
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  email_verified_at: string | null;
  created_at: string;
};

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function cookieSecurity(): { sameSite: "none" | "lax"; secure: boolean; partitioned?: boolean } {
  try {
    const proto = headers().get("x-forwarded-proto");
    if (proto === "https") return { sameSite: "none", secure: true, partitioned: true };
  } catch {
    /* outside request scope (e.g. unit tests) */
  }
  const secure = process.env.NODE_ENV === "production";
  return { sameSite: "lax", secure };
}

export function sessionMaxAge(remember: boolean): number {
  const hours = Number(process.env.SESSION_TTL_HOURS || 720);
  return (remember ? hours : 24) * 3600;
}

export async function createSession(
  userId: string,
  options: { remember?: boolean; userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; csrf: string }> {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const maxAge = sessionMaxAge(options.remember ?? false);

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, csrf_token, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
    [userId, hashToken(token), csrf, (options.userAgent ?? "").slice(0, 512), options.ip, maxAge],
  );

  const jar = cookies();
  const sec = cookieSecurity();
  jar.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: sec.sameSite,
    secure: sec.secure,
    ...(sec.partitioned ? { partitioned: true } : {}),
    maxAge,
  });
  jar.set(CSRF_COOKIE, csrf, {
    path: "/",
    httpOnly: false,
    sameSite: sec.sameSite,
    secure: sec.secure,
    ...(sec.partitioned ? { partitioned: true } : {}),
    maxAge,
  });

  return { token, csrf };
}

function readTokenFromRequest(): string | undefined {
  const fromCookie = cookies().get(SESSION_COOKIE)?.value;
  if (fromCookie) return fromCookie;
  try {
    const fromHeader = headers().get("x-hd-session");
    if (fromHeader) return fromHeader;
  } catch {
    /* outside request scope */
  }
  return undefined;
}

export async function getSession(): Promise<{ user: SafeUser; csrf: string; sessionId: string } | null> {
  const token = readTokenFromRequest();
  if (!token) return null;

  const row = await one<SessionRow>(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
            u.id, u.email, u.name, u.role, u.email_verified_at, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.deleted_at IS NULL`,
    [hashToken(token)],
  );
  if (!row) return null;

  return {
    sessionId: row.session_id,
    csrf: row.csrf_token,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      emailVerifiedAt: row.email_verified_at,
      createdAt: row.created_at,
    },
  };
}

export async function requireUser(): Promise<SafeUser> {
  const session = await getSession();
  if (!session) throw new RedirectError("/login");
  return session.user;
}

export class RedirectError extends Error {
  constructor(public readonly destination: string) {
    super(destination);
  }
}

export async function destroySession(): Promise<void> {
  const token = readTokenFromRequest();
  if (token) {
    await pool.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [hashToken(token)]);
  }
  const jar = cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

export async function revokeAllSessions(userId: string, exceptId?: string): Promise<void> {
  await pool.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2)`,
    [userId, exceptId ?? null],
  );
}

import "server-only";

import crypto from "crypto";

import bcrypt from "bcryptjs";

import { one, pool, query, withTransaction } from "@/lib/db";
import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/mail";
import { hashToken, randomToken, revokeAllSessions } from "@/lib/session";

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
  }
}

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES || 5);
const LOCKOUT_MIN = Number(process.env.LOGIN_LOCKOUT_MIN || 15);
const VERIFY_TTL_MIN = Number(process.env.VERIFY_TOKEN_TTL_MIN || 60);
const RESET_TTL_MIN = Number(process.env.RESET_TOKEN_TTL_MIN || 30);
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_COST || 12);

const ipAttempts = new Map<string, { count: number; resetAt: number }>();

/** Best-effort per-IP throttle on top of the database-backed account lockout. */
export function checkIpThrottle(ip: string, limit = 30, windowMs = 60_000): void {
  const now = Date.now();
  const entry = ipAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    ipAttempts.set(ip, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count += 1;
  if (entry.count > limit) {
    throw new AuthError(429, "Too many attempts. Try again in a minute.");
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  role: "user" | "admin";
  email_verified_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
};

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ userId: string; token: string; role: 'user' | 'admin' }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  const existing = await one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  if (existing) throw new AuthError(409, "An account with this email already exists.", "email");

  const passwordHash = await hashPassword(input.password);
  const token = randomToken(32);

  try {
    const user = await withTransaction(async (client) => {
      const adminEmail = (process.env.ADMIN_EMAIL || "napagunasaisujith@gmail.com").trim().toLowerCase();
      const initialRole = email === adminEmail ? "admin" : "user";
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, role, email_verified_at)
         VALUES ($1, $2, $3, $4, now())
         RETURNING id`,
        [email, name, passwordHash, initialRole],
      );
      await client.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
        [inserted.rows[0].id, hashToken(token), VERIFY_TTL_MIN],
      );
      await client.query(
        `INSERT INTO subscriptions (user_id, tier, status, pages_per_month)
         VALUES ($1, 'free', 'active', 20)
         ON CONFLICT (user_id) DO NOTHING`,
        [inserted.rows[0].id],
      );
      return inserted.rows[0];
    });
    return { userId: user.id, token, role: (email === (process.env.ADMIN_EMAIL || 'napagunasaisujith@gmail.com').trim().toLowerCase() ? 'admin' : 'user') };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new AuthError(409, "An account with this email already exists.", "email");
    }
    throw error;
  }
}

export async function sendVerification(userId: string, email: string, token: string): Promise<void> {
  const url = `${APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendVerificationEmail(email, url);
  await pool.query("INSERT INTO audit_logs (user_id, action, meta) VALUES ($1, 'auth.verification_sent', $2)", [
    userId,
    JSON.stringify({ email }),
  ]);
}

export async function loginUser(input: {
  email: string;
  password: string;
  ip?: string | null;
}): Promise<{ userId: string; role: "user" | "admin"; emailVerified: boolean }> {
  const email = input.email.trim().toLowerCase();

  const user = await one<UserRow>("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  if (!user) {
    await bcrypt.compare(input.password, "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBpUv0Qh0eYlJ1s4vZ5s1r3xY9G2mW");
    throw new AuthError(401, "Email or password is incorrect.");
  }

  const lockedUntil = user.locked_until ? new Date(user.locked_until) : null;
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AuthError(423, `Account temporarily locked. Try again in ${minutes} minute(s).`);
  }

  const ok = await verifyPassword(input.password, user.password_hash);
  if (!ok) {
    const failures = user.failed_login_count + 1;
    const shouldLock = failures >= MAX_FAILURES;
    await pool.query(
      `UPDATE users
          SET failed_login_count = $2,
              locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END
        WHERE id = $1`,
      [user.id, failures, shouldLock, LOCKOUT_MIN],
    );
    await pool.query(
      "INSERT INTO audit_logs (user_id, action, meta) VALUES ($1, 'auth.login_failed', $2)",
      [user.id, JSON.stringify({ ip: input.ip ?? null, count: failures })],
    );
    if (shouldLock) {
      throw new AuthError(423, `Too many failed attempts. Account locked for ${LOCKOUT_MIN} minutes.`);
    }
    throw new AuthError(401, "Email or password is incorrect.");
  }

  await pool.query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
    [user.id],
  );
  await pool.query("INSERT INTO audit_logs (user_id, action, meta) VALUES ($1, 'auth.login', $2)", [
    user.id,
    JSON.stringify({ ip: input.ip ?? null }),
  ]);

  return {
    userId: user.id,
    role: user.role,
    emailVerified: Boolean(user.email_verified_at),
  };
}

export async function verifyEmailToken(rawToken: string): Promise<string | null> {
  const row = await one<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    "SELECT * FROM email_verification_tokens WHERE token_hash = $1",
    [hashToken(rawToken)],
  );
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  await withTransaction(async (client) => {
    await client.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [row.user_id]);
    await client.query("UPDATE email_verification_tokens SET used_at = now() WHERE id = $1", [row.id]);
    await client.query("INSERT INTO audit_logs (user_id, action) VALUES ($1, 'auth.email_verified')", [row.user_id]);
  });
  return row.user_id;
}

export async function resendVerification(userId: string, email: string): Promise<void> {
  const token = randomToken(32);
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [userId, hashToken(token), VERIFY_TTL_MIN],
  );
  await sendVerification(userId, email, token);
}

export async function requestPasswordReset(emailInput: string): Promise<void> {
  const email = emailInput.trim().toLowerCase();
  const user = await one<{ id: string; email: string }>("SELECT id, email FROM users WHERE lower(email) = lower($1)", [
    email,
  ]);
  if (!user) return; // never reveal whether the account exists

  const token = randomToken(32);
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [user.id, hashToken(token), RESET_TTL_MIN],
  );
  const url = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendPasswordResetEmail(user.email, url);
}

export async function resetPasswordWithToken(rawToken: string, newPassword: string): Promise<string | null> {
  const row = await one<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    "SELECT * FROM password_reset_tokens WHERE token_hash = $1",
    [hashToken(rawToken)],
  );
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    await client.query(
      "UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1",
      [row.user_id, passwordHash],
    );
    await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [row.id]);
    await client.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1", [row.user_id]);
    await client.query("INSERT INTO audit_logs (user_id, action) VALUES ($1, 'auth.password_reset')", [row.user_id]);
  });
  return row.user_id;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await one<UserRow>("SELECT * FROM users WHERE id = $1", [userId]);
  if (!user) throw new AuthError(404, "Account not found");
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) throw new AuthError(400, "Current password is incorrect.", "currentPassword");

  const passwordHash = await hashPassword(newPassword);
  await pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, passwordHash]);
  await revokeAllSessions(userId);
  await pool.query("INSERT INTO audit_logs (user_id, action) VALUES ($1, 'auth.password_changed')", [userId]);
  await sendPasswordChangedEmail(user.email);
}

export async function updateProfile(userId: string, name: string): Promise<void> {
  await pool.query("UPDATE users SET name = $2, updated_at = now() WHERE id = $1", [userId, name.trim()]);
}

export async function emailExists(email: string): Promise<boolean> {
  const row = await one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [
    email.trim().toLowerCase(),
  ]);
  return Boolean(row);
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

export async function findOrCreateGoogleUser(input: {
  email: string;
  name?: string;
  googleId: string;
}): Promise<{ userId: string; role: string; emailVerified: boolean }> {
  const email = input.email.trim().toLowerCase();
  const existing = await one<{
    id: string;
    role: string;
    email_verified_at: Date | null;
  }>(
    "SELECT id, role, email_verified_at FROM users WHERE lower(email) = $1",
    [email]
  );

  if (existing) {
    if (!existing.email_verified_at) {
      await query("UPDATE users SET email_verified_at = now() WHERE id = $1", [existing.id]);
    }
    return {
      userId: existing.id,
      role: existing.role,
      emailVerified: true,
    };
  }

  return await withTransaction(async (client) => {
    const res = await client.query<{ id: string; role: string }>(
      `INSERT INTO users (email, name, email_verified_at, role, created_at, updated_at)
       VALUES ($1, $2, now(), 'user', now(), now())
       RETURNING id, role`,
      [email, input.name || email.split("@")[0]]
    );
    const user = res.rows[0];

    await client.query(
      `INSERT INTO subscriptions (user_id, tier, status, pages_per_month, created_at, updated_at)
       VALUES ($1, 'free', 'active', 20, now(), now())`,
      [user.id]
    );

    return {
      userId: user.id,
      role: user.role,
      emailVerified: true,
    };
  });
}

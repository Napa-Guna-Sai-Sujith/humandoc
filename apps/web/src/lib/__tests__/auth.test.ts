import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { dbMock, mailMock } = vi.hoisted(() => ({
  dbMock: {
    one: vi.fn(),
    query: vi.fn(),
    pool: { query: vi.fn() },
    withTransaction: vi.fn(),
  },
  mailMock: {
    sendVerificationEmail: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    sendPasswordChangedEmail: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => dbMock);
vi.mock("@/lib/mail", () => mailMock);

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: () => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

import {
  AuthError,
  checkIpThrottle,
  hashPassword,
  loginUser,
  registerUser,
  resetPasswordWithToken,
  verifyEmailToken,
  verifyPassword,
} from "@/lib/auth";
import { assertCsrf } from "@/lib/csrf";
import { hashToken, sessionMaxAge } from "@/lib/session";

describe("password hashing & session helpers", () => {
  it("hashes and verifies passwords with bcrypt", async () => {
    const hash = await hashPassword("GoodPassw0rd!");
    expect(hash.startsWith("$2")).toBe(true);
    expect(await verifyPassword("GoodPassw0rd!", hash)).toBe(true);
    expect(await verifyPassword("WrongPassw0rd!", hash)).toBe(false);
    expect(await verifyPassword("GoodPassw0rd!", null)).toBe(false);
  });

  it("produces deterministic sha256 token hashes and honors remember-me TTL", () => {
    expect(hashToken("abc")).toHaveLength(64);
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(sessionMaxAge(false)).toBe(24 * 3600);
    expect(sessionMaxAge(true)).toBeGreaterThan(24 * 3600);
  });

  it("validates double-submit CSRF tokens in constant time", () => {
    const reqOk = {
      headers: new Headers({ "x-csrf-token": "secret-token-123" }),
      cookies: { get: () => ({ value: "secret-token-123" }) },
    } as unknown as Parameters<typeof assertCsrf>[0];
    const reqBad = {
      headers: new Headers({ "x-csrf-token": "wrong-token-000" }),
      cookies: { get: () => ({ value: "secret-token-123" }) },
    } as unknown as Parameters<typeof assertCsrf>[0];

    expect(assertCsrf(reqOk)).toBe(true);
    expect(assertCsrf(reqBad)).toBe(false);
  });
});

describe("auth flows (register, login lockout, verify, reset)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects duplicate emails on registration with 409", async () => {
    dbMock.one.mockResolvedValueOnce({ id: "existing-user" });
    await expect(
      registerUser({ name: "Ada", email: "ada@example.com", password: "GoodPassw0rd!" }),
    ).rejects.toMatchObject({ status: 409, field: "email" });
  });

  it("locks account after 5 failed login attempts", async () => {
    const realHash = await hashPassword("CorrectPass1!");
    dbMock.one.mockResolvedValueOnce({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      password_hash: realHash,
      role: "user",
      email_verified_at: new Date().toISOString(),
      failed_login_count: 4, // 5th failure triggers lockout
      locked_until: null,
    });
    dbMock.pool.query.mockResolvedValue({ rows: [] });

    await expect(loginUser({ email: "ada@example.com", password: "WrongPassword1!" })).rejects.toMatchObject({
      status: 423,
    });
    expect(dbMock.pool.query).toHaveBeenCalled();
  });

  it("blocks login while account lockout window is active", async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    dbMock.one.mockResolvedValueOnce({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      password_hash: "unused",
      role: "user",
      email_verified_at: null,
      failed_login_count: 5,
      locked_until: future,
    });

    await expect(loginUser({ email: "ada@example.com", password: "any" })).rejects.toMatchObject({ status: 423 });
  });

  it("verifies valid email token and rejects expired/used tokens", async () => {
    dbMock.one.mockResolvedValueOnce({
      id: "tok1",
      user_id: "u1",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      used_at: null,
    });
    expect(await verifyEmailToken("expired-raw")).toBeNull();

    dbMock.one.mockResolvedValueOnce({
      id: "tok2",
      user_id: "u1",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: null,
    });
    dbMock.withTransaction.mockImplementationOnce(async (fn: (c: { query: typeof vi.fn }) => Promise<unknown>) =>
      fn({ query: vi.fn() }),
    );
    expect(await verifyEmailToken("valid-raw")).toBe("u1");
  });

  it("resets password with valid 30-min token and revokes sessions", async () => {
    const clientQuery = vi.fn();
    dbMock.one.mockResolvedValueOnce({
      id: "rst1",
      user_id: "u1",
      expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      used_at: null,
    });
    dbMock.withTransaction.mockImplementationOnce(async (fn: (c: { query: typeof vi.fn }) => Promise<unknown>) =>
      fn({ query: clientQuery }),
    );

    const uid = await resetPasswordWithToken("reset-raw", "BrandNewPass1!");
    expect(uid).toBe("u1");
    expect(clientQuery).toHaveBeenCalledTimes(4);
  });

  it("enforces per-IP rate limiting", () => {
    const ip = "203.0.113.77";
    checkIpThrottle(ip, 2, 60_000);
    checkIpThrottle(ip, 2, 60_000);
    expect(() => checkIpThrottle(ip, 2, 60_000)).toThrow(AuthError);
  });
});

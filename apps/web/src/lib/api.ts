"use client";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

const SESSION_HEADER = "x-hd-session";
const SESSION_STORAGE_KEY = "hd_session_token";
const CSRF_STORAGE_KEY = "hd_csrf_token";

let memoryCsrf: string | null = null;
let memorySession: string | null = null;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function safeStorageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key); window.sessionStorage.removeItem(key);
  } catch {
    /* ignore restricted storage */
  }
}

export function setClientAuthTokens(tokens: { sessionToken?: string | null; csrfToken?: string | null }): void {
  if (tokens.sessionToken !== undefined) {
    memorySession = tokens.sessionToken || null;
    safeStorageSet(SESSION_STORAGE_KEY, memorySession);
  }
  if (tokens.csrfToken !== undefined) {
    memoryCsrf = tokens.csrfToken || null;
    safeStorageSet(CSRF_STORAGE_KEY, memoryCsrf);
  }
}

export function clearClientAuthTokens(): void {
  memorySession = null;
  memoryCsrf = null;
  safeStorageSet(SESSION_STORAGE_KEY, null);
  safeStorageSet(CSRF_STORAGE_KEY, null);
}

export function getClientSessionToken(): string | null {
  return memorySession || safeStorageGet(SESSION_STORAGE_KEY);
}

async function ensureCsrfToken(): Promise<string | null> {
  const existing = memoryCsrf || safeStorageGet(CSRF_STORAGE_KEY);
  if (existing) return existing;
  const fromCookie = readCookie("hd_csrf");
  if (fromCookie) {
    memoryCsrf = fromCookie;
    safeStorageSet(CSRF_STORAGE_KEY, fromCookie);
    return fromCookie;
  }

  try {
    const res = await fetch("/api/auth/csrf", { credentials: "include", cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { csrf?: string };
      if (data.csrf) {
        memoryCsrf = data.csrf;
        safeStorageSet(CSRF_STORAGE_KEY, data.csrf);
        return data.csrf;
      }
    }
  } catch {
    /* network error */
  }
  return readCookie("hd_csrf");
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown; blob?: boolean };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, blob, headers, ...rest } = options;
  const headerMap: Record<string, string> = {
    Accept: "application/json",
    ...(body instanceof FormData ? {} : body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(headers as Record<string, string> | undefined),
  };

  const sessionTok = getClientSessionToken();
  if (sessionTok && !headerMap[SESSION_HEADER]) {
    headerMap[SESSION_HEADER] = sessionTok;
  }

  const method = (rest.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = await ensureCsrfToken();
    if (csrf) headerMap["x-csrf-token"] = csrf;
  }

  const init: RequestInit = {
    ...rest,
    credentials: "include",
    headers: headerMap,
  };

  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") || "";
  const payload = blob && contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let fields: Record<string, string> | undefined;
    try {
      const data = await response.json();
      message = data.detail || data.message || data.error || message;
      if (data.fields && typeof data.fields === "object") {
        fields = data.fields as Record<string, string>;
      } else if (typeof data.detail === "object" && data.detail !== null) {
        fields = Object.fromEntries(
          (data.detail as Array<{ loc: string[]; msg: string }>).map((issue) => [issue.loc[issue.loc.length - 1], issue.msg]),
        );
        message = Object.values(fields)[0] || message;
      }
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(response.status, message, fields);
  }

  if (blob) return payload as T;
  const data = (await response.json()) as T & { sessionToken?: string; csrfToken?: string };
  if (data && typeof data === "object") {
    if ("sessionToken" in data || "csrfToken" in data) {
      setClientAuthTokens({
        sessionToken: (data as { sessionToken?: string }).sessionToken,
        csrfToken: (data as { csrfToken?: string }).csrfToken,
      });
    }
  }
  if (path === "/api/auth/logout" || path === "/api/auth/account") {
    clearClientAuthTokens();
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
};

export type JobStatus =
  | "queued"
  | "analyzing"
  | "analyzed"
  | "rewriting"
  | "rebuilding"
  | "verifying"
  | "done"
  | "failed"
  | "canceled";

export type Job = {
  id: string;
  status: JobStatus;
  filename: string;
  size: number;
  kind: string;
  total_pages: number;
  processed_pages: number;
  total_blocks: number;
  rewritten_blocks: number;
  flagged_blocks: number;
  skipped_blocks: number;
  words: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  options: Record<string, unknown>;
  analysis: Record<string, unknown> | null;
  current_section: string | null;
  error: string | null;
  has_output: boolean;
  has_qa: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
  pages: Array<{ page: number; status: string; notes: Record<string, unknown> }>;
};

export type Analysis = {
  kind: string;
  total_pages: number;
  words: number;
  words_rewrite: number;
  languages: string[];
  fonts: string[];
  selectable: boolean;
  needs_ocr: boolean;
  blocks_total: number;
  blocks_rewrite: number;
  blocks_skipped: number;
  est_tokens_in: number;
  est_tokens_out: number;
  est_cost_usd: number;
  warnings: string[];
};

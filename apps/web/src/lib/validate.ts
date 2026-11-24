export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string; color: string };

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value.trim());
}

export function passwordStrength(password: string): PasswordStrength {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const clamped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  const colors = ["bg-red-500", "bg-red-400", "bg-amber-400", "bg-emerald-400", "bg-emerald-500"];
  return { score: clamped, label: labels[clamped], color: colors[clamped] };
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 128) return "Password must be 128 characters or fewer.";
  if (!/[a-z]/.test(password)) return "Add at least one lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Add at least one uppercase letter.";
  if (!/\d/.test(password)) return "Add at least one number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Add at least one symbol.";
  return null;
}

export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return "Enter your full name.";
  if (trimmed.length > 80) return "Name must be 80 characters or fewer.";
  if (!/^[\p{L}\p{M}.' -]+$/u.test(trimmed)) return "Name contains unsupported characters.";
  return null;
}

export type RegistrationInput = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  terms: boolean;
};

export type FieldErrors = Record<string, string>;

export function validateRegistration(input: RegistrationInput): FieldErrors {
  const errors: FieldErrors = {};
  const nameError = validateName(input.name);
  if (nameError) errors.name = nameError;
  if (!isValidEmail(input.email)) errors.email = "Enter a valid email address.";
  const passwordError = validatePassword(input.password);
  if (passwordError) errors.password = passwordError;
  if (input.password !== input.confirmPassword) errors.confirmPassword = "Passwords do not match.";
  if (!input.terms) errors.terms = "You must accept the terms and privacy policy.";
  return errors;
}

export function validateLogin(input: { email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!isValidEmail(input.email)) errors.email = "Enter a valid email address.";
  if (!input.password) errors.password = "Enter your password.";
  return errors;
}

export function pageRangeError(value: string, totalPages?: number): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return null;
  const parts = trimmed.split(",").map((part) => part.trim());
  for (const part of parts) {
    const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
    if (!match) return "Use formats like 1-10, 15 or all.";
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start) return "Page range must be ascending and start at 1.";
    if (totalPages && start > totalPages) return `This document only has ${totalPages} page(s).`;
  }
  return null;
}

export function parsePageRange(value: string, totalPages: number): number[] {
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part.trim());
    if (!match) continue;
    const start = Number(match[1]);
    const end = Math.min(totalPages, Number(match[2] ?? match[1]));
    for (let page = start; page <= end; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

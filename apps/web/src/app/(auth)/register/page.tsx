"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { isValidEmail, passwordStrength } from "@/lib/validate";
import { cn } from "@/lib/utils";

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "", terms: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const strength = passwordStrength(form.password);

  const validateField = (field: keyof typeof form, value: string | boolean) => {
    const next = { ...errors };
    if (field === "name") {
      const v = String(value).trim();
      if (v && v.length < 2) next.name = "Enter your full name.";
      else delete next.name;
    }
    if (field === "email") {
      if (String(value) && !isValidEmail(String(value))) next.email = "Enter a valid email address.";
      else delete next.email;
    }
    if (field === "password") {
      if (String(value) && String(value).length < 8) next.password = "At least 8 characters.";
      else delete next.password;
    }
    if (field === "confirmPassword") {
      if (String(value) && String(value) !== form.password) next.confirmPassword = "Passwords do not match.";
      else delete next.confirmPassword;
    }
    setErrors(next);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (form.name.trim().length < 2) nextErrors.name = "Enter your full name.";
    if (!isValidEmail(form.email)) nextErrors.email = "Enter a valid email address.";
    if (form.password.length < 8) nextErrors.password = "At least 8 characters.";
    if (form.password !== form.confirmPassword) nextErrors.confirmPassword = "Passwords do not match.";
    if (!form.terms) nextErrors.terms = "You must accept the terms to continue.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      const res = await api.post<{ ok: boolean; user?: { emailVerified?: boolean } }>("/api/auth/register", form);
      if (res.user?.emailVerified) {
        router.push("/dashboard");
      } else {
        router.push(`/verify-email?email=${encodeURIComponent(form.email)}`);
      }
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ ...(err.fields ?? {}), form: err.message });
      } else {
        setErrors({ form: "Something went wrong. Please try again." });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1.5 mb-6 text-sm text-muted-foreground">
        Start with 20 free pages a month. No card required.
      </p>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {errors.form ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errors.form}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            autoComplete="name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            onBlur={() => {
              setTouched({ ...touched, name: true });
              validateField("name", form.name);
            }}
            aria-invalid={Boolean(touched.name && errors.name)}
          />
          {touched.name && errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            onBlur={() => {
              setTouched({ ...touched, email: true });
              validateField("email", form.email);
            }}
            aria-invalid={Boolean(touched.email && errors.email)}
          />
          {touched.email && errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              onBlur={() => {
                setTouched({ ...touched, password: true });
                validateField("password", form.password);
              }}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {form.password ? (
            <div className="pt-1">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={cn("h-1 flex-1 rounded-full", step <= strength.score ? strength.color : "bg-secondary")}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{strength.label}</p>
            </div>
          ) : null}
          {touched.password && errors.password ? <p className="text-xs text-destructive">{errors.password}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
            onBlur={() => {
              setTouched({ ...touched, confirmPassword: true });
              validateField("confirmPassword", form.confirmPassword);
            }}
            aria-invalid={Boolean(touched.confirmPassword && errors.confirmPassword)}
          />
          {touched.confirmPassword && errors.confirmPassword ? (
            <p className="text-xs text-destructive">{errors.confirmPassword}</p>
          ) : null}
        </div>

        <div>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={form.terms}
              onChange={(event) => setForm({ ...form, terms: event.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-input accent-foreground"
            />
            <span className="text-muted-foreground">
              I agree to the{" "}
              <Link href="/legal/terms" className="text-foreground underline underline-offset-2">
                terms
              </Link>{" "}
              and{" "}
              <Link href="/legal/privacy" className="text-foreground underline underline-offset-2">
                privacy policy
              </Link>
              , and I&apos;ll follow my school or employer&apos;s AI-use policy.
            </span>
          </label>
          {errors.terms ? <p className="mt-1 text-xs text-destructive">{errors.terms}</p> : null}
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <>
      <noscript>
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          JavaScript is required to create a HumanDoc account. Please enable JavaScript in your browser and reload this page.
        </div>
      </noscript>
      <Suspense
        fallback={
          <div className="space-y-4">
            <div className="h-7 w-48 animate-pulse rounded bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded bg-muted" />
            <div className="h-10 w-full animate-pulse rounded bg-muted" />
            <div className="h-10 w-full animate-pulse rounded bg-muted" />
            <div className="h-10 w-full animate-pulse rounded bg-muted" />
          </div>
        }
      >
        <RegisterForm />
      </Suspense>
    </>
  );
}

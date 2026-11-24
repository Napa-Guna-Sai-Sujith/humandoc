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

  useEffect(() => {
    const error = params.get("error");
    if (error) {
      setErrors({ form: "Sign-up with Google failed. Please try again." });
    }
  }, [params]);

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
      await api.post("/api/auth/register", form);
      router.push("/dashboard");
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

      <div className="space-y-4 mb-4">
        <a
          href="/api/auth/google"
          className="inline-flex w-full items-center justify-center gap-3 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Continue with Google
        </a>

        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <span className="relative bg-background px-2 text-xs uppercase text-muted-foreground">
            Or sign up with email
          </span>
        </div>
      </div>

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
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

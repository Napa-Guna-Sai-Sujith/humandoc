"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { passwordStrength, validatePassword } from "@/lib/validate";
import { cn } from "@/lib/utils";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) setErrors({ form: "This reset link is incomplete. Request a new one." });
  }, [token]);

  const strength = passwordStrength(password);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const message = validatePassword(password);
    if (message) nextErrors.password = message;
    if (password !== confirm) nextErrors.confirm = "Passwords do not match.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      await api.post("/api/auth/reset", { token, password, confirmPassword: confirm });
      router.push("/login?reset=1");
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : "Could not reset password." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Must be at least 8 characters with upper case, lower case, a number and a symbol.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {errors.form ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errors.form}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {password ? (
            <div className="flex gap-1 pt-1">
              {[1, 2, 3, 4].map((step) => (
                <div key={step} className={cn("h-1 flex-1 rounded-full", step <= strength.score ? strength.color : "bg-secondary")} />
              ))}
            </div>
          ) : null}
          {errors.password ? <p className="text-xs text-destructive">{errors.password}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          {errors.confirm ? <p className="text-xs text-destructive">{errors.confirm}</p> : null}
        </div>

        <Button type="submit" className="w-full" disabled={submitting || !token}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Update password
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}

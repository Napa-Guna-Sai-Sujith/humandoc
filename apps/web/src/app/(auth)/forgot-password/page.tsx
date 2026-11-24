"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { isValidEmail } from "@/lib/validate";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.post("/api/auth/forgot", { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Enter your email and we&apos;ll send a secure link that expires in 30 minutes.
      </p>

      {sent ? (
        <div className="mt-6 rounded-lg border bg-secondary/60 p-4 text-sm">
          If an account exists for <span className="font-medium">{email}</span>, a reset link is on its way.
          Check your spam folder if it doesn&apos;t arrive within a few minutes.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <Button type="submit" className="w-full" disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Send reset link
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}

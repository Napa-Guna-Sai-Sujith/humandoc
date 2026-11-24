"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { Suspense, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Mail, RefreshCw, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const token = searchParams.get("token");
  const emailParam = searchParams.get("email");
  const errorParam = searchParams.get("error");

  const [verifying, setVerifying] = useState(Boolean(token));
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam === "invalid"
      ? "This verification link is invalid or has expired. Please request a new one below."
      : null,
  );
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // If token is present in the URL query, verify it immediately
  useEffect(() => {
    if (!token) return;

    let active = true;
    setVerifying(true);
    fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`, {
      method: "GET",
      redirect: "manual",
    })
      .then((res) => {
        if (!active) return;
        if (res.status === 200 || res.status === 302 || res.status === 307 || res.type === "opaqueredirect") {
          setVerified(true);
          setVerifying(false);
          toast({
            title: "Email Verified Successfully!",
            description: "Welcome to HumanDoc. Redirecting to your dashboard...",
            variant: "success",
          });
          setTimeout(() => {
            router.push("/dashboard?verified=1");
            router.refresh();
          }, 1500);
        } else {
          setVerifying(false);
          setError("Verification link is invalid or has expired. Please request a new one.");
        }
      })
      .catch(() => {
        if (!active) return;
        setVerifying(false);
        setError("Could not verify email token. Please try again.");
      });

    return () => {
      active = false;
    };
  }, [token, router, toast]);

  // Handle countdown for resend button
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    setResending(true);
    try {
      await api.post("/api/auth/resend", { email: emailParam || undefined });
      toast({
        title: "Verification Email Sent",
        description: "A fresh verification link has been sent to your email address.",
        variant: "success",
      });
      setCooldown(60);
      setError(null);
    } catch (err) {
      toast({
        title: "Resend Failed",
        description: err instanceof ApiError ? err.message : "Could not send verification email.",
        variant: "error",
      });
    } finally {
      setResending(false);
    }
  };

  // State 1: Verifying token
  if (verifying) {
    return (
      <div className="text-center py-8 space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
        <h1 className="text-2xl font-bold tracking-tight">Verifying your email...</h1>
        <p className="text-sm text-muted-foreground">Please wait while we confirm your account details.</p>
      </div>
    );
  }

  // State 2: Successfully verified
  if (verified) {
    return (
      <div className="text-center py-8 space-y-4 animate-fade-up">
        <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Email Verified!</h1>
        <p className="text-sm text-muted-foreground">
          Your account is now fully active. Redirecting you to your dashboard...
        </p>
        <div className="pt-2">
          <Button asChild className="gap-2">
            <Link href="/dashboard?verified=1">
              Go to Dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // State 3: Waiting for verification / Link sent / Error
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
          <Mail className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Verify your email address</h1>
        <p className="text-sm text-muted-foreground">
          {emailParam ? (
            <>
              We sent a verification link to <strong className="text-foreground">{emailParam}</strong>.
            </>
          ) : (
            "We sent a verification link to your registered email address."
          )}
        </p>
      </div>

      {error ? (
        <Alert variant="destructive" className="text-left">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Verification Error</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground">Next steps to access your account:</p>
          <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
            <li>Open your email inbox (check Spam or Junk if not found in 1-2 minutes).</li>
            <li>Click the <strong>&quot;Verify email&quot;</strong> link inside the message.</li>
            <li>Once confirmed, your HumanDoc dashboard and jobs will unlock completely!</li>
          </ol>
        </div>
      )}

      <div className="space-y-3 pt-2">
        <Button
          onClick={handleResend}
          disabled={resending || cooldown > 0}
          variant="outline"
          className="w-full gap-2"
        >
          {resending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {cooldown > 0 ? `Resend email in ${cooldown}s` : "Resend verification link"}
        </Button>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
          <Link href="/login" className="hover:text-foreground underline underline-offset-4">
            Back to Sign in
          </Link>
          <Link href="/dashboard" className="hover:text-foreground underline underline-offset-4">
            Already verified? Dashboard ↗
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}

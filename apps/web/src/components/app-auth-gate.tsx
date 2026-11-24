"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, LogOut, Mail, RefreshCw } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api, clearClientAuthTokens } from "@/lib/api";

type User = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  emailVerifiedAt?: string | null;
};

export function AppAuthGate({ initialUser, children }: { initialUser: User | null; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(initialUser);
  const [checking, setChecking] = useState(!initialUser);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const fetchUser = useCallback(async () => {
    try {
      const res = await api.get<{ user: User | null }>("/api/auth/me");
      if (res.user) {
        setUser(res.user);
        setChecking(false);
      } else {
        clearClientAuthTokens();
        router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
      }
    } catch {
      clearClientAuthTokens();
      router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
    }
  }, [pathname, router]);

  useEffect(() => {
    if (initialUser) {
      setUser(initialUser);
      setChecking(false);
      return;
    }
    fetchUser();
  }, [initialUser, fetchUser]);

  // Handle countdown for resend button
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (!user) return;
    setResending(true);
    try {
      await api.post("/api/auth/resend", { email: user.email });
      toast({
        title: "Verification Email Sent",
        description: `We sent a new confirmation link to ${user.email}. Check your inbox!`,
        variant: "success",
      });
      setCooldown(60);
    } catch {
      toast({
        title: "Could not send email",
        description: "Please wait a moment before requesting another link.",
        variant: "error",
      });
    } finally {
      setResending(false);
    }
  };

  const handleSignOut = async () => {
    await api.post("/api/auth/logout");
    clearClientAuthTokens();
    router.push("/login");
    router.refresh();
  };

  if (checking || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspace…
        </div>
      </div>
    );
  }

  // Verification Gate: user must have verified email or be admin
  const isVerified = Boolean(user.emailVerifiedAt) || user.role === "admin";

  if (!isVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <Card className="max-w-md w-full shadow-lg border-primary/20 animate-fade-up">
          <CardHeader className="text-center pb-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
              <Mail className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl font-bold">Verify Your Email Address</CardTitle>
            <CardDescription className="text-xs">
              To access your HumanDoc account, please verify your email address.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs leading-relaxed text-muted-foreground">
            <div className="rounded-lg bg-muted/60 p-3 border text-foreground">
              <p className="font-medium text-xs">
                We sent a verification link to <strong className="text-primary">{user.email}</strong>.
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Please click the link inside your email to unlock your account and start rewriting documents.
              </p>
            </div>

            <div className="space-y-2">
              <p className="font-semibold text-foreground">Didn&apos;t receive the email?</p>
              <ul className="list-disc list-inside space-y-1 text-[11px]">
                <li>Check your Spam or Promotions folder.</li>
                <li>Wait 1-2 minutes for mail delivery.</li>
                <li>Click the resend button below to dispatch a new link.</li>
              </ul>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2 pt-2 border-t">
            <Button
              onClick={handleResend}
              disabled={resending || cooldown > 0}
              className="w-full gap-2"
            >
              {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {cooldown > 0 ? `Resend link in ${cooldown}s` : "Resend Verification Email"}
            </Button>
            <Button
              variant="outline"
              onClick={fetchUser}
              className="w-full gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              I&apos;ve Verified My Email (Refresh)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="w-full text-xs text-muted-foreground hover:text-foreground mt-1"
            >
              <LogOut className="h-3.5 w-3.5 mr-1.5" /> Sign out
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <AppShell user={{ name: user.name, email: user.email, role: user.role }}>
      {children}
    </AppShell>
  );
}

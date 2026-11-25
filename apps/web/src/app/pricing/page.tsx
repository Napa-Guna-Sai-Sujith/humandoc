import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Logo } from "@/components/logo";
import { PricingClient } from "@/components/pricing-client";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Pricing & Plans",
  description:
    "Compare HumanDoc Free, Starter, Pro, and Studio plans by monthly page allowance, upload limits, and max pages per plagiarism check. No surprise overage charges.",
};

export default async function PricingPage() {
  const session = await getSession();

  if (session) {
    return (
      <AppShell
        user={{
          name: session.user.name,
          email: session.user.email,
          role: session.user.role,
        }}
      >
        <PricingClient isAuthenticated />
      </AppShell>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link href="/#how" className="hover:text-foreground">How it works</Link>
            <Link href="/#features" className="hover:text-foreground">Features</Link>
            <Link href="/pricing" className="font-medium text-foreground">Pricing</Link>
            <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/register">Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PricingClient isAuthenticated={false} />
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-xs text-muted-foreground sm:px-6">
          <Logo />
          <div className="flex gap-4">
            <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/responsible-use" className="hover:text-foreground">Responsible use</Link>
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
          </div>
          <p>© {new Date().getFullYear()} HumanDoc</p>
        </div>
      </footer>
    </div>
  );
}

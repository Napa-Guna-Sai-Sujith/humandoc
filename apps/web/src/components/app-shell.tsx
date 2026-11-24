"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Copyright,
  CreditCard,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Mail,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs/new", label: "New job", icon: Sparkles },
  { href: "/drillbit", label: "HD Plagiarism", icon: ShieldCheck },
  { href: "/history", label: "History", icon: History },
  { href: "/pricing", label: "Pricing & usage", icon: BarChart3 },
  { href: "/invoices", label: "Invoices", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

type User = { name: string; email: string; role: "user" | "admin" };

export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [usage, setUsage] = useState<{ pagesUsed: number; pagesPerMonth: number; pagesRemaining: number; tier: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [copyrightOpen, setCopyrightOpen] = useState(false);

  useEffect(() => {
    api
      .get<{ pagesUsed: number; pagesPerMonth: number; pagesRemaining: number; tier: string }>("/api/billing/usage")
      .then(setUsage)
      .catch(() => setUsage(null));
  }, [pathname]);

  const signOut = async () => {
    await api.post("/api/auth/logout");
    router.push("/login");
    router.refresh();
  };

  const initials = (user.name || user.email || "U").slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-card lg:flex">
        <div className="flex h-16 items-center px-6">
          <Logo />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          {user.role === "admin" ? (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith("/admin")
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <ShieldCheck className="h-4 w-4" />
              Admin
            </Link>
          ) : null}
        </nav>

        {/* Queries & Support Contact */}
        <div className="border-t p-3 bg-primary/5 text-xs">
          <div className="flex items-start gap-2">
            <Mail className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold text-foreground text-[11px]">For any queries contact:</p>
              <a
                href="mailto:napagunasaisujith@gmail.com"
                className="block truncate text-[11px] text-primary hover:underline font-medium"
                title="Send email to support"
              >
                napagunasaisujith@gmail.com
              </a>
            </div>
          </div>
        </div>

        {/* Copyright Button */}
        <div className="border-t p-2 text-center bg-card">
          <button
            type="button"
            onClick={() => setCopyrightOpen(true)}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors font-medium cursor-pointer"
          >
            <Copyright className="h-3 w-3" />
            <span>&copy; 2026 HD Plagiarism · Copyright</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            className="rounded-md p-2 hover:bg-accent lg:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle navigation"
          >
            <FileText className="h-5 w-5" />
          </button>
          <div className="lg:hidden">
            <Logo compact />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:block">
              {usage ? `${usage.pagesRemaining} pages left` : ""}
            </span>
            <div className="h-6 w-px bg-border" />
            <Link href="/settings" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs uppercase border border-primary/20">
                {initials}
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-xs font-medium leading-tight">{user.name || "User"}</p>
                <p className="text-[10px] text-muted-foreground">{user.email}</p>
              </div>
            </Link>
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5 ml-1">
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        {mobileOpen ? (
          <nav className="border-b bg-card px-3 py-2 lg:hidden">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
            <div className="mt-2 pt-2 border-t text-xs px-2 text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground text-[11px]">For queries: napagunasaisujith@gmail.com</p>
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setCopyrightOpen(true);
                }}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <Copyright className="h-3 w-3" /> Copyright Notice
              </button>
            </div>
          </nav>
        ) : null}

        <main className="flex-1 px-4 py-8 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>

        <footer className="border-t bg-card px-6 py-4 text-xs text-muted-foreground">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCopyrightOpen(true)}
                className="flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
              >
                <Copyright className="h-3.5 w-3.5" /> 2026 HumanDoc HD Plagiarism. All rights reserved.
              </button>
              <span className="hidden sm:inline text-muted-foreground/40">|</span>
              <span className="text-muted-foreground">Files deleted automatically. Zero AI training.</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <a
                href="mailto:napagunasaisujith@gmail.com"
                className="hover:text-foreground font-semibold text-primary inline-flex items-center gap-1"
              >
                <Mail className="h-3 w-3" /> Queries: napagunasaisujith@gmail.com
              </a>
              <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
              <Link href="/legal/terms" className="hover:text-foreground">Terms</Link>
              <Link href="/responsible-use" className="hover:text-foreground">Responsible use</Link>
            </div>
          </div>
        </footer>
      </div>

      {/* Copyright Notice Dialog */}
      <Dialog
        open={copyrightOpen}
        onClose={() => setCopyrightOpen(false)}
        title="Copyright & Intellectual Property Notice"
        description="Legal and ownership disclosure for HumanDoc HD Plagiarism."
      >
        <div className="space-y-3 text-xs leading-relaxed text-muted-foreground">
          <div className="rounded-lg bg-muted/60 p-3 border text-foreground space-y-1">
            <p className="font-semibold text-sm">&copy; 2026 HumanDoc (HD Plagiarism). All rights reserved.</p>
            <p className="text-xs text-muted-foreground">
              HD Plagiarism Detection, Similarity Calibration, and Deep Humanization Engine are proprietary technologies of HumanDoc.
            </p>
          </div>

          <p>
            All submitted content, research documents, and generated rewrite outputs remain the exclusive intellectual property of the respective authors. HumanDoc does not store, retain, publish, or train machine learning models on any customer documents.
          </p>

          <div className="rounded-lg border bg-card p-3 space-y-1.5">
            <p className="font-semibold text-foreground text-xs flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-primary" /> Questions, Licensing or Academic Queries
            </p>
            <p className="text-[11px]">
              For any queries, enterprise partnerships, or support, please contact our team directly:
            </p>
            <a
              href="mailto:napagunasaisujith@gmail.com"
              className="text-primary font-bold text-xs hover:underline block"
            >
              napagunasaisujith@gmail.com
            </a>
          </div>

          <div className="pt-2 flex justify-end">
            <Button size="sm" onClick={() => setCopyrightOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-card p-10 text-center">
      <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <h3 className="font-medium">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export { timeAgo };

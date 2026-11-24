"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { Suspense } from "react";
import { Check, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Usage = {
  tier: string;
  pagesUsed: number;
  pagesPerMonth: number;
  pagesRemaining: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type Tier = { id: string; name: string; pages: number; price: number; blurb: string; features: string[] };

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    pages: 20,
    price: 0,
    blurb: "For trying it out on a short paper.",
    features: ["20 pages a month", "PDF, DOCX, PPTX, Markdown", "Block locking", "QA report", "7-day auto-delete"],
  },
  {
    id: "starter",
    name: "Starter",
    pages: 100,
    price: 12,
    blurb: "For a thesis chapter or a weekly report.",
    features: ["100 pages a month", "Priority queue", "Side-by-side preview", "Custom instructions", "Email support"],
  },
  {
    id: "pro",
    name: "Pro",
    pages: 500,
    price: 29,
    blurb: "For teams that rewrite every week.",
    features: ["500 pages a month", "Priority queue", "Glossary memory", "Bulk page ranges", "Email support"],
  },
  {
    id: "studio",
    name: "Studio",
    pages: 2000,
    price: 79,
    blurb: "For agencies and research groups.",
    features: ["2,000 pages a month", "Highest priority", "Dedicated worker pool", "Custom retention window", "Support SLA"],
  },
];

function PricingContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const [usage, setUsage] = React.useState<Usage | null>(null);
  const [loading, setLoading] = React.useState<string | null>(null);
  const [portalLoading, setPortalLoading] = React.useState(false);

  React.useEffect(() => {
    api.get<Usage>("/api/billing/usage").then(setUsage).catch(() => setUsage(null));
    if (params.get("upgraded")) toast({ title: "Welcome aboard", description: "Your plan is now active.", variant: "success" });
    if (params.get("canceled")) toast({ title: "Checkout canceled", description: "No changes were made." });
  }, [params, toast]);

  const checkout = async (tier: Tier) => {
    setLoading(tier.id);
    try {
      const result = await api.post<{ url: string }>("/api/billing/checkout", { tier: tier.id });
      window.location.href = result.url;
    } catch (err) {
      toast({
        title: "Checkout failed",
        description: err instanceof ApiError ? err.message : "Stripe is not configured.",
        variant: "error",
      });
      setLoading(null);
    }
  };

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const result = await api.post<{ url: string }>("/api/billing/portal");
      window.location.href = result.url;
    } catch (err) {
      toast({ title: "Could not open billing portal", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
      setPortalLoading(false);
    }
  };

  const cancel = async () => {
    try {
      await api.post("/api/billing/cancel");
      toast({ title: "Subscription will not renew", description: "You keep access until the period ends.", variant: "success" });
      router.refresh();
      const fresh = await api.get<Usage>("/api/billing/usage");
      setUsage(fresh);
    } catch (err) {
      toast({ title: "Could not update subscription", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    }
  };

  const pct = usage ? Math.min(100, (usage.pagesUsed / Math.max(1, usage.pagesPerMonth)) * 100) : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pricing &amp; usage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Simple plans by page count. No per-token surprises — every job shows its cost before you start.
        </p>
      </div>

      {usage ? (
        <Card>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium capitalize">{usage.tier} plan</p>
                <p className="text-xs text-muted-foreground">
                  {usage.pagesUsed.toLocaleString()} of {usage.pagesPerMonth.toLocaleString()} pages used this period
                  {usage.currentPeriodEnd ? ` · renews ${new Date(usage.currentPeriodEnd).toLocaleDateString()}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={openPortal} disabled={portalLoading}>
                  {portalLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Billing portal
                </Button>
                {usage.tier !== "free" && !usage.cancelAtPeriodEnd ? (
                  <Button variant="ghost" size="sm" onClick={cancel}>
                    Cancel renewal
                  </Button>
                ) : null}
              </div>
            </div>
            <Progress value={pct} className="mt-4" />
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{usage.pagesRemaining.toLocaleString()} pages remaining</span>
              <Link href="/invoices" className="underline underline-offset-2 hover:text-foreground">
                View invoices
              </Link>
            </div>
            {usage.cancelAtPeriodEnd ? (
              <p className="mt-3 text-xs text-amber-700">
                Your subscription is set to cancel at the end of the current period.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TIERS.map((tier) => {
          const current = usage?.tier === tier.id;
          return (
            <Card key={tier.id} className={cn("flex flex-col", current && "border-primary")}>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{tier.name}</CardTitle>
                  {current ? <Badge variant="success">Current</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">{tier.blurb}</p>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-3xl font-semibold tracking-tight">
                  ${tier.price}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
                <ul className="mt-4 space-y-2">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {tier.id === "free" ? (
                  <Button variant="outline" className="w-full" asChild>
                    <Link href="/jobs/new">Start free</Link>
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={current ? "secondary" : "default"}
                    onClick={() => checkout(tier)}
                    disabled={loading === tier.id || current}
                  >
                    {loading === tier.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {current ? "Current plan" : "Choose plan"}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Payments are processed by Stripe. Prices exclude tax. You can cancel any time; access continues until the end of
        the paid period.
      </p>
    </div>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={null}>
      <PricingContent />
    </Suspense>
  );
}

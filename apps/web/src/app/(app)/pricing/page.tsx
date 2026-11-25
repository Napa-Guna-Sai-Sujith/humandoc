"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { Suspense } from "react";
import { Check, CheckCircle2, Loader2, Phone, Send } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
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
    features: [
      "20 pages a month",
      "PDF, DOCX, PPTX, Markdown",
      "HD Plagiarism similarity & AI preview",
      "Block locking & QA report",
      "Auto-delete after processing",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    pages: 100,
    price: 12,
    blurb: "For a thesis chapter or a weekly report.",
    features: [
      "100 pages a month",
      "HD Plagiarism Check engine",
      "Auto-humanize to <10% HD Safe",
      "Priority queue & preview",
      "Email support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    pages: 500,
    price: 29,
    blurb: "For teams that rewrite every week.",
    features: [
      "500 pages a month",
      "HD Plagiarism Extreme AI & Similarity",
      "0% AI & <5% Plagiarism Guarantee",
      "UGC & University Compliance Report",
      "Bulk page ranges & glossary",
    ],
  },
  {
    id: "studio",
    name: "Studio",
    pages: 2000,
    price: 79,
    blurb: "For agencies and research groups.",
    features: [
      "2,000 pages a month",
      "Unlimited HD Plagiarism deep scans",
      "Dedicated journal database pool",
      "Highest priority & SLA",
      "Custom retention window",
    ],
  },
];

function PricingContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const [usage, setUsage] = React.useState<Usage | null>(null);
  const [profile, setProfile] = React.useState<{ name: string; email: string }>({ name: "", email: "" });
  const [portalLoading, setPortalLoading] = React.useState(false);

  // Modal State for Plan Request
  const [selectedTier, setSelectedTier] = React.useState<Tier | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submittedMessage, setSubmittedMessage] = React.useState<string | null>(null);
  const [confirmationPopup, setConfirmationPopup] = React.useState<{
    tierName: string;
    phone: string;
  } | null>(null);

  React.useEffect(() => {
    api.get<Usage>("/api/billing/usage").then(setUsage).catch(() => setUsage(null));
    api
      .get<{ user: { name: string; email: string } }>("/api/auth/me")
      .then((res) => {
        setProfile({ name: res.user.name || "", email: res.user.email });
        setFullName(res.user.name || "");
      })
      .catch(() => undefined);

    if (params.get("upgraded")) toast({ title: "Welcome aboard", description: "Your plan is now active.", variant: "success" });
    if (params.get("canceled")) toast({ title: "Checkout canceled", description: "No changes were made." });
  }, [params, toast]);

  const handleOpenPlanModal = (tier: Tier) => {
    setSelectedTier(tier);
    setIsModalOpen(true);
  };

  const handleClosePlanModal = () => {
    setIsModalOpen(false);
    setSelectedTier(null);
  };

  const handleSubmitPlanRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTier) return;

    const trimmedPhone = phone.trim();
    const digitsOnly = trimmedPhone.replace(/\D/g, "");
    if (!trimmedPhone || digitsOnly.length < 7) {
      toast({
        title: "Mobile Number Required",
        description: "Please enter a valid mobile number (with country code if outside US/India) so our team can reach you.",
        variant: "error",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>("/api/billing/request-plan", {
        tier: selectedTier.id,
        phone: trimmedPhone,
        name: fullName || profile.name,
        notes,
      });

      toast({
        title: "Plan Request Sent",
        description: res.message || "Our team will contact you in a couple of hours.",
        variant: "success",
      });

      setSubmittedMessage(
        `Thank you! Your request for the ${selectedTier.name} plan has been sent. Our team will contact you at ${trimmedPhone} in a couple of hours so you can discuss with them and take the plan.`,
      );
      setConfirmationPopup({ tierName: selectedTier.name, phone: trimmedPhone });
      setIsModalOpen(false);
      setSelectedTier(null);
      setPhone("");
      setNotes("");
    } catch (err) {
      toast({
        title: "Request Failed",
        description: err instanceof ApiError ? err.message : "Unable to submit your request. Please try again.",
        variant: "error",
      });
    } finally {
      setSubmitting(false);
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

      {submittedMessage ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <AlertTitle className="text-base font-semibold">Request Received!</AlertTitle>
          <AlertDescription className="text-sm mt-1">{submittedMessage}</AlertDescription>
        </Alert>
      ) : null}

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
                    onClick={() => handleOpenPlanModal(tier)}
                    disabled={current}
                  >
                    {current ? "Current plan" : "Choose plan"}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Choose a plan to submit an upgrade request. Our team will contact your mobile number directly to activate your account.
      </p>

      {/* Plan Request Pop-up Modal */}
      <Dialog
        open={isModalOpen}
        onClose={handleClosePlanModal}
        title={selectedTier ? `Request ${selectedTier.name} Plan` : "Request Plan"}
        description={
          selectedTier
            ? `$${selectedTier.price}/month · ${selectedTier.pages.toLocaleString()} pages per month`
            : undefined
        }
      >
        {selectedTier ? (
          <form onSubmit={handleSubmitPlanRequest} className="space-y-4">
            <div className="rounded-lg bg-muted/60 p-3.5 text-xs text-muted-foreground border">
              <p className="font-semibold text-foreground">
                Upgrading to {selectedTier.name} Plan
              </p>
              <p className="mt-1">
                Enter your contact details below. An email notification will be sent immediately to the HumanDoc team and we will reach out directly to your mobile number to activate your plan.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="req-name">Your Name</Label>
              <Input
                id="req-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. John Doe"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="req-email">Account Email</Label>
              <Input
                id="req-email"
                type="email"
                value={profile.email}
                disabled
                className="bg-muted text-muted-foreground cursor-not-allowed"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="req-phone" className="flex items-center gap-1 font-semibold text-foreground">
                  <Phone className="h-3.5 w-3.5 text-primary" />
                  Mobile Number <span className="text-red-500">*</span>
                </Label>
                <span className="text-[11px] text-red-500 font-medium">Mandatory</span>
              </div>
              <Input
                id="req-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +91 9876543210 or +1 (555) 000-0000"
                className="font-medium"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Include country code (e.g. +91, +1). We will call or WhatsApp you on this number.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="req-notes">Notes or Special Requirements (Optional)</Label>
              <Textarea
                id="req-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special requests, team size, or preferred contact time..."
                rows={2}
                className="min-h-[70px]"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={handleClosePlanModal} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="gap-1.5">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending Request...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Submit Plan Request
                  </>
                )}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      {/* Post-Submit Confirmation Pop-up */}
      <Dialog
        open={Boolean(confirmationPopup)}
        onClose={() => setConfirmationPopup(null)}
        title="Plan Request Sent!"
        description={
          confirmationPopup
            ? `${confirmationPopup.tierName} Plan · Contact: ${confirmationPopup.phone}`
            : undefined
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold">Our team will contact you in a couple of hours.</p>
              <p className="text-emerald-900/90">
                You can discuss your requirements with them and take the plan. We&apos;ve also sent a confirmation email to{" "}
                <span className="font-medium">{profile.email || "your email"}</span>.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={() => setConfirmationPopup(null)}>
              Got it
            </Button>
          </div>
        </div>
      </Dialog>
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

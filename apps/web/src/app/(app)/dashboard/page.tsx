"use client";

import Link from "next/link";
import React from "react";
import { ArrowRight, Clock, FileText, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";

import { EmptyState } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Job } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

type Usage = { pagesUsed: number; pagesPerMonth: number; pagesRemaining: number; tier: string };

export default function DashboardPage() {
  const [jobs, setJobs] = React.useState<Job[] | null>(null);
  const [usage, setUsage] = React.useState<Usage | null>(null);

  React.useEffect(() => {
    api
      .get<{ jobs: Job[] }>("/backend/jobs?limit=6")
      .then((result) => setJobs(result.jobs))
      .catch(() => setJobs([]));
    api
      .get<Usage>("/api/billing/usage")
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  const pct = usage ? Math.min(100, (usage.pagesUsed / Math.max(1, usage.pagesPerMonth)) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Good to see you</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rewrite the words, keep the layout. Upload a document to get started.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Pages this month</p>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-semibold">
              {usage ? `${usage.pagesUsed}` : "—"}
              <span className="text-sm font-normal text-muted-foreground"> / {usage?.pagesPerMonth ?? "—"}</span>
            </p>
            <Progress value={pct} className="mt-3" />
            <p className="mt-2 text-xs capitalize text-muted-foreground">{usage?.tier ?? "free"} plan</p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardContent className="flex h-full flex-col justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">This month&apos;s allowance</p>
              <p className="mt-2 text-2xl font-semibold">
                {usage ? usage.pagesRemaining.toLocaleString() : "—"} pages left
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Need more? Upgrade any time — unused pages don&apos;t roll over.
              </p>
            </div>
            <div className="mt-4 flex gap-2">
              <Button asChild size="sm">
                <Link href="/jobs/new">
                  <Sparkles className="h-4 w-4" /> New job
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/pricing">See plans</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent jobs</h2>
          <Link href="/history" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {!jobs ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Upload a PDF, DOCX, PPTX or Markdown file and HumanDoc will rewrite it block by block."
            action={
              <Button asChild>
                <Link href="/jobs/new">Upload a document</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{job.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.total_pages} pages · {job.words.toLocaleString()} words · {timeAgo(job.created_at)}
                  </p>
                </div>
                <Badge
                  variant={job.status === "done" ? "success" : job.status === "failed" ? "destructive" : "secondary"}
                  className="capitalize"
                >
                  {job.status}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-medium">Privacy by default</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Documents are encrypted at rest (S3 SSE-AES256) and in transit. Each account is isolated by prefix and
                every download uses a short-lived signed URL. Files auto-delete after your retention window, and we never
                train models on your content. You are responsible for following your school or employer&apos;s AI-use
                policy.
              </p>
              <div className="mt-3 flex gap-4 text-xs">
                <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-foreground">
                  Privacy policy
                </Link>
                <Link href="/responsible-use" className="underline underline-offset-2 hover:text-foreground">
                  Responsible use
                </Link>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: Sparkles,
            title: "Block-level rewriting",
            body: "Each block is rewritten with its neighbours, section heading and a document glossary in context.",
          },
          {
            icon: FileText,
            title: "Layout preserved",
            body: "Text is redacted and re-inserted in place. Images, charts and vectors are never moved.",
          },
          {
            icon: Clock,
            title: "Checkpointed at scale",
            body: "Every page is saved as it finishes. A crash resumes from the last page, not from zero.",
          },
        ].map((feature) => (
          <Card key={feature.title}>
            <CardContent className="p-4">
              <feature.icon className="h-4 w-4 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{feature.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{feature.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

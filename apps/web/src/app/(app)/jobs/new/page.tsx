"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { AlertTriangle, ArrowRight, Coins, FileText, Languages, Loader2, ScanSearch } from "lucide-react";

import { BlockPreview } from "@/components/block-preview";
import { DEFAULT_OPTIONS, JobOptionsForm, type JobOptionsState } from "@/components/job-options";
import { UploadZone } from "@/components/upload-zone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api, ApiError, type Analysis, type Job } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";

type UploadInfo = { uploadId: string; filename: string; size: number; mime: string };

export default function NewJobPage() {
  const router = useRouter();
  const [upload, setUpload] = React.useState<UploadInfo | null>(null);
  const [options, setOptions] = React.useState<JobOptionsState>(DEFAULT_OPTIONS);
  const [job, setJob] = React.useState<Job | null>(null);
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [maxMb, setMaxMb] = React.useState(500);

  React.useEffect(() => {
    api
      .get<{ max_upload_mb: number }>("/backend/config")
      .then((config) => setMaxMb(config.max_upload_mb))
      .catch(() => setMaxMb(500));
  }, []);

  React.useEffect(() => {
    if (!job) return;
    if (["analyzed", "failed", "canceled", "done"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const fresh = await api.get<{ job: Job }>(`/backend/jobs/${job.id}`);
        setJob(fresh.job);
        if (fresh.job.analysis) setAnalysis(fresh.job.analysis as unknown as Analysis);
        if (["analyzed", "failed", "done"].includes(fresh.job.status)) window.clearInterval(timer);
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job]);

  const createJob = async () => {
    if (!upload) return;
    setCreating(true);
    setError(null);
    try {
      const payload = {
        upload_id: upload.uploadId,
        options: {
          style: options.style,
          strength: options.strength,
          tone: options.tone,
          language: options.language,
          keep_original_language: options.keepOriginalLanguage,
          page_range: options.pageRange,
          protected_terms: options.protectedTerms
            .split(",")
            .map((term) => term.trim())
            .filter(Boolean),
          locked_blocks: [],
          skip: options.skip,
          custom_instructions: options.customInstructions,
          notify_on_complete: options.notifyOnComplete,
        },
      };
      const result = await api.post<{ job: Job; quota: { pages_remaining: number } }>("/backend/jobs", payload);
      setJob(result.job);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the job.");
    } finally {
      setCreating(false);
    }
  };

  const startJob = async () => {
    if (!job) return;
    setStarting(true);
    setError(null);
    try {
      await api.post(`/backend/jobs/${job.id}/start`);
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start processing.");
      setStarting(false);
    }
  };

  const analyzing = job && ["queued", "analyzing"].includes(job.status);
  const ready = Boolean(analysis && job?.status === "analyzed");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New job</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a document, check the pre-job report, lock anything you want preserved, then rewrite.
        </p>
      </div>

      <div className="space-y-6">
        {!job ? (
          <>
            <Card>
              <CardContent className="p-5">
                <h2 className="mb-4 text-sm font-semibold">1 · Upload</h2>
                <UploadZone onUploaded={setUpload} maxMb={maxMb} />
              </CardContent>
            </Card>

            {upload ? (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span className="font-medium text-foreground">{upload.filename}</span>
                  <span>· {formatBytes(upload.size)}</span>
                </div>

                <Card>
                  <CardContent className="p-5">
                    <h2 className="mb-4 text-sm font-semibold">2 · How should it read?</h2>
                    <JobOptionsForm value={options} onChange={setOptions} />
                  </CardContent>
                </Card>

                {error ? (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Could not create the job</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex justify-end">
                  <Button size="lg" onClick={createJob} disabled={creating}>
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                    {creating ? "Analysing…" : "Analyse document"}
                  </Button>
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <Card>
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">{job.filename}</h2>
                    <p className="text-xs text-muted-foreground">{formatBytes(job.size)} · uploaded</p>
                  </div>
                  <Badge variant={job.status === "analyzed" ? "success" : "secondary"}>{job.status}</Badge>
                </div>

                {analyzing ? (
                  <div className="mt-6">
                    <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {job.status === "queued" ? "Waiting for a worker…" : "Reading structure, fonts and languages…"}
                    </div>
                    <Progress value={job.status === "queued" ? 8 : 55} />
                  </div>
                ) : null}

                {analysis && job.status === "analyzed" ? (
                  <div className="mt-6 animate-fade-up">
                    <div className="flex items-center gap-2">
                      <ScanSearch className="h-4 w-4" />
                      <h3 className="text-sm font-semibold">Pre-job report</h3>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat label="Pages" value={String(analysis.total_pages)} />
                      <Stat label="Words" value={analysis.words.toLocaleString()} />
                      <Stat label="Blocks" value={String(analysis.blocks_total)} />
                      <Stat label="To rewrite" value={String(analysis.blocks_rewrite)} />
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <InfoRow icon={<Languages className="h-4 w-4" />} label="Languages">
                        {analysis.languages.length ? analysis.languages.join(", ") : "auto-detected"}
                      </InfoRow>
                      <InfoRow icon={<FileText className="h-4 w-4" />} label="Text layer">
                        {analysis.needs_ocr
                          ? "Scanned — OCR will run first"
                          : analysis.selectable
                            ? "Selectable text"
                            : "Mostly images"}
                      </InfoRow>
                      <InfoRow icon={<Coins className="h-4 w-4" />} label="Est. cost">
                        ${analysis.est_cost_usd.toFixed(3)} · {(analysis.est_tokens_in + analysis.est_tokens_out).toLocaleString()} tokens
                      </InfoRow>
                      <InfoRow icon={<FileText className="h-4 w-4" />} label="Fonts found">
                        {analysis.fonts.length}
                      </InfoRow>
                    </div>

                    {analysis.warnings.map((warning) => (
                      <Alert key={warning} variant="warning" className="mt-3">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{warning}</AlertDescription>
                      </Alert>
                    ))}

                    <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                      {analysis.blocks_skipped} blocks will be copied through untouched (images, tables, code,
                      citations, headers, captions and locked regions). We never move or resize graphics.
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {ready ? (
              <>
                <BlockPreview jobId={job.id} totalPages={analysis?.total_pages ?? 1} isPdf={analysis?.kind === "pdf"} hasOutput={false} />
                {error ? (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Files auto-delete after your retention window. You can delete them sooner from History.
                  </p>
                  <Button size="lg" onClick={startJob} disabled={starting}>
                    {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Start rewrite
                    {!starting ? <ArrowRight className="h-4 w-4" /> : null}
                  </Button>
                </div>
              </>
            ) : null}

            {job.status === "failed" ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Analysis failed</AlertTitle>
                <AlertDescription>{job.error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="text-center">
              <Link href="/dashboard" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                Cancel and go back
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("rounded-lg border bg-card p-3")}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-card p-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm">{children}</p>
      </div>
    </div>
  );
}

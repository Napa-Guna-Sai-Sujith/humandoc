"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Coins,
  Copy,
  Download,
  FileText,
  Languages,
  Loader2,
  ScanSearch,
  Sparkles,
} from "lucide-react";

import { BlockPreview } from "@/components/block-preview";
import { DEFAULT_OPTIONS, JobOptionsForm, type JobOptionsState } from "@/components/job-options";
import { UploadZone } from "@/components/upload-zone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type Analysis, type Job } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";

type UploadInfo = { uploadId: string; filename: string; size: number; mime: string };

type QuotaState = {
  tier: string;
  pagesPerMonth: number;
  pagesUsed: number;
  pagesRemaining: number;
  maxCheckPages: number;
  maxUploads: number;
  uploadsUsed: number;
  uploadsRemaining: number;
};

type PasteResult = {
  originalText: string;
  humanizedText: string;
  paragraphsChanged: number;
  totalParagraphs: number;
  wordCount: number;
  pageCount: number;
  style: string;
};

export default function NewJobPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [inputMode, setInputMode] = React.useState<"upload" | "paste">("upload");
  const [upload, setUpload] = React.useState<UploadInfo | null>(null);
  const [pastedTitle, setPastedTitle] = React.useState("Humanized Document");
  const [pastedText, setPastedText] = React.useState("");
  const [pasteResult, setPasteResult] = React.useState<PasteResult | null>(null);
  const [convertingPaste, setConvertingPaste] = React.useState(false);
  const [copiedPaste, setCopiedPaste] = React.useState(false);
  const [downloadingFmt, setDownloadingFmt] = React.useState<"pdf" | "docx" | "doc" | null>(null);
  const [quota, setQuota] = React.useState<QuotaState | null>(null);
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
    api
      .get<QuotaState>("/api/billing/usage")
      .then(setQuota)
      .catch(() => setQuota(null));
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

  const convertPastedText = async () => {
    const clean = pastedText.trim();
    if (!clean) {
      setError("Please paste the text you want to convert and humanize.");
      return;
    }
    setConvertingPaste(true);
    setError(null);
    try {
      const res = await api.post<PasteResult & { ok: boolean; quota?: QuotaState }>("/api/jobs/rewrite-text", {
        title: pastedTitle,
        text: clean,
        style: options.style,
        strength: options.strength,
        tone: options.tone,
        language: options.language,
        protected_terms: options.protectedTerms
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        custom_instructions: options.customInstructions,
      });
      setPasteResult(res);
      if (res.quota) setQuota(res.quota);
      toast({
        title: "Text Converted & Humanized",
        description: `Rewrote ${res.paragraphsChanged} of ${res.totalParagraphs} paragraph(s) in ${res.style.toUpperCase()} style.`,
        variant: "success",
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not convert text.";
      setError(msg);
      toast({ title: "Conversion Failed", description: msg, variant: "error" });
    } finally {
      setConvertingPaste(false);
    }
  };

  const copyHumanizedOutput = () => {
    if (!pasteResult?.humanizedText) return;
    navigator.clipboard.writeText(pasteResult.humanizedText);
    setCopiedPaste(true);
    toast({ title: "Copied to clipboard", description: "Humanized text is ready to paste anywhere.", variant: "success" });
    setTimeout(() => setCopiedPaste(false), 2000);
  };

  const downloadHumanizedOutput = async (fmt: "pdf" | "docx" | "doc" | "txt") => {
    if (!pasteResult?.humanizedText) return;
    const baseName = (pastedTitle || "HumanDoc_Output").replace(/[^a-zA-Z0-9_-]/g, "_");
    if (fmt === "txt") {
      const blob = new Blob([pasteResult.humanizedText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}_Humanized.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    setDownloadingFmt(fmt);
    try {
      const res = await fetch("/api/drillbit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: pastedTitle || "Humanized Document",
          text: pasteResult.humanizedText,
          format: fmt,
        }),
      });
      if (!res.ok) throw new Error(`Failed to export .${fmt}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}_Humanized.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Download Failed",
        description: err instanceof Error ? err.message : `Could not export .${fmt} file.`,
        variant: "error",
      });
    } finally {
      setDownloadingFmt(null);
    }
  };

  const analyzing = job && ["queued", "analyzing"].includes(job.status);
  const ready = Boolean(analysis && job?.status === "analyzed");
  const pastedWords = pastedText.trim() ? pastedText.trim().split(/\s+/).length : 0;
  const pastedPages = Math.max(1, Math.ceil(pastedWords / 350));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New job</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a document or paste text directly, choose your style (including IEEE Paper), and convert cleanly.
          </p>
        </div>
      </div>

      {quota ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-xs shadow-xs">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary" className="capitalize font-semibold">
              {quota.tier} Plan
            </Badge>
            <span className="text-muted-foreground">
              Uploads:{" "}
              <strong className={cn("text-foreground", quota.uploadsRemaining <= 0 && "text-destructive")}>
                {quota.uploadsUsed} / {quota.maxUploads >= 10000 ? "Unlimited" : quota.maxUploads}
              </strong>
            </span>
            <span>·</span>
            <span className="text-muted-foreground">
              Pages left:{" "}
              <strong className={cn("text-foreground", quota.pagesRemaining <= 0 && "text-destructive")}>
                {quota.pagesRemaining.toLocaleString()} / {quota.pagesPerMonth.toLocaleString()}
              </strong>
            </span>
            <span>·</span>
            <span className="text-muted-foreground">
              Max per request: <strong className="text-foreground">{quota.maxCheckPages} pages</strong>
            </span>
          </div>
          {quota.tier !== "studio" && quota.tier !== "enterprise" && quota.pagesPerMonth < 10000 ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
              <Link href="/pricing">Upgrade Plan</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-6">
        {!job ? (
          <>
            <Card>
              <CardContent className="p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">1 · Input</h2>
                  <div className="inline-flex rounded-lg border bg-muted p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setInputMode("upload");
                        setError(null);
                      }}
                      className={cn(
                        "rounded-md px-3 py-1 font-medium transition-colors",
                        inputMode === "upload" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Upload File
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInputMode("paste");
                        setError(null);
                      }}
                      className={cn(
                        "rounded-md px-3 py-1 font-medium transition-colors",
                        inputMode === "paste" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Paste Text
                    </button>
                  </div>
                </div>

                {inputMode === "upload" ? (
                  <UploadZone onUploaded={setUpload} maxMb={maxMb} />
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="paste-title">Document Title (Optional)</Label>
                      <Input
                        id="paste-title"
                        value={pastedTitle}
                        onChange={(e) => setPastedTitle(e.target.value)}
                        placeholder="e.g. IEEE Paper Introduction or Thesis Chapter"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <Label htmlFor="paste-body">Paste Your Text</Label>
                        <span className="text-muted-foreground">
                          {pastedWords.toLocaleString()} words · ~{pastedPages} / {quota?.maxCheckPages ?? 10} page(s)
                        </span>
                      </div>
                      <Textarea
                        id="paste-body"
                        rows={8}
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        placeholder="Paste your paragraphs or IEEE paper section here..."
                        className="min-h-[180px]"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {inputMode === "upload" && upload ? (
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
                    <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                      <span>{error}</span>
                      <Button size="sm" variant="outline" className="h-7 bg-background text-foreground" asChild>
                        <Link href="/pricing">Upgrade Plan</Link>
                      </Button>
                    </AlertDescription>
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

            {inputMode === "paste" ? (
              <>
                <Card>
                  <CardContent className="p-5">
                    <h2 className="mb-4 text-sm font-semibold">2 · How should it read?</h2>
                    <JobOptionsForm value={options} onChange={setOptions} totalPages={pastedPages} />
                  </CardContent>
                </Card>

                {error ? (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Notice</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                      <span>{error}</span>
                      <Button size="sm" variant="outline" className="h-7 bg-background text-foreground" asChild>
                        <Link href="/pricing">Upgrade Plan</Link>
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex justify-end">
                  <Button size="lg" onClick={convertPastedText} disabled={convertingPaste || !pastedText.trim()}>
                    {convertingPaste ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {convertingPaste ? "Converting to Humanized Text…" : "Convert & Humanize Text"}
                  </Button>
                </div>

                {pasteResult ? (
                  <Card className="border-emerald-300 shadow-sm animate-fade-up">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="success">Humanized AI Output Ready</Badge>
                            <Badge variant="outline" className="uppercase text-[11px]">{pasteResult.style}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {pasteResult.wordCount.toLocaleString()} words · {pasteResult.pageCount} page(s) · {pasteResult.paragraphsChanged} of {pasteResult.totalParagraphs} paragraph(s) rewritten
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" onClick={copyHumanizedOutput} className="gap-1.5">
                            {copiedPaste ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            {copiedPaste ? "Copied!" : "Copy Humanized Text"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadHumanizedOutput("pdf")}
                            disabled={downloadingFmt !== null}
                          >
                            {downloadingFmt === "pdf" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                            PDF (.pdf)
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadHumanizedOutput("docx")}
                            disabled={downloadingFmt !== null}
                          >
                            {downloadingFmt === "docx" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                            Word (.docx)
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadHumanizedOutput("doc")}
                            disabled={downloadingFmt !== null}
                          >
                            {downloadingFmt === "doc" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                            Word (.doc)
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => downloadHumanizedOutput("txt")}>
                            <Download className="h-3.5 w-3.5 mr-1" />
                            Text (.txt)
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-lg border bg-muted/40 p-3.5 space-y-1.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Original Text
                          </p>
                          <div className="max-h-80 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                            {pasteResult.originalText}
                          </div>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3.5 space-y-1.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                            Humanized Output (Ready to Copy &amp; Use)
                          </p>
                          <div className="max-h-80 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                            {pasteResult.humanizedText}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
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

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React from "react";
import { AlertTriangle, ArrowLeft, Download, FileCheck2, Loader2, Play, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";

import { BlockPreview } from "@/components/block-preview";
import { JobProgress, type ProgressEvent } from "@/components/job-progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, getClientSessionToken, type Job } from "@/lib/api";
import { cn, formatBytes, formatDateTime } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700",
  analyzing: "bg-sky-100 text-sky-800",
  analyzed: "bg-sky-100 text-sky-800",
  rewriting: "bg-indigo-100 text-indigo-800",
  rebuilding: "bg-violet-100 text-violet-800",
  verifying: "bg-amber-100 text-amber-900",
  done: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  canceled: "bg-slate-100 text-slate-600",
};

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const router = useRouter();
  const { toast } = useToast();

  const [job, setJob] = React.useState<Job | null>(null);
  const [event, setEvent] = React.useState<ProgressEvent | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [downloadUrl, setDownloadUrl] = React.useState<string | null>(null);
  const [qaUrl, setQaUrl] = React.useState<string | null>(null);
  const [downloadingFmt, setDownloadingFmt] = React.useState<"pdf" | "docx" | "doc" | "txt" | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const downloadFormat = async (fmt: "pdf" | "docx" | "doc" | "txt") => {
    if (!job) return;
    setDownloadingFmt(fmt);
    try {
      const st = getClientSessionToken();
      const res = await fetch(`/backend/jobs/${jobId}/export?format=${fmt}`, {
        credentials: "include",
        headers: st ? { "x-hd-session": st } : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to export .${fmt}`);
      }
      const blob = await res.blob();
      const base = (job.filename.includes(".") ? job.filename.replace(/\.[^.]+$/, "") : job.filename)
        .replace(/[^a-zA-Z0-9_-]/g, "_");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base || "HumanDoc"}.humanized.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: `Downloaded (.${fmt})`,
        description: `Saved rewritten output as .${fmt.toUpperCase()}.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : `Could not export .${fmt} file.`,
        variant: "error",
      });
    } finally {
      setDownloadingFmt(null);
    }
  };

  const refresh = React.useCallback(async () => {
    try {
      const result = await api.get<{ job: Job }>(`/backend/jobs/${jobId}`);
      setJob(result.job);
      return result.job;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const jobStatus = job?.status;
  React.useEffect(() => {
    if (!jobStatus) return;
    if (["done", "failed", "canceled", "analyzed"].includes(jobStatus)) return;

    const st = getClientSessionToken();
    const streamUrl = st ? `/backend/jobs/${jobId}/stream?st=${encodeURIComponent(st)}` : `/backend/jobs/${jobId}/stream`;
    const source = new EventSource(streamUrl, { withCredentials: true });
    source.addEventListener("snapshot", (message) => {
      try {
        setEvent(JSON.parse((message as MessageEvent).data) as ProgressEvent);
      } catch {
        /* ignore */
      }
    });
    source.addEventListener("message", (message) => {
      try {
        const data = JSON.parse((message as MessageEvent).data) as ProgressEvent;
        setEvent(data);
        if (data.type === "done" || data.type === "error") {
          void refresh();
          source.close();
        }
      } catch {
        /* ignore */
      }
    });
    source.onerror = () => source.close();
    return () => source.close();
  }, [jobStatus, jobId, refresh]);

  React.useEffect(() => {
    if (job?.status !== "done") return;
    api
      .get<{ url: string }>(`/backend/jobs/${jobId}/download`)
      .then((result) => setDownloadUrl(result.url))
      .catch(() => setDownloadUrl(null));
    api
      .get<{ url: string }>(`/backend/jobs/${jobId}/qa`)
      .then((result) => setQaUrl(result.url))
      .catch(() => setQaUrl(null));
  }, [job?.status, jobId]);

  const startRewrite = async () => {
    setBusy(true);
    try {
      await api.post(`/backend/jobs/${jobId}/start`);
      await refresh();
      toast({ title: "Rewrite started", description: "Processing your document page by page.", variant: "success" });
    } catch (err) {
      toast({ title: "Could not start", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    try {
      await api.post(`/backend/jobs/${jobId}/resume`);
      await refresh();
      toast({ title: "Resuming", description: "Continuing from the last completed page.", variant: "success" });
    } catch (err) {
      toast({ title: "Could not resume", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/backend/jobs/${jobId}`);
      toast({ title: "Job deleted", description: "The file and its output were removed.", variant: "success" });
      router.push("/history");
    } catch (err) {
      toast({ title: "Could not delete", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!job) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Job not found</AlertTitle>
        <AlertDescription>It may have been deleted, or you may not have access to it.</AlertDescription>
      </Alert>
    );
  }

  const canResume = ["failed", "rewriting", "rebuilding", "verifying"].includes(job.status);
  const summary = event?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/history" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> History
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{job.filename}</h1>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLES[job.status] ?? "bg-slate-100")}>
              {job.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatBytes(job.size)} · {job.total_pages} pages · created {formatDateTime(job.created_at)}
            {job.expires_at ? ` · auto-deletes ${formatDateTime(job.expires_at)}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {job.status === "analyzed" ? (
            <Button onClick={startRewrite} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Start rewrite
            </Button>
          ) : null}
          {canResume ? (
            <Button variant="outline" onClick={resume} disabled={busy}>
              <RotateCcw className="h-4 w-4" /> Resume
            </Button>
          ) : null}
          {downloadUrl ? (
            <Button asChild>
              <a href={downloadUrl}>
                <Download className="h-4 w-4" /> Download
              </a>
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} aria-label="Delete job">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <JobProgress job={job} event={event} />
        </CardContent>
      </Card>

      {job.status === "failed" ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Processing stopped</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{job.error}</p>
            <p className="text-xs">
              Every page was checkpointed. Resume picks up from the last completed page — nothing restarts from zero.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {job.status === "analyzed" ? (
        <Alert>
          <Play className="h-4 w-4" />
          <AlertTitle>Ready to start</AlertTitle>
          <AlertDescription>
            The pre-job report is complete. Lock any blocks you want preserved, then start the rewrite.
          </AlertDescription>
        </Alert>
      ) : null}

      {job.status === "done" ? (
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Blocks rewritten" value={String(summary?.rewritten ?? job.rewritten_blocks)} />
          <StatCard label="Flagged (kept original)" value={String(summary?.flagged ?? job.flagged_blocks)} />
          <StatCard label="Cost" value={`$${(summary?.cost_usd ?? job.cost_usd).toFixed(3)}`} />
        </div>
      ) : null}

      {job.status === "done" ? (
        <Card>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Deliverables</h2>
                <p className="text-xs text-muted-foreground">
                  Download in your original layout format (.{(job.kind || "pdf").toUpperCase()}) or convert to PDF, Word (.docx / .doc), or Text, plus the QA report.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {downloadUrl ? (
                  <Button asChild>
                    <a href={downloadUrl}>
                      <Download className="h-4 w-4" /> Original (.{(job.kind || "pdf").toLowerCase()})
                    </a>
                  </Button>
                ) : null}
                {(["pdf", "docx", "doc", "txt"] as const).map((fmt) => (
                  <Button
                    key={fmt}
                    variant="outline"
                    onClick={() => void downloadFormat(fmt)}
                    disabled={downloadingFmt !== null}
                  >
                    {downloadingFmt === fmt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {fmt === "pdf" ? "PDF (.pdf)" : fmt === "docx" ? "Word (.docx)" : fmt === "doc" ? "Word (.doc)" : "Text (.txt)"}
                  </Button>
                ))}
                {qaUrl ? (
                  <Button variant="outline" asChild>
                    <a href={qaUrl}>
                      <FileCheck2 className="h-4 w-4" /> QA report
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Layout verified: page count, image fingerprints and page geometry are unchanged. Images and vector
                graphics were never moved or resized.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-5">
          <Tabs defaultValue="preview">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList>
                <TabsTrigger value="preview">Before / after</TabsTrigger>
                <TabsTrigger value="details">Job details</TabsTrigger>
              </TabsList>
              {job.status === "rewriting" ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="sse-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  Live
                </span>
              ) : null}
            </div>

            <TabsContent value="preview">
              <BlockPreview jobId={job.id} totalPages={job.total_pages || 1} isPdf={job.kind === "pdf"} hasOutput={job.has_output} />
            </TabsContent>

            <TabsContent value="details">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Detail label="Style" value={String(job.options.style ?? "professional")} />
                <Detail label="Strength" value={String(job.options.strength ?? "medium")} />
                <Detail label="Language" value={String(job.options.language ?? "auto")} />
                <Detail label="Page range" value={String(job.options.page_range ?? "all")} />
                <Detail label="Tokens in / out" value={`${job.tokens_in.toLocaleString()} / ${job.tokens_out.toLocaleString()}`} />
                <Detail label="Protected terms" value={Array.isArray(job.options.protected_terms) ? ((job.options.protected_terms as string[]).join(", ") || "—") : "—"} />
                {job.analysis ? (
                  <Detail label="Detected fonts" value={`${(job.analysis.fonts as string[] | undefined)?.length ?? 0} fonts`} />
                ) : null}
                {job.analysis ? (
                  <Detail label="Languages" value={(job.analysis.languages as string[] | undefined)?.join(", ") || "auto"} />
                ) : null}
              </dl>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this job?"
        description="The source file, output and QA report will be deleted immediately. This cannot be undone."
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={remove} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete permanently
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm">{value}</dd>
    </div>
  );
}

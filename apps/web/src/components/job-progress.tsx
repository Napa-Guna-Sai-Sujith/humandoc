"use client";

import React from "react";
import { Check, CircleDashed, Clock, Loader2 } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { Job, JobStatus } from "@/lib/api";
import { cn, formatEta } from "@/lib/utils";

export type ProgressEvent = {
  type: string;
  stage?: string;
  page?: number;
  total?: number;
  current_page?: number;
  section?: string;
  eta_seconds?: number;
  status?: JobStatus;
  message?: string;
  error?: string;
  summary?: Record<string, number>;
};

const STAGES: Array<{ key: string; label: string }> = [
  { key: "analyzing", label: "Analyse" },
  { key: "rewriting", label: "Rewrite" },
  { key: "rebuilding", label: "Rebuild" },
  { key: "verifying", label: "Verify" },
];

export function stageIndex(status: JobStatus): number {
  switch (status) {
    case "analyzing":
      return 0;
    case "rewriting":
      return 1;
    case "rebuilding":
      return 2;
    case "verifying":
      return 3;
    case "done":
      return 4;
    default:
      return 0;
  }
}

export function JobProgress({ job, event }: { job: Job; event: ProgressEvent | null }) {
  const index = stageIndex(job.status);
  const active = event?.stage ?? (job.status === "rewriting" ? "rewriting" : job.status);
  const page = event?.page ?? job.processed_pages;
  const total = event?.total ?? (job.total_pages || 1);
  const percent = job.status === "done" ? 100 : Math.min(99, Math.round((page / Math.max(1, total)) * 100));
  const running = ["analyzing", "rewriting", "rebuilding", "verifying", "queued"].includes(job.status);

  const [stageElapsed, setStageElapsed] = React.useState(0);
  React.useEffect(() => {
    setStageElapsed(0);
    if (!running) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setStageElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, job.status]);

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  };

  return (
    <div>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STAGES.map((stage, stageIdx) => {
          const complete = stageIdx < index || job.status === "done";
          const current = stageIdx === index && running;
          return (
            <li key={stage.key} className="relative">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                  complete && "border-emerald-200 bg-emerald-50 text-emerald-900",
                  current && "border-primary bg-accent",
                  !complete && !current && "text-muted-foreground",
                )}
              >
                {complete ? (
                  <Check className="h-3.5 w-3.5" />
                ) : current ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CircleDashed className="h-3.5 w-3.5" />
                )}
                <span className="font-medium">{stage.label}</span>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">
            {job.status === "done"
              ? "Complete"
              : job.status === "failed"
                ? "Stopped"
                : job.status === "rebuilding"
                  ? "Rebuilding document layout"
                  : job.status === "verifying"
                    ? "Verifying output & QA"
                    : job.status === "analyzing" || job.status === "queued"
                      ? "Analysing your document"
                      : `Page ${Math.min(page, total)} of ${total}`}
          </span>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {running ? (
              <span className="inline-flex items-center gap-1 font-mono font-medium text-foreground">
                <Clock className="h-3.5 w-3.5 text-primary" />
                {job.status === "rebuilding" ? `Rebuild timer: ${formatTimer(stageElapsed)}` : `Elapsed: ${formatTimer(stageElapsed)}`}
              </span>
            ) : null}
            <span>{running ? formatEta(event?.eta_seconds) : null}</span>
          </div>
        </div>
        <Progress value={percent} />
        {job.current_section && job.status === "rewriting" ? (
          <p className="mt-2 truncate text-xs text-muted-foreground">
            Current section: <span className="text-foreground">{job.current_section}</span>
          </p>
        ) : null}
        {event?.message ? <p className="mt-2 text-xs text-muted-foreground">{event.message}</p> : null}
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { AlertCircle, CheckCircle2, FileUp, Loader2, UploadCloud, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, ApiError } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";

const ACCEPTED = ".pdf,.docx,.pptx,.txt,.md";

type Props = {
  onUploaded: (payload: { uploadId: string; filename: string; size: number; mime: string }) => void;
  maxMb: number;
};

type Phase = "idle" | "uploading" | "done" | "error";

async function putWithRetry(url: string, blob: Blob, attempts = 4): Promise<string | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { method: "PUT", body: blob });
      if (response.ok) {
        return response.headers.get("etag")?.replaceAll('"', "") ?? response.headers.get("ETag") ?? "";
      }
      lastError = new Error(`Part upload failed (${response.status})`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
  }
  throw lastError;
}

export function UploadZone({ onUploaded, maxMb }: Props) {
  const [dragging, setDragging] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  const startUpload = async (selected: File) => {
    setFile(selected);
    setError(null);
    setPhase("uploading");
    setProgress(0);

    try {
      const init = await api.post<{
        upload_id: string;
        key: string;
        part_size: number;
        total_parts: number;
        part_urls: string[];
      }>("/backend/uploads/init", {
        filename: selected.name,
        size: selected.size,
        content_type: selected.type || "application/octet-stream",
      });

      const parts: Array<{ part_number: number; etag: string }> = [];
      for (let index = 0; index < init.total_parts; index++) {
        const start = index * init.part_size;
        const blob = selected.slice(start, start + init.part_size);
        const etag = await putWithRetry(init.part_urls[index], blob);
        parts.push({ part_number: index + 1, etag: etag ?? "" });
        setProgress(Math.round(((index + 1) / init.total_parts) * 100));
      }

      const completed = await api.post<{ upload_id: string; key: string; size: number }>(
        `/backend/uploads/${init.upload_id}/complete`,
        { parts },
      );

      setPhase("done");
      onUploaded({
        uploadId: completed.upload_id,
        filename: selected.name,
        size: completed.size,
        mime: selected.type || "application/octet-stream",
      });
    } catch (err) {
      setPhase("error");
      setError(err instanceof ApiError ? err.message : "Upload failed. Check your connection and try again.");
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) startUpload(dropped);
  };

  return (
    <div>
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center transition-colors",
          dragging ? "border-primary bg-accent" : "border-border bg-card hover:bg-accent/50",
          phase === "uploading" && "pointer-events-none",
        )}
      >
        <input
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (!selected) return;
            if (selected.size > maxMb * 1024 * 1024) {
              setError(`That file is ${formatBytes(selected.size)}. The limit is ${maxMb} MB.`);
              setPhase("error");
              return;
            }
            startUpload(selected);
          }}
          disabled={phase === "uploading"}
        />

        {phase === "idle" ? (
          <>
            <UploadCloud className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Drop your document here, or click to browse</p>
            <p className="mt-1 text-xs text-muted-foreground">
              PDF (text or scanned), DOCX, PPTX, TXT, Markdown · up to {maxMb} MB
            </p>
          </>
        ) : null}

        {phase === "uploading" ? (
          <div className="w-full max-w-md">
            <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-muted-foreground" />
            <p className="truncate text-sm font-medium">{file?.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{formatBytes(file?.size ?? 0)}</p>
            <Progress value={progress} className="mt-4" />
            <p className="mt-2 text-xs text-muted-foreground">{progress}% uploaded · resumable</p>
          </div>
        ) : null}

        {phase === "done" && file ? (
          <div className="flex w-full max-w-md items-center gap-3 rounded-lg border bg-emerald-50 p-3 text-left">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)} uploaded</p>
            </div>
          </div>
        ) : null}
      </label>

      {phase === "error" ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => {
                setPhase("idle");
                setError(null);
                setFile(null);
              }}
              className="mt-1 underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {file && phase !== "uploading" ? (
        <button
          type="button"
          onClick={() => {
            setFile(null);
            setPhase("idle");
            setProgress(0);
          }}
          className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" /> Remove file
        </button>
      ) : null}

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FileUp className="h-3 w-3" />
        Files stream directly to encrypted object storage — they never pass through the app server.
      </p>
    </div>
  );
}

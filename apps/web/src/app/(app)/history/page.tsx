"use client";

import Link from "next/link";
import React from "react";
import { Loader2, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type Job } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "success" | "destructive" | "secondary" | "warning" | "info"> = {
  done: "success",
  failed: "destructive",
  canceled: "secondary",
  analyzing: "info",
  rewriting: "info",
  rebuilding: "warning",
  verifying: "warning",
};

export default function HistoryPage() {
  const [jobs, setJobs] = React.useState<Job[] | null>(null);
  const [deleting, setDeleting] = React.useState<Job | null>(null);
  const [busy, setBusy] = React.useState(false);
  const { toast } = useToast();

  const load = React.useCallback(async () => {
    try {
      const result = await api.get<{ jobs: Job[] }>("/backend/jobs?limit=100");
      setJobs(result.jobs);
    } catch {
      setJobs([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/backend/jobs/${deleting.id}`);
      toast({ title: "Job deleted", description: "The file and its output were removed.", variant: "success" });
      setDeleting(null);
      await load();
    } catch (err) {
      toast({ title: "Could not delete", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every job keeps its checkpoint, output and QA report until it auto-deletes.
          </p>
        </div>
        <Button asChild>
          <Link href="/jobs/new">New job</Link>
        </Button>
      </div>

      {!jobs ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Jobs you run will appear here with their status, page count and cost."
          action={
            <Button asChild>
              <Link href="/jobs/new">Upload a document</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Pages</TableHead>
                <TableHead className="text-right">Words</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Link href={`/jobs/${job.id}`} className="font-medium hover:underline">
                      {job.filename}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">{formatBytes(job.size)}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[job.status] ?? "secondary"} className="capitalize">
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{job.total_pages || "—"}</TableCell>
                  <TableCell className="text-right">{job.words ? job.words.toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-right">{job.cost_usd ? `$${job.cost_usd.toFixed(3)}` : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(job.created_at)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleting(job)}
                      aria-label={`Delete ${job.filename}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this job?"
        description={`${deleting?.filename ?? ""} and its output will be deleted immediately.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={remove} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

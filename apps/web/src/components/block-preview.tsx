"use client";

import React from "react";
import { Lock, Unlock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, getClientSessionToken } from "@/lib/api";
import { cn } from "@/lib/utils";

type Block = {
  id: string;
  type: string;
  bbox: number[];
  original: string;
  rewritten: string;
  skip: boolean;
  skip_reason: string;
  locked: boolean;
  flag: string;
  font: string;
  size: number;
};

type Props = {
  jobId: string;
  totalPages: number;
  initialPage?: number;
  isPdf?: boolean;
  hasOutput?: boolean;
  onLocksChanged?: () => void;
};

export function BlockPreview({ jobId, totalPages, initialPage = 1, isPdf = false, hasOutput = false, onLocksChanged }: Props) {
  const [page, setPage] = React.useState(initialPage);
  const [blocks, setBlocks] = React.useState<Block[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (target: number) => {
      setLoading(true);
      try {
        const result = await api.get<{ blocks: Block[] }>(`/backend/jobs/${jobId}/preview/${target}`);
        setBlocks(result.blocks);
      } catch {
        setBlocks([]);
      } finally {
        setLoading(false);
      }
    },
    [jobId],
  );

  React.useEffect(() => {
    void load(page);
  }, [page, hasOutput, load]);

  const toggleLock = async (block: Block) => {
    setBusy(block.id);
    try {
      await api.patch(`/backend/jobs/${jobId}/locks`, { block_ids: [block.id], locked: !block.locked });
      setBlocks((current) =>
        current ? current.map((item) => (item.id === block.id ? { ...item, locked: !block.locked, skip: !block.locked ? true : item.skip_reason === "locked" ? false : item.skip } : item)) : current,
      );
      onLocksChanged?.();
    } catch (err) {
      console.warn("Could not toggle block lock:", err);
    } finally {
      setBusy(null);
    }
  };

  const skipped = blocks?.filter((block) => block.skip && !block.locked).length ?? 0;
  const locked = blocks?.filter((block) => block.locked).length ?? 0;
  const hasAnyRewritten = Boolean(blocks?.some((block) => block.rewritten && block.rewritten !== block.original));

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Block map</h3>
            <p className="text-xs text-muted-foreground">
              Click a block to lock it. Locked blocks are copied through untouched.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={String(page)}
              onChange={(event) => setPage(Number(event.target.value))}
              className="w-32"
            >
              {Array.from({ length: Math.max(1, totalPages) }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  Page {index + 1}
                </option>
              ))}
            </Select>
            <Badge variant="secondary">{skipped} skipped</Badge>
            <Badge variant="warning">{locked} locked</Badge>
          </div>
        </div>

        {isPdf ? (
          <div className="mb-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-muted/40 p-2">
              <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Original page {page}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/backend/jobs/${jobId}/render/${page}?variant=before${getClientSessionToken() ? `&st=${encodeURIComponent(getClientSessionToken()!)}` : ""}`}
                alt={`Original page ${page}`}
                className="w-full rounded border bg-white object-contain"
              />
            </div>
            {hasOutput ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-2">
                <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-emerald-800">
                  Rewritten page {page}
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/backend/jobs/${jobId}/render/${page}?variant=after${getClientSessionToken() ? `&st=${encodeURIComponent(getClientSessionToken()!)}` : ""}`}
                  alt={`Rewritten page ${page}`}
                  className="w-full rounded border bg-white object-contain"
                />
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                Rewritten PDF page preview appears here once processing finishes.
              </div>
            )}
          </div>
        ) : blocks && blocks.length > 0 ? (
          <div className="mb-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-muted/40 p-2">
              <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Original page {page}
              </p>
              <div className="max-h-[460px] overflow-y-auto rounded border bg-white p-5 text-slate-900 shadow-xs space-y-2.5">
                {blocks.map((block) => (
                  <p
                    key={`orig-${block.id}`}
                    className={cn(
                      "whitespace-pre-wrap leading-relaxed",
                      block.type === "heading" ? "text-sm font-bold text-slate-950" : "text-xs text-slate-800",
                    )}
                  >
                    {block.original}
                  </p>
                ))}
              </div>
            </div>
            {hasOutput || hasAnyRewritten ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-2">
                <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-emerald-800">
                  Rewritten page {page}
                </p>
                <div className="max-h-[460px] overflow-y-auto rounded border bg-white p-5 text-slate-900 shadow-xs space-y-2.5">
                  {blocks.map((block) => {
                    const changed = Boolean(block.rewritten && block.rewritten !== block.original);
                    return (
                      <p
                        key={`rew-${block.id}`}
                        className={cn(
                          "whitespace-pre-wrap leading-relaxed",
                          block.type === "heading" ? "text-sm font-bold text-slate-950" : "text-xs text-slate-800",
                          changed && "rounded bg-emerald-50/70 px-1.5 py-0.5",
                        )}
                      >
                        {block.rewritten || block.original}
                      </p>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                Rewritten document page preview appears here once processing finishes.
              </div>
            )}
          </div>
        ) : null}

        {loading && !blocks ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : null}

        {blocks && blocks.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No text blocks detected on this page. It may be a scanned page or contain only images.
          </p>
        ) : null}

        <div className="space-y-2">
          {blocks?.map((block) => (
            <div
              key={block.id}
              className={cn(
                "rounded-lg border p-3 transition-colors",
                block.locked ? "border-amber-300 bg-amber-50" : "bg-card",
                block.skip && !block.locked ? "opacity-70" : "",
              )}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge variant={block.type === "heading" ? "default" : "outline"} className="text-[10px]">
                  {block.type.replace("_", " ")}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {block.font} · {block.size}pt
                </span>
                {block.skip && !block.locked ? (
                  <Badge variant="secondary" className="text-[10px]">
                    skipped · {block.skip_reason.replace("_", " ")}
                  </Badge>
                ) : null}
                {block.locked ? <Badge variant="warning" className="text-[10px]">locked</Badge> : null}
                {block.flag ? <Badge variant="destructive" className="text-[10px]">{block.flag}</Badge> : null}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    {block.original.split(/\s+/).length} words
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant={block.locked ? "secondary" : "ghost"}
                    onClick={() => toggleLock(block)}
                    disabled={busy === block.id}
                    className="h-7 gap-1 px-2 text-[11px]"
                  >
                    {block.locked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {block.locked ? "Unlock" : "Lock"}
                  </Button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{block.original}</p>
              {block.rewritten && block.rewritten !== block.original ? (
                <div className="mt-2 rounded-md bg-emerald-50 p-2 text-sm leading-relaxed text-emerald-950">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                    rewritten
                  </span>
                  {block.rewritten}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

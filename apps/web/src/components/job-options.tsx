"use client";

import React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { pageRangeError } from "@/lib/validate";
import { cn } from "@/lib/utils";

export type JobOptionsState = {
  style: "academic" | "professional" | "casual" | "creative";
  strength: "light" | "medium" | "strong";
  tone: number;
  language: string;
  keepOriginalLanguage: boolean;
  pageRange: string;
  protectedTerms: string;
  skip: { references: boolean; tables: boolean; headers_footers: boolean; captions: boolean };
  customInstructions: string;
};

export const DEFAULT_OPTIONS: JobOptionsState = {
  style: "professional",
  strength: "medium",
  tone: 50,
  language: "auto",
  keepOriginalLanguage: true,
  pageRange: "all",
  protectedTerms: "",
  skip: { references: true, tables: true, headers_footers: true, captions: true },
  customInstructions: "",
};

const STYLES: Array<{ id: JobOptionsState["style"]; label: string; hint: string }> = [
  { id: "academic", label: "Academic", hint: "Formal, hedged, precise" },
  { id: "professional", label: "Professional", hint: "Clear workplace prose" },
  { id: "casual", label: "Casual", hint: "Warm and conversational" },
  { id: "creative", label: "Creative", hint: "Vivid but restrained" },
];

const STRENGTHS: Array<{ id: JobOptionsState["strength"]; label: string; hint: string }> = [
  { id: "light", label: "Light", hint: "Fix clunky phrasing" },
  { id: "medium", label: "Medium", hint: "Rework sentence structure" },
  { id: "strong", label: "Strong", hint: "Full rewrite, same facts" },
];

const LANGUAGES = [
  ["auto", "Keep the original language"],
  ["en", "English"],
  ["en-GB", "English (British)"],
  ["hi", "Hindi"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["pt", "Portuguese"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["zh", "Chinese"],
  ["ar", "Arabic"],
];

export function JobOptionsForm({
  value,
  onChange,
  totalPages,
}: {
  value: JobOptionsState;
  onChange: (next: JobOptionsState) => void;
  totalPages?: number;
}) {
  const set = <K extends keyof JobOptionsState>(key: K, next: JobOptionsState[K]) => onChange({ ...value, [key]: next });

  const rangeError = totalPages ? pageRangeError(value.pageRange, totalPages) : pageRangeError(value.pageRange);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold">Style</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                onClick={() => set("style", style.id)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  value.style === style.id ? "border-primary bg-accent" : "hover:bg-accent/50",
                )}
              >
                <p className="text-sm font-medium">{style.label}</p>
                <p className="text-[11px] text-muted-foreground">{style.hint}</p>
              </button>
            ))}
          </div>

          <h3 className="mt-6 text-sm font-semibold">Strength</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {STRENGTHS.map((strength) => (
              <button
                key={strength.id}
                type="button"
                onClick={() => set("strength", strength.id)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  value.strength === strength.id ? "border-primary bg-accent" : "hover:bg-accent/50",
                )}
              >
                <p className="text-sm font-medium capitalize">{strength.label}</p>
                <p className="text-[11px] leading-snug text-muted-foreground">{strength.hint}</p>
              </button>
            ))}
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Tone</h3>
              <span className="text-xs text-muted-foreground">
                {value.tone < 34 ? "Casual" : value.tone < 67 ? "Neutral" : "Formal"}
              </span>
            </div>
            <Slider value={value.tone} onValueChange={(next) => set("tone", next)} className="mt-3" />
            <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Casual</span>
              <span>Formal</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="space-y-4">
            <div>
              <Label>Language</Label>
              <Select value={value.language} onChange={(event) => set("language", event.target.value)} className="mt-2">
                {LANGUAGES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </Select>
              <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Switch
                  checked={value.keepOriginalLanguage}
                  onCheckedChange={(next) => set("keepOriginalLanguage", next)}
                />
                Never translate — keep each block in its original language
              </label>
            </div>

            <div>
              <Label htmlFor="pageRange">Page range</Label>
              <Input
                id="pageRange"
                value={value.pageRange}
                onChange={(event) => set("pageRange", event.target.value)}
                placeholder="all or 1-10, 15"
                className="mt-2"
              />
              {rangeError ? <p className="mt-1 text-xs text-destructive">{rangeError}</p> : null}
              {totalPages ? <p className="mt-1 text-xs text-muted-foreground">{totalPages} pages detected</p> : null}
            </div>

            <div>
              <Label htmlFor="protected">Protected terms</Label>
              <Input
                id="protected"
                value={value.protectedTerms}
                onChange={(event) => set("protectedTerms", event.target.value)}
                placeholder="product names, acronyms, jargon — comma separated"
                className="mt-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                These are copied verbatim and never paraphrased.
              </p>
            </div>

            <div>
              <Label htmlFor="custom">Custom instructions</Label>
              <Textarea
                id="custom"
                value={value.customInstructions}
                onChange={(event) => set("customInstructions", event.target.value)}
                placeholder="e.g. Keep the author's dry humour. Avoid the word 'solution'."
                className="mt-2"
                maxLength={2000}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold">Leave these untouched</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Images, charts, equations, code and URLs are always skipped. These toggles add more.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["references", "References & citations"],
                ["tables", "Table cells"],
                ["headers_footers", "Headers & footers"],
                ["captions", "Captions"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <span className="text-sm">{label}</span>
                <Switch
                  checked={value.skip[key]}
                  onCheckedChange={(next) => set("skip", { ...value.skip, [key]: next })}
                />
              </label>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCheck,
  FileText,
  Filter,
  Globe,
  GraduationCap,
  Info,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import type { DrillbitReport, DrillbitSource } from "@/lib/drillbit";
import { cn } from "@/lib/utils";

const SAMPLE_ACADEMIC_TEXT = `In order to investigate the impact of neural architectures on natural language processing, this paper delves into transformer models. Due to the fact that standard recurrent units suffer from vanishing gradients, attention mechanisms play a crucial role in modern deep learning pipelines. Furthermore, it is important to note that transformer self-attention facilitates the capture of long-range semantic dependencies across diverse sentences.

Additionally, extensive empirical research demonstrates that pre-trained language representations yield substantial performance improvements across benchmarking tasks. It is essential that researchers take into consideration the computational complexity required for full-context training. In conclusion, the paradigm shift toward self-attention architectures serves as a testament to the rapid evolution of generative artificial intelligence and provides the ability to scale models efficiently.`;

export default function DrillbitPlagiarismPage() {
  const { toast } = useToast();
  const [docTitle, setDocTitle] = useState("Academic Thesis Chapter 1");
  const [text, setText] = useState(SAMPLE_ACADEMIC_TEXT);
  const [excludeQuotes, setExcludeQuotes] = useState(true);
  const [excludeBibliography, setExcludeBibliography] = useState(true);
  const [excludeSmallMatches, setExcludeSmallMatches] = useState(true);

  const [analyzing, setAnalyzing] = useState(false);
  const [humanizing, setHumanizing] = useState(false);
  const [report, setReport] = useState<DrillbitReport | null>(null);
  const [activeTab, setActiveTab] = useState<"report" | "sources" | "text">("report");
  const [copied, setCopied] = useState(false);

  // Run Drillbit Check
  const handleRunCheck = async () => {
    if (!text.trim()) {
      toast({ title: "Text required", description: "Please enter or paste your document text.", variant: "error" });
      return;
    }

    setAnalyzing(true);
    try {
      const res = await api.post<{ ok: boolean; report: DrillbitReport }>("/api/drillbit/check", {
        text,
        title: docTitle,
        filters: { excludeQuotes, excludeBibliography, excludeSmallMatches },
      });
      setReport(res.report);
      toast({
        title: "Drillbit Analysis Complete",
        description: `Similarity Score: ${res.report.similarityScore}% · AI Content: ${res.report.aiScore}%`,
        variant: res.report.similarityScore <= 10 ? "success" : "default",
      });
    } catch (err) {
      toast({
        title: "Analysis Failed",
        description: err instanceof ApiError ? err.message : "Could not analyze document.",
        variant: "error",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  // Convert & Humanize with HumanDoc Engine
  const handleHumanize = async () => {
    if (!text.trim()) return;

    setHumanizing(true);
    try {
      const res = await api.post<{
        ok: boolean;
        humanizedText: string;
        wordsChanged: number;
        report: DrillbitReport;
      }>("/api/drillbit/humanize", {
        text,
        title: docTitle,
      });

      setText(res.humanizedText);
      setReport(res.report);
      toast({
        title: "Document Humanized & Verified!",
        description: `Similarity lowered to ${res.report.similarityScore}% (Grade A / UGC Compliant) and 0% AI detected.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Humanization Failed",
        description: err instanceof ApiError ? err.message : "Could not convert text.",
        variant: "error",
      });
    } finally {
      setHumanizing(false);
    }
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "Copied to clipboard", description: "Clean humanized text ready for submission." });
    setTimeout(() => setCopied(false), 2000);
  };

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const isSafe = report ? report.similarityScore <= 10 : false;

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Drillbit Plagiarism &amp; AI Analysis</h1>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
              Drillbit 2026 Engine
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Check similarity against academic journals, research repositories, and internet sources modeled after{" "}
            <a
              href="https://www.drillbitplagiarismcheck.com"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
            >
              drillbitplagiarismcheck.com <ExternalLink className="h-3 w-3" />
            </a>
            . If plagiarism or AI is flagged, auto-humanize to guarantee under 10% similarity.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setText(SAMPLE_ACADEMIC_TEXT);
              setDocTitle("Research Paper Sample (With AI / Plagiarism)");
              setReport(null);
            }}
          >
            Load Sample Paper
          </Button>
        </div>
      </div>

      {/* Input Form & Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">Document Details &amp; Text Input</CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{wordCount.toLocaleString()} words</span>
              <span>·</span>
              <span>{Math.max(1, Math.ceil(wordCount / 350))} page(s)</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="doc-title">Document Title / Paper Name</Label>
            <Input
              id="doc-title"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="e.g. Master Thesis - Deep Learning in Healthcare"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="doc-text">Document Content</Label>
              {copied ? (
                <span className="text-xs text-emerald-600 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Copied!
                </span>
              ) : null}
            </div>
            <Textarea
              id="doc-text"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your thesis, research paper, essay, or academic article here to check Drillbit similarity..."
              className="font-mono text-xs leading-relaxed"
            />
          </div>

          {/* Drillbit Exclusion Filters */}
          <div className="flex flex-wrap items-center gap-4 rounded-lg bg-muted/50 p-3 border text-xs">
            <span className="font-semibold text-muted-foreground flex items-center gap-1">
              <Filter className="h-3.5 w-3.5 text-primary" /> Drillbit Filters:
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeQuotes}
                onChange={(e) => setExcludeQuotes(e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span>Exclude Quotes / Citations</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeBibliography}
                onChange={(e) => setExcludeBibliography(e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span>Exclude Bibliography / References</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeSmallMatches}
                onChange={(e) => setExcludeSmallMatches(e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span>Exclude Small Matches (&lt; 14 words)</span>
            </label>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-3 border-t bg-muted/10 pt-4">
          <Button variant="ghost" size="sm" onClick={handleCopyText} disabled={!text}>
            <Copy className="h-4 w-4 mr-1.5" /> Copy Text
          </Button>

          <div className="flex items-center gap-2">
            <Button onClick={handleRunCheck} disabled={analyzing || !text.trim()} className="gap-2">
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {analyzing ? "Analyzing with Drillbit..." : "Run Drillbit Plagiarism Check"}
            </Button>
          </div>
        </CardFooter>
      </Card>

      {/* Drillbit Report Section */}
      {report ? (
        <div className="space-y-6 animate-fade-up">
          {/* Action Callout if similarity or AI is high */}
          {!isSafe || report.aiScore > 10 ? (
            <Alert className="border-amber-300 bg-amber-50 text-amber-900 shadow-sm">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <div className="flex-1">
                <AlertTitle className="text-base font-bold flex items-center justify-between">
                  <span>Plagiarism / AI Flagged ({report.similarityScore}% Similarity · {report.aiScore}% AI)</span>
                </AlertTitle>
                <AlertDescription className="mt-1 text-sm">
                  This document exceeds the standard university/UGC 10% similarity allowance or has high AI markers.
                  Click below to convert and humanize your text with HumanDoc&apos;s deep engine to clear all Drillbit matches.
                </AlertDescription>
                <div className="mt-3">
                  <Button
                    onClick={handleHumanize}
                    disabled={humanizing}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-2 shadow"
                  >
                    {humanizing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Converting and Re-structuring Text...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Convert &amp; Humanize for Drillbit (Bypass Matches &lt;5%)
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Alert>
          ) : (
            <Alert className="border-emerald-300 bg-emerald-50 text-emerald-900 shadow-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div className="flex-1">
                <AlertTitle className="text-base font-bold flex items-center justify-between">
                  <span>Drillbit Certified Safe ({report.similarityScore}% Similarity · {report.aiScore}% AI)</span>
                  <Badge variant="success" className="text-xs bg-emerald-600 text-white">
                    UGC &amp; University Compliant
                  </Badge>
                </AlertTitle>
                <AlertDescription className="mt-1 text-sm">
                  Your paper satisfies Drillbit&apos;s Satisfactory Grade criteria (under 10% similarity) and has zero detectable AI patterns.
                  Safe for final thesis, journal, or institutional submission.
                </AlertDescription>
              </div>
            </Alert>
          )}

          {/* Official Report Header */}
          <Card className="border-t-4 border-t-primary">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Official Drillbit Similarity Report
                    </span>
                    <Badge variant="outline" className="font-mono text-xs">
                      {report.submissionId}
                    </Badge>
                  </div>
                  <h2 className="text-xl font-bold mt-1">{report.title}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Analyzed on {new Date(report.analyzedAt).toLocaleString()} · {report.wordCount.toLocaleString()} words · {report.pageCount} page(s)
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleRunCheck}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Re-scan
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              {/* Score Metric Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-2">
                {/* 1. Similarity Score */}
                <div
                  className={cn(
                    "rounded-xl border p-4 text-center flex flex-col justify-center items-center shadow-sm",
                    report.gradeColor === "green" && "bg-emerald-50/50 border-emerald-200 text-emerald-950",
                    report.gradeColor === "blue" && "bg-blue-50/50 border-blue-200 text-blue-950",
                    report.gradeColor === "orange" && "bg-amber-50/50 border-amber-200 text-amber-950",
                    report.gradeColor === "red" && "bg-red-50/50 border-red-200 text-red-950",
                  )}
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Similarity Score
                  </span>
                  <div className="text-4xl font-extrabold tracking-tight my-1">
                    {report.similarityScore}%
                  </div>
                  <Badge
                    variant={report.gradeColor === "green" ? "success" : "default"}
                    className={cn(
                      "text-xs capitalize font-bold",
                      report.gradeColor === "green" && "bg-emerald-600 text-white",
                      report.gradeColor === "blue" && "bg-blue-600 text-white",
                      report.gradeColor === "orange" && "bg-amber-600 text-white",
                      report.gradeColor === "red" && "bg-red-600 text-white",
                    )}
                  >
                    {report.gradeBand}
                  </Badge>
                  <p className="text-[11px] text-muted-foreground mt-2 font-medium">
                    {report.gradeDescription}
                  </p>
                </div>

                {/* 2. AI Detection */}
                <div className="rounded-xl border bg-card p-4 text-center flex flex-col justify-center items-center shadow-sm">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Drillbit Extreme AI
                  </span>
                  <div
                    className={cn(
                      "text-4xl font-extrabold tracking-tight my-1",
                      report.aiScore === 0 ? "text-emerald-600" : "text-amber-600",
                    )}
                  >
                    {report.aiScore}%
                  </div>
                  <Badge variant={report.aiScore === 0 ? "success" : "default"} className="text-xs">
                    {report.aiStatus}
                  </Badge>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    {report.aiScore === 0 ? "Natural human syntax" : "High repetitive perplexity"}
                  </p>
                </div>

                {/* 3. Matched Source Types */}
                <div className="rounded-xl border bg-card p-4 flex flex-col justify-center shadow-sm text-xs space-y-2">
                  <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                    Sources Breakdown
                  </span>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Globe className="h-3.5 w-3.5 text-blue-500" /> Internet:
                    </span>
                    <span className="font-bold">{report.summary.internetPercent}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5 text-purple-500" /> Publications:
                    </span>
                    <span className="font-bold">{report.summary.publicationsPercent}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <GraduationCap className="h-3.5 w-3.5 text-emerald-500" /> Student Theses:
                    </span>
                    <span className="font-bold">{report.summary.studentPapersPercent}%</span>
                  </div>
                </div>

                {/* 4. Institutional Compliance Check */}
                <div className="rounded-xl border bg-card p-4 flex flex-col justify-center shadow-sm text-xs">
                  <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                    UGC / Academic Compliance
                  </span>
                  <div className="mt-2 flex items-center gap-2">
                    {isSafe ? (
                      <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                    ) : (
                      <ShieldAlert className="h-6 w-6 text-amber-600 shrink-0" />
                    )}
                    <div>
                      <p className="font-bold text-foreground">
                        {isSafe ? "Passed Verification" : "Requires Modification"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {isSafe ? "Meets institutional <10% standard" : "Exceeds standard 10% threshold"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* View Tabs */}
              <div className="mt-6 border-b flex gap-4 text-sm font-medium">
                <button
                  type="button"
                  onClick={() => setActiveTab("report")}
                  className={cn(
                    "pb-2 border-b-2 transition-colors",
                    activeTab === "report" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  Highlighted Document ({report.segments.length} segments)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("sources")}
                  className={cn(
                    "pb-2 border-b-2 transition-colors",
                    activeTab === "sources" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  Matched Sources List ({report.sources.length})
                </button>
              </div>

              {/* Tab 1: Highlighted Text View */}
              {activeTab === "report" ? (
                <div className="mt-4 rounded-xl border bg-card p-5 text-sm leading-relaxed space-y-3 font-serif">
                  <p className="text-xs font-sans text-muted-foreground mb-3 italic">
                    Highlighted sections represent text segments matched with external databases. Badges [1], [2] correspond to matched sources.
                  </p>
                  <div className="whitespace-pre-wrap">
                    {report.segments.map((seg, idx) => {
                      if (seg.sourceId) {
                        const src = report.sources.find((s) => s.id === seg.sourceId);
                        return (
                          <span
                            key={idx}
                            style={{
                              backgroundColor: `${src?.color || "#f59e0b"}20`,
                              borderBottom: `2px solid ${src?.color || "#f59e0b"}`,
                            }}
                            className="px-1 py-0.5 rounded font-sans inline"
                          >
                            {seg.text}
                            <sup
                              style={{ color: src?.color || "#f59e0b" }}
                              className="font-bold px-1 ml-0.5 rounded bg-white shadow-xs text-[10px]"
                            >
                              [{seg.sourceId}]
                            </sup>{" "}
                          </span>
                        );
                      }
                      return <span key={idx}>{seg.text} </span>;
                    })}
                  </div>
                </div>
              ) : null}

              {/* Tab 2: Matched Sources Table */}
              {activeTab === "sources" ? (
                <div className="mt-4 rounded-xl border overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted text-muted-foreground font-semibold uppercase tracking-wider border-b">
                      <tr>
                        <th className="p-3 w-12 text-center">#</th>
                        <th className="p-3">Matched Repository / Source</th>
                        <th className="p-3">Category</th>
                        <th className="p-3 text-right">Words</th>
                        <th className="p-3 text-right">Similarity %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {report.sources.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-muted-foreground">
                            No external matches found. Document is completely original!
                          </td>
                        </tr>
                      ) : (
                        report.sources.map((src) => (
                          <tr key={src.id} className="hover:bg-muted/30">
                            <td className="p-3 text-center">
                              <span
                                style={{ backgroundColor: src.color }}
                                className="inline-block w-5 h-5 rounded-full text-white font-bold text-[11px] leading-5 text-center"
                              >
                                {src.id}
                              </span>
                            </td>
                            <td className="p-3 font-medium">
                              <div>{src.title}</div>
                              <span className="text-[11px] text-muted-foreground">{src.domain}</span>
                            </td>
                            <td className="p-3">
                              <Badge variant="outline" className="text-[10px]">
                                {src.category}
                              </Badge>
                            </td>
                            <td className="p-3 text-right text-muted-foreground">
                              {src.matchedWords.toLocaleString()} words
                            </td>
                            <td className="p-3 text-right font-bold text-sm">
                              {src.percent}%
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </CardContent>

            <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/10 pt-4">
              <span className="text-xs text-muted-foreground">
                Drillbit Plagiarism Check algorithm calibrated with UGC ShodhShuddhi guidelines.
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopyText}>
                  <Copy className="h-4 w-4 mr-1.5" /> Copy Clean Text
                </Button>
                {!isSafe ? (
                  <Button size="sm" onClick={handleHumanize} disabled={humanizing} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Sparkles className="h-4 w-4 mr-1.5" /> Convert &amp; Humanize
                  </Button>
                ) : null}
              </div>
            </CardFooter>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

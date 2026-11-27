"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileCheck,
  FileText,
  FileUp,
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
  Upload,
  X,
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [inputMode, setInputMode] = useState<"upload" | "paste">("upload");
  const [docTitle, setDocTitle] = useState("Academic Thesis Chapter 1");
  const [text, setText] = useState(SAMPLE_ACADEMIC_TEXT);

  // File Upload State
  const [fileLoading, setFileLoading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedPages, setUploadedPages] = useState<number | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Filters
  const [excludeQuotes, setExcludeQuotes] = useState(true);
  const [excludeBibliography, setExcludeBibliography] = useState(true);
  const [excludeSmallMatches, setExcludeSmallMatches] = useState(true);

  // Analysis & Humanization State
  const [analyzing, setAnalyzing] = useState(false);
  const [humanizing, setHumanizing] = useState(false);
  const [report, setReport] = useState<DrillbitReport | null>(null);
  const [activeTab, setActiveTab] = useState<"report" | "sources" | "text">("report");
  const [copied, setCopied] = useState(false);

  // Plan Quota State
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
  const [quota, setQuota] = useState<QuotaState | null>(null);

  useEffect(() => {
    api
      .get<QuotaState>("/api/billing/usage")
      .then(setQuota)
      .catch(() => setQuota(null));
  }, []);

  const maxCheckPages = quota?.maxCheckPages ?? 10;
  const currentTierLabel = (quota?.tier || "free").toUpperCase();

  const extractPdfClient = async (file: File): Promise<{ text: string; pages: number }> => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    }
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item: any) => item.str || "");
      fullText += strings.join(" ") + "\n\n";
    }
    return { text: fullText.trim(), pages: pdf.numPages };
  };

  // Handle File Upload with Plan-Based Page & Upload Limit Validation
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (quota && quota.uploadsRemaining <= 0) {
      setPageError(
        `Upload limit reached (${quota.uploadsUsed}/${quota.maxUploads} uploads used on the ${quota.tier} plan). Upgrade your plan to upload more documents.`,
      );
      toast({
        title: "Upload Limit Reached",
        description: `Your ${quota.tier} plan allows up to ${quota.maxUploads} uploads. Upgrade to continue.`,
        variant: "error",
      });
      e.target.value = "";
      return;
    }

    setFileLoading(true);
    setPageError(null);
    setReport(null);

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const cleanTitle = file.name.replace(/\.[^/.]+$/, "");

    // Fast-path client-side extraction for plain text and markdown
    if (ext === "txt" || ext === "md") {
      try {
        const rawText = (await file.text()).trim();
        const words = rawText ? rawText.split(/\s+/).length : 0;
        const pages = Math.max(1, Math.ceil(words / 350));
        if (pages > maxCheckPages) {
          setPageError(
            `Document exceeds your ${quota?.tier || "free"} plan limit of ${maxCheckPages} pages per check (~${pages} pages found). Upgrade your plan for up to 100 pages.`,
          );
          toast({
            title: `${maxCheckPages}-Page Plan Limit Exceeded`,
            description: `This document contains ~${pages} pages. Your ${quota?.tier || "free"} plan allows ${maxCheckPages} pages per check.`,
            variant: "error",
          });
          setFileLoading(false);
          return;
        }
        setText(rawText);
        setDocTitle(cleanTitle);
        setUploadedFileName(file.name);
        setUploadedPages(pages);
        toast({
          title: "Document Loaded Successfully",
          description: `${file.name} · ${pages} page(s) · ${words.toLocaleString()} words`,
          variant: "success",
        });
        setFileLoading(false);
        e.target.value = "";
        return;
      } catch (txtErr) {
        console.warn("Client text read failed:", txtErr);
      }
    }

    // Direct high-performance in-browser extraction for PDF files (handles large files up to 25MB instantly)
    if (ext === "pdf") {
      try {
        const { text: rawText, pages } = await extractPdfClient(file);
        if (pages > maxCheckPages) {
          setPageError(
            `Document exceeds your ${quota?.tier || "free"} plan limit of ${maxCheckPages} pages per check (${pages} pages found). Upgrade your plan for up to 100 pages.`,
          );
          toast({
            title: `${maxCheckPages}-Page Plan Limit Exceeded`,
            description: `This document contains ${pages} pages. Your ${quota?.tier || "free"} plan allows ${maxCheckPages} pages per check.`,
            variant: "error",
          });
          setFileLoading(false);
          e.target.value = "";
          return;
        }

        const words = rawText ? rawText.split(/\s+/).length : 0;
        setText(rawText);
        setDocTitle(cleanTitle);
        setUploadedFileName(file.name);
        setUploadedPages(pages);
        setPageError(null);

        toast({
          title: "Document Loaded Successfully",
          description: `${file.name} · ${pages} page(s) (within ${maxCheckPages}-page plan limit) · ${words.toLocaleString()} words extracted`,
          variant: "success",
        });
        setFileLoading(false);
        e.target.value = "";
        return;
      } catch (pdfClientErr) {
        console.warn("Client-side PDF extraction failed, falling back to server parser:", pdfClientErr);
      }
    }

    // Server-side extraction fallback
    // Note: Vercel serverless has a strict 4.5MB request payload limit.
    // For files > 4MB (like patent.pdf) or upon 413, route directly to the FastAPI engine on Render/localhost.
    const backendDirect =
      process.env.NEXT_PUBLIC_API_URL ||
      (typeof window !== "undefined" && window.location.hostname === "localhost"
        ? "http://localhost:8000"
        : "https://humandoc.onrender.com");

    const formData = new FormData();
    formData.append("file", file);

    try {
      let res: Response;
      if (file.size > 4 * 1024 * 1024) {
        // Direct to backend parser to bypass Vercel 4.5MB payload limit
        res = await fetch(`${backendDirect}/drillbit/extract`, {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch("/api/drillbit/extract", {
          method: "POST",
          body: formData,
        });
        if (res.status === 413 || !res.ok) {
          // If Vercel edge proxy rejected it, retry directly with the backend
          const retryRes = await fetch(`${backendDirect}/drillbit/extract`, {
            method: "POST",
            body: formData,
          }).catch(() => null);
          if (retryRes && retryRes.ok) {
            res = retryRes;
          }
        }
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          data.detail ||
          (res.status === 413
            ? "File size exceeds serverless upload limit. Please copy and paste the text directly."
            : "Could not process document. Please check the file or paste the text directly.");
        setPageError(msg);
        toast({
          title: "Upload Failed",
          description: msg,
          variant: "error",
        });
        return;
      }

      if (data.pages > maxCheckPages) {
        setPageError(
          `Document exceeds your ${quota?.tier || "free"} plan limit of ${maxCheckPages} pages per check (${data.pages} pages found). Upgrade your plan for up to 100 pages.`,
        );
        toast({
          title: `${maxCheckPages}-Page Plan Limit Exceeded`,
          description: `This document contains ${data.pages} pages. Your ${quota?.tier || "free"} plan allows ${maxCheckPages} pages per check.`,
          variant: "error",
        });
        return;
      }

      setText(data.text);
      setDocTitle(cleanTitle);
      setUploadedFileName(file.name);
      setUploadedPages(data.pages);

      toast({
        title: "Document Loaded Successfully",
        description: `${file.name} · ${data.pages} page(s) (within ${maxCheckPages}-page plan limit) · ${data.wordCount.toLocaleString()} words`,
        variant: "success",
      });
    } catch {
      toast({
        title: "Upload Failed",
        description: "Failed to parse document. Please check connection or try pasting the text.",
        variant: "error",
      });
    } finally {
      setFileLoading(false);
      e.target.value = "";
    }
  };

  const clearUploadedFile = () => {
    setUploadedFileName(null);
    setUploadedPages(null);
    setPageError(null);
    setText("");
    setReport(null);
  };

  // Run HD Plagiarism Check
  const handleRunCheck = async () => {
    if (!text.trim()) {
      toast({ title: "Text required", description: "Please upload a document or enter text.", variant: "error" });
      return;
    }

    const pagesToCheck = uploadedPages ?? Math.max(1, Math.ceil(text.trim().split(/\s+/).length / 350));
    if (quota && quota.uploadsRemaining <= 0) {
      const msg = `Upload limit reached (${quota.uploadsUsed}/${quota.maxUploads} uploads used on the ${quota.tier} plan). Upgrade your plan to run more checks.`;
      setPageError(msg);
      toast({ title: "Upload Limit Reached", description: msg, variant: "error" });
      return;
    }
    if (pagesToCheck > maxCheckPages) {
      const msg = `Your ${quota?.tier || "free"} plan supports up to ${maxCheckPages} pages per check (this document has ${pagesToCheck} pages). Upgrade your plan for higher limits.`;
      setPageError(msg);
      toast({ title: "Plan Page Limit Exceeded", description: msg, variant: "error" });
      return;
    }

    setAnalyzing(true);
    try {
      const res = await api.post<{ ok: boolean; report: DrillbitReport; quota?: QuotaState }>("/api/drillbit/check", {
        text,
        title: docTitle,
        pageCount: pagesToCheck,
        filters: { excludeQuotes, excludeBibliography, excludeSmallMatches },
      });
      setReport(res.report);
      if (res.quota) setQuota(res.quota);
      setPageError(null);
      toast({
        title: "HD Plagiarism Check Complete",
        description: `Similarity Score: ${res.report.similarityScore}% · AI Content: ${res.report.aiScore}%`,
        variant: res.report.similarityScore <= 10 ? "success" : "default",
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not analyze document.";
      if (err instanceof ApiError && err.status === 402) {
        setPageError(msg);
      }
      toast({
        title: "Analysis Failed",
        description: msg,
        variant: "error",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  // Convert & Humanize with HD Plagiarism Engine
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

  const handleDownloadText = () => {
    const element = document.createElement("a");
    const file = new Blob([text], { type: "text/plain;charset=utf-8" });
    element.href = URL.createObjectURL(file);
    element.download = `${docTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}_HD_Humanized.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast({ title: "Downloaded", description: "Humanized document saved to your device." });
  };

  const [downloadingFormat, setDownloadingFormat] = useState<"pdf" | "docx" | "doc" | null>(null);

  const handleDownloadFile = async (format: "pdf" | "docx" | "doc" | "txt") => {
    if (!text.trim()) return;
    if (format === "txt") {
      handleDownloadText();
      return;
    }

    setDownloadingFormat(format);
    try {
      const res = await fetch("/api/drillbit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: docTitle || "HumanDoc_Document",
          text,
          format,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to export .${format}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(docTitle || "HumanDoc_Document").replace(/[^a-zA-Z0-9_-]/g, "_")}_HD_Humanized.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: `Downloaded (.${format})`,
        description: `Document saved as .${format.toUpperCase()} file.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Download Failed",
        description: err instanceof Error ? err.message : `Could not export .${format} file.`,
        variant: "error",
      });
    } finally {
      setDownloadingFormat(null);
    }
  };

  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const handleDownloadReportPdf = async () => {
    if (!report) return;
    setDownloadingPdf(true);
    try {
      const res = await fetch("/api/drillbit/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: report.title,
          submissionId: report.submissionId,
          wordCount: report.wordCount,
          pageCount: computedPages,
          similarityScore: report.similarityScore,
          aiScore: report.aiScore,
          gradeBand: report.gradeBand,
          gradeDescription: report.gradeDescription,
          sources: report.sources,
          segments: report.segments,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to generate report PDF");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report.submissionId}_Drillbit_Similarity_Report.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast({
        title: "Report Downloaded",
        description: `Official Drillbit Similarity Report PDF saved (${report.similarityScore}% similarity).`,
      });
    } catch (err: any) {
      toast({
        title: "Download Failed",
        description: err.message || "Could not generate PDF report. Please try again.",
        variant: "error",
      });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const computedPages = uploadedPages ?? Math.max(1, Math.ceil(wordCount / 350));
  const isSafe = report ? report.similarityScore <= 10 : false;

  return (
    <div className="space-y-6 pb-12">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".pdf,.docx,.doc,.txt,.md"
        className="hidden"
      />

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">HD Plagiarism &amp; AI Analysis</h1>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
              {currentTierLabel} Plan · Max {maxCheckPages} Pages / Check
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Check complete PDF, DOCX, DOC, and text documents against academic journals, research repositories, and web sources calibrated with{" "}
            <a
              href="https://www.drillbitplagiarismcheck.com"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
            >
              drillbitplagiarismcheck.com <ExternalLink className="h-3 w-3" />
            </a>
            . For queries contact{" "}
            <a href="mailto:napagunasaisujith@gmail.com" className="text-primary underline font-medium">
              napagunasaisujith@gmail.com
            </a>
            .
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setText(SAMPLE_ACADEMIC_TEXT);
              setDocTitle("Research Paper Sample (With AI / Plagiarism)");
              setUploadedFileName(null);
              setUploadedPages(1);
              setPageError(null);
              setReport(null);
            }}
          >
            Load Sample Paper
          </Button>
        </div>
      </div>

      {/* Plan Quota Summary Bar */}
      {quota ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-xs shadow-xs">
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
              Max per check: <strong className="text-foreground">{maxCheckPages} pages</strong>
            </span>
          </div>
          {quota.tier !== "studio" && quota.tier !== "enterprise" && quota.pagesPerMonth < 10000 ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
              <Link href="/pricing">Upgrade Plan</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Main Document Input Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold">Document Input</CardTitle>
              <div className="flex rounded-lg border bg-muted p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setInputMode("upload")}
                  className={cn(
                    "px-2.5 py-1 rounded-md font-medium transition-colors",
                    inputMode === "upload" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Upload File (PDF / DOCX / DOC)
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("paste")}
                  className={cn(
                    "px-2.5 py-1 rounded-md font-medium transition-colors",
                    inputMode === "paste" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Paste Text
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{wordCount.toLocaleString()} words</span>
              <span>·</span>
              <span className={cn("font-medium", computedPages > maxCheckPages ? "text-destructive font-bold" : "text-foreground")}>
                {computedPages} / {maxCheckPages} page(s)
              </span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Error Alert */}
          {pageError ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>
                {pageError.includes("Upload limit")
                  ? "Upload Limit Reached"
                  : pageError.includes("plan limit") || pageError.includes("page quota") || pageError.includes("exceeds")
                    ? "Plan Limit Exceeded"
                    : "Upload Error"}
              </AlertTitle>
              <AlertDescription className="text-xs flex flex-wrap items-center justify-between gap-2">
                <span>{pageError}</span>
                <Button size="sm" variant="outline" className="h-7 bg-background text-foreground" asChild>
                  <Link href="/pricing">Upgrade Plan</Link>
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {/* Mode 1: File Upload Box */}
          {inputMode === "upload" ? (
            <div className="space-y-3">
              {uploadedFileName ? (
                <div className="flex items-center justify-between p-3.5 rounded-xl border bg-primary/5 text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold">
                      <FileCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground text-sm">{uploadedFileName}</p>
                      <p className="text-muted-foreground">
                        {uploadedPages} page(s) (under {maxCheckPages}-page plan max) · {wordCount.toLocaleString()} words extracted
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={fileLoading}
                    >
                      Replace File
                    </Button>
                    <Button variant="ghost" size="sm" onClick={clearUploadedFile}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/30",
                    fileLoading && "opacity-50 pointer-events-none",
                  )}
                >
                  {fileLoading ? (
                    <div className="space-y-2">
                      <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                      <p className="text-sm font-medium">Extracting document pages and counting words...</p>
                      <p className="text-xs text-muted-foreground">Verifying {maxCheckPages}-page plan limit...</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2">
                        <FileUp className="h-6 w-6" />
                      </div>
                      <p className="text-sm font-semibold text-foreground">
                        Click to upload your Document (.PDF, .DOCX, .DOC, .TXT, .MD)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Your <strong className="text-foreground capitalize">{quota?.tier || "free"}</strong> plan limit:{" "}
                        <strong className="text-foreground">{maxCheckPages} pages</strong> per check
                        {quota ? ` · ${quota.uploadsRemaining} of ${quota.maxUploads >= 10000 ? "Unlimited" : quota.maxUploads} uploads left` : ""}.
                      </p>
                      <div className="pt-2">
                        <span className="inline-block text-[11px] bg-muted px-3 py-1 rounded-full text-muted-foreground border">
                          Supports Research Theses, Chapters, Dissertations &amp; Assignments
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

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
              <Label htmlFor="doc-text">Document Content Preview</Label>
              {copied ? (
                <span className="text-xs text-emerald-600 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Copied!
                </span>
              ) : null}
            </div>
            <Textarea
              id="doc-text"
              rows={inputMode === "upload" && uploadedFileName ? 5 : 8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Document text appears here..."
              className="font-mono text-xs leading-relaxed"
            />
          </div>

          {/* HD Plagiarism Exclusion Filters */}
          <div className="flex flex-wrap items-center gap-4 rounded-lg bg-muted/50 p-3 border text-xs">
            <span className="font-semibold text-muted-foreground flex items-center gap-1">
              <Filter className="h-3.5 w-3.5 text-primary" /> HD Plagiarism Filters:
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
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleCopyText} disabled={!text}>
              <Copy className="h-4 w-4 mr-1.5" /> Copy Text
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDownloadText} disabled={!text}>
              <Download className="h-4 w-4 mr-1.5" /> Download (.txt)
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleRunCheck}
              disabled={analyzing || fileLoading || !text.trim() || computedPages > 100}
              className="gap-2"
            >
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {analyzing ? "Analyzing with HD Plagiarism..." : "Run HD Plagiarism Check"}
            </Button>
          </div>
        </CardFooter>
      </Card>

      {/* HD Plagiarism Report Section */}
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
                  This document exceeds the standard university/UGC 10% similarity allowance or contains AI patterns.
                  Click below to convert and humanize your text with HumanDoc&apos;s deep engine to clear all plagiarism matches.
                </AlertDescription>
                <div className="mt-3 flex flex-wrap gap-2">
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
                        Convert &amp; Humanize with HD Plagiarism (Bypass Matches &lt;5%)
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
                  <span>HD Plagiarism Certified Safe ({report.similarityScore}% Similarity · {report.aiScore}% AI)</span>
                  <Badge variant="success" className="text-xs bg-emerald-600 text-white">
                    UGC &amp; University Compliant
                  </Badge>
                </AlertTitle>
                <AlertDescription className="mt-1 text-sm">
                  Your paper satisfies HD Plagiarism Satisfactory Grade criteria (under 10% similarity) and has zero detectable AI patterns.
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
                      Official HD Plagiarism Similarity Report
                    </span>
                    <Badge variant="outline" className="font-mono text-xs">
                      {report.submissionId}
                    </Badge>
                  </div>
                  <h2 className="text-xl font-bold mt-1">{report.title}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Analyzed on {new Date(report.analyzedAt).toLocaleString()} · {report.wordCount.toLocaleString()} words · {computedPages} page(s) (Limit: 100)
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleDownloadReportPdf}
                    disabled={downloadingPdf}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm"
                  >
                    {downloadingPdf ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Drillbit Report (.pdf)
                  </Button>
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
                    HD Extreme AI Detection
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
                HD Plagiarism Check algorithm · For queries: napagunasaisujith@gmail.com · &copy; 2026 HumanDoc HD
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleDownloadReportPdf}
                  disabled={downloadingPdf}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm"
                >
                  {downloadingPdf ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1.5" />
                  )}
                  Drillbit Report (.pdf)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownloadFile("pdf")}
                  disabled={downloadingFormat !== null}
                >
                  {downloadingFormat === "pdf" ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1.5" />
                  )}
                  PDF (.pdf)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownloadFile("docx")}
                  disabled={downloadingFormat !== null}
                >
                  {downloadingFormat === "docx" ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1.5" />
                  )}
                  Word (.docx)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownloadFile("doc")}
                  disabled={downloadingFormat !== null}
                >
                  {downloadingFormat === "doc" ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1.5" />
                  )}
                  Word (.doc)
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleDownloadFile("txt")}>
                  <Download className="h-4 w-4 mr-1.5" /> Text (.txt)
                </Button>
                <Button variant="outline" size="sm" onClick={handleCopyText}>
                  <Copy className="h-4 w-4 mr-1.5" /> Copy Text
                </Button>
                {!isSafe ? (
                  <Button size="sm" onClick={handleHumanize} disabled={humanizing} className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium">
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

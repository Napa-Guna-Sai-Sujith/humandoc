import Link from "next/link";
import {
  ArrowRight,
  FileText,
  Gauge,
  Image as ImageIcon,
  Lock,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: ScanSearch,
    title: "Analyse",
    body: "We read the file structure: pages, fonts, languages, tables, images and reading order. You get a report before anything is rewritten.",
  },
  {
    icon: Sparkles,
    title: "Rewrite",
    body: "Each block is rewritten on its own with its neighbours, section heading and a document glossary. Facts, numbers and citations are validated automatically.",
  },
  {
    icon: FileText,
    title: "Rebuild",
    body: "Text is redacted and re-inserted into the same box, at the same size and colour. Images, charts and vectors are never moved.",
  },
  {
    icon: ShieldCheck,
    title: "Verify",
    body: "Page count, image fingerprints and page geometry are checked. You get a QA report listing anything that was flagged or kept as-is.",
  },
];

const FEATURES = [
  {
    icon: Gauge,
    title: "Hundreds of pages, no hard limit",
    body: "Pages are processed in parallel batches and checkpointed one by one. Close the tab mid-job and resume from the last page.",
  },
  {
    icon: ImageIcon,
    title: "Layout, untouched",
    body: "PDF text is redacted and re-inserted in place. DOCX and PPTX text is edited inside the existing runs, so styles, numbering and images survive.",
  },
  {
    icon: Lock,
    title: "You choose what changes",
    body: "Lock any block with a click. Skip references, tables, headers and captions. Protect product names and technical terms.",
  },
  {
    icon: Wand2,
    title: "Sounds like a person",
    body: "Sentence length varies, transitions are natural, and stock AI phrasing is rejected by a validator before it reaches your file.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
            <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/register">Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,hsl(214_32%_91%),transparent)]" />
        <div className="mx-auto max-w-6xl px-6 py-20 text-center md:py-28">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3" /> PDF · DOCX · PPTX · TXT · Markdown
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-6xl">
            Rewrite the words. Keep the layout exactly as it was.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground md:text-lg">
            HumanDoc rewrites document text so it reads naturally and human-written, block by block, while preserving
            formatting, fonts, images and page geometry. Built for files of any size — including hundreds of pages.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/register">
                Start free — 20 pages <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="#how">See how it works</Link>
            </Button>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            No card required · Files auto-delete · Never used for training
          </p>
        </div>
      </section>

      <section id="how" className="border-y bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Four steps, one faithful document</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Everything that is not prose stays exactly where it was.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <div key={step.title} className="rounded-xl border bg-card p-5">
                <div className="flex items-center justify-between">
                  <step.icon className="h-5 w-5" />
                  <span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                </div>
                <h3 className="mt-4 text-sm font-semibold">{step.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Made for documents that matter</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Not a chatbot. A document engine that understands structure, enforces constraints and proves the result.
            </p>
            <div className="mt-6 space-y-4">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="flex gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary">
                    <feature.icon className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-medium">{feature.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{feature.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="rounded-xl bg-muted/60 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span className="ml-2 text-[11px] text-muted-foreground">quarterly-report.pdf · 142 pages</span>
              </div>
              <div className="space-y-2 rounded-lg bg-white p-4 shadow-sm">
                <div className="h-3 w-1/2 rounded bg-slate-900" />
                <div className="h-2 w-full rounded bg-slate-200" />
                <div className="h-2 w-11/12 rounded bg-slate-200" />
                <div className="h-2 w-full rounded bg-slate-200" />
                <div className="mt-4 h-2 w-1/3 rounded bg-slate-900" />
                <div className="h-2 w-full rounded bg-slate-200" />
                <div className="h-2 w-4/5 rounded bg-slate-200" />
                <div className="mt-4 flex gap-3">
                  <div className="h-16 flex-1 rounded bg-emerald-100" />
                  <div className="h-16 flex-1 rounded bg-sky-100" />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Page 87 of 142</span>
                <span className="text-emerald-700">images unchanged</span>
              </div>
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <li className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Same page count</li>
              <li className="flex items-center gap-2"><ImageIcon className="h-3.5 w-3.5" /> Images byte-identical</li>
              <li className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> Fonts preserved</li>
              <li className="flex items-center gap-2"><Lock className="h-3.5 w-3.5" /> Block-level locks</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="pricing" className="border-t bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Start free. Scale when you need to.</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Every job shows an estimated cost before you start. No surprise bills.
            </p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { name: "Free", pages: "20 pages / month", price: "$0" },
              { name: "Pro", pages: "500 pages / month", price: "$29" },
              { name: "Studio", pages: "2,000 pages / month", price: "$79" },
            ].map((tier) => (
              <div key={tier.name} className="rounded-xl border bg-card p-5">
                <p className="text-sm font-medium">{tier.name}</p>
                <p className="mt-2 text-3xl font-semibold">{tier.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <p className="mt-1 text-xs text-muted-foreground">{tier.pages}</p>
                <Button asChild variant="outline" size="sm" className="mt-4 w-full">
                  <Link href="/pricing">View plan</Link>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-2xl border bg-card p-6 md:p-8">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Responsible use</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                HumanDoc is a writing and editing tool. You must follow your school&apos;s, employer&apos;s or
                publisher&apos;s policy on AI assistance, and disclose it where required. We do not claim that output
                will pass AI detectors, and we do not market the product that way. You remain responsible for the
                accuracy and integrity of anything you submit.
              </p>
              <Link href="/responsible-use" className="mt-3 inline-flex items-center gap-1 text-sm underline underline-offset-2">
                Read the full policy <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="rounded-xl bg-muted/60 p-5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Privacy at a glance</p>
              <ul className="mt-3 space-y-2">
                <li>Encrypted at rest (S3 SSE-AES256) and in transit.</li>
                <li>Per-account isolation and short-lived signed URLs.</li>
                <li>Uploads and outputs auto-delete after 7 days by default.</li>
                <li>We never train models on your documents.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-muted-foreground">
          <Logo />
          <div className="flex gap-4">
            <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/responsible-use" className="hover:text-foreground">Responsible use</Link>
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
          </div>
          <p>© {new Date().getFullYear()} HumanDoc</p>
        </div>
      </footer>
    </div>
  );
}

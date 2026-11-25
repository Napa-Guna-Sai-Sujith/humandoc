import Link from "next/link";

import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <Logo className="[&_span]:text-primary-foreground" />
        <div className="space-y-4 max-w-md">
          <p className="text-2xl font-medium leading-snug tracking-tight">
            Rewrite and polish your documents while keeping the original layout intact.
          </p>
          <ul className="space-y-2 text-sm text-primary-foreground/80">
            <li>• Supports PDF, DOCX, PPTX, TXT &amp; Markdown</li>
            <li>• Block-level editing with number &amp; citation validation</li>
            <li>• Built-in plagiarism &amp; AI analysis with PDF report export</li>
          </ul>
        </div>
        <p className="text-xs text-primary-foreground/60">
          Encrypted at rest and in transit · Auto-deleted after processing · Never used for training
        </p>
      </div>
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-6 lg:justify-end">
          <div className="lg:hidden">
            <Logo />
          </div>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to home
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  );
}

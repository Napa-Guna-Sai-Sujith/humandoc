import Link from "next/link";

import { cn } from "@/lib/utils";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 5v14M5 12h9M14 5v14" strokeLinecap="round" />
          <path d="M18.5 9.5c2.2 0 3.5 1.6 3.5 3.6s-1.3 3.6-3.5 3.6" strokeLinecap="round" />
        </svg>
      </span>
      {!compact ? (
        <span className="text-[15px] font-semibold tracking-tight">HumanDoc</span>
      ) : null}
    </Link>
  );
}

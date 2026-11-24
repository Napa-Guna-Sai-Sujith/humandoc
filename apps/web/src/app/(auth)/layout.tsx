import Link from "next/link";

import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <Logo className="[&_span]:text-primary-foreground" />
        <div>
          <blockquote className="max-w-md text-2xl font-medium leading-snug tracking-tight">
            “The layout came back pixel-identical. Only the words changed — and they finally sound like me.”
          </blockquote>
          <p className="mt-4 text-sm text-primary-foreground/70">Research lead, 180-page technical report</p>
        </div>
        <p className="text-xs text-primary-foreground/50">
          Encrypted at rest and in transit · Deleted on your schedule · Never used for training
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

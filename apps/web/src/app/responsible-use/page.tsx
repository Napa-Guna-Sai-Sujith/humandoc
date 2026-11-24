import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Responsible use" };

export default function ResponsibleUsePage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Responsible use</h1>
      <p className="mt-2 text-sm text-muted-foreground">HumanDoc is an editing tool, not a loophole.</p>

      <Alert variant="warning" className="mt-8">
        <AlertTitle>Read this before you rewrite</AlertTitle>
        <AlertDescription>
          You must follow your school, employer or publisher&apos;s policy on AI assistance, and disclose AI assistance
          where that policy requires it. HumanDoc does not guarantee that output will pass AI detectors, and we do not
          market it as a way to evade them.
        </AlertDescription>
      </Alert>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="text-lg font-medium text-foreground">What HumanDoc is for</h2>
          <p className="mt-2">
            Improving clarity, flow and consistency in writing you are entitled to edit. It is a drafting and editing
            aid, like a human editor or a grammar checker with better judgement.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-foreground">What it is not for</h2>
          <p className="mt-2">
            Misrepresenting authorship where disclosure is required, circumventing academic integrity rules, or
            laundering content you did not write. If a policy forbids AI assistance, do not use HumanDoc for that work.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-foreground">Accuracy is yours</h2>
          <p className="mt-2">
            The engine preserves numbers, names, dates and citations by validation, but it cannot verify whether a
            claim is true. Review the rewritten document before submitting or publishing it.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-foreground">What we do on our side</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>We never claim detector evasion, and we do not optimise for it.</li>
            <li>We reject stock AI phrasing in output rather than adding it.</li>
            <li>We do not train on your documents.</li>
            <li>We keep an audit log of account and job actions.</li>
          </ul>
        </section>
      </div>

      <div className="mt-10 flex gap-3">
        <Button variant="outline" asChild><Link href="/legal/terms">Terms</Link></Button>
        <Button variant="outline" asChild><Link href="/legal/privacy">Privacy</Link></Button>
        <Button asChild><Link href="/register">Create an account</Link></Button>
      </div>
    </div>
  );
}

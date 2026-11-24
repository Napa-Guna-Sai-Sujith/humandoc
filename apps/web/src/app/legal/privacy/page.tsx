import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Privacy policy" };

const sections = [
  {
    title: "What we collect",
    body: "Account data (name, email, hashed password), usage records (pages, words, tokens), billing records processed by Stripe, and the documents you choose to upload. We store documents to process your job and to let you download the result.",
  },
  {
    title: "How documents are stored",
    body: "Files are written to S3-compatible object storage with server-side AES-256 encryption. Keys are scoped to your account. Downloads use short-lived signed URLs. Network traffic is encrypted with TLS.",
  },
  {
    title: "Who can see your documents",
    body: "Only you. Administrators can see job metadata (filename, page count, status, cost) for support and abuse prevention, but not document contents. The model provider receives the text of blocks that are being rewritten in order to return the rewrite.",
  },
  {
    title: "Retention and deletion",
    body: "Uploads and outputs are deleted automatically after a couple of hours following processing by default. You can delete any job immediately from History, and you can delete your account and all associated data from Settings. Deletion of stored objects is final.",
  },
  {
    title: "Training",
    body: "We do not use your documents to train machine-learning models, and we do not sell document content.",
  },
  {
    title: "Cookies and sessions",
    body: "We use a first-party httpOnly session cookie and a double-submit CSRF cookie. We do not use advertising cookies or third-party trackers.",
  },
  {
    title: "Your rights",
    body: "You can export or delete your data at any time. Depending on your jurisdiction you may have additional rights; contact privacy@humandoc.local.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: 23 November 2026</p>
      <div className="mt-8 space-y-8">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-medium">{section.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
          </section>
        ))}
      </div>
      <div className="mt-10 flex gap-3">
        <Button variant="outline" asChild><Link href="/">Home</Link></Button>
        <Button variant="outline" asChild><Link href="/legal/terms">Terms</Link></Button>
      </div>
    </div>
  );
}

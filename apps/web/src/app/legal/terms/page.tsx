import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Terms of service" };

const sections = [
  {
    title: "1. The service",
    body: "HumanDoc rewrites the text of documents you upload while preserving layout, formatting and images. The service is provided as-is. Output quality varies with input quality, language and document complexity.",
  },
  {
    title: "2. Your responsibilities",
    body: "You confirm that you have the right to upload and modify every document you submit, and that you will not upload unlawful, harmful or infringing material. You are responsible for reviewing output before use.",
  },
  {
    title: "3. Academic and professional integrity",
    body: "You must comply with any AI-use policy that applies to you, including those of your school, employer or publisher, and disclose AI assistance where required. HumanDoc is not marketed as a way to bypass AI detectors and makes no such guarantee.",
  },
  {
    title: "4. Acceptable use",
    body: "Do not attempt to disrupt the service, probe other accounts, reverse the rewriting model, or use the service to deceive readers about authorship where disclosure is required.",
  },
  {
    title: "5. Plans and billing",
    body: "Paid plans are billed monthly through Stripe and renew automatically until cancelled. Cancel from the billing portal; access continues to the end of the paid period. Refunds are at our discretion except where required by law.",
  },
  {
    title: "6. Inactive account deletion",
    body: "The account will be deleted automatically after 15 days if the account is unused. Users are advised to actively access and utilize their account to prevent automatic deactivation and permanent removal of account records and data.",
  },
  {
    title: "7. Data and retention",
    body: "Your use of the service is governed by our Privacy Policy. Files auto-delete after the retention window; you may delete them sooner.",
  },
  {
    title: "8. Liability",
    body: "To the maximum extent permitted by law, HumanDoc is not liable for indirect or consequential loss, including loss of data, profit or reputation arising from use of the service.",
  },
  {
    title: "9. Changes",
    body: "We may update these terms. Continued use after publication constitutes acceptance. The current version is always available at this URL.",
  },
];

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: 24 November 2026</p>
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
        <Button variant="outline" asChild><Link href="/legal/privacy">Privacy</Link></Button>
      </div>
    </div>
  );
}

import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/toast";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HumanDoc — Rewrite the words, keep the layout", template: "%s · HumanDoc" },
  description:
    "HumanDoc rewrites document text so it reads naturally and human-written, while preserving layout, formatting and images exactly. PDF, DOCX, PPTX and Markdown.",
  keywords: ["document rewriting", "PDF editor", "humanize text", "layout preserving", "DOCX"],
};

export const viewport: Viewport = { themeColor: "#0f172a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans">
        <Toaster>{children}</Toaster>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/toast";

import "./globals.css";

const APP_URL = process.env.APP_URL || "https://humandoc.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: "HumanDoc — Rewrite the words, keep the layout", template: "%s · HumanDoc" },
  description:
    "Rewrite and polish PDF, DOCX, PPTX, and Markdown documents while preserving formatting, fonts, tables, and images.",
  openGraph: {
    type: "website",
    siteName: "HumanDoc",
    title: "HumanDoc — Rewrite the words, keep the layout",
    description:
      "Rewrite and polish PDF, DOCX, PPTX, and Markdown documents while preserving formatting, fonts, tables, and images.",
    url: APP_URL,
  },
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

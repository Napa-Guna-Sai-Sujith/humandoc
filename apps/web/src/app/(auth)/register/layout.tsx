import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Sign up for HumanDoc and start rewriting PDF, DOCX, PPTX, and Markdown documents with 20 free pages.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}

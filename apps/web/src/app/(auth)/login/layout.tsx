import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your HumanDoc workspace to rewrite documents and check plagiarism reports.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}

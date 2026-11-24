"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api";

export function AdminRoleGate({ initialRole, children }: { initialRole?: "user" | "admin" | null; children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(initialRole === "admin");

  useEffect(() => {
    if (initialRole === "admin") {
      setAllowed(true);
      return;
    }
    if (initialRole === "user") {
      router.replace("/dashboard");
      return;
    }
    api
      .get<{ user: { role: "user" | "admin" } | null }>("/api/auth/me")
      .then((res) => {
        if (res.user?.role === "admin") setAllowed(true);
        else router.replace("/dashboard");
      })
      .catch(() => router.replace("/login"));
  }, [initialRole, router]);

  if (!allowed) {
    return (
      <div className="flex py-16 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Checking administrator access…
      </div>
    );
  }

  return <>{children}</>;
}

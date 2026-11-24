"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { api, clearClientAuthTokens } from "@/lib/api";

type User = { id: string; name: string; email: string; role: "user" | "admin" };

export function AppAuthGate({ initialUser, children }: { initialUser: User | null; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(initialUser);
  const [checking, setChecking] = useState(!initialUser);

  useEffect(() => {
    if (initialUser) {
      setUser(initialUser);
      setChecking(false);
      return;
    }
    let active = true;
    api
      .get<{ user: User | null }>("/api/auth/me")
      .then((res) => {
        if (!active) return;
        if (res.user) {
          setUser(res.user);
          setChecking(false);
        } else {
          clearClientAuthTokens();
          router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
        }
      })
      .catch(() => {
        if (!active) return;
        clearClientAuthTokens();
        router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
      });
    return () => {
      active = false;
    };
  }, [initialUser, pathname, router]);

  if (checking || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspace…
        </div>
      </div>
    );
  }

  return (
    <AppShell user={{ name: user.name, email: user.email, role: user.role }}>
      {children}
    </AppShell>
  );
}

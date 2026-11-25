"use client";

import { useEffect, useRef } from "react";

export function AutoRefresh() {
  const initialVersion = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const checkVersion = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        const latest = data?.version;
        if (!latest || latest === "dev") return;

        if (!initialVersion.current) {
          initialVersion.current = latest;
          return;
        }
        if (initialVersion.current !== latest && active) {
          window.location.reload();
        }
      } catch {
        /* ignore transient network errors */
      }
    };

    void checkVersion();
    const interval = window.setInterval(checkVersion, 30_000);
    const onFocus = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };
    const onChunkError = (event: PromiseRejectionEvent) => {
      const msg = String((event.reason as Error | undefined)?.message || event.reason || "");
      if (msg.includes("ChunkLoadError") || msg.includes("Loading chunk")) {
        window.location.reload();
      }
    };

    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    window.addEventListener("unhandledrejection", onChunkError);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("unhandledrejection", onChunkError);
    };
  }, []);

  return null;
}

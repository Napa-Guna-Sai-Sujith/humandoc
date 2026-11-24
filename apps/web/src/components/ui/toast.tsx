"use client";

import * as React from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type Toast = { id: string; title: string; description?: string; variant?: "default" | "success" | "error" };
type ToastContextValue = { toast: (input: Omit<Toast, "id">) => void };

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <Toaster>");
  return context;
}

export function Toaster({ children }: { children?: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const toast = React.useCallback((input: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((current) => [...current, { id, ...input }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);

  const remove = (id: string) => setToasts((current) => current.filter((item) => item.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-lg border bg-card p-4 shadow-lg animate-fade-up",
              item.variant === "error" && "border-destructive/40",
            )}
          >
            {item.variant === "error" ? (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            ) : item.variant === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="flex-1 text-sm">
              <p className="font-medium">{item.title}</p>
              {item.description ? <p className="mt-0.5 text-muted-foreground">{item.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => remove(item.id)}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

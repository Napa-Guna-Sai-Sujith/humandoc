"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type MenuContextValue = { open: boolean; setOpen: (open: boolean) => void };
const MenuContext = React.createContext<MenuContextValue | null>(null);

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return (
    <MenuContext.Provider value={{ open, setOpen }}>
      <div className="relative" ref={ref}>
        {children}
      </div>
    </MenuContext.Provider>
  );
}

export function DropdownMenuTrigger({ children, className }: { children: React.ReactNode; className?: string }) {
  const context = React.useContext(MenuContext);
  return (
    <button type="button" onClick={() => context?.setOpen(!context.open)} className={cn(className)}>
      {children}
    </button>
  );
}

export function DropdownMenuContent({ children, align = "end", className }: {
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const context = React.useContext(MenuContext);
  if (!context?.open) return null;
  return (
    <div
      role="menu"
      className={cn(
        "absolute z-40 mt-2 min-w-[10rem] overflow-hidden rounded-lg border bg-card p-1 text-sm shadow-md animate-fade-up",
        align === "end" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({ children, onClick, className, destructive }: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  destructive?: boolean;
}) {
  const context = React.useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClick?.();
        context?.setOpen(false);
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent",
        destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

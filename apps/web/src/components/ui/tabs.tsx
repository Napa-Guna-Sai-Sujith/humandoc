"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type TabsContextValue = { value: string; setValue: (value: string) => void };
const TabsContext = React.createContext<TabsContextValue | null>(null);

function Tabs({ defaultValue, value, onValueChange, className, children }: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? "");
  const current = value ?? internal;
  const setValue = (next: string) => {
    setInternal(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext.Provider value={{ value: current, setValue }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex max-w-full flex-nowrap items-center justify-start overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground sm:justify-center",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  const context = React.useContext(TabsContext);
  const active = context?.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => context?.setValue(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-card text-foreground shadow" : "hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function TabsContent({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  const context = React.useContext(TabsContext);
  if (context?.value !== value) return null;
  return <div role="tabpanel" className={cn("mt-4 focus-visible:outline-none", className)}>{children}</div>;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };

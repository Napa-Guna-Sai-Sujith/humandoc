import * as React from "react";

import { cn } from "@/lib/utils";

const Separator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { orientation?: "h" | "v" }>(
  ({ className, orientation = "h", ...props }, ref) => (
    <div
      ref={ref}
      role="separator"
      className={cn(
        "shrink-0 bg-border",
        orientation === "h" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  ),
);
Separator.displayName = "Separator";

export { Separator };

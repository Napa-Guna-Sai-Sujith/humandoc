import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

type CheckboxProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, checked = false, onCheckedChange, ...props }, ref) => (
    <button
      {...props}
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(event) => {
        onCheckedChange?.(!checked);
        props.onClick?.(event);
      }}
      className={cn(
        "peer h-4 w-4 shrink-0 rounded-sm border border-input shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        checked && "bg-primary text-primary-foreground",
        className,
      )}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  ),
);
Checkbox.displayName = "Checkbox";

export { Checkbox };

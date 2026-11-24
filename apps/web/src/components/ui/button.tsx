import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border border-input bg-card shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3",
        lg: "h-11 rounded-lg px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Next.js <Link>) instead of a <button>. */
  asChild?: boolean;
}

/** Minimal Radix-style Slot: merges className and forwards props/ref onto the child. */
const Slot = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }>(
  ({ children, ...slotProps }, ref) => {
    if (React.isValidElement(children)) {
      const childProps = children.props as Record<string, unknown>;
      return React.cloneElement(children, {
        ...slotProps,
        ...childProps,
        className: cn(slotProps.className, (childProps.className as string | undefined) ?? ""),
        ref,
      } as never);
    }
    return null;
  },
);
Slot.displayName = "Slot";

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size, className }));
    if (asChild) {
      return (
        <Slot className={classes} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button className={classes} ref={ref} {...props}>
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

import * as React from "react";

import { cn } from "@/lib/utils";

type SliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: number;
  onValueChange?: (value: number) => void;
};

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, onValueChange, min = 0, max = 100, ...props }, ref) => (
    <input
      ref={ref}
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(event) => onValueChange?.(Number(event.target.value))}
      className={cn(
        "h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-foreground",
        className,
      )}
      style={{ accentColor: "hsl(222 47% 11%)" }}
      {...props}
    />
  ),
);
Slider.displayName = "Slider";

export { Slider };

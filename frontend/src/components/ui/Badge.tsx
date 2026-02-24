import { cva, type VariantProps } from "class-variance-authority";
import { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-3 py-1 text-xs font-medium", {
  variants: {
    variant: {
      neutral: "bg-muted text-muted-foreground",
      success: "bg-success/15 text-success",
      failed: "bg-failure/15 text-failure",
      running: "bg-accent/15 text-accent",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
});

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

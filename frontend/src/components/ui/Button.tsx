import { cva, type VariantProps } from "class-variance-authority";
import { ButtonHTMLAttributes, forwardRef } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-xl font-semibold transition-transform duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "text-white shadow-soft hover:-translate-y-0.5 hover:shadow-hover",
        secondary: "bg-muted border border-border text-foreground hover:bg-white",
        danger: "bg-failure/10 text-failure border border-failure/30 hover:bg-failure/20",
        ghost: "text-foreground hover:bg-muted",
        blue: "bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20",
        success: "bg-success/10 text-success border border-success/30 hover:bg-success/20",
      },
      size: {
        sm: "px-2.5 py-1 text-xs rounded-lg",
        md: "px-4 py-2 text-sm",
      },
      fullWidth: {
        true: "w-full",
        false: "w-auto",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      fullWidth: false,
    },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, fullWidth, ...props },
  ref,
) {
  const resolvedVariant = variant ?? "primary";

  return (
    <button
      ref={ref}
      className={cn(
        buttonVariants({ variant: resolvedVariant, size, fullWidth }),
        resolvedVariant === "primary" && "bg-gradient-accent",
        className,
      )}
      {...props}
    />
  );
});

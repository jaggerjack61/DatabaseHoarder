import { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

interface SectionProps extends HTMLAttributes<HTMLElement> {
  label?: string;
  title?: string;
}

export function Section({ className, label, title, children, ...props }: SectionProps) {
  return (
    <section className={cn("space-y-4", className)} {...props}>
      {(label || title) && (
        <header className="space-y-2">
          {label && <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>}
          {title && <h2 className="font-headline text-3xl text-foreground">{title}</h2>}
        </header>
      )}
      {children}
    </section>
  );
}

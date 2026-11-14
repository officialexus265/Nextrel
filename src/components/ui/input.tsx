import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm text-fg placeholder:text-subtle outline-none transition-colors focus:border-border-strong focus:ring-2 focus:ring-ring/30",
        className,
      )}
      {...props}
    />
  );
}

import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "muted",
  children,
}: {
  className?: string;
  tone?: "muted" | "live" | "idle" | "down" | "info" | "accent";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    muted: "bg-surface-2 text-muted border-border",
    live: "bg-live/15 text-live border-live/30",
    idle: "bg-idle/15 text-idle border-idle/30",
    down: "bg-down/15 text-down border-down/30",
    info: "bg-info/15 text-info border-info/30",
    accent: "bg-accent text-accent-fg border-transparent",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

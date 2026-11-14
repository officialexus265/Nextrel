import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/utils";
import type { MovementState } from "@/lib/fleet/types";

const TONE: Record<MovementState, "live" | "idle" | "down"> = {
  moving: "live",
  idle: "idle",
  stopped: "down",
  offline: "down",
};

const LABEL: Record<MovementState, string> = {
  moving: "Moving",
  idle: "Idling",
  stopped: "Stopped",
  offline: "Offline",
};

export function StatusChip({
  movement,
  durationMs,
}: {
  movement: MovementState;
  durationMs?: number;
}) {
  const extra =
    movement !== "moving" && durationMs != null && durationMs > 30_000
      ? ` · ${formatDuration(durationMs)}`
      : "";
  return (
    <Badge tone={TONE[movement]}>
      <span className="size-1.5 rounded-full bg-current" />
      {LABEL[movement]}
      {extra}
    </Badge>
  );
}

export function movementColor(m: MovementState) {
  if (m === "moving") return "var(--color-live)";
  if (m === "idle") return "var(--color-idle)";
  return "var(--color-down)";
}

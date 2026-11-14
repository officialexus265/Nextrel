export function behaviorLabel(kind: string) {
  if (kind === "harsh_brake") return "Harsh brake";
  if (kind === "harsh_accel") return "Harsh acceleration";
  if (kind === "harsh_corner") return "Harsh corner";
  return kind.replaceAll("_", " ");
}

export function commandLabel(kind: string) {
  if (kind === "locate") return "Locate";
  if (kind === "restart") return "Restart";
  if (kind === "snapshot") return "Snapshot";
  return kind;
}

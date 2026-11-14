export type BriefWindow = "day" | "week" | "month";

export type BriefBucket = {
  key: string;
  label: string;
  distanceKm: number;
  fuelUsed: number;
  alerts: number;
};

const TZ = "Africa/Nairobi";

export function nairobiStamp(input: string | Date) {
  const d = input instanceof Date ? input : new Date(input);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  const hour = (bag.hour ?? "00").padStart(2, "0");
  return {
    ymd: `${bag.year}-${bag.month}-${bag.day}`,
    hourKey: `${hour}:00`,
  };
}

export function briefAxis(window: BriefWindow, now = Date.now()): BriefBucket[] {
  if (window === "day") {
    return Array.from({ length: 24 }, (_, h) => {
      const label = `${String(h).padStart(2, "0")}:00`;
      return { key: label, label, distanceKm: 0, fuelUsed: 0, alerts: 0 };
    });
  }
  const days = window === "week" ? 7 : 30;
  const labelFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });
  const out: BriefBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const key = nairobiStamp(d).ymd;
    out.push({ key, label: labelFmt.format(d), distanceKm: 0, fuelUsed: 0, alerts: 0 });
  }
  return out;
}

export function bucketKey(iso: string, window: BriefWindow) {
  const stamp = nairobiStamp(iso);
  return window === "day" ? stamp.hourKey : stamp.ymd;
}

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}

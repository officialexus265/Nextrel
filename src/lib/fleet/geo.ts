import type { FenceSchedule } from "./types";

export type LatLng = { lat: number; lng: number };

const R = 6371000;

export function toRad(d: number) {
  return (d * Math.PI) / 180;
}

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function destination(start: LatLng, brngDeg: number, distM: number): LatLng {
  const brng = toRad(brngDeg);
  const lat1 = toRad(start.lat);
  const lng1 = toRad(start.lng);
  const ang = distM / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

export function routeLength(points: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}

export function alongRoute(points: LatLng[], distanceM: number): { point: LatLng; heading: number } {
  if (points.length === 0) return { point: { lat: 0, lng: 0 }, heading: 0 };
  if (points.length === 1) return { point: points[0], heading: 0 };
  const total = routeLength(points);
  let d = ((distanceM % total) + total) % total;
  for (let i = 1; i < points.length; i++) {
    const seg = haversine(points[i - 1], points[i]);
    if (d <= seg) {
      const t = seg === 0 ? 0 : d / seg;
      const point = {
        lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
        lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * t,
      };
      return { point, heading: (bearing(points[i - 1], points[i]) + 360) % 360 };
    }
    d -= seg;
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  return { point: last, heading: (bearing(prev, last) + 360) % 360 };
}

export function pointInCircle(p: LatLng, c: LatLng, radiusM: number) {
  return haversine(p, c) <= radiusM;
}

export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].lat;
    const yj = poly[j].lat;
    const xi = poly[i].lng;
    const xj = poly[j].lng;
    const intersect =
      yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return haversine(p, a);
  const t = Math.max(
    0,
    Math.min(1, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy)),
  );
  return haversine(p, { lat: a.lat + t * dy, lng: a.lng + t * dx });
}

export function distToPolyline(p: LatLng, path: LatLng[]): number {
  let min = Infinity;
  for (let i = 1; i < path.length; i++) min = Math.min(min, distToSegment(p, path[i - 1], path[i]));
  return min;
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function parseSchedule(raw: unknown): FenceSchedule | null {
  if (!raw) return null;
  const s = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!s || typeof s !== "object") return null;
  const rec = s as { days?: unknown; start?: unknown; end?: unknown };
  if (!Array.isArray(rec.days) || typeof rec.start !== "string" || typeof rec.end !== "string") return null;
  const days = rec.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6);
  if (days.length === 0) return null;
  return { days, start: rec.start, end: rec.end };
}

/** True when a fence should be evaluated. Null schedule means always on. Clock is Nairobi (EAT). */
export function scheduleIsOpen(schedule: FenceSchedule | null, now = new Date()): boolean {
  if (!schedule) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Nairobi",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const day = WEEKDAY[weekday.slice(0, 3)] ?? 0;
  if (!schedule.days.includes(day)) return false;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = hour * 60 + minute;
  const [sh, sm] = schedule.start.split(":").map(Number);
  const [eh, em] = schedule.end.split(":").map(Number);
  const start = (sh || 0) * 60 + (sm || 0);
  const end = (eh || 0) * 60 + (em || 0);
  if (start === end) return true;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

const PLACES: { name: string; lat: number; lng: number }[] = [
  { name: "Jomo Kenyatta International Airport", lat: -1.3194, lng: 36.9275 },
  { name: "Nairobi CBD", lat: -1.2864, lng: 36.8172 },
  { name: "Westlands", lat: -1.2673, lng: 36.811 },
  { name: "Industrial Area", lat: -1.3185, lng: 36.8448 },
  { name: "Nyayo Stadium", lat: -1.3047, lng: 36.8255 },
  { name: "Upper Hill", lat: -1.2994, lng: 36.8156 },
  { name: "Kilimani", lat: -1.292, lng: 36.787 },
  { name: "Karen", lat: -1.3196, lng: 36.71 },
  { name: "Embakasi", lat: -1.309, lng: 36.9 },
  { name: "Thika Superhighway", lat: -1.22, lng: 36.888 },
  { name: "Gigiri", lat: -1.234, lng: 36.81 },
  { name: "Mombasa Road", lat: -1.334, lng: 36.896 },
  { name: "South B", lat: -1.319, lng: 36.84 },
  { name: "Parklands", lat: -1.261, lng: 36.818 },
  { name: "Kasarani", lat: -1.226, lng: 36.896 },
  { name: "Syokimau", lat: -1.354, lng: 36.931 },
  { name: "Athi River junction", lat: -1.45, lng: 36.98 },
  { name: "University of Nairobi", lat: -1.279, lng: 36.817 },
  { name: "JKIA Cargo Terminal", lat: -1.327, lng: 36.914 },
  { name: "Eastern Bypass", lat: -1.286, lng: 36.92 },
];

export function reverseGeocode(lat: number, lng: number): string {
  let best = PLACES[0];
  let bestD = Infinity;
  for (const p of PLACES) {
    const d = haversine({ lat, lng }, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (bestD < 400) return best.name;
  return `${best.name} · ${(bestD / 1000).toFixed(1)} km`;
}

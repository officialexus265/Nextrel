import { useEffect, useRef, useState } from "react";
import type { PositionRow } from "@/lib/fleet/types";

export type PlaybackEvent = {
  id: string;
  kind: "alert" | "fuel" | "stop" | "behavior";
  type: string;
  title: string;
  ts: string;
  lat: number | null;
  lng: number | null;
  litres?: number;
};

const EVENT_COLOR: Record<string, string> = {
  speeding: "#c45c5c",
  fuel_drop: "#c45c5c",
  drop: "#c45c5c",
  offline: "#c45c5c",
  stop: "#c4923a",
  fill: "#3f9d78",
  geofence_enter: "#6f8fbf",
  geofence_exit: "#6f8fbf",
  geofence_dwell: "#c4923a",
  harsh_brake: "#c45c5c",
  harsh_accel: "#c4923a",
  harsh_corner: "#6f8fbf",
};

export function PlaybackMap({
  points,
  index,
  events = [],
  className,
}: {
  points: PositionRow[];
  index: number;
  events?: PlaybackEvent[];
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const [map, setMap] = useState<import("leaflet").Map | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    let created: import("leaflet").Map | null = null;
    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !hostRef.current) return;
      const start = points[0];
      created = L.map(hostRef.current, { zoomControl: true }).setView(
        start ? [start.lat, start.lng] : [-1.286, 36.82],
        13,
      );
      L.tileLayer("https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=cb1_58tw_1_1ac83981eb505a5d6d737364", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        maxZoom: 19,
      }).addTo(created);
      setMap(created);
      setTimeout(() => created?.invalidateSize(), 80);
    })();
    return () => {
      cancelled = true;
      created?.remove();
      markerRef.current = null;
      setMap(null);
    };
  }, [points]);

  useEffect(() => {
    if (!map || points.length === 0) return;
    let cancelled = false;
    let line: import("leaflet").Polyline | null = null;
    const dots: import("leaflet").CircleMarker[] = [];
    (async () => {
      const L = await import("leaflet");
      if (cancelled) return;
      const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
      line = L.polyline(latlngs, { color: "#3f9d78", weight: 3, opacity: 0.85 }).addTo(map);
      for (const e of events) {
        if (cancelled) break;
        if (e.lat == null || e.lng == null) continue;
        const color = EVENT_COLOR[e.type] ?? "#6f8fbf";
        const dot = L.circleMarker([e.lat, e.lng], {
          radius: e.kind === "stop" ? 4 : 6,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.85,
        })
          .bindTooltip(e.title, { direction: "top", opacity: 0.95 })
          .addTo(map);
        dots.push(dot);
      }
      if (cancelled) {
        line.remove();
        dots.forEach((d) => d.remove());
        return;
      }
      map.fitBounds(line.getBounds(), { padding: [28, 28] });
    })();
    return () => {
      cancelled = true;
      line?.remove();
      dots.forEach((d) => d.remove());
    };
  }, [map, points, events]);

  useEffect(() => {
    const p = points[index];
    if (!map || !p) return;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled) return;
      const html = `<div class="kestrel-marker" style="color:var(--color-live);transform:rotate(${p.heading}deg)"><span></span></div>`;
      const icon = L.divIcon({
        className: "bg-transparent border-0",
        html,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      if (!markerRef.current) {
        markerRef.current = L.marker([p.lat, p.lng], { icon, zIndexOffset: 500 }).addTo(map);
      } else {
        markerRef.current.setLatLng([p.lat, p.lng]);
        markerRef.current.setIcon(icon);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [map, index, points]);

  return <div ref={hostRef} className={className ?? "h-full w-full"} />;
}

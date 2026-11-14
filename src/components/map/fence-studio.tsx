import { useEffect, useRef, useState } from "react";
import type { GeofenceRow } from "@/lib/fleet/types";

export type FenceDraft = {
  kind: "circle" | "polygon" | "route";
  points: [number, number][];
  radiusM: number;
  widthM: number;
};

type Props = {
  fences: GeofenceRow[];
  draft: FenceDraft | null;
  drawing: boolean;
  selectedId: string | null;
  focus: [number, number] | null;
  onMapClick: (lat: number, lng: number) => void;
  onSelect: (id: string) => void;
  className?: string;
};

export function FenceStudioMap({
  fences,
  draft,
  drawing,
  selectedId,
  focus,
  onMapClick,
  onSelect,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const savedRef = useRef<import("leaflet").LayerGroup | null>(null);
  const draftRef = useRef<import("leaflet").LayerGroup | null>(null);
  const clickRef = useRef(onMapClick);
  const selectRef = useRef(onSelect);
  clickRef.current = onMapClick;
  selectRef.current = onSelect;
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !hostRef.current) return;
      const map = L.map(hostRef.current, { zoomControl: true, attributionControl: true }).setView([-1.286, 36.82], 12);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        maxZoom: 19,
      }).addTo(map);
      savedRef.current = L.layerGroup().addTo(map);
      draftRef.current = L.layerGroup().addTo(map);
      map.on("click", (e) => clickRef.current(e.latlng.lat, e.latlng.lng));
      mapRef.current = map;
      setReady(true);
      setTimeout(() => map.invalidateSize(), 80);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    const map = mapRef.current;
    if (!el || !map || !ready) return;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    const group = savedRef.current;
    if (!map || !group || !ready) return;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled) return;
      group.clearLayers();
      const bounds: [number, number][] = [];
      for (const g of fences) {
        if (!g.active && g.id !== selectedId) continue;
        const selected = g.id === selectedId;
        const color = g.zoneType === "forbidden" ? "var(--color-down)" : "var(--color-info)";
        const weight = selected ? 3 : 1.5;
        const opacity = g.active ? 1 : 0.35;
        const layer = drawGeom(L, g, { color, weight, opacity, interactive: !drawing });
        if (!layer) continue;
        layer.bindTooltip(g.name);
        if (!drawing) layer.on("click", () => selectRef.current(g.id));
        layer.addTo(group);
        collectBounds(g, bounds);
      }
      if (!fitted.current && bounds.length > 0 && !draft) {
        fitted.current = true;
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fences, selectedId, ready, drawing, draft]);

  useEffect(() => {
    const group = draftRef.current;
    if (!group || !ready) return;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled) return;
      group.clearLayers();
      if (!draft || draft.points.length === 0) return;
      const color = "var(--color-live)";
      if (draft.kind === "circle") {
        const [lat, lng] = draft.points[0];
        L.circle([lat, lng], { radius: draft.radiusM, color, weight: 2, fillOpacity: 0.12 }).addTo(group);
        L.circleMarker([lat, lng], { radius: 5, color, fillColor: color, fillOpacity: 1, weight: 0 }).addTo(group);
      } else if (draft.kind === "polygon") {
        const latlngs = draft.points.map(([lat, lng]) => [lat, lng] as [number, number]);
        if (latlngs.length >= 3) {
          L.polygon(latlngs, { color, weight: 2, fillOpacity: 0.12 }).addTo(group);
        } else if (latlngs.length >= 2) {
          L.polyline(latlngs, { color, weight: 2 }).addTo(group);
        }
        for (const p of latlngs) {
          L.circleMarker(p, { radius: 4, color, fillColor: color, fillOpacity: 1, weight: 0 }).addTo(group);
        }
      } else {
        const latlngs = draft.points.map(([lat, lng]) => [lat, lng] as [number, number]);
        L.polyline(latlngs, { color, weight: Math.max(6, draft.widthM / 28), opacity: 0.85 }).addTo(group);
        for (const p of latlngs) {
          L.circleMarker(p, { radius: 4, color, fillColor: color, fillOpacity: 1, weight: 0 }).addTo(group);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draft, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;
    map.panTo(focus, { animate: true });
  }, [focus, ready]);

  return <div ref={hostRef} className={className} />;
}

function drawGeom(
  L: typeof import("leaflet"),
  g: GeofenceRow,
  style: { color: string; weight: number; opacity: number; interactive: boolean },
) {
  const opts = { color: style.color, weight: style.weight, opacity: style.opacity, interactive: style.interactive };
  if (g.geometry.type === "circle") {
    return L.circle([g.geometry.lat, g.geometry.lng], { ...opts, radius: g.geometry.radiusM, fillOpacity: 0.08 });
  }
  if (g.geometry.type === "polygon") {
    return L.polygon(
      g.geometry.points.map(([lat, lng]) => [lat, lng] as [number, number]),
      { ...opts, fillOpacity: 0.08 },
    );
  }
  if (g.geometry.type === "route") {
    return L.polyline(
      g.geometry.path.map(([lat, lng]) => [lat, lng] as [number, number]),
      { ...opts, weight: Math.max(style.weight + 2, g.geometry.widthM / 32) },
    );
  }
  return null;
}

function collectBounds(g: GeofenceRow, bounds: [number, number][]) {
  if (g.geometry.type === "circle") bounds.push([g.geometry.lat, g.geometry.lng]);
  else if (g.geometry.type === "polygon") bounds.push(...g.geometry.points);
  else bounds.push(...g.geometry.path);
}

import { useEffect, useRef, useState } from "react";
import type { GeofenceRow, LiveVehicle } from "@/lib/fleet/types";
import { movementColor } from "@/components/fleet/status";

type Props = {
  vehicles: LiveVehicle[];
  geofences: GeofenceRow[];
  selectedId: string | null;
  follow: boolean;
  fitNonce: number;
  onSelect: (id: string) => void;
  className?: string;
};

export function LiveMap({ vehicles, geofences, selectedId, follow, fitNonce, onSelect, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<Map<string, import("leaflet").Marker>>(new Map());
  const geoRef = useRef<import("leaflet").LayerGroup | null>(null);
  const trailRef = useRef<import("leaflet").Polyline | null>(null);
  const historyRef = useRef<Map<string, [number, number][]>>(new Map());
  const fittedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !hostRef.current) return;
      const map = L.map(hostRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([-1.286, 36.82], 12);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        maxZoom: 19,
      }).addTo(map);
      geoRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
      setTimeout(() => map.invalidateSize(), 80);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current.clear();
      trailRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = geoRef.current;
    if (!map || !group || !ready) return;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled) return;
      group.clearLayers();
      for (const g of geofences) {
        const color = g.zoneType === "forbidden" ? "var(--color-down)" : "var(--color-info)";
        if (g.geometry.type === "circle") {
          L.circle([g.geometry.lat, g.geometry.lng], {
            radius: g.geometry.radiusM,
            color,
            weight: 1.5,
            fillOpacity: 0.08,
          })
            .bindTooltip(g.name)
            .addTo(group);
        } else if (g.geometry.type === "polygon") {
          L.polygon(
            g.geometry.points.map(([lat, lng]) => [lat, lng] as [number, number]),
            { color, weight: 1.5, fillOpacity: 0.08 },
          )
            .bindTooltip(g.name)
            .addTo(group);
        } else if (g.geometry.type === "route") {
          L.polyline(
            g.geometry.path.map(([lat, lng]) => [lat, lng] as [number, number]),
            { color, weight: Math.max(4, g.geometry.widthM / 30), opacity: 0.35 },
          )
            .bindTooltip(g.name)
            .addTo(group);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [geofences, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled) return;
      const seen = new Set<string>();
      for (const v of vehicles) {
        seen.add(v.id);
        const hist = historyRef.current.get(v.id) ?? [];
        const last = hist[hist.length - 1];
        if (!last || Math.abs(last[0] - v.lat) > 0.00002 || Math.abs(last[1] - v.lng) > 0.00002) {
          hist.push([v.lat, v.lng]);
          if (hist.length > 48) hist.shift();
          historyRef.current.set(v.id, hist);
        }
        const selected = selectedId === v.id;
        const html = `<div class="kestrel-pin${selected ? " is-selected" : ""}"><div class="kestrel-marker" style="color:${movementColor(v.movement)};transform:rotate(${v.heading}deg)"><span></span></div><div class="kestrel-plate">${escapeHtml(v.plate)}</div></div>`;
        const icon = L.divIcon({
          className: "bg-transparent border-0",
          html,
          iconSize: [78, 44],
          iconAnchor: [39, 14],
        });
        let marker = markersRef.current.get(v.id);
        if (!marker) {
          marker = L.marker([v.lat, v.lng], { icon, zIndexOffset: 600 }).addTo(map);
          marker.on("click", () => onSelectRef.current(v.id));
          markersRef.current.set(v.id, marker);
        } else {
          marker.setLatLng([v.lat, v.lng]);
          marker.setIcon(icon);
        }
        marker.setZIndexOffset(selected ? 1200 : 600);
        marker.bindTooltip(`${v.name} · ${v.speed.toFixed(0)} km/h · ${v.movement}`, {
          direction: "top",
          offset: [0, -16],
        });
      }
      for (const [id, marker] of markersRef.current) {
        if (!seen.has(id)) {
          marker.remove();
          markersRef.current.delete(id);
          historyRef.current.delete(id);
        }
      }

      const trail = selectedId ? (historyRef.current.get(selectedId) ?? []) : [];
      if (trail.length > 1) {
        if (!trailRef.current) {
          trailRef.current = L.polyline(trail, {
            color: "var(--color-accent)",
            weight: 3,
            opacity: 0.85,
          }).addTo(map);
        } else {
          trailRef.current.setLatLngs(trail);
        }
      } else if (trailRef.current) {
        trailRef.current.remove();
        trailRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vehicles, selectedId, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || vehicles.length === 0) return;
    if (fittedRef.current) return;
    fittedRef.current = true;
    void fitFleet(map, vehicles);
  }, [vehicles, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || fitNonce === 0) return;
    void fitFleet(map, vehicles);
  }, [fitNonce, ready, vehicles]);

  useEffect(() => {
    if (!follow || !selectedId || !mapRef.current) return;
    const v = vehicles.find((x) => x.id === selectedId);
    if (!v) return;
    mapRef.current.panTo([v.lat, v.lng], { animate: true });
  }, [selectedId, vehicles, follow]);

  return <div ref={hostRef} className={className ?? "h-full w-full"} />;
}

async function fitFleet(map: import("leaflet").Map, vehicles: LiveVehicle[]) {
  if (vehicles.length === 0) return;
  const L = await import("leaflet");
  const bounds = L.latLngBounds(vehicles.map((v) => [v.lat, v.lng] as [number, number]));
  map.fitBounds(bounds.pad(0.18), { animate: true, maxZoom: 14 });
  setTimeout(() => map.invalidateSize(), 60);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&" + "amp;")
    .replaceAll("<", "&" + "lt;")
    .replaceAll(">", "&" + "gt;")
    .replaceAll('"', "&" + "quot;")
    .replaceAll("'", "&" + "#39;");
}

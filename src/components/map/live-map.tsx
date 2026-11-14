import { useEffect, useRef, useState } from "react";
import type { GeofenceRow, LiveVehicle, MapCenter } from "@/lib/fleet/types";
import { movementColor } from "@/components/fleet/status";

type Props = {
  vehicles: LiveVehicle[];
  geofences: GeofenceRow[];
  selectedId: string | null;
  follow: boolean;
  fitNonce: number;
  mapCenter: MapCenter;
  onSelect: (id: string) => void;
  className?: string;
};

export function LiveMap({ vehicles, geofences, selectedId, follow, fitNonce, mapCenter, onSelect, className }: Props) {
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
  const [baseMap, setBaseMap] = useState<"street" | "voyager" | "satellite">("street");
  const tileRef = useRef<import("leaflet").TileLayer | null>(null);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !hostRef.current) return;
      const initialZoom = mapCenter.label === "Malawi" ? 6 : 12;
      const map = L.map(hostRef.current, { zoomControl: false, attributionControl: true })
        .setView([mapCenter.lat, mapCenter.lng], initialZoom);
      tileRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
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
      tileRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setView([mapCenter.lat, mapCenter.lng], mapCenter.label === "Malawi" ? 6 : 12, { animate: false });
  }, [mapCenter.lat, mapCenter.lng, mapCenter.label, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    void import("leaflet").then((L) => {
      tileRef.current?.remove();
      const layers = {
        street: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }),
        voyager: L.tileLayer("https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "&copy; OpenStreetMap &copy; CARTO", maxZoom: 20 }),
        satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles &copy; Esri", maxZoom: 19 }),
      };
      tileRef.current = layers[baseMap].addTo(map);
    });
  }, [baseMap, ready]);
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
    if (!map || !ready || fitNonce === 0) return;
    void fitFleet(map, vehicles);
  }, [fitNonce, ready, vehicles]);

  useEffect(() => {
    if (!follow || !selectedId || !mapRef.current) return;
    const v = vehicles.find((x) => x.id === selectedId);
    if (!v) return;
    mapRef.current.panTo([v.lat, v.lng], { animate: true });
  }, [selectedId, vehicles, follow]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className={className ?? "h-full w-full"} />
      <div className="absolute right-3 top-3 z-[700] flex flex-col gap-2">
        <div className="overflow-hidden rounded-md border border-border bg-surface/95 shadow-md backdrop-blur">
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => mapRef.current?.zoomIn()} className="grid size-9 place-items-center border-b border-border text-xl leading-none hover:bg-surface-2">+</button>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => mapRef.current?.zoomOut()} className="grid size-9 place-items-center text-xl leading-none hover:bg-surface-2">−</button>
        </div>
        <select aria-label="Map type" title="Choose map type" value={baseMap} onChange={(event) => setBaseMap(event.target.value as typeof baseMap)} className="h-9 rounded-md border border-border bg-surface/95 px-2 text-xs font-medium text-fg shadow-md backdrop-blur">
          <option value="street">Street</option><option value="voyager">Light</option><option value="satellite">Satellite</option>
        </select>
      </div>
    </div>
  );
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

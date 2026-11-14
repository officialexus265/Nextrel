import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Crosshair, Fuel, Gauge, MapPin, Navigation, Radio, Search, X } from "lucide-react";
import { getLiveFleet } from "@/lib/fleet/api";
import { LiveMap } from "@/components/map/live-map";
import { StatusChip } from "@/components/fleet/status";
import { Input } from "@/components/ui/input";
import { formatAgo, formatKm, formatLitres, formatSpeed, cn } from "@/lib/utils";
import type { LivePulse, LiveVehicle } from "@/lib/fleet/types";

export const Route = createFileRoute("/ops/")({ component: LiveOps });

function LiveOps() {
  const q = useQuery({
    queryKey: ["live-fleet"],
    queryFn: () => getLiveFleet(),
    refetchInterval: 4000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | LiveVehicle["movement"]>("all");
  const [follow, setFollow] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);

  const vehicles = q.data?.vehicles ?? [];
  const geofences = q.data?.geofences ?? [];
  const kpis = q.data?.kpis;
  const pulse = q.data?.pulse ?? [];
  const signals = q.data?.signals ?? [];
  const selected = vehicles.find((v) => v.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    return vehicles.filter((v) => {
      if (filter !== "all" && v.movement !== filter) return false;
      if (!query) return true;
      const hay = `${v.name} ${v.plate} ${v.driverName ?? ""} ${v.companyName}`.toLowerCase();
      return hay.includes(query.toLowerCase());
    });
  }, [vehicles, filter, query]);

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col md:h-[calc(100dvh-3.5rem)]">
      <div className="grid grid-cols-3 gap-px border-b border-border bg-border sm:grid-cols-6">
        <Kpi label="Vehicles" value={kpis?.vehicles ?? "—"} />
        <Kpi label="Moving" value={kpis?.moving ?? "—"} tone="live" />
        <Kpi label="Idling" value={kpis?.idle ?? "—"} tone="idle" />
        <Kpi label="Stopped" value={vehicles.filter((v) => v.movement === "stopped").length || (q.data ? 0 : "—")} tone="down" />
        <Kpi label="Offline" value={kpis?.offline ?? "—"} tone="down" />
        <Kpi label="Open alerts" value={kpis?.openAlerts ?? "—"} tone={kpis?.criticalAlerts ? "down" : "muted"} />
      </div>
      <div className="flex items-center gap-3 overflow-x-auto border-b border-border bg-surface px-3 py-2 text-xs text-muted">
        <span className="shrink-0 tabular">24h {kpis ? formatKm(kpis.distance24h) : "—"}</span>
        <span className={cn("shrink-0", kpis?.fuelDrops24h ? "text-down" : "")}>
          {kpis?.fuelDrops24h ?? "—"} fuel drop{kpis?.fuelDrops24h === 1 ? "" : "s"}
        </span>
        {q.data?.paused?.length ? (
          <span className="shrink-0 text-idle">Paused: {q.data.paused.join(" · ")}</span>
        ) : null}
        {kpis?.criticalAlerts ? <span className="shrink-0 text-down">{kpis.criticalAlerts} critical</span> : null}
        <span className="hidden h-3 w-px shrink-0 bg-border sm:block" />
        {pulse.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => a.vehicleId && setSelectedId(a.vehicleId)}
            className="shrink-0 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-fg"
          >
            <PulseDot severity={a.severity} />
            {a.title}
          </button>
        ))}
        {signals.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelectedId(a.vehicleId)}
            className="shrink-0 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-fg"
          >
            <PulseDot severity={a.severity} />
            {a.title}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="relative min-h-0 min-w-0 flex-1">
          {q.data ? (
            <LiveMap
              vehicles={vehicles}
              geofences={geofences}
              selectedId={selectedId}
              follow={follow}
              fitNonce={fitNonce}
              mapCenter={q.data.mapCenter}
              onSelect={setSelectedId}
              className="h-full w-full"
            />
          ) : (
            <div className="grid h-full place-items-center text-muted">{q.isError ? "Map failed to load." : "Loading map…"}</div>
          )}
          <div className="pointer-events-none absolute left-3 top-3 z-[500] flex flex-col gap-2">
            <div className="pointer-events-auto flex overflow-hidden rounded-[var(--radius-sm)] border border-border bg-surface/95 text-[11px] uppercase tracking-wide backdrop-blur">
              <Legend swatch="bg-live" label="Moving" />
              <Legend swatch="bg-idle" label="Idle" />
              <Legend swatch="bg-down" label="Stop" />
            </div>
            <div className="pointer-events-auto flex gap-1">
              <button
                type="button"
                onClick={() => setFitNonce((n) => n + 1)}
                className="inline-flex h-9 items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-surface/95 px-2.5 text-xs backdrop-blur"
              >
                <Crosshair className="size-3.5" /> Fit fleet
              </button>
              <button
                type="button"
                onClick={() => setFollow((f) => !f)}
                className={cn(
                  "inline-flex h-9 items-center rounded-[var(--radius-sm)] border px-2.5 text-xs backdrop-blur",
                  follow ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface/95",
                )}
              >
                Follow
              </button>
            </div>
          </div>
          {selected && (
            <aside className="absolute inset-x-3 bottom-3 z-[500] max-h-[46%] overflow-auto rounded-[var(--radius-lg)] border border-border bg-surface/95 p-4 backdrop-blur md:inset-x-auto md:bottom-4 md:right-4 md:w-80">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{selected.name}</div>
                  <div className="font-mono text-xs text-muted">{selected.plate}</div>
                </div>
                <button type="button" className="rounded-[var(--radius-xs)] p-1 text-muted hover:bg-surface-2" onClick={() => setSelectedId(null)}>
                  <X className="size-4" />
                </button>
              </div>
              <StatusChip movement={selected.movement} durationMs={selected.durationMs} />
              {selected.openAlerts > 0 && (
                <Link to="/ops/alerts" className="ml-2 text-xs text-down">
                  {selected.openAlerts} open
                </Link>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <Fact icon={Gauge} label="Speed" value={formatSpeed(selected.speed)} />
                <Fact icon={Fuel} label="Fuel" value={selected.fuelLevel != null ? `${Math.round(selected.fuelLevel)}% · ${formatLitres(selected.fuelLitres)}` : "—"} />
                <Fact icon={Navigation} label="Heading" value={`${Math.round(selected.heading)}°`} />
                <Fact icon={Radio} label="Ignition" value={selected.ignition ? "On" : "Off"} />
              </dl>
              <div className="mt-3 flex items-start gap-2 text-sm text-muted">
                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                <span>{selected.address ?? "Locating…"}</span>
              </div>
              <div className="mt-3 text-xs text-subtle">
                {selected.driverName ?? "Unassigned"} · {selected.companyName}
                <div className="mt-1">Updated {formatAgo(selected.ts)} · limit {selected.speedLimit} km/h</div>
                <div className="font-mono mt-1">IMEI {selected.deviceImei ?? "—"}</div>
              </div>
              <Link
                to="/ops/vehicles/$vehicleId"
                params={{ vehicleId: selected.id }}
                className="mt-3 inline-flex h-9 items-center text-sm text-info"
              >
                Open unit file
              </Link>
            </aside>
          )}
        </section>
        <aside className="flex h-[42%] min-h-0 w-full shrink-0 flex-col border-t border-border bg-surface lg:hidden">
          <FleetFilters query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} />
          <FleetList vehicles={filtered} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
        <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-surface lg:flex">
          <FleetFilters query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} />
          <FleetList vehicles={filtered} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1.5">
      <span className={cn("size-1.5 rounded-full", swatch)} />
      {label}
    </span>
  );
}

function PulseDot({ severity }: { severity: LivePulse["severity"] }) {
  return (
    <span
      className={cn(
        "mr-1 inline-block size-1.5 rounded-full align-middle",
        severity === "critical" ? "bg-down" : severity === "warning" ? "bg-idle" : "bg-info",
      )}
    />
  );
}

function FleetFilters({
  query,
  setQuery,
  filter,
  setFilter,
}: {
  query: string;
  setQuery: (v: string) => void;
  filter: "all" | LiveVehicle["movement"];
  setFilter: (v: "all" | LiveVehicle["movement"]) => void;
}) {
  return (
    <div className="space-y-2 border-b border-border p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input className="pl-8" placeholder="Search plate, unit, driver" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1">
        {(["all", "moving", "idle", "stopped", "offline"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "h-8 rounded-full border px-2.5 text-[11px] uppercase tracking-wide",
              filter === f ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg",
            )}
          >
            {f}
          </button>
        ))}
      </div>
    </div>
  );
}

function FleetList({
  vehicles,
  selectedId,
  onSelect,
}: {
  vehicles: LiveVehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {vehicles.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onSelect(v.id)}
          className={cn(
            "flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left hover:bg-surface-2",
            selectedId === v.id && "bg-surface-2",
          )}
        >
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full"
            style={{
              background:
                v.movement === "moving" ? "var(--color-live)" : v.movement === "idle" ? "var(--color-idle)" : "var(--color-down)",
            }}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-sm font-medium">{v.plate}</span>
              <span className="tabular text-xs text-muted">{formatSpeed(v.speed)}</span>
            </span>
            <span className="block truncate text-xs text-muted">
              {v.name}
              {v.openAlerts > 0 ? ` · ${v.openAlerts} alert${v.openAlerts === 1 ? "" : "s"}` : ""}
            </span>
            <span className="mt-1 block">
              <StatusChip movement={v.movement} durationMs={v.durationMs} />
            </span>
          </span>
        </button>
      ))}
      {vehicles.length === 0 && <div className="p-6 text-sm text-muted">No vehicles match.</div>}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="bg-surface px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-subtle">{label}</div>
      <div className={cn("tabular text-xl font-semibold", tone === "live" && "text-live", tone === "idle" && "text-idle", tone === "down" && "text-down")}>
        {value}
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] bg-surface-2 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-subtle">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="mt-0.5 tabular text-sm">{value}</div>
    </div>
  );
}
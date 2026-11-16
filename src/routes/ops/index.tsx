import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useRef } from "react";
import { Activity, Bell, CircleStop, Crosshair, Fuel, Gauge, MapPin, Navigation, PauseCircle, Radio, RefreshCw, Search, Truck, WifiOff, X } from "lucide-react";
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
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
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
  const contextVehicle = vehicles.find((v) => v.id === contextMenuId) ?? null;
  const openVehicleActions = (id: string) => {
    setSelectedId(id);
    setContextMenuId(id);
  };

  const filtered = useMemo(() => {
    return vehicles.filter((v) => {
      if (filter !== "all" && v.movement !== filter) return false;
      if (!query) return true;
      const normalize = (value: string) => value.toLowerCase().replace(/[\\s-]/g, "");
      const hay = normalize(`${v.name} ${v.plate} ${v.driverName ?? ""} ${v.companyName} ${v.deviceImei ?? ""}`);
      return hay.includes(normalize(query));
    });
  }, [vehicles, filter, query]);

  return (
    <div className="min-h-full space-y-4 p-3 md:space-y-5 md:p-5">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-live">Operations / Live monitoring</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-[1.7rem]">Live fleet</h1>
          <p className="mt-1 text-sm text-muted">{vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"} in your monitored fleet</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-subtle sm:inline-flex"><span className="size-1.5 animate-pulse rounded-full bg-live" /> Refreshes every 4 seconds</span>
          <button type="button" onClick={() => q.refetch()} disabled={q.isFetching} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50">
            <RefreshCw className={cn("size-3.5", q.isFetching && "animate-spin")} /> Refresh
          </button>
        </div>
      </section>
      {q.isError && <div role="alert" className="rounded-[var(--radius-md)] border border-down/30 bg-down/10 px-4 py-3 text-sm text-down">Live fleet data could not be refreshed. Showing the last available data, if any.</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={Truck} label="Vehicles" value={kpis?.vehicles ?? "—"} detail="Registered units" />
        <Kpi icon={Activity} label="Moving" value={kpis?.moving ?? "—"} tone="live" detail="On the road" />
        <Kpi icon={PauseCircle} label="Idling" value={kpis?.idle ?? "—"} tone="idle" detail="Engine on, stationary" />
        <Kpi icon={CircleStop} label="Stopped" value={vehicles.filter((v) => v.movement === "stopped").length || (q.data ? 0 : "—")} detail="Parked or stationary" />
        <Kpi icon={WifiOff} label="Offline" value={kpis?.offline ?? "—"} tone="down" detail="No recent signal" />
        <Kpi icon={Bell} label="Open alerts" value={kpis?.openAlerts ?? "—"} tone={kpis?.criticalAlerts ? "down" : "muted"} detail={kpis?.criticalAlerts ? `${kpis.criticalAlerts} critical` : "Needs attention"} />
      </div>
      <section className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5 text-xs text-muted">
        <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-subtle">Live activity</span>
        <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 tabular">24h distance · {kpis ? formatKm(kpis.distance24h) : "—"}</span>
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
            {a.title}{a.plate ? ` · ${a.plate}` : ""}
          </button>
        ))}
        {signals.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelectedId(a.vehicleId)}
            className="shrink-0 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-fg transition-colors hover:border-border-strong hover:bg-surface-3"
          >
            <PulseDot severity={a.severity} />
            {a.title} · {a.plate}
          </button>
        ))}
        {!pulse.length && !signals.length && <span className="text-subtle">No new activity to report.</span>}
      </section>
      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="relative h-[56vh] min-h-[420px] min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-panel)] lg:h-[calc(100dvh-20rem)] lg:min-h-[520px]">
          {q.data ? (
            <LiveMap
              vehicles={vehicles}
              geofences={geofences}
              selectedId={selectedId}
              follow={follow}
              fitNonce={fitNonce}
              mapCenter={q.data.mapCenter}
              onSelect={setSelectedId}
              onContextMenu={openVehicleActions}
              className="h-full w-full"
            />
          ) : (
            <div className="grid h-full place-items-center text-muted">{q.isError ? "Map failed to load." : "Loading map…"}</div>
          )}
          {contextVehicle && (
            <div className="absolute right-3 top-14 z-[900] w-48 rounded-[var(--radius-md)] border border-border bg-surface p-2 shadow-xl" role="menu" aria-label={`Actions for ${contextVehicle.plate}`}>
              <div className="truncate px-2 pb-2 text-xs font-semibold text-muted">{contextVehicle.plate}</div>
              <button type="button" role="menuitem" onClick={() => { setSelectedId(contextVehicle.id); setContextMenuId(null); }} className="flex h-9 w-full items-center rounded-[var(--radius-sm)] px-2 text-left text-sm hover:bg-surface-2">View / quick inspection</button>
              <a role="menuitem" href={`/ops/playback?vehicleId=${encodeURIComponent(contextVehicle.id)}`} className="flex h-9 items-center rounded-[var(--radius-sm)] px-2 text-sm hover:bg-surface-2">Playback history</a>
              <Link role="menuitem" to="/ops/vehicles/$vehicleId" params={{ vehicleId: contextVehicle.id }} onClick={() => setContextMenuId(null)} className="flex h-9 items-center rounded-[var(--radius-sm)] px-2 text-sm hover:bg-surface-2">Open unit file</Link>
              <button type="button" onClick={() => setContextMenuId(null)} className="mt-1 flex h-8 w-full items-center justify-center rounded-[var(--radius-sm)] text-xs text-muted hover:bg-surface-2">Close</button>
            </div>
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
            <aside className="absolute inset-x-3 bottom-3 z-[500] max-h-[72%] overflow-auto rounded-[var(--radius-lg)] border border-border bg-surface/95 p-4 backdrop-blur md:inset-x-auto md:bottom-4 md:right-4 md:w-80">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-live">Quick inspection</div>
                  <div className="mt-1 text-sm font-semibold">{selected.name}</div>
                  <div className="font-mono text-xs text-muted">{selected.plate}</div>
                </div>
                <button type="button" aria-label="Close vehicle details" className="rounded-[var(--radius-xs)] p-1 text-muted hover:bg-surface-2" onClick={() => setSelectedId(null)}>
                  <X className="size-4" />
                </button>
              </div>
              <div className="mb-3 h-32 overflow-hidden rounded-[var(--radius-sm)] border border-border">
                <LiveMap
                  vehicles={[selected]}
                  geofences={[]}
                  selectedId={selected.id}
                  follow={true}
                  fitNonce={0}
                  mapCenter={{ lat: selected.lat, lng: selected.lng, label: selected.plate }}
                  onSelect={() => setSelectedId(selected.id)}
                  className="h-full w-full"
                />
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
        <aside className="flex max-h-[440px] min-h-[320px] w-full shrink-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface lg:hidden">
          <FleetFilters query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} count={filtered.length} />
          <FleetList vehicles={filtered} selectedId={selectedId} onSelect={setSelectedId} onContextMenu={openVehicleActions} />
        </aside>
        <aside className="hidden min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface lg:flex">
          <FleetFilters query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} count={filtered.length} />
          <FleetList vehicles={filtered} selectedId={selectedId} onSelect={setSelectedId} onContextMenu={openVehicleActions} />
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
  count,
}: {
  query: string;
  setQuery: (v: string) => void;
  filter: "all" | LiveVehicle["movement"];
  setFilter: (v: "all" | LiveVehicle["movement"]) => void;
  count: number;
}) {
  return (
    <div className="space-y-3 border-b border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Fleet vehicles</div>
          <div className="mt-0.5 text-[11px] text-subtle">Live status and telemetry</div>
        </div>
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium tabular text-muted">{count} units</span>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input className="pl-8" placeholder="Search plate, unit, driver or IMEI" value={query} onChange={(e) => setQuery(e.target.value)} />
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
  onContextMenu,
}: {
  vehicles: LiveVehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (id: string) => void;
}) {
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  const lastRightClick = useRef<{ id: string; at: number }>({ id: "", at: 0 });
  const clearLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {vehicles.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => { if (longPressTriggered.current) { longPressTriggered.current = false; return; } onSelect(v.id); }}
          onTouchStart={() => { longPressTriggered.current = false; clearLongPress(); longPressTimer.current = window.setTimeout(() => { longPressTriggered.current = true; onContextMenu(v.id); }, 550); }}
          onTouchEnd={clearLongPress}
          onTouchMove={clearLongPress}
          onContextMenu={(event) => { event.preventDefault(); const now = Date.now(); if (lastRightClick.current.id === v.id && now - lastRightClick.current.at < 500) onContextMenu(v.id); lastRightClick.current = { id: v.id, at: now }; }}
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

function Kpi({ icon: Icon, label, value, detail, tone }: { icon: typeof Truck; label: string; value: number | string; detail: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] border border-border bg-surface p-3 shadow-[var(--shadow-panel)] transition-colors hover:border-border-strong sm:p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle">{label}</div>
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-surface-2 text-muted", tone === "live" && "bg-live/10 text-live", tone === "idle" && "bg-idle/10 text-idle", tone === "down" && "bg-down/10 text-down")}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <div className={cn("mt-2 tabular text-2xl font-semibold tracking-tight", tone === "live" && "text-live", tone === "idle" && "text-idle", tone === "down" && "text-down")}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-subtle">{detail}</div>
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
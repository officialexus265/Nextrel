import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getAppSession, getFleetBrief } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ops/brief")({ component: BriefPage });

const WINDOWS = [
  { id: "day", label: "24 hours" },
  { id: "week", label: "7 days" },
  { id: "month", label: "30 days" },
] as const;

function BriefPage() {
  const session = useQuery({ queryKey: ["app-session"], queryFn: () => getAppSession() });
  const [window, setWindow] = useState<(typeof WINDOWS)[number]["id"]>("week");
  const blocked = session.data && ["accounts", "pending", "field_admin"].includes(session.data.role);
  const q = useQuery({
    queryKey: ["fleet-brief", window],
    queryFn: () => getFleetBrief({ data: { window } }),
    enabled: Boolean(session.data) && !blocked,
  });

  if (blocked) {
    return (
      <div>
        <PageHeader title="Shift brief" subtitle="Operational totals stay with trackers and company admins." />
        <p className="px-4 text-sm text-muted md:px-6">Your role uses billing and usage, not the live fleet.</p>
      </div>
    );
  }

  const data = q.data;
  const multi = new Set(data?.vehicles.map((v) => v.companyName) ?? []).size > 1;

  return (
    <div className="pb-8">
      <PageHeader
        title="Shift brief"
        subtitle="Distance, fuel, idle, and fence activity. Nairobi time."
        actions={
          <div className="flex rounded-[var(--radius-md)] bg-surface-2 p-1">
            {WINDOWS.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setWindow(w.id)}
                className={cn(
                  "h-8 rounded-[var(--radius-sm)] px-3 text-sm text-muted",
                  window === w.id && "bg-surface text-fg",
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-px border-y border-border bg-border sm:grid-cols-4">
        <Kpi label="Distance" value={data ? `${data.distanceKm.toLocaleString()} km` : "—"} />
        <Kpi label="Fuel used" value={data ? `${data.fuelUsed.toLocaleString()} L` : "—"} detail={data?.efficiency != null ? `${data.efficiency} L/100 km` : undefined} />
        <Kpi label="Idle" value={data ? formatMin(data.idleMin) : "—"} detail={data ? `${data.movingHours} h moving` : undefined} />
        <Kpi label="Trips" value={data ? String(data.tripCount) : "—"} />
        <Kpi label="Speeding" value={data ? String(data.speeding) : "—"} tone={data?.speeding ? "down" : "muted"} />
        <Kpi label="Offline" value={data ? String(data.offline) : "—"} tone={data?.offline ? "idle" : "muted"} />
        <Kpi label="Fence events" value={data ? String(data.geofenceCount) : "—"} />
        <Kpi label="Fuel events" value={data ? `${data.fuelDrops} drop · ${data.fuelFills} fill` : "—"} tone={data?.fuelDrops ? "down" : "muted"} />
      </div>

      <div className="mt-6 grid gap-4 px-4 lg:grid-cols-5 md:px-6">
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 lg:col-span-3">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Distance</h2>
            <span className="text-xs text-subtle">{window === "day" ? "By hour" : "By day"}</span>
          </div>
          <div className="h-52">
            {data ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.buckets}>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                    interval={window === "day" ? 3 : window === "month" ? 4 : 0}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis width={36} tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "var(--color-surface-2)" }}
                    contentStyle={{
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      color: "var(--color-fg)",
                      fontSize: 12,
                    }}
                    formatter={(v, name) => [name === "distanceKm" ? `${v} km` : String(v), name === "distanceKm" ? "Distance" : "Alerts"]}
                  />
                  <Bar dataKey="distanceKm" fill="var(--color-live)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted">{q.isError ? "Could not load the brief." : "Loading…"}</div>
            )}
          </div>
        </section>

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface lg:col-span-2">
          <h2 className="px-4 pt-4 text-sm font-medium">Units by distance</h2>
          <ul className="mt-2 divide-y divide-border">
            {(data?.vehicles ?? []).map((v) => (
              <li key={v.id}>
                <Link
                  to="/ops/vehicles/$vehicleId"
                  params={{ vehicleId: v.id }}
                  className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{v.name}</div>
                    <div className="truncate text-xs text-muted">
                      {v.plate}
                      {multi ? ` · ${v.companyName}` : ""}
                      {v.alerts > 0 ? ` · ${v.alerts} alerts` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tabular text-sm">{v.distanceKm} km</div>
                    <div className="tabular text-xs text-muted">{v.fuelUsed} L</div>
                  </div>
                </Link>
              </li>
            ))}
            {data && data.vehicles.length === 0 && <li className="px-4 py-6 text-sm text-muted">No trips in this window.</li>}
          </ul>
        </section>
      </div>

      <div className="mt-4 grid gap-4 px-4 lg:grid-cols-3 md:px-6">
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
          <h2 className="text-sm font-medium">Geofences</h2>
          <ul className="mt-3 space-y-3">
            {(data?.fences ?? []).map((f) => (
              <li key={f.name} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <div>{f.name}</div>
                  <div className="text-xs text-muted">
                    {f.enters} in · {f.exits} out{f.dwells ? ` · ${f.dwells} dwell` : ""}
                  </div>
                </div>
                <Badge tone={f.zoneType === "forbidden" ? "down" : "info"}>{f.zoneType}</Badge>
              </li>
            ))}
            {data && data.fences.length === 0 && <li className="text-sm text-muted">No fence crossings in this window.</li>}
          </ul>
        </section>

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
          <h2 className="text-sm font-medium">Fuel events</h2>
          <ul className="mt-3 space-y-3">
            {(data?.fuelEvents ?? []).map((f) => (
              <li key={f.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone={f.kind === "drop" ? "down" : "live"}>{f.kind}</Badge>
                  <span className="tabular">{f.litres} L</span>
                </div>
                <div className="mt-1 text-muted">
                  {f.vehicleName} · {f.plate}
                </div>
                <div className="text-xs text-subtle">
                  {f.notes ? `${f.notes} · ` : ""}
                  {new Date(f.ts).toLocaleString()}
                </div>
              </li>
            ))}
            {data && data.fuelEvents.length === 0 && <li className="text-sm text-muted">No fills or drops logged.</li>}
          </ul>
        </section>

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
          <h2 className="text-sm font-medium">Documents due</h2>
          <ul className="mt-3 space-y-3">
            {(data?.documents ?? []).map((d) => {
              const soon = new Date(d.expiresOn).getTime() - Date.now() < 45 * 86400000;
              return (
                <li key={d.id} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <div>{d.title}</div>
                    <div className="text-xs text-muted">{d.vehicleName ?? "Fleet"} · {d.kind}</div>
                  </div>
                  <Badge tone={soon ? "idle" : "muted"}>{d.expiresOn}</Badge>
                </li>
              );
            })}
            {data && data.documents.length === 0 && <li className="text-sm text-muted">Nothing expiring in the next 90 days.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  detail,
  tone = "muted",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "muted" | "down" | "idle";
}) {
  return (
    <div className="bg-bg px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-subtle">{label}</div>
      <div className={cn("tabular text-lg font-semibold", tone === "down" && "text-down", tone === "idle" && "text-idle")}>{value}</div>
      {detail && <div className="text-xs text-muted">{detail}</div>}
    </div>
  );
}

function formatMin(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

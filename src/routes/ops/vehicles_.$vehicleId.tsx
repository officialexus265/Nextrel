import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { assignDriver, getAppSession, getVehicleDossier, listDrivers, logFuel, updateFuelEvent, deleteFuelEvent, queueDeviceCommand, deleteDocument, saveDocument, setSpeedLimit } from "@/lib/fleet/api";
import { commandLabel } from "@/lib/fleet/labels";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAgo, formatKm, formatLitres, formatSpeed } from "@/lib/utils";

export const Route = createFileRoute("/ops/vehicles_/$vehicleId")({ component: VehicleFile });

function VehicleFile() {
  const { vehicleId } = Route.useParams();
  const qc = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [fuelOpen, setFuelOpen] = useState(false);
  const [editingFuelId, setEditingFuelId] = useState<string | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [kind, setKind] = useState<"fill" | "drop">("fill");
  const [litres, setLitres] = useState("");
  const [notes, setNotes] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docKind, setDocKind] = useState<"insurance" | "registration" | "permit" | "service">("insurance");
  const [docExpiry, setDocExpiry] = useState("");
  const [limit, setLimit] = useState("");
  useEffect(() => setMounted(true), []);
  const session = useQuery({ queryKey: ["app-session"], queryFn: () => getAppSession() });
  const canLog = session.data?.role === "company_admin" || session.data?.role === "super_admin";
  const canSoft =
    session.data?.role === "company_admin" ||
    session.data?.role === "super_admin" ||
    session.data?.role === "field_admin" ||
    session.data?.role === "tracker";
  const canHard = canLog || session.data?.role === "field_admin";
  const drivers = useQuery({
    queryKey: ["drivers"],
    queryFn: () => listDrivers(),
    enabled: canLog,
  });
  const q = useQuery({
    queryKey: ["dossier", vehicleId],
    queryFn: () => getVehicleDossier({ data: { vehicleId } }),
    refetchInterval: 12_000,
  });
  const log = useMutation({
    mutationFn: async () => {
      if (editingFuelId) {
        await updateFuelEvent({ data: { id: editingFuelId, kind, litres: Number(litres), notes } });
      } else {
        await logFuel({ data: { vehicleId, kind, litres: Number(litres), notes } });
      }
      return { ok: true };
    },
    onSuccess: () => {
      toast.success(editingFuelId ? "Fuel entry updated" : "Fuel entry logged");
      setFuelOpen(false);
      setEditingFuelId(null);
      setLitres("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["dossier", vehicleId] });
      qc.invalidateQueries({ queryKey: ["fleet-brief"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeFuel = useMutation({
    mutationFn: (id: string) => deleteFuelEvent({ data: { id } }),
    onSuccess: () => {
      toast.success("Fuel entry deleted");
      qc.invalidateQueries({ queryKey: ["dossier", vehicleId] });
      qc.invalidateQueries({ queryKey: ["fleet-brief"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const fileDoc = useMutation({
    mutationFn: () =>
      saveDocument({
        data: { id: editingDocId ?? undefined, vehicleId, title: docTitle, kind: docKind, expiresOn: docExpiry || undefined },
      }),
    onSuccess: () => {
      toast.success(editingDocId ? "Document updated" : "Document filed");
      setDocOpen(false);
      setEditingDocId(null);
      setDocTitle("");
      setDocExpiry("");
      qc.invalidateQueries({ queryKey: ["dossier", vehicleId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeDocument = useMutation({
    mutationFn: (id: string) => deleteDocument({ data: { id } }),
    onSuccess: () => {
      toast.success("Document removed");
      qc.invalidateQueries({ queryKey: ["dossier", vehicleId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const speed = useMutation({
    mutationFn: (clear: boolean) =>
      setSpeedLimit({
        data: { target: "vehicle", vehicleId, speedLimit: clear ? undefined : Number(limit), clear },
      }),
    onSuccess: () => {
      toast.success("Speed limit updated");
      qc.invalidateQueries({ queryKey: ["dossier", vehicleId] });
      qc.invalidateQueries({ queryKey: ["live-fleet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const assign = useMutation({
    mutationFn: (driverId: string | null) => {
      const current = q.data?.vehicle.driverId;
      if (!driverId) {
        if (!current) return Promise.resolve({ ok: true });
        return assignDriver({ data: { driverId: current, vehicleId: null } });
      }
      return assignDriver({ data: { driverId, vehicleId } });
    },
    onSuccess: () => {
      toast.success("Driver updated");
      qc.invalidateQueries({ queryKey: ["dossier", vehicleId] });
      qc.invalidateQueries({ queryKey: ["drivers"] });
      qc.invalidateQueries({ queryKey: ["live-fleet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const command = useMutation({
    mutationFn: (kind: "locate" | "restart" | "snapshot") =>
      queueDeviceCommand({ data: { vehicleId, kind } }),
    onSuccess: () => {
      toast.success("Command acknowledged");
      qc.invalidateQueries({ queryKey: ["dossier", vehicleId] });
      qc.invalidateQueries({ queryKey: ["media"] });
      qc.invalidateQueries({ queryKey: ["devices"] });
      qc.invalidateQueries({ queryKey: ["live-fleet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const data = q.data;
  const limitId = data?.vehicle.id;
  const limitValue = data?.vehicle.speedLimit;
  useEffect(() => {
    if (limitValue != null) setLimit(String(limitValue));
  }, [limitId, limitValue]);
  const chart = (data?.fuel ?? [])
    .filter((p) => p.fuel != null)
    .map((p) => ({
      t: new Date(p.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      fuel: Math.round(p.fuel ?? 0),
    }));

  return (
    <div>
      <PageHeader
        title={data ? data.vehicle.name : "Unit file"}
        subtitle={data ? `${data.vehicle.plate} · ${data.vehicle.companyName}` : "Fuel, device, and recent movement."}
        actions={
          <div className="flex items-center gap-2">
            {canLog && (
              <Dialog open={fuelOpen} onOpenChange={setFuelOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="secondary" onClick={() => {
                    setEditingFuelId(null);
                    setKind("fill");
                    setLitres("");
                    setNotes("");
                  }}>Log fuel</Button>
                </DialogTrigger>
                <DialogContent title={editingFuelId ? "Edit fuel entry" : "Manual fuel entry"}>
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      log.mutate();
                    }}
                  >
                    <div className="flex gap-2">
                      {(["fill", "drop"] as const).map((k) => (
                        <Button key={k} type="button" size="sm" variant={kind === k ? "default" : "secondary"} onClick={() => setKind(k)}>
                          {k === "fill" ? "Fill-up" : "Drop"}
                        </Button>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <Label>Litres</Label>
                      <Input required inputMode="decimal" value={litres} onChange={(e) => setLitres(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Note</Label>
                      <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pump slip, depot, or reason" />
                    </div>
                    <Button className="w-full" type="submit" disabled={log.isPending || !(Number(litres) > 0)}>
                      {editingFuelId ? "Save changes" : "Save entry"}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
            <Link to="/ops/vehicles" className="inline-flex h-9 items-center gap-1 text-sm text-muted hover:text-fg">
              <ArrowLeft className="size-4" /> Fleet
            </Link>
          </div>
        }
      />
      {q.isError && <p className="px-4 text-sm text-down md:px-6">{q.error instanceof Error ? q.error.message : "Could not open this unit."}</p>}
      {data && (
        <div className="space-y-4 px-4 pb-10 md:px-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Fuel" value={data.latest?.fuel != null ? `${Math.round(data.latest.fuel)}%` : "—"} detail={formatLitres(data.latest?.litres)} />
            <Stat label="Speed" value={formatSpeed(data.latest?.speed)} detail={`Limit ${data.vehicle.speedLimit} km/h`} />
            <Stat label="Odometer" value={formatKm(data.vehicle.odometerKm)} detail={`${Math.round(data.vehicle.engineHours)} h`} />
            <Stat label="Last packet" value={data.latest ? formatAgo(data.latest.ts) : "—"} detail={data.vehicle.driverName ?? "Unassigned"} />
          </div>

          {canLog && (
            <section className="grid gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-4 lg:grid-cols-2">
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  speed.mutate(false);
                }}
              >
                <div className="text-sm font-medium">Speed limit</div>
                <p className="text-sm text-muted">
                  Company default {data.vehicle.defaultSpeed} km/h
                  {data.vehicle.speedOverride != null ? ` · this unit overrides at ${data.vehicle.speedOverride}` : " · this unit inherits it"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="w-28" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
                  <Button type="submit" size="sm" variant="secondary" disabled={speed.isPending || !(Number(limit) >= 20)}>
                    Set override
                  </Button>
                  {data.vehicle.speedOverride != null && (
                    <Button type="button" size="sm" variant="ghost" disabled={speed.isPending} onClick={() => speed.mutate(true)}>
                      Use company default
                    </Button>
                  )}
                </div>
              </form>
              <label className="space-y-2 text-sm">
                <span className="block font-medium">Driver</span>
                <select
                  className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm"
                  value={data.vehicle.driverId ?? ""}
                  disabled={assign.isPending}
                  onChange={(e) => assign.mutate(e.target.value || null)}
                >
                  <option value="">Unassigned</option>
                  {(drivers.data ?? [])
                    .filter((d) => d.companyId === data.vehicle.companyId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.vehicleName && d.vehicleId !== data.vehicle.id ? ` · on ${d.vehicleName}` : ""}
                      </option>
                    ))}
                </select>
              </label>
            </section>
          )}

          <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-medium">Fuel level</h2>
              <span className="text-xs text-subtle">Tank {Math.round(data.vehicle.tankLitres)} L</span>
            </div>
            {mounted && chart.length > 1 ? (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart}>
                    <YAxis domain={[0, 100]} width={28} tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-surface-2)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        color: "var(--color-fg)",
                        fontSize: 12,
                      }}
                      formatter={(v) => [`${v}%`, "Fuel"]}
                    />
                    <Area type="monotone" dataKey="fuel" stroke="var(--color-live)" fill="var(--color-live)" fillOpacity={0.16} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted">Not enough samples yet.</p>
            )}
          </section>

          <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium">Fuel vs plan</h2>
              <span className="text-xs text-subtle">7 days · {data.fuelPlan.baseline} L/100 km</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Distance" value={`${data.fuelPlan.distanceKm} km`} detail={`${data.fuelPlan.trips} trips`} />
              <Stat label="Actual" value={`${data.fuelPlan.actualL} L`} detail="Recorded on trips" />
              <Stat label="Expected" value={`${data.fuelPlan.expectedL} L`} detail="Baseline burn" />
              <Stat
                label="Variance"
                value={`${data.fuelPlan.actualL - data.fuelPlan.expectedL > 0 ? "+" : ""}${(Math.round((data.fuelPlan.actualL - data.fuelPlan.expectedL) * 10) / 10).toFixed(1)} L`}
                detail={data.fuelPlan.actualL > data.fuelPlan.expectedL ? "Over plan" : "Inside plan"}
              />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
              <h2 className="text-sm font-medium">Device</h2>
              {data.device ? (
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <Item label="IMEI" value={data.device.imei} mono />
                  <Item label="Protocol" value={`${data.device.protocol} · ${data.device.decoder}`} />
                  <Item label="GSM" value={data.device.gsmSignal != null ? String(data.device.gsmSignal) : "—"} />
                  <Item label="GPS" value={data.device.gpsSignal != null ? String(data.device.gpsSignal) : "—"} />
                  <Item label="Battery" value={data.device.battery != null ? `${Math.round(data.device.battery)}%` : "—"} />
                  <Item label="Last seen" value={data.device.lastSeen ? formatAgo(data.device.lastSeen) : "—"} />
                </dl>
              ) : (
                <p className="mt-2 text-sm text-muted">No tracker assigned.</p>
              )}
              {canSoft && data.device && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={command.isPending} onClick={() => command.mutate("locate")}>
                    Request location
                  </Button>
                  <Button size="sm" variant="secondary" disabled={command.isPending} onClick={() => command.mutate("snapshot")}>
                    Snapshot
                  </Button>
                  {canHard && (
                    <Button size="sm" variant="ghost" disabled={command.isPending} onClick={() => command.mutate("restart")}>
                      Restart
                    </Button>
                  )}
                </div>
              )}
              {data.commands.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-subtle">
                  {data.commands.map((c) => (
                    <li key={c.id}>
                      {commandLabel(c.kind)} · {c.status}
                      {c.result ? ` · ${c.result}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-sm text-muted">
                {[data.vehicle.make, data.vehicle.model].filter(Boolean).join(" ") || "Vehicle"}{" "}
                {data.vehicle.color ? `· ${data.vehicle.color}` : ""}
              </p>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
              <h2 className="text-sm font-medium">Recent alerts</h2>
              <ul className="mt-3 space-y-2">
                {data.alerts.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                    <span>
                      <span className="block">{a.title}</span>
                      <span className="text-xs text-subtle">{formatAgo(a.createdAt)}</span>
                    </span>
                    <Badge tone={a.severity === "critical" ? "down" : a.severity === "warning" ? "idle" : "info"}>{a.status}</Badge>
                  </li>
                ))}
                {data.alerts.length === 0 && <li className="text-sm text-muted">No alerts on this unit.</li>}
              </ul>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium">Documents</h2>
                {canLog && (
                  <Dialog open={docOpen} onOpenChange={setDocOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="ghost" onClick={() => {
                        setEditingDocId(null);
                        setDocTitle("");
                        setDocKind("insurance");
                        setDocExpiry("");
                      }}>File paper</Button>
                    </DialogTrigger>
                    <DialogContent title={editingDocId ? "Edit vehicle document" : "Vehicle document"}>
                      <form
                        className="space-y-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          fileDoc.mutate();
                        }}
                      >
                        <div className="space-y-1">
                          <Label>Title</Label>
                          <Input required value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Insurance — comprehensive" />
                        </div>
                        <div className="space-y-1">
                          <Label>Kind</Label>
                          <select
                            className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm"
                            value={docKind}
                            onChange={(e) => setDocKind(e.target.value as typeof docKind)}
                          >
                            <option value="insurance">Insurance</option>
                            <option value="registration">Registration</option>
                            <option value="permit">Permit</option>
                            <option value="service">Service record</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label>Expires</Label>
                          <Input type="date" value={docExpiry} onChange={(e) => setDocExpiry(e.target.value)} />
                        </div>
                        <Button className="w-full" type="submit" disabled={fileDoc.isPending}>
                          {editingDocId ? "Save changes" : "Save"}
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <ul className="mt-3 space-y-2">
                {data.documents.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block">{d.title}</span>
                      <span className="text-xs capitalize text-subtle">{d.kind}</span>
                      <Badge tone={d.expiresOn && new Date(d.expiresOn).getTime() - Date.now() < 45 * 86400000 ? "idle" : "muted"}>
                        {d.expiresOn ?? "No expiry"}
                      </Badge>
                    </span>
                    {canLog && (
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" variant="secondary" onClick={() => {
                          setEditingDocId(d.id);
                          setDocTitle(d.title);
                          setDocKind(d.kind as typeof docKind);
                          setDocExpiry(d.expiresOn ?? "");
                          setDocOpen(true);
                        }}>Edit</Button>
                        <Button size="sm" variant="ghost" disabled={removeDocument.isPending} onClick={() => {
                          if (window.confirm(`Delete document "${d.title}"?`)) removeDocument.mutate(d.id);
                        }}>Delete</Button>
                      </div>
                    )}
                  </li>
                ))}
                {data.documents.length === 0 && <li className="text-sm text-muted">No papers filed on this unit.</li>}
              </ul>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
              <h2 className="text-sm font-medium">Driving behaviour</h2>
              <ul className="mt-3 space-y-2">
                {data.behavior.map((b) => (
                  <li key={b.id} className="flex items-start justify-between gap-3 text-sm">
                    <span>
                      <span className="block">{b.label}{b.value != null ? ` · ${b.value.toFixed(2)} g` : ""}</span>
                      <span className="text-xs text-subtle">{b.driverName ?? "Unassigned"} · {formatAgo(b.ts)}</span>
                    </span>
                    <Badge tone={b.severity === "critical" ? "down" : b.severity === "warning" ? "idle" : "info"}>{b.severity}</Badge>
                  </li>
                ))}
                {data.behavior.length === 0 && <li className="text-sm text-muted">No harsh events on this unit.</li>}
              </ul>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
              <h2 className="text-sm font-medium">Driver history</h2>
              <ul className="mt-3 space-y-2">
                {data.assignments.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                    <span>{a.name}</span>
                    <span className="text-xs text-subtle">
                      {new Date(a.startedAt).toLocaleDateString()}
                      {a.endedAt ? ` – ${new Date(a.endedAt).toLocaleDateString()}` : " – current"}
                    </span>
                  </li>
                ))}
                {data.assignments.length === 0 && <li className="text-sm text-muted">No assignment history yet.</li>}
              </ul>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
              <h2 className="text-sm font-medium">Fuel log</h2>
              <ul className="mt-3 space-y-2">
                {data.fuelEvents.map((f) => (
                  <li key={f.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block capitalize">{f.kind} · {f.litres} L</span>
                      <span className="text-xs text-subtle">{f.notes ?? "No note"} · {formatAgo(f.ts)}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge tone={f.kind === "drop" ? "down" : "live"}>{f.kind}</Badge>
                      {canLog && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => {
                            setEditingFuelId(f.id);
                            setKind(f.kind as "fill" | "drop");
                            setLitres(String(f.litres));
                            setNotes(f.notes ?? "");
                            setFuelOpen(true);
                          }}>Edit</Button>
                          <Button size="sm" variant="ghost" disabled={removeFuel.isPending} onClick={() => {
                            if (window.confirm(`Delete this ${f.kind} entry of ${f.litres} L?`)) removeFuel.mutate(f.id);
                          }}>Delete</Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
                {data.fuelEvents.length === 0 && <li className="text-sm text-muted">No manual or detected fuel events yet.</li>}
              </ul>
            </section>
          </div>

          <section className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
            <h2 className="px-4 pt-4 text-sm font-medium">Trips</h2>
            <table className="mt-2 w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.12em] text-subtle">
                <tr>
                  {["Start", "From", "To", "Distance", "Max", "Fuel"].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.trips.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-4 py-2 text-muted">{new Date(t.startedAt).toLocaleString()}</td>
                    <td className="px-4 py-2">{t.startAddress ?? "—"}</td>
                    <td className="px-4 py-2 text-muted">{t.endAddress ?? "—"}</td>
                    <td className="tabular px-4 py-2">{formatKm(t.distanceKm)}</td>
                    <td className="tabular px-4 py-2">{formatSpeed(t.maxSpeed)}</td>
                    <td className="tabular px-4 py-2">{formatLitres(t.fuelUsed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.trips.length === 0 && <p className="px-4 py-4 text-sm text-muted">No closed trips yet.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-subtle">{label}</div>
      <div className="tabular mt-1 text-lg font-semibold">{value}</div>
      <div className="truncate text-xs text-muted">{detail}</div>
    </div>
  );
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-subtle">{label}</div>
      <div className={mono ? "font-mono text-xs" : ""}>{value}</div>
    </div>
  );
}

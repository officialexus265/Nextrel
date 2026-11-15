import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { assignDevice, deleteDevice, filePacket, getAppSession, listCalibrations, listCompanies, listDevices, listIngestJournal, listVehicles, queueDeviceCommand, saveCalibration, saveDevice } from "@/lib/fleet/api";
import { DECODER_NAMES, decode, samplePacket, type DecoderName, type NormalizedFix } from "@/lib/fleet/decoders";
import { commandLabel } from "@/lib/fleet/labels";
import { DEVICE_CAPABILITIES, DEVICE_CAPABILITY_LABELS, type DeviceCapability, type DeviceConnectionMode } from "@/lib/fleet/types";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatAgo } from "@/lib/utils";

export const Route = createFileRoute("/ops/devices")({ component: DevicesPage });

function DevicesPage() {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["app-session"], queryFn: () => getAppSession() });
  const q = useQuery({ queryKey: ["devices"], queryFn: () => listDevices() });
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => listVehicles() });
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => listCompanies(), retry: false });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [imei, setImei] = useState("");
  const [protocol, setProtocol] = useState("HTTP");
  const [decoder, setDecoder] = useState("generic_http");
  const [companyId, setCompanyId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [capabilities, setCapabilities] = useState<DeviceCapability[]>([]);
  const [connectionMode, setConnectionMode] = useState<DeviceConnectionMode>("live");

  const mut = useMutation({
    mutationFn: () =>
      saveDevice({
        data: { id: editingId ?? undefined, imei, protocol, decoder, capabilities, connectionMode, companyId: companyId || (companies.data?.[0]?.id ?? ""), vehicleId: vehicleId || null },
      }),
    onSuccess: () => {
      toast.success(editingId ? "Device updated" : "Device registered");
      setOpen(false);
      setEditingId(null);
      setImei("");
      setProtocol("HTTP");
      setDecoder("generic_http");
      setCompanyId("");
      setVehicleId("");
      setCapabilities([]);
      setConnectionMode("live");
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteDevice({ data: { id } }),
    onSuccess: () => {
      toast.success("Device removed");
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Devices"
        subtitle="Register hardware, then prove a manufacturer frame decodes before it hits the map."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => {
                setEditingId(null);
                setImei("");
                setProtocol("HTTP");
                setDecoder("generic_http");
                setCompanyId("");
                setVehicleId("");
              }}>Register device</Button>
            </DialogTrigger>
            <DialogContent title={editingId ? "Edit device" : "Register device"}>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  mut.mutate();
                }}
              >
                <div className="space-y-1"><Label>IMEI</Label><Input required value={imei} onChange={(e) => setImei(e.target.value)} /></div>
                <div className="space-y-1">
                  <Label>Protocol</Label>
                  <select className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                    {["HTTP", "TCP", "MQTT", "UDP"].map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Decoder</Label>
                  <select className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm" value={decoder} onChange={(e) => setDecoder(e.target.value)}>
                    {DECODER_NAMES.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Connection mode</Label>
                  <select className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm" value={connectionMode} onChange={(e) => setConnectionMode(e.target.value as DeviceConnectionMode)}>
                    <option value="live">Live tracker</option>
                    <option value="simulated">Simulator / lab device</option>
                  </select>
                  <p className="text-xs text-muted">Live devices will not report successful commands until a real downlink gateway is connected.</p>
                </div>
                <div className="space-y-2 rounded-[var(--radius-md)] border border-border p-3">
                  <div>
                    <Label>Hardware capabilities</Label>
                    <p className="mt-1 text-xs text-muted">Select only features confirmed by the tracker model, wiring and manufacturer documentation.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {DEVICE_CAPABILITIES.map((capability) => (
                      <label key={capability} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-1 accent-current" checked={capabilities.includes(capability)}
                          onChange={(e) => setCapabilities((current) => e.target.checked ? [...current, capability] : current.filter((item) => item !== capability))} />
                        <span>{DEVICE_CAPABILITY_LABELS[capability]}</span>
                      </label>
                    ))}
                  </div>
                  {capabilities.some((capability) => capability === "engine_immobilize" || capability === "engine_restore") && (
                    <p className="text-xs text-amber-700">Engine immobilizer hardware is recorded, but remote engine commands remain unavailable until a verified device gateway and vehicle safety interlocks are implemented.</p>
                  )}
                </div>
                {companies.data && (
                  <div className="space-y-1">
                    <Label>Company</Label>
                    <select className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                      <option value="">Select…</option>
                      {companies.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Assign vehicle</Label>
                  <select className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">Unassigned</option>
                    {(vehicles.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.plate} — {v.name}</option>)}
                  </select>
                </div>
                <Button className="w-full" type="submit" disabled={mut.isPending}>{editingId ? "Save changes" : "Register device"}</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <PacketBench />
      <div className="overflow-x-auto px-4 pb-10 md:px-6">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.12em] text-subtle">
            <tr>
              {["IMEI", "Decoder", "Capabilities", "Vehicle", "Company", "Last seen", "GSM", "GPS", "Battery", "Actions & assignment"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((d) => (
              <tr key={d.id} className="border-t border-border align-middle hover:bg-surface-2/40">
                <td className="px-2 py-2 font-mono text-xs">{d.imei}</td>
                <td className="px-2 py-2"><Badge tone="muted">{d.decoder}</Badge></td>
                <td className="px-2 py-2">
                  <div className="flex max-w-[240px] flex-wrap gap-1">
                    {d.capabilities.length ? d.capabilities.map((capability) => (
                      <Badge key={capability} tone="muted">{DEVICE_CAPABILITY_LABELS[capability]}</Badge>
                    )) : <span className="text-xs text-subtle">Not declared</span>}
                  </div>
                  {d.capabilitySource === "manual" && <span className="mt-1 block text-[10px] text-subtle">Manually verified</span>}
                </td>
                <td className="px-2 py-2">{d.vehicleName ?? "—"}</td>
                <td className="px-2 py-2 text-muted">{d.companyName ?? "—"}</td>
                <td className="px-2 py-2 text-muted">{d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "Never"}</td>
                <td className="tabular px-2 py-2">{d.gsmSignal ?? "—"}</td>
                <td className="tabular px-2 py-2">{d.gpsSignal ?? "—"}</td>
                <td className="tabular px-2 py-2">{d.battery != null ? `${Math.round(d.battery)}%` : "—"}</td>
                <td className="px-3 py-3 align-middle">
                  <div className="min-w-[270px] space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface-2/70 p-1.5">
                    {(session.data?.role === "super_admin" || session.data?.role === "field_admin" || session.data?.role === "company_admin") && (
                      <Button size="sm" variant="secondary" onClick={() => {
                        setEditingId(d.id);
                        setImei(d.imei);
                        setProtocol(d.protocol);
                        setDecoder(d.decoder);
                        setCompanyId(d.companyId ?? "");
                        setVehicleId(d.vehicleId ?? "");
                        setCapabilities(d.capabilities);
                        setConnectionMode(d.connectionMode);
                        setOpen(true);
                      }}>Edit</Button>
                    )}
                    <CalibrateButton deviceId={d.id} count={d.calibrationCount} />
                    <CommandButtons
                      deviceId={d.id}
                      role={session.data?.role}
                      lastKind={d.lastCommandKind}
                      lastStatus={d.lastCommandStatus}
                      capabilities={d.capabilities}
                      connectionMode={d.connectionMode}
                    />
                    {(session.data?.role === "super_admin" || session.data?.role === "field_admin" || session.data?.role === "company_admin") && (
                      <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => {
                        if (window.confirm(`Remove device ${d.imei}? Devices that have reported data or have calibration/command history are retained.`)) remove.mutate(d.id);
                      }}>Delete</Button>
                    )}
                    </div>
                  <label className="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-2.5 py-2">
                    <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-subtle">Assign to</span>
                    <select
                      className="h-8 min-w-0 flex-1 rounded-[var(--radius-xs)] border border-border bg-surface-2 px-2.5 text-xs font-medium"
                      defaultValue={d.vehicleId ?? ""}
                      onChange={async (e) => {
                        try {
                          await assignDevice({ data: { deviceId: d.id, vehicleId: e.target.value || null } });
                          toast.success("Assignment updated");
                          qc.invalidateQueries({ queryKey: ["devices"] });
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Could not update assignment");
                        }
                      }}
                    >
                      <option value="">Unassigned</option>
                      {(vehicles.data ?? []).map((v) => (
                        <option key={v.id} value={v.id}>{v.plate}</option>
                      ))}
                    </select>
                  </label>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CommandButtons({
  deviceId,
  role,
  lastKind,
  lastStatus,
}: {
  deviceId: string;
  role: string | undefined;
  lastKind: string | null;
  lastStatus: string | null;
}) {
  const qc = useQueryClient();
  const can = role === "super_admin" || role === "company_admin" || role === "field_admin";
  const mut = useMutation({
    mutationFn: (kind: "locate" | "restart") => queueDeviceCommand({ data: { deviceId, kind } }),
    onSuccess: () => {
      toast.success("Command acknowledged");
      qc.invalidateQueries({ queryKey: ["devices"] });
      qc.invalidateQueries({ queryKey: ["live-fleet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can) return lastKind ? <span className="text-xs text-subtle">{commandLabel(lastKind)} · {lastStatus}</span> : null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button size="sm" variant="ghost" disabled={mut.isPending} onClick={() => mut.mutate("locate")}>Locate</Button>
      <Button size="sm" variant="ghost" disabled={mut.isPending} onClick={() => mut.mutate("restart")}>Restart</Button>
      {lastKind && (
        <span className="text-xs text-subtle">{commandLabel(lastKind)} · {lastStatus}</span>
      )}
    </div>
  );
}

function CalibrateButton({ deviceId, count }: { deviceId: string; count: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [emptyVoltage, setEmpty] = useState(0.5);
  const [fullVoltage, setFull] = useState(4.8);
  const [tankLitres, setTank] = useState(120);
  const history = useQuery({
    queryKey: ["calibrations", deviceId],
    queryFn: () => listCalibrations({ data: { deviceId } }),
    enabled: open,
  });
  const mut = useMutation({
    mutationFn: () => saveCalibration({ data: { deviceId, emptyVoltage, fullVoltage, tankLitres } }),
    onSuccess: () => {
      toast.success("Calibration recorded");
      qc.invalidateQueries({ queryKey: ["calibrations", deviceId] });
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">Calibrate{count ? ` · ${count}` : ""}</Button>
      </DialogTrigger>
      <DialogContent title="Fuel sensor calibration">
        <div className="space-y-3">
          <div className="space-y-1"><Label>Empty voltage</Label><Input type="number" step="0.1" value={emptyVoltage} onChange={(e) => setEmpty(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Full voltage</Label><Input type="number" step="0.1" value={fullVoltage} onChange={(e) => setFull(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Tank litres</Label><Input type="number" value={tankLitres} onChange={(e) => setTank(Number(e.target.value))} /></div>
          <Button className="w-full" onClick={() => mut.mutate()} disabled={mut.isPending}>Save calibration</Button>
          <ul className="space-y-2 border-t border-border pt-3">
            {(history.data ?? []).map((c) => (
              <li key={c.id} className="text-sm">
                <span className="tabular">{c.emptyVoltage}–{c.fullVoltage} V · {c.tankLitres} L</span>
                <span className="mt-0.5 block text-xs text-subtle">{c.notes ?? "No note"} · {new Date(c.createdAt).toLocaleString()}</span>
              </li>
            ))}
            {history.isSuccess && (history.data ?? []).length === 0 && (
              <li className="text-sm text-muted">No calibration history yet.</li>
            )}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const BENCH: { id: DecoderName; label: string; hint: string }[] = [
  { id: "generic_http", label: "Generic", hint: "Normalised JSON. The sample is the parked depot shuttle, so the fix stays put on the live map." },
  { id: "teltonika", label: "Teltonika", hint: "Codec JSON. IO 239 is ignition and IO 270 is fuel percent. Sample is Unit 01 — it will roll on." },
  { id: "concox", label: "Concox", hint: "Cloud JSON on Nairobi time, or a 7878 frame. Sample is the idling city van, which holds." },
  { id: "gt06", label: "GT06", hint: "Location frame starting 7878, wrapped with the IMEI. Sample is Unit 04." },
];

function PacketBench() {
  const qc = useQueryClient();
  const journal = useQuery({ queryKey: ["ingest-journal"], queryFn: () => listIngestJournal() });
  const [decoder, setDecoder] = useState<DecoderName>("generic_http");
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<NormalizedFix[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<{ vehicleName: string | null; address: string | null } | null>(null);
  const hint = BENCH.find((item) => item.id === decoder)?.hint;
  const file = useMutation({
    mutationFn: () => filePacket({ data: { decoder, raw } }),
    onSuccess: (result) => {
      setFiled({ vehicleName: result.vehicleName, address: result.address });
      if (result.fix) setPreview([result.fix]);
      setError(null);
      toast.success(result.vehicleName ? `Fix filed for ${result.vehicleName}` : "Fix filed");
      qc.invalidateQueries({ queryKey: ["ingest-journal"] });
      qc.invalidateQueries({ queryKey: ["devices"] });
      qc.invalidateQueries({ queryKey: ["live-fleet"] });
      qc.invalidateQueries({ queryKey: ["health"] });
    },
    onError: (e: Error) => {
      setFiled(null);
      setError(e.message);
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["ingest-journal"] });
    },
  });

  function loadSample() {
    setRaw(samplePacket(decoder));
    setPreview(null);
    setError(null);
    setFiled(null);
  }

  function runDecode() {
    try {
      setPreview(decode(decoder, raw));
      setError(null);
      setFiled(null);
    } catch (err) {
      setPreview(null);
      setFiled(null);
      setError(err instanceof Error ? err.message : "Could not decode");
    }
  }

  const shown = preview?.[0];

  return (
    <section className="mx-4 mb-6 space-y-4 md:mx-6">
      <div className="grid gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Packet bench</h2>
            <p className="mt-1 text-sm text-muted">Decoders normalise Teltonika, Concox, and GT06 into one fix. A TCP or MQTT proxy can post the same bytes to the ingest endpoint.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {BENCH.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant={decoder === item.id ? "default" : "secondary"}
                onClick={() => {
                  setDecoder(item.id);
                  setPreview(null);
                  setError(null);
                  setFiled(null);
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <p className="text-sm text-muted">{hint}</p>
          <Textarea
            value={raw}
            spellCheck={false}
            className="min-h-44 font-mono text-xs"
            placeholder="Paste a frame or load a sample"
            onChange={(e) => {
              setRaw(e.target.value);
              setPreview(null);
              setError(null);
              setFiled(null);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={loadSample}>
              Load sample
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={!raw.trim()} onClick={runDecode}>
              Decode
            </Button>
            <Button type="button" size="sm" disabled={!raw.trim() || file.isPending} onClick={() => file.mutate()}>
              File into fleet
            </Button>
          </div>
        </div>
        <div className="rounded-[var(--radius-md)] border border-border bg-surface-2 p-3">
          <div className="text-xs uppercase tracking-[0.14em] text-subtle">Normalised fix</div>
          {error && <p className="mt-3 text-sm text-down">{error}</p>}
          {!error && !shown && <p className="mt-3 text-sm text-muted">Decode a packet to see lat, speed, ignition, and fuel before anything is stored.</p>}
          {shown && (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <Field k="IMEI" v={shown.imei} mono />
              <Field k="Decoder" v={shown.decoder} />
              <Field k="When" v={new Date(shown.timestamp).toLocaleString()} />
              <Field k="Event" v={shown.event} />
              <Field k="Latitude" v={shown.lat.toFixed(5)} />
              <Field k="Longitude" v={shown.lng.toFixed(5)} />
              <Field k="Speed" v={`${Math.round(shown.speed)} km/h`} />
              <Field k="Heading" v={`${Math.round(shown.heading)}°`} />
              <Field k="Ignition" v={shown.ignition ? "On" : "Off"} />
              <Field k="Fuel" v={shown.fuelLevel == null ? "—" : `${Math.round(shown.fuelLevel)}%`} />
              <Field k="Altitude" v={shown.altitude == null ? "—" : `${Math.round(shown.altitude)} m`} />
              <Field k="Satellites" v={shown.satellites == null ? "—" : String(shown.satellites)} />
            </dl>
          )}
          {filed && (
            <div className="mt-4 border-t border-border pt-3 text-sm">
              <p>
                Filed{filed.vehicleName ? ` on ${filed.vehicleName}` : ""}
                {filed.address ? ` · ${filed.address}` : ""}.
              </p>
              <Link to="/ops" className="mt-2 inline-flex h-9 items-center text-sm text-fg underline-offset-4 hover:underline">
                Open the live map
              </Link>
            </div>
          )}
          {preview && preview.length > 1 && <p className="mt-3 text-xs text-subtle">{preview.length} records in this batch. The last one is shown.</p>}
        </div>
      </div>
      <div>
        <h2 className="text-sm font-medium">Ingest tape</h2>
        <ul className="mt-2 divide-y divide-border rounded-[var(--radius-lg)] border border-border">
          {(journal.data ?? []).map((row) => (
            <li key={row.id} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("text-xs uppercase tracking-[0.14em]", row.status === "ok" ? "text-live" : "text-down")}>{row.status}</span>
                  <span className="font-mono text-xs text-muted">{row.imei ?? "—"}</span>
                  {row.decoder && <Badge tone="muted">{row.decoder}</Badge>}
                </div>
                <p className="truncate text-sm text-muted">{row.detail ?? "—"}</p>
              </div>
              <span className="shrink-0 text-xs text-subtle">{formatAgo(row.createdAt)}</span>
            </li>
          ))}
          {journal.isSuccess && (journal.data ?? []).length === 0 && (
            <li className="px-3 py-4 text-sm text-muted">No frames yet. Load a sample, decode it, then file it.</li>
          )}
          {journal.isError && <li className="px-3 py-4 text-sm text-down">Could not read the ingest tape.</li>}
        </ul>
      </div>
    </section>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-subtle">{k}</dt>
      <dd className={cn("truncate", mono && "font-mono text-xs")}>{v}</dd>
    </div>
  );
}

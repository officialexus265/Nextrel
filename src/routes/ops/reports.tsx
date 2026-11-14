import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { fileReportNow, getAppSession, getReports, listCompanies, listReportDesk, saveReportSchedule, setScheduleEnabled } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatAgo } from "@/lib/utils";

export const Route = createFileRoute("/ops/reports")({ component: ReportsPage });

const KINDS = ["trips", "stops", "idle", "speeding", "fuel", "offline", "geofence", "distance", "hours", "behaviour"] as const;

const LABELS: Record<string, string> = {
  vehicleName: "Vehicle",
  plate: "Plate",
  startedAt: "Started",
  endedAt: "Ended",
  startAddress: "From",
  endAddress: "To",
  distanceKm: "Distance km",
  maxSpeed: "Max km/h",
  idleMinutes: "Idle min",
  idleMin: "Idle min",
  fuelUsed: "Fuel L",
  durationMin: "Duration min",
  address: "Place",
  ignition: "Ignition",
  title: "Alert",
  body: "Detail",
  createdAt: "When",
  kind: "Kind",
  litres: "Litres",
  ts: "When",
  notes: "Notes",
  fence: "Geofence",
  zone: "Zone",
  trips: "Trips",
  windowHours: "Hours in window",
  meterHours: "Meter hours",
  driver: "Driver",
  g: "g-force",
  severity: "Severity",
};

function nairobiDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function ReportsPage() {
  const session = useQuery({ queryKey: ["app-session"], queryFn: () => getAppSession() });
  const canDesk = session.data?.role === "company_admin" || session.data?.role === "super_admin";
  const [kind, setKind] = useState<(typeof KINDS)[number]>("trips");
  const [from, setFrom] = useState(() => nairobiDate(-7));
  const [to, setTo] = useState(() => nairobiDate(0));
  const q = useQuery({
    queryKey: ["reports", kind, from, to],
    queryFn: () =>
      getReports({
        data: {
          kind,
          from: new Date(`${from}T00:00:00+03:00`).toISOString(),
          to: new Date(`${to}T23:59:59+03:00`).toISOString(),
        },
      }),
  });
  const rows = (q.data ?? []) as Record<string, unknown>[];
  const headers = useMemo(() => (rows[0] ? Object.keys(rows[0]).filter((h) => h !== "id") : []), [rows]);

  function download(filename: string, mime: string, body: string) {
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))];
    download(`Nextrel-${kind}.csv`, "text/csv", lines.join("\n"));
  }

  function exportExcel() {
    const head = headers.map((h) => `<Cell><Data ss:Type="String">${xmlEscape(LABELS[h] ?? h)}</Data></Cell>`).join("");
    const body = rows
      .map((r) => {
        const cells = headers
          .map((h) => `<Cell><Data ss:Type="String">${xmlEscape(formatCell(r[h]))}</Data></Cell>`)
          .join("");
        return `<Row>${cells}</Row>`;
      })
      .join("");
    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${xmlEscape(kind)}"><Table><Row>${head}</Row>${body}</Table></Worksheet>
</Workbook>`;
    download(`Nextrel-${kind}.xls`, "application/vnd.ms-excel", xml);
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Nairobi dates. Export CSV or Excel, or print this page for a PDF."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>CSV</Button>
            <Button size="sm" variant="secondary" onClick={exportExcel} disabled={rows.length === 0}>Excel</Button>
          </div>
        }
      />
      <div className="space-y-4 px-4 md:px-6">
        {canDesk && session.data && <ReportDesk role={session.data.role} companyId={session.data.companyId} />}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block h-10 rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm text-fg"
            />
          </label>
          <label className="text-xs text-muted">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block h-10 rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm text-fg"
            />
          </label>
        </div>
        <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <TabsList className="flex h-auto flex-wrap">
            {KINDS.map((k) => (
              <TabsTrigger key={k} value={k} className="capitalize">
                {k}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-[0.12em] text-subtle">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {LABELS[h] ?? h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={String(r.id ?? i)} className="border-t border-border">
                  {headers.map((h) => (
                    <td key={h} className="px-3 py-2 text-muted">
                      {formatCell(r[h])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {q.isError && <p className="p-6 text-sm text-down">Could not load this report.</p>}
          {!q.isError && rows.length === 0 && <p className="p-6 text-sm text-muted">No rows for this report.</p>}
        </div>
      </div>
    </div>
  );
}

function whenLabel(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 45_000) return `Due ${formatAgo(iso)}`;
  const hours = Math.max(1, Math.round(ms / 3600000));
  if (hours < 36) return `Next in ${hours}h`;
  return `Next in ${Math.round(hours / 24)}d`;
}

function formatCell(v: unknown) {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === "string" && v.includes("T") && !Number.isNaN(Date.parse(v))) {
    return new Date(v).toLocaleString();
  }
  return String(v);
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SCHEDULE_KINDS = ["trips", "fuel", "stops", "speeding", "offline"] as const;

function ReportDesk({ role, companyId }: { role: string; companyId: string | null }) {
  const qc = useQueryClient();
  const desk = useQuery({ queryKey: ["report-desk"], queryFn: () => listReportDesk() });
  const companies = useQuery({
    queryKey: ["companies"],
    queryFn: () => listCompanies(),
    enabled: role === "super_admin",
  });
  const [kind, setKind] = useState<(typeof SCHEDULE_KINDS)[number]>("trips");
  const [cadence, setCadence] = useState<"daily" | "weekly">("daily");
  const [recipient, setRecipient] = useState("");
  const [picked, setPicked] = useState(companyId ?? "");
  const target = role === "super_admin" ? picked || companies.data?.[0]?.id || "" : companyId ?? "";
  const save = useMutation({
    mutationFn: () => saveReportSchedule({ data: { companyId: target, kind, cadence, recipient } }),
    onSuccess: () => {
      toast.success("Schedule saved");
      setRecipient("");
      qc.invalidateQueries({ queryKey: ["report-desk"] });
      qc.invalidateQueries({ queryKey: ["control-desk"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => setScheduleEnabled({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report-desk"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const file = useMutation({
    mutationFn: (id: string) => fileReportNow({ data: { id } }),
    onSuccess: () => {
      toast.success("Filed on the mail desk");
      qc.invalidateQueries({ queryKey: ["report-desk"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const paused = desk.data?.dispatch.paused;

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <div className="text-sm font-medium">Scheduled delivery</div>
      <p className="mt-1 text-sm text-muted">
        {paused
          ? "The platform owner paused the mail desk."
          : "Due reports file on the mail desk. A relay is not connected, so they stay inside Nextrel."}
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {role === "super_admin" && (
          <label className="text-xs text-muted lg:col-span-1">
            Company
            <select
              value={target}
              onChange={(e) => setPicked(e.target.value)}
              className="mt-1 block h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm text-fg"
            >
              {(companies.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-muted">
          Report
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="mt-1 block h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm capitalize text-fg"
          >
            {SCHEDULE_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Cadence
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as typeof cadence)}
            className="mt-1 block h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm text-fg"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <label className="text-xs text-muted sm:col-span-2 lg:col-span-1">
          Recipient
          <Input required type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="ops@company.example" className="mt-1" />
        </label>
        <div className="flex items-end">
          <Button type="submit" size="sm" disabled={save.isPending || !target}>Schedule</Button>
        </div>
      </form>
      <ul className="mt-4 space-y-2">
        {(desk.data?.schedules ?? []).map((s) => (
          <li key={s.id} className="flex flex-col gap-2 border-t border-border pt-2 text-sm sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <span className="capitalize">{s.cadence} {s.kind}</span>
              <span className="text-muted"> · {s.companyName} · {s.recipient}</span>
              <div className="text-xs text-subtle">{s.enabled ? whenLabel(s.nextRun) : "Paused"}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={!s.enabled || paused || file.isPending} onClick={() => file.mutate(s.id)}>
                File now
              </Button>
              <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ id: s.id, enabled: !s.enabled })}>
                {s.enabled ? "Pause" : "Resume"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { applyQuietHours, listAlertRules, listCompanies, setSpeedLimit, updateAlertRule } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AlertRuleRow } from "@/lib/fleet/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ops/rules")({ component: RulesPage });

const COPY: Record<string, { title: string; hint: string; field?: "minutes" | "graceKmh" | "litres"; unit?: string }> = {
  offline: { title: "Offline", hint: "Raise when a unit stops reporting.", field: "minutes", unit: "min" },
  speeding: { title: "Speeding", hint: "Grace above the vehicle speed limit.", field: "graceKmh", unit: "km/h" },
  fuel_drop: { title: "Fuel drop", hint: "Litres lost while nearly stopped.", field: "litres", unit: "L" },
  long_idle: { title: "Long idle", hint: "Engine on, not moving.", field: "minutes", unit: "min" },
  geofence_enter: { title: "Geofence enter", hint: "Entry into allowed or forbidden zones." },
  geofence_exit: { title: "Geofence exit", hint: "Leaving a watched zone." },
};

function RulesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["alert-rules"], queryFn: () => listAlertRules() });
  const companiesQ = useQuery({ queryKey: ["companies"], queryFn: () => listCompanies(), retry: false });
  const rows = (q.data ?? []).filter((r) => !r.vehicleId);
  const companies = [...new Map(rows.map((r) => [r.companyId, r.companyName])).entries()];
  const [companyId, setCompanyId] = useState("");
  const activeCompany = companyId || companies[0]?.[0] || "";
  const shown = rows.filter((r) => r.companyId === activeCompany);
  const sample = shown[0]?.config;

  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("06:00");
  const [escalate, setEscalate] = useState("20");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!sample || ready) return;
    setQuietStart(sample.quietStart || "");
    setQuietEnd(sample.quietEnd || "");
    setEscalate(sample.escalateMin != null ? String(sample.escalateMin) : "");
    setReady(true);
  }, [sample, ready]);

  const quiet = useMutation({
    mutationFn: () =>
      applyQuietHours({
        data: {
          companyId: activeCompany,
          quietStart: quietStart || null,
          quietEnd: quietEnd || null,
          escalateMin: escalate ? Number(escalate) : null,
        },
      }),
    onSuccess: () => {
      toast.success("Quiet hours saved");
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Alert rules"
        subtitle="Company thresholds the live engine uses. Critical alerts still fire during quiet hours."
      />
      <section className="mx-4 mb-6 rounded-[var(--radius-lg)] border border-border bg-surface p-4 md:mx-6">
        <div className="text-sm font-medium">Quiet hours and escalation</div>
        <p className="mt-1 text-sm text-muted">Nairobi time. Leave blank to alert around the clock. Escalation marks an open alert if nobody acknowledges it.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Quiet from</Label>
            <Input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Until</Label>
            <Input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Escalate after (min)</Label>
            <Input inputMode="numeric" value={escalate} onChange={(e) => setEscalate(e.target.value)} placeholder="20" />
          </div>
        </div>
        <Button className="mt-4" size="sm" disabled={quiet.isPending || shown.length === 0} onClick={() => quiet.mutate()}>
          Save window
        </Button>
        <CompanySpeed companyId={activeCompany} speed={companiesQ.data?.find((c) => c.id === activeCompany)?.defaultSpeedLimit} />
        {companies.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {companies.map(([id, name]) => (
              <Button key={id} size="sm" variant={id === activeCompany ? "default" : "secondary"} onClick={() => { setCompanyId(id); setReady(false); }}>
                {name}
              </Button>
            ))}
          </div>
        )}
      </section>
      <div className="grid gap-3 px-4 pb-10 md:grid-cols-2 md:px-6">
        {shown.map((rule) => (
          <RuleCard key={rule.id} rule={rule} />
        ))}
        {q.isSuccess && shown.length === 0 && (
          <p className="text-sm text-muted">No company rules yet. Open a company as an admin.</p>
        )}
      </div>
    </div>
  );
}

function CompanySpeed({ companyId, speed }: { companyId: string; speed: number | undefined }) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  useEffect(() => {
    if (speed != null) setValue(String(speed));
  }, [companyId, speed]);
  const mut = useMutation({
    mutationFn: () => setSpeedLimit({ data: { target: "company", companyId, speedLimit: Number(value) } }),
    onSuccess: () => {
      toast.success("Company speed limit saved");
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["live-fleet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!companyId || speed == null) return null;
  return (
    <form
      className="mt-5 flex flex-wrap items-end gap-2 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        mut.mutate();
      }}
    >
      <div className="space-y-1">
        <Label>Company speed limit (km/h)</Label>
        <Input className="w-32" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={mut.isPending || !(Number(value) >= 20)}>
        Save limit
      </Button>
      <p className="w-full text-sm text-muted">Vehicles without their own limit use this. Speeding alerts use the effective limit plus the grace above.</p>
    </form>
  );
}

function RuleCard({ rule }: { rule: AlertRuleRow }) {
  const qc = useQueryClient();
  const meta = COPY[rule.type] ?? { title: rule.type, hint: "" };
  const field = meta.field;
  const initial = field ? String(rule.config[field] ?? "") : "";
  const [value, setValue] = useState(initial);

  const mut = useMutation({
    mutationFn: (patch: { enabled?: boolean; config?: AlertRuleRow["config"] }) =>
      updateAlertRule({ data: { id: rule.id, ...patch } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <article className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{meta.title}</h2>
          <p className="mt-1 text-sm text-muted">{meta.hint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          onClick={() => mut.mutate({ enabled: !rule.enabled })}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full border transition-colors",
            rule.enabled ? "border-live bg-live" : "border-border bg-surface-2",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-fg transition-transform",
              rule.enabled ? "translate-x-6 bg-accent-fg" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={rule.enabled ? "live" : "muted"}>{rule.enabled ? "Armed" : "Off"}</Badge>
        {rule.config.quietStart && rule.config.quietEnd && (
          <Badge tone="info">
            Quiet {rule.config.quietStart}–{rule.config.quietEnd}
          </Badge>
        )}
      </div>
      {field && (
        <form
          className="mt-4 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(value);
            if (!Number.isFinite(n)) return;
            mut.mutate({ config: { [field]: n } });
            toast.success("Threshold saved");
          }}
        >
          <div className="flex-1 space-y-1">
            <Label>Threshold{meta.unit ? ` (${meta.unit})` : ""}</Label>
            <Input value={value} inputMode="decimal" onChange={(e) => setValue(e.target.value)} />
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={mut.isPending}>
            Save
          </Button>
        </form>
      )}
    </article>
  );
}

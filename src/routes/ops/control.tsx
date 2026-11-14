import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { fileReportNow, getControlDesk, revokeSession, setFeatureFlag, setScheduleEnabled } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn, formatAgo } from "@/lib/utils";

export const Route = createFileRoute("/ops/control")({ component: ControlPage });

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Platform owner",
  field_admin: "Field staff",
  company_admin: "Company admin",
  tracker: "Tracker",
  accounts: "Accounts",
  pending: "Pending",
};

type FlagKey = "offline" | "speeding" | "fuel_theft" | "long_idle" | "geofence" | "mail_dispatch";

function ControlPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["control-desk"], queryFn: () => getControlDesk() });
  const flag = useMutation({
    mutationFn: (input: { key: FlagKey; enabled: boolean }) => setFeatureFlag({ data: input }),
    onSuccess: () => {
      toast.success("Engine updated");
      qc.invalidateQueries({ queryKey: ["control-desk"] });
      qc.invalidateQueries({ queryKey: ["live-fleet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: (sessionId: string) => revokeSession({ data: { sessionId } }),
    onSuccess: () => {
      toast.success("Session ended");
      qc.invalidateQueries({ queryKey: ["control-desk"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = q.data;

  return (
    <div className="pb-8">
      <PageHeader
        title="Control room"
        subtitle="Engine switches, signed-in sessions, and the mail desk. Nothing is sent by SMS or WhatsApp."
      />
      {q.isError && (
        <p className="px-4 text-sm text-down md:px-6">{q.error instanceof Error ? q.error.message : "Control room unavailable."}</p>
      )}
      {data && (
        <div className="space-y-8 px-4 md:px-6">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border">
            <Mini label="Companies" value={data.totals.companies} />
            <Mini label="Vehicles" value={data.totals.vehicles} />
            <Mini label="Open alerts" value={data.totals.openAlerts} />
          </div>

          <section>
            <h2 className="text-sm font-medium">Engine</h2>
            <p className="mt-1 text-sm text-muted">The live tick honors these on the next position. Company rules still apply when a switch is on.</p>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {data.flags.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="switch"
                  aria-checked={item.enabled}
                  disabled={flag.isPending}
                  onClick={() => flag.mutate({ key: item.key as FlagKey, enabled: !item.enabled })}
                  className={cn(
                    "flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-left",
                    item.enabled ? "border-live/40 bg-surface" : "border-border bg-surface-2",
                  )}
                >
                  <span>
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="block text-xs text-muted">{item.detail}</span>
                  </span>
                  <span className={cn("shrink-0 text-xs uppercase tracking-[0.14em]", item.enabled ? "text-live" : "text-subtle")}>
                    {item.enabled ? "On" : "Off"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium">Sessions</h2>
            <p className="mt-1 text-sm text-muted">End someone else’s console. Your own session stays until you sign out.</p>
            <div className="mt-3 space-y-2">
              {data.sessions.length === 0 && <p className="text-sm text-muted">No live sessions.</p>}
              {data.sessions.map((s) => (
                <div key={s.id} className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.name || s.email || "Signed-in user"}</span>
                      {s.self && <Badge tone="info">This console</Badge>}
                      {s.role && <Badge>{ROLE_LABEL[s.role] ?? s.role}</Badge>}
                    </div>
                    <p className="mt-1 truncate text-sm text-muted">
                      {s.email ?? "No email"}
                      {s.companyName ? ` · ${s.companyName}` : ""}
                      {" · "}
                      {formatAgo(s.updatedAt)}
                    </p>
                    <p className="truncate text-xs text-subtle">{agentLabel(s.userAgent)}{s.ipAddress ? ` · ${s.ipAddress}` : ""}</p>
                  </div>
                  {!s.self && (
                    <Button size="sm" variant="secondary" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                      End session
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <ScheduleBlock
            schedules={data.schedules}
            paused={data.dispatch.paused}
            onChange={() => qc.invalidateQueries({ queryKey: ["control-desk"] })}
          />
          <MailBlock mail={data.mail} paused={data.dispatch.paused} />
        </div>
      )}
    </div>
  );
}

function ScheduleBlock({
  schedules,
  paused,
  onChange,
}: {
  schedules: { id: string; companyName: string; kind: string; cadence: string; recipient: string; enabled: boolean; nextRun: string }[];
  paused: boolean;
  onChange: () => void;
}) {
  const toggle = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => setScheduleEnabled({ data: input }),
    onSuccess: onChange,
    onError: (e: Error) => toast.error(e.message),
  });
  const file = useMutation({
    mutationFn: (id: string) => fileReportNow({ data: { id } }),
    onSuccess: () => {
      toast.success("Report filed on the mail desk");
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section>
      <h2 className="text-sm font-medium">Schedules</h2>
      <p className="mt-1 text-sm text-muted">
        {paused ? "Mail desk is paused, so due reports wait." : "Due reports file themselves on the live tick. Add more from Reports inside a company."}
      </p>
      <div className="mt-3 space-y-2">
        {schedules.map((s) => (
          <div key={s.id} className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="font-medium capitalize">{s.cadence} {s.kind}</div>
              <p className="text-sm text-muted">{s.companyName} · {s.recipient}</p>
              <p className="text-xs text-subtle">{formatWhen(s.nextRun)}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={!s.enabled || paused || file.isPending} onClick={() => file.mutate(s.id)}>
                File now
              </Button>
              <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: s.id, enabled: !s.enabled })}>
                {s.enabled ? "Pause" : "Resume"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatWhen(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return `Due ${formatAgo(iso)}`;
  const hours = Math.round(ms / 3600000);
  if (hours < 36) return `Next in ${hours}h`;
  return `Next in ${Math.round(hours / 24)}d`;
}

function MailBlock({
  mail,
  paused,
}: {
  mail: { id: string; companyName: string | null; to: string; subject: string; body: string; createdAt: string }[];
  paused: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const current = mail.find((m) => m.id === openId) ?? null;
  return (
    <section>
      <h2 className="text-sm font-medium">Mail desk</h2>
      <p className="mt-1 text-sm text-muted">
        {paused ? "Dispatch is off." : "Copies stay here until a mail relay is connected."}
      </p>
      <div className="mt-3 space-y-2">
        {mail.length === 0 && <p className="text-sm text-muted">Nothing filed yet.</p>}
        {mail.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setOpenId(m.id)}
            className="block w-full rounded-[var(--radius-lg)] border border-border bg-surface p-3 text-left"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{m.subject}</span>
              <span className="shrink-0 text-xs text-subtle">{formatAgo(m.createdAt)}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{m.to}{m.companyName ? ` · ${m.companyName}` : ""}</p>
          </button>
        ))}
      </div>
      <Dialog open={Boolean(current)} onOpenChange={(open) => !open && setOpenId(null)}>
        <DialogContent title="Filed report">
          {current && (
            <div className="space-y-3">
              <p className="text-sm text-muted">{current.to}</p>
              <pre className="whitespace-pre-wrap font-sans text-sm text-fg">{current.body}</pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-subtle">{label}</div>
      <div className="tabular text-xl font-semibold">{value}</div>
    </div>
  );
}

function agentLabel(ua: string | null) {
  if (!ua) return "Unknown client";
  return ua.replace(/\s+/g, " ").slice(0, 72);
}

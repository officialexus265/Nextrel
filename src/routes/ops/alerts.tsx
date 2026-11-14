import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ackAlert, listAlerts } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { AlertRow } from "@/lib/fleet/types";
import { format } from "date-fns";

export const Route = createFileRoute("/ops/alerts")({ component: AlertsPage });

function AlertsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["alerts"], queryFn: () => listAlerts(), refetchInterval: 8000 });
  const [filter, setFilter] = useState<"open" | "all">("open");
  const rows = (q.data ?? []).filter((a) => (filter === "open" ? a.status === "open" : true));

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle="In-app acknowledgments. Email delivery is queued for the same events."
        actions={
          <div className="flex gap-1">
            <Button size="sm" variant={filter === "open" ? "default" : "secondary"} onClick={() => setFilter("open")}>
              Open
            </Button>
            <Button size="sm" variant={filter === "all" ? "default" : "secondary"} onClick={() => setFilter("all")}>
              All
            </Button>
          </div>
        }
      />
      <div className="space-y-2 px-4 pb-10 md:px-6">
        {rows.map((a) => (
          <AlertCard key={a.id} alert={a} onAck={() => qc.invalidateQueries({ queryKey: ["alerts"] })} />
        ))}
        {rows.length === 0 && <p className="text-sm text-muted">No alerts in this view.</p>}
      </div>
    </div>
  );
}

function AlertCard({ alert, onAck }: { alert: AlertRow; onAck: () => void }) {
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(false);
  const mut = useMutation({
    mutationFn: () => ackAlert({ data: { id: alert.id, comment } }),
    onSuccess: () => {
      toast.success("Alert acknowledged");
      setOpen(false);
      onAck();
    },
  });
  const tone = alert.severity === "critical" ? "down" : alert.severity === "warning" ? "idle" : "info";
  return (
    <article className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{alert.severity}</Badge>
            {alert.escalated && <Badge tone="down">Escalated</Badge>}
            <Badge tone={alert.status === "open" ? "idle" : "muted"}>{alert.status}</Badge>
            <span className="text-xs uppercase tracking-wide text-subtle">{alert.type.replaceAll("_", " ")}</span>
          </div>
          <h2 className="mt-2 font-medium">{alert.title}</h2>
          <p className="mt-1 text-sm text-muted">{alert.body}</p>
          <p className="mt-2 text-xs text-subtle">
            {alert.vehicleName ?? "Fleet"} {alert.plate ? `· ${alert.plate}` : ""} · {alert.companyName} ·{" "}
            {format(new Date(alert.createdAt), "dd MMM HH:mm")}
          </p>
        </div>
        {alert.status === "open" && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Acknowledge</Button>
            </DialogTrigger>
            <DialogContent title="Acknowledge alert">
              <p className="mb-3 text-sm text-muted">{alert.title}</p>
              <Textarea placeholder="Optional comment for the audit trail" value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button className="mt-4 w-full" disabled={mut.isPending} onClick={() => mut.mutate()}>
                Confirm
              </Button>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {alert.ackComment && <p className="mt-3 text-sm text-muted">Note: {alert.ackComment}</p>}
    </article>
  );
}

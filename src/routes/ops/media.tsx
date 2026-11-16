import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getAppSession, listMedia, listVehicles, queueDeviceCommand } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/ops/media")({ component: MediaPage });

function MediaPage() {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["app-session"], queryFn: () => getAppSession() });
  const q = useQuery({ queryKey: ["media"], queryFn: () => listMedia() });
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => listVehicles() });
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const canAsk = ["super_admin", "company_admin", "field_admin", "tracker"].includes(session.data?.role ?? "");
  const snap = useMutation({
    mutationFn: () => queueDeviceCommand({ data: { vehicleId, kind: "snapshot" } }),
    onSuccess: () => {
      toast.success("Snapshot stored");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["media"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const units = (vehicles.data ?? []).filter((v) => !session.data?.companyId || v.company_id === session.data.companyId);
  return (
    <div>
      <PageHeader
        title="Dashcam & media"
        subtitle="Event stills and short clips stored against the vehicle and timestamp."
        actions={
          canAsk ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">Request snapshot</Button>
              </DialogTrigger>
              <DialogContent title="Manual snapshot">
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    snap.mutate();
                  }}
                >
                  <div className="space-y-1">
                    <Label>Vehicle</Label>
                    <select
                      required
                      className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm"
                      value={vehicleId}
                      onChange={(e) => setVehicleId(e.target.value)}
                    >
                      <option value="">Select…</option>
                      {units.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.plate} — {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button className="w-full" type="submit" disabled={snap.isPending || !vehicleId}>
                    Ask the camera
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />
      <div className="grid gap-3 px-4 pb-10 sm:grid-cols-2 lg:grid-cols-3 md:px-6">
        {(q.data ?? []).map((m) => (
          <article key={m.id} className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface">
            <img src={m.path} alt={m.caption ?? "Dashcam still"} className="h-40 w-full object-cover" />
            <div className="p-3">
              <div className="flex items-center gap-2">
                <Badge tone="muted">{m.kind}</Badge>
                {m.eventType && <Badge tone="idle">{m.eventType.replaceAll("_", " ")}</Badge>}
              </div>
              <h2 className="mt-2 text-sm font-medium">{m.caption}</h2>
              <p className="mt-1 text-xs text-muted">
                {m.vehicleName} · {m.plate} · {new Date(m.ts).toLocaleString()}
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

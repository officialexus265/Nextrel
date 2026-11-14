import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { assignDriver, listDrivers, listVehicles, saveDriver } from "@/lib/fleet/api";
import { behaviorLabel } from "@/lib/fleet/labels";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/ops/drivers")({ component: DriversPage });

function DriversPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["drivers"], queryFn: () => listDrivers() });
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => listVehicles() });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [licenseNo, setLicense] = useState("");
  const [phone, setPhone] = useState("");
  const mut = useMutation({
    mutationFn: () => saveDriver({ data: { name, licenseNo, phone } }),
    onSuccess: () => {
      toast.success("Driver added");
      setOpen(false);
      setName("");
      setLicense("");
      setPhone("");
      qc.invalidateQueries({ queryKey: ["drivers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const assign = useMutation({
    mutationFn: (input: { driverId: string; vehicleId: string | null }) => assignDriver({ data: input }),
    onSuccess: () => {
      toast.success("Assignment updated");
      qc.invalidateQueries({ queryKey: ["drivers"] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["live-fleet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const units = vehicles.data ?? [];

  return (
    <div>
      <PageHeader
        title="Drivers"
        subtitle="One driver per unit. Reassignment closes the previous shift and keeps the history."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Add driver</Button>
            </DialogTrigger>
            <DialogContent title="New driver">
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  mut.mutate();
                }}
              >
                <div className="space-y-1"><Label>Name</Label><Input required value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1"><Label>Licence</Label><Input value={licenseNo} onChange={(e) => setLicense(e.target.value)} /></div>
                <div className="space-y-1"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                <Button className="w-full" type="submit" disabled={mut.isPending}>Save</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="grid gap-2 px-4 pb-10 md:px-6">
        {(q.data ?? []).map((d) => {
          const choices = units.filter((v) => v.company_id === d.companyId);
          return (
            <article key={d.id} className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:grid-cols-[1fr_16rem] sm:items-center">
              <div className="min-w-0">
                <div className="font-medium">{d.name}</div>
                <p className="mt-1 truncate text-sm text-muted">
                  {d.licenseNo ?? "No licence"} · {d.phone ?? "No phone"}
                </p>
                <p className="mt-1 text-xs text-subtle">
                  {d.harshWeek > 0
                    ? `${d.harshWeek} behaviour event${d.harshWeek === 1 ? "" : "s"} this week`
                    : "No harsh events this week"}
                  {d.lastBehavior ? ` · last ${behaviorLabel(d.lastBehavior).toLowerCase()}` : ""}
                </p>
              </div>
              <label className="text-xs text-subtle">
                Assigned unit
                <select
                  className="mt-1 h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm text-fg"
                  value={d.vehicleId ?? ""}
                  disabled={assign.isPending}
                  onChange={(e) => assign.mutate({ driverId: d.id, vehicleId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {choices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate} — {v.name}
                    </option>
                  ))}
                </select>
              </label>
            </article>
          );
        })}
        {q.isSuccess && (q.data ?? []).length === 0 && (
          <p className="text-sm text-muted">No drivers in this company yet.</p>
        )}
      </div>
    </div>
  );
}

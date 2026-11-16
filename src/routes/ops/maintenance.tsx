import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { completeMaintenance, deleteMaintenance, listMaintenance, listVehicles, saveMaintenance } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/ops/maintenance")({ component: MaintenancePage });

function MaintenancePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["maintenance"], queryFn: () => listMaintenance() });
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => listVehicles() });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [title, setTitle] = useState("");
  const [dueOdometer, setDueOdometer] = useState("");
  const [dueHours, setDueHours] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const mut = useMutation({
    mutationFn: (id: string) => completeMaintenance({ data: { id } }),
    onSuccess: () => {
      toast.success("Marked complete");
      qc.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteMaintenance({ data: { id } }),
    onSuccess: () => {
      toast.success("Reminder deleted");
      qc.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const create = useMutation({
    mutationFn: () =>
      saveMaintenance({
        data: {
          id: editingId ?? undefined,
          vehicleId,
          title,
          dueOdometer: dueOdometer ? Number(dueOdometer) : undefined,
          dueHours: dueHours ? Number(dueHours) : undefined,
          dueDate: dueDate || undefined,
          notes: notes || undefined,
        },
      }),
    onSuccess: () => {
      toast.success(editingId ? "Reminder updated" : "Reminder saved");
      setOpen(false);
      setEditingId(null);
      setTitle("");
      setDueOdometer("");
      setDueHours("");
      setDueDate("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle="Reminders against odometer, engine hours, or a calendar date."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">New reminder</Button>
            </DialogTrigger>
            <DialogContent title={editingId ? "Edit service reminder" : "Service reminder"}>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate();
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
                    {(vehicles.data ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate} — {v.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Work</Label>
                  <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Oil and filters" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Due km</Label>
                    <Input inputMode="numeric" value={dueOdometer} onChange={(e) => setDueOdometer(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Due engine hours</Label>
                    <Input inputMode="numeric" value={dueHours} onChange={(e) => setDueHours(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Due date</Label>
                    <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Note</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <Button className="w-full" type="submit" disabled={create.isPending || !vehicleId}>
                  Save reminder
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="space-y-2 px-4 pb-10 md:px-6">
        {(q.data ?? []).map((m) => {
          const remainKm = m.dueOdometer != null ? m.dueOdometer - m.odometerKm : null;
          const overdue = m.status === "open" && ((remainKm != null && remainKm <= 0) || (m.dueDate != null && new Date(m.dueDate).getTime() < Date.now()));
          return (
            <article key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4">
              <div className="min-w-0">
                <div className="font-medium">{m.title}</div>
                <p className="text-sm text-muted">
                  {m.vehicleName} · {m.plate}
                  {m.dueOdometer != null ? ` · due ${Math.round(m.dueOdometer).toLocaleString()} km` : ""}
                  {m.dueDate ? ` · ${String(m.dueDate).slice(0, 10)}` : ""}
                </p>
                {m.notes && <p className="mt-1 text-sm text-subtle">{m.notes}</p>}
                {remainKm != null && m.status === "open" && (
                  <p className={overdue ? "mt-1 text-sm text-down" : "mt-1 text-sm text-muted"}>
                    {overdue ? `${Math.abs(Math.round(remainKm)).toLocaleString()} km past due` : `${Math.round(remainKm).toLocaleString()} km remaining`}
                    {` · meter ${Math.round(m.odometerKm).toLocaleString()} km`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={m.status === "open" ? (overdue ? "down" : "idle") : "live"}>{overdue ? "due" : m.status}</Badge>
                {m.status === "open" && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => mut.mutate(m.id)} disabled={mut.isPending}>
                      Complete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      setEditingId(m.id);
                      setVehicleId(m.vehicleId);
                      setTitle(m.title);
                      setDueOdometer(m.dueOdometer == null ? "" : String(m.dueOdometer));
                      setDueHours(m.dueHours == null ? "" : String(m.dueHours));
                      setDueDate(m.dueDate ? String(m.dueDate).slice(0, 10) : "");
                      setNotes(m.notes ?? "");
                      setOpen(true);
                    }}>Edit</Button>
                    <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => {
                      if (window.confirm(`Delete reminder "${m.title}"?`)) remove.mutate(m.id);
                    }}>Delete</Button>
                  </>
                )}
              </div>
            </article>
          );
        })}
        {q.isSuccess && (q.data ?? []).length === 0 && <p className="text-sm text-muted">No service reminders yet.</p>}
      </div>
    </div>
  );
}

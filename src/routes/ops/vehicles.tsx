import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { deleteVehicle, listVehicles, saveVehicle } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/ops/vehicles")({ component: VehiclesPage });

function VehiclesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["vehicles"], queryFn: () => listVehicles() });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [companyId, setCompanyId] = useState("");
  const remove = useMutation({
    mutationFn: (id: string) => deleteVehicle({ data: { id } }),
    onSuccess: () => {
      toast.success("Vehicle removed");
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["live-fleet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mut = useMutation({
    mutationFn: () => saveVehicle({ data: { id: editingId ?? undefined, name, plate, make, model, companyId: companyId || undefined } }),
    onSuccess: () => {
      toast.success(editingId ? "Vehicle updated" : "Vehicle saved");
      setOpen(false);
      setEditingId(null);
      setName("");
      setPlate("");
      qc.invalidateQueries({ queryKey: ["vehicles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Vehicles"
        subtitle="Fleet register, odometer, and device assignment."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => {
                setEditingId(null);
                setName("");
                setPlate("");
                setMake("");
                setModel("");
                setCompanyId("");
              }}>Add vehicle</Button>
            </DialogTrigger>
            <DialogContent title={editingId ? "Edit vehicle" : "New vehicle"}>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  mut.mutate();
                }}
              >
                <div className="space-y-1"><Label>Name</Label><Input required value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1"><Label>Plate</Label><Input required value={plate} onChange={(e) => setPlate(e.target.value)} /></div>
                <div className="space-y-1"><Label>Make</Label><Input value={make} onChange={(e) => setMake(e.target.value)} /></div>
                <div className="space-y-1"><Label>Model</Label><Input value={model} onChange={(e) => setModel(e.target.value)} /></div>
                <Button className="w-full" type="submit" disabled={mut.isPending}>{editingId ? "Save changes" : "Save"}</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="overflow-x-auto px-4 pb-10 md:px-6">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.12em] text-subtle">
            <tr>
              {["Unit", "Plate", "Vehicle", "Driver", "Odometer", "Hours", "IMEI", "Company", "Actions"].map((h) => (
                <th key={h} className="px-2 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((v) => (
              <tr key={v.id} className="border-t border-border">
                <td className="px-2 py-2">
                  <Link to="/ops/vehicles/$vehicleId" params={{ vehicleId: v.id }} className="hover:underline">
                    {v.name}
                  </Link>
                </td>
                <td className="px-2 py-2 font-mono">{v.plate}</td>
                <td className="px-2 py-2 text-muted">{[v.make, v.model].filter(Boolean).join(" ")}</td>
                <td className="px-2 py-2 text-muted">{v.driver_name ?? "—"}</td>
                <td className="tabular px-2 py-2">{Math.round(v.odometer_km).toLocaleString()} km</td>
                <td className="tabular px-2 py-2">{Math.round(v.engine_hours)}</td>
                <td className="px-2 py-2 font-mono text-xs text-muted">{v.imei ?? "Unassigned"}</td>
                <td className="px-2 py-2 text-muted">{v.company_name}</td>
                <td className="px-2 py-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => {
                      setEditingId(v.id);
                      setName(v.name);
                      setPlate(v.plate);
                      setMake(v.make ?? "");
                      setModel(v.model ?? "");
                      setCompanyId(v.company_id);
                      setOpen(true);
                    }}>Edit</Button>
                    <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => {
                      if (window.confirm(`Delete vehicle "${v.plate}"? Vehicles with operational history cannot be deleted.`)) remove.mutate(v.id);
                    }}>Delete</Button>
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

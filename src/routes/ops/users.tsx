import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getAppSession, inviteUser, listTeam, setCompanyMark, setUserActive, updateUserRole } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/ops/users")({ component: UsersPage });

function UsersPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["team"], queryFn: () => listTeam() });
  const session = useQuery({ queryKey: ["app-session"], queryFn: () => getAppSession() });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"tracker" | "accounts" | "company_admin">("tracker");
  const accountStatus = useMutation({
    mutationFn: (input: { userId: string; active: boolean }) => setUserActive({ data: input }),
    onSuccess: () => {
      toast.success("Account status updated");
      qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const roleChange = useMutation({
    mutationFn: (input: { userId: string; role: "field_admin" | "company_admin" | "tracker" | "accounts" | "pending" }) => updateUserRole({ data: input }),
    onSuccess: () => {
      toast.success("User role updated");
      qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mut = useMutation({
    mutationFn: () => inviteUser({ data: { email, role, companyId: null } }),
    onSuccess: () => {
      toast.success("Invite recorded — they inherit this role on first sign-in");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Invites bind to email. The person signs in with Google, X, or email and receives the role automatically."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Invite</Button>
            </DialogTrigger>
            <DialogContent title="Invite user">
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  mut.mutate();
                }}
              >
                <div className="space-y-1"><Label>Email</Label><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div className="space-y-1">
                  <Label>Role</Label>
                  <select className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                    <option value="tracker">Tracker / monitor</option>
                    <option value="accounts">Accounts</option>
                    <option value="company_admin">Company admin</option>
                  </select>
                </div>
                <Button className="w-full" type="submit">Send invite</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="space-y-6 px-4 pb-10 md:px-6">
        {session.data?.role === "company_admin" && session.data.companyId && (
          <CompanyMark companyId={session.data.companyId} initial={session.data.companyMark} />
        )}
        <div>
        <h2 className="mb-2 text-xs uppercase tracking-[0.14em] text-subtle">Active</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.12em] text-subtle">
              <tr>{["Name", "Email", "Role", "Status", "Manage"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(q.data?.profiles ?? []).map((p) => (
                <tr key={p.user_id} className="border-t border-border">
                  <td className="px-2 py-2">{p.name ?? "—"}</td>
                  <td className="px-2 py-2 text-muted">{p.email ?? "—"}</td>
                  <td className="px-2 py-2">
                    {session.data?.realRole === "super_admin" && p.role !== "super_admin" ? (
                      <select
                        className="h-8 rounded-[var(--radius-xs)] border border-border bg-surface-2 px-2 text-xs"
                        value={p.role}
                        disabled={roleChange.isPending}
                        onChange={(e) => roleChange.mutate({ userId: p.user_id, role: e.target.value as "field_admin" | "company_admin" | "tracker" | "accounts" | "pending" })}
                      >
                        {(["field_admin", "company_admin", "tracker", "accounts", "pending"] as const).map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : <Badge tone="muted">{p.role}</Badge>}
                  </td>
                  <td className="px-2 py-2"><Badge tone={p.active ? "live" : "down"}>{p.active ? "Active" : "Deactivated"}</Badge></td>
                  <td className="px-2 py-2">
                    {session.data?.realRole === "super_admin" && p.role !== "super_admin" && p.user_id !== session.data.userId ? (
                      <Button size="sm" variant="ghost" disabled={accountStatus.isPending} onClick={() => {
                        const active = !p.active;
                        if (window.confirm(`${active ? "Reactivate" : "Deactivate"} ${p.email ?? p.name ?? "this account"}?`)) accountStatus.mutate({ userId: p.user_id, active });
                      }}>{p.active ? "Deactivate" : "Reactivate"}</Button>
                    ) : <span className="text-xs text-subtle">Protected</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2 className="mb-2 mt-8 text-xs uppercase tracking-[0.14em] text-subtle">Pending invites</h2>
        <ul className="space-y-2">
          {(q.data?.invites ?? []).map((i) => (
            <li key={i.id} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-border px-3 py-2 text-sm">
              <span>{i.email}</span>
              <Badge tone="idle">{i.role}</Badge>
            </li>
          ))}
          {(q.data?.invites ?? []).length === 0 && <p className="text-sm text-muted">No pending invites.</p>}
        </ul>
        </div>
      </div>
    </div>
  );
}

function CompanyMark({ companyId, initial }: { companyId: string; initial: string | null }) {
  const qc = useQueryClient();
  const [mark, setMark] = useState(initial ?? "");
  const save = useMutation({
    mutationFn: () => setCompanyMark({ data: { companyId, mark } }),
    onSuccess: (res) => {
      setMark(res.mark);
      toast.success("Mark updated");
      qc.invalidateQueries({ queryKey: ["app-session"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <Label>Company mark</Label>
        <p className="text-sm text-muted">Two to four letters shown beside your company name in the console.</p>
        <Input value={mark} maxLength={4} onChange={(e) => setMark(e.target.value.toUpperCase())} className="mt-2 w-28 uppercase" />
      </div>
      <Button type="submit" size="sm" disabled={save.isPending || mark.trim().length === 0}>
        Save mark
      </Button>
    </form>
  );
}

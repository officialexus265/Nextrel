import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { approveRegistration, listCompanies, listPendingRegistrations, rejectRegistration } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/ops/registrations")({ component: RegistrationsPage });

function RegistrationsPage() {
  const qc = useQueryClient();
  const pending = useQuery({ queryKey: ["pending-registrations"], queryFn: () => listPendingRegistrations() });
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => listCompanies() });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pending-registrations"] });
    qc.invalidateQueries({ queryKey: ["team"] });
  };
  const approve = useMutation({
    mutationFn: (input: { userId: string; role: "company_admin" | "tracker" | "accounts" | "field_admin"; companyId: string | null }) =>
      approveRegistration({ data: input }),
    onSuccess: () => { toast.success("Registration approved"); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const reject = useMutation({
    mutationFn: (input: { userId: string; reason?: string }) => rejectRegistration({ data: input }),
    onSuccess: () => { toast.success("Registration rejected"); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div>
      <PageHeader title="Pending registrations" subtitle="Only the System Owner can approve or reject new account registrations." />
      <div className="space-y-3 px-4 pb-10 md:px-6">
        <div className="flex items-center justify-between text-sm text-muted">
          <span>Awaiting decision</span>
          <Badge tone="idle">{pending.data?.length ?? 0} pending</Badge>
        </div>
        {(pending.data ?? []).map((item) => (
          <RegistrationCard key={item.user_id} item={item} companies={companies.data ?? []}
            busy={approve.isPending || reject.isPending}
            onApprove={(role, companyId) => approve.mutate({ userId: item.user_id, role, companyId })}
            onReject={() => {
              const reason = window.prompt("Optional reason for rejecting this registration:") ?? "";
              reject.mutate({ userId: item.user_id, reason });
            }}
          />
        ))}
        {!pending.isLoading && (pending.data ?? []).length === 0 && (
          <Card className="p-6 text-center">
            <h2 className="font-semibold">No pending registrations</h2>
            <p className="mt-1 text-sm text-muted">New registrations awaiting approval will appear here.</p>
          </Card>
        )}
        {pending.isError && <p className="text-sm text-down">Could not load pending registrations.</p>}
      </div>
    </div>
  );
}

function RegistrationCard({ item, companies, busy, onApprove, onReject }: {
  item: { user_id: string; name: string | null; email: string | null; created_at: string };
  companies: { id: string; name: string }[];
  busy: boolean;
  onApprove: (role: "company_admin" | "tracker" | "accounts" | "field_admin", companyId: string | null) => void;
  onReject: () => void;
}) {
  const [role, setRole] = useState<"company_admin" | "tracker" | "accounts" | "field_admin">("company_admin");
  const [companyId, setCompanyId] = useState("");
  useEffect(() => { if (!companyId && companies[0]) setCompanyId(companies[0].id); }, [companies, companyId]);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{item.name || "New user"}</h2>
          <p className="text-sm text-muted">{item.email || "No email available"}</p>
          <p className="mt-1 text-xs text-subtle">Registered {new Date(item.created_at).toLocaleString()}</p>
        </div>
        <Badge tone="idle">Pending</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted">Assign role
          <select className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="company_admin">Company Admin</option>
            <option value="tracker">Tracker</option>
            <option value="accounts">Accounts</option>
            <option value="field_admin">Field Admin</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted">Company
          <select className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg" value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={role === "field_admin"}>
            <option value="">Select company</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onReject}>Reject</Button>
        <Button disabled={busy || (role !== "field_admin" && !companyId)} onClick={() => onApprove(role, role === "field_admin" ? null : companyId)}>
          Approve account
        </Button>
      </div>
    </Card>
  );
}

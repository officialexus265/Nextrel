import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { createOwnershipTransfer, getAppSession, listCompanies, listOwnershipTransfers } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/ops/ownership")({ component: OwnershipPage });

function OwnershipPage() {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["app-session"], queryFn: () => getAppSession() });
  const transfers = useQuery({ queryKey: ["ownership-transfers"], queryFn: () => listOwnershipTransfers() });
  const companies = useQuery({
    queryKey: ["companies"],
    queryFn: () => listCompanies(),
    enabled: session.data?.realRole === "super_admin" || session.data?.isCompanyOwner === true,
  });
  const [emails, setEmails] = useState<Record<string, string>>({});
  const invite = useMutation({
    mutationFn: (input: { companyId: string; email: string }) => createOwnershipTransfer({ data: input }),
    onSuccess: () => {
      toast.success("Ownership invitation created. The recipient must sign in with that email and accept it.");
      qc.invalidateQueries({ queryKey: ["ownership-transfers"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const canManage = session.data?.realRole === "super_admin" || session.data?.isCompanyOwner === true;

  return (
    <div>
      <PageHeader title="Company ownership" subtitle="Ownership is separate from Company Admin privileges. Accepting ownership does not automatically grant operational access." />
      <div className="space-y-6 px-4 pb-10 md:px-6">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Ownership invitations and history</h2>
          {(transfers.data ?? []).map((transfer) => (
            <Card key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium">{transfer.company_name}</div>
                <div className="text-sm text-muted">{transfer.direction === "incoming" ? "Invited owner" : "Invitation sent to"} {transfer.to_email}</div>
                <div className="mt-1 text-xs text-subtle">Expires {new Date(transfer.expires_at).toLocaleString()}</div>
              </div>
              <Badge tone={transfer.status === "accepted" ? "live" : transfer.status === "pending" ? "idle" : "muted"}>{transfer.status}</Badge>
            </Card>
          ))}
          {(transfers.data ?? []).length === 0 && <p className="text-sm text-muted">No ownership invitations or transfers yet.</p>}
        </section>
        {canManage && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Invite or transfer a company owner</h2>
            {(companies.data ?? []).map((company) => (
              <Card key={company.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{company.name}</div>
                  <div className="text-xs text-muted">{company.city || "Location not set"}</div>
                </div>
                <Input type="email" placeholder="new.owner@example.com" value={emails[company.id] ?? ""} onChange={(e) => setEmails((old) => ({ ...old, [company.id]: e.target.value }))} className="sm:max-w-xs" />
                <Button size="sm" disabled={invite.isPending || !(emails[company.id] ?? "").includes("@")} onClick={() => invite.mutate({ companyId: company.id, email: emails[company.id].trim() })}>Send invitation</Button>
              </Card>
            ))}
            {(companies.data ?? []).length === 0 && <p className="text-sm text-muted">No companies are available in your scope.</p>}
          </section>
        )}
      </div>
    </div>
  );
}

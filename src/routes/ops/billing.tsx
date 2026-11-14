import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { listInvoices, markInvoice, getAppSession } from "@/lib/fleet/api";
import { buildInvoicePdf } from "@/lib/fleet/invoice-pdf";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/utils";
import type { InvoiceRow } from "@/lib/fleet/types";

export const Route = createFileRoute("/ops/billing")({ component: BillingPage });

function BillingPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["invoices"], queryFn: () => listInvoices() });
  const session = useQuery({ queryKey: ["app-session"], queryFn: () => getAppSession() });
  const canSettle = session.data?.realRole === "super_admin";
  const mut = useMutation({
    mutationFn: (id: string) => markInvoice({ data: { id, status: "paid" } }),
    onSuccess: () => {
      toast.success("Marked paid");
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="Billing" subtitle="Manual invoices at this stage — no payment gateway." />
      <div className="overflow-x-auto px-4 pb-10 md:px-6">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.12em] text-subtle">
            <tr>{["Invoice", "Company", "Period", "Vehicles", "Amount", "Status", "Due", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((i) => (
              <tr key={i.id} className="border-t border-border">
                <td className="px-2 py-2 font-mono text-xs">{i.number}</td>
                <td className="px-2 py-2">{i.companyName}</td>
                <td className="px-2 py-2 text-muted">{i.period}</td>
                <td className="tabular px-2 py-2">{i.vehicleCount}</td>
                <td className="tabular px-2 py-2">{money(i.amountCents)}</td>
                <td className="px-2 py-2">
                  <Badge tone={i.status === "paid" ? "live" : i.status === "due" ? "idle" : "muted"}>{i.status}</Badge>
                </td>
                <td className="px-2 py-2 text-muted">{i.dueDate ?? "—"}</td>
                <td className="px-2 py-2">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => downloadInvoice(i)}>
                      <Download className="size-3.5" /> PDF
                    </Button>
                    {canSettle && i.status !== "paid" && (
                      <Button size="sm" variant="ghost" onClick={() => mut.mutate(i.id)}>
                        Mark paid
                      </Button>
                    )}
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

function downloadInvoice(invoice: InvoiceRow) {
  const bytes = buildInvoicePdf(invoice);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${invoice.number}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listAudit } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";

export const Route = createFileRoute("/ops/audit")({ component: AuditPage });

function AuditPage() {
  const q = useQuery({ queryKey: ["audit"], queryFn: () => listAudit() });
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Immutable record of critical actions." />
      <ul className="space-y-2 px-4 pb-10 md:px-6">
        {(q.data ?? []).map((a) => (
          <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-sm">
            <span>
              <span className="font-mono text-xs text-live">{a.action}</span>
              {a.target ? <span className="text-muted"> · {a.target}</span> : null}
            </span>
            <span className="text-xs text-subtle">{new Date(a.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

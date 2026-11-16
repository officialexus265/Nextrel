import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { acceptOwnershipTransfer, getAppSession, listOwnershipTransfers } from "@/lib/fleet/api";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/ops")({ component: OpsLayout });

function OpsLayout() {
  const { user, isPending } = useCurrentUserState();
  const sessionQuery = useQuery({
    queryKey: ["app-session"],
    queryFn: () => getAppSession(),
    enabled: Boolean(user),
  });

  if (isPending) return <BootScreen label="Restoring session" />;
  if (!user) return <RedirectToSignIn />;
  if (sessionQuery.isPending) return <BootScreen label="Provisioning fleet" />;
  if (sessionQuery.error || !sessionQuery.data) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">Could not load your workspace</h1>
          <p className="mt-2 text-sm text-muted">
            {sessionQuery.error instanceof Error ? sessionQuery.error.message : "Unknown error"}
          </p>
          <Button className="mt-4" onClick={() => sessionQuery.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const session = sessionQuery.data;
  if (session.role === "pending") return <PendingWorkspace session={session} />;

  return (
    <AppShell session={session}>
      <Outlet />
    </AppShell>
  );
}

function BootScreen({ label }: { label: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg">
      <div className="w-64 space-y-3">
        <div className="text-center text-xs uppercase tracking-[0.2em] text-muted">{label}</div>
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-2 w-2/3 mx-auto" />
      </div>
    </div>
  );
}

function PendingWorkspace({ session }: { session: NonNullable<ReturnType<typeof useCurrentUserState>["user"]> extends never ? never : import("@/lib/fleet/types").SessionContext }) {
  const qc = useQueryClient();
  const invitations = useQuery({ queryKey: ["ownership-transfers"], queryFn: () => listOwnershipTransfers() });
  const accept = useMutation({
    mutationFn: (transferId: string) => acceptOwnershipTransfer({ data: { transferId } }),
    onSuccess: () => {
      toast.success("Company ownership accepted. Ask the System Owner to assign your operational role separately.");
      qc.invalidateQueries({ queryKey: ["ownership-transfers"] });
      qc.invalidateQueries({ queryKey: ["app-session"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-6 py-10">
      <div className="w-full max-w-xl space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{session.approvalStatus === "rejected" ? "Registration not approved" : "Access pending"}</h1>
          <p className="mt-2 text-sm text-muted">
            {session.approvalStatus === "rejected"
              ? "Your registration was declined. Contact the System Owner if you believe this was a mistake."
              : <>Your account is signed in as {session.email ?? "your email"}, but the System Owner has not assigned an operational role yet.</>}
          </p>
        </div>
        {(invitations.data ?? []).filter((item) => item.direction === "incoming" && item.status === "pending").map((item) => (
          <Card key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-medium">{item.company_name}</div>
              <p className="text-sm text-muted">You have been invited to become this company's owner.</p>
              <Badge tone="idle">Ownership pending</Badge>
            </div>
            <Button disabled={accept.isPending} onClick={() => accept.mutate(item.id)}>Accept ownership</Button>
          </Card>
        ))}
        {session.approvalStatus !== "rejected" && <p className="text-center text-xs text-subtle">Company ownership and Company Admin access are separate. Accepting ownership does not grant access to fleet operations.</p>}
      </div>
    </div>
  );
}

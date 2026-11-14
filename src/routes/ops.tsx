import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getAppSession } from "@/lib/fleet/api";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
  if (session.role === "pending") {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
        <div className="max-w-md">
          <h1 className="text-2xl font-semibold tracking-tight">Access pending</h1>
          <p className="mt-2 text-sm text-muted">
            Your account is signed in, but a platform owner has not assigned a company role yet. Ask them to send an invite to {session.email ?? "your email"}.
          </p>
        </div>
      </div>
    );
  }

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

import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getAppSession } from "@/lib/fleet/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NextrelMark } from "@/components/layout/app-shell";
import { useQuery } from "@tanstack/react-query";

/**
 * Super Admin / Platform Owner entry.
 * Not linked from the public landing page. Only accounts with realRole === "super_admin"
 * are allowed through; everyone else is signed out and shown access denied.
 */
export const Route = createFileRoute("/platform")({ component: PlatformLogin });

function PlatformLogin() {
  const { user, isPending } = useCurrentUserState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const sessionQuery = useQuery({
    queryKey: ["app-session-platform"],
    queryFn: () => getAppSession(),
    enabled: Boolean(user) && !denied,
    retry: false,
  });

  if (isPending) {
    return <div className="grid min-h-dvh place-items-center bg-bg text-muted">Loading…</div>;
  }

  if (user && !denied) {
    if (sessionQuery.isPending) {
      return <div className="grid min-h-dvh place-items-center bg-bg text-muted">Verifying access…</div>;
    }
    if (sessionQuery.data?.realRole === "super_admin") {
      return <Navigate to="/ops" />;
    }
    if (sessionQuery.data || sessionQuery.isError) {
      authClient.signOut().finally(() => setDenied(true));
      return (
        <div className="grid min-h-dvh place-items-center bg-bg px-4">
          <div className="max-w-sm text-center">
            <p className="text-sm text-down">Access denied</p>
            <p className="mt-2 text-sm text-muted">This entry point is reserved for the platform owner.</p>
          </div>
        </div>
      );
    }
  }

  if (denied) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg px-4">
        <div className="max-w-sm text-center">
          <p className="text-sm text-down">Access denied</p>
          <p className="mt-2 text-sm text-muted">This entry point is reserved for the platform owner.</p>
        </div>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signIn.email({ email, password, callbackURL: "/platform" });
      if (res.error) throw new Error(res.error.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-[var(--radius-xl)] border border-border bg-surface p-6 shadow-[var(--shadow-panel)]">
        <div className="mb-6 flex items-center gap-3">
          <NextrelMark />
          <div>
            <div className="text-sm font-semibold tracking-[0.2em]">Nextrel</div>
            <div className="text-xs text-muted">Platform access</div>
          </div>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Owner console</h1>
        <p className="mt-1 mb-5 text-sm text-muted">Restricted to the platform owner account.</p>

        {!authEnabled ? (
          <p className="text-sm text-muted">Authentication is disabled in this environment.</p>
        ) : (
          <form className="space-y-3" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                required
                minLength={8}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-down">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Verifying…" : "Authenticate"}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-[11px] text-subtle">
          Company and field users should use the standard sign-in page.
        </p>
      </div>
    </main>
  );
}

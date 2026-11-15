import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getAppSession } from "@/lib/fleet/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KestrelMark } from "@/components/layout/app-shell";
import { useQuery } from "@tanstack/react-query";

/**
 * Super Admin / Platform Owner entry.
 * Not linked from the public landing page. Only accounts with realRole === "super_admin"
 * are allowed through; everyone else is signed out and shown access denied.
 */
export const Route = createFileRoute("/platform")({ component: PlatformLogin });

const MAX_ATTEMPTS = 5;
const LOCK_MS = 30_000;

function PlatformLogin() {
  const { user, isPending } = useCurrentUserState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const signOutStarted = useRef(false);

  const sessionQuery = useQuery({
    queryKey: ["app-session-platform"],
    queryFn: () => getAppSession(),
    enabled: Boolean(user) && !denied,
    retry: false,
  });

  if (isPending) {
    return <div className="grid min-h-dvh place-items-center bg-bg text-muted">Loading…</div>;
  }

  useEffect(() => {
    if (!user || sessionQuery.isPending || denied || signOutStarted.current) return;
    if (sessionQuery.isError || (sessionQuery.data && sessionQuery.data.realRole !== "super_admin")) {
      signOutStarted.current = true;
      void authClient.signOut().catch(() => undefined).finally(() => setDenied(true));
    }
  }, [user, sessionQuery.isPending, sessionQuery.isError, sessionQuery.data, denied]);

  if (user && !denied) {
    if (sessionQuery.isPending) return <div className="grid min-h-dvh place-items-center bg-bg text-muted">Verifying access…</div>;
    if (sessionQuery.data?.realRole === "super_admin") return <Navigate to="/ops" />;
    if (sessionQuery.data || sessionQuery.isError) return <div className="grid min-h-dvh place-items-center bg-bg text-muted">Verifying platform access…</div>;
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

  const locked = Date.now() < lockedUntil;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (locked) {
      setError("Too many attempts. Wait a moment and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signIn.email({ email, password, callbackURL: "/platform" });
      if (res.error) throw new Error(res.error.message);
      setFails(0);
    } catch (err) {
      const next = fails + 1;
      setFails(next);
      if (next >= MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCK_MS);
        setFails(0);
        setError("Too many attempts. Wait 30 seconds and try again.");
      } else {
        setError(err instanceof Error ? err.message : "Sign-in failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-[var(--radius-xl)] border border-border bg-surface p-6 shadow-[var(--shadow-panel)]">
        <div className="mb-6 flex items-center gap-3">
          <KestrelMark />
          <div>
            <div className="text-sm font-semibold tracking-[0.2em]">KESTREL</div>
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
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-fg"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-down">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || locked}>
              {busy ? "Verifying…" : locked ? "Temporarily locked" : "Authenticate"}
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

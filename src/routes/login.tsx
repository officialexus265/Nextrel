import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NextrelMark } from "@/components/layout/app-shell";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isPending) {
    return <div className="grid min-h-dvh place-items-center bg-bg text-muted">Loading session…</div>;
  }
  if (user) return <Navigate to="/ops" />;

  async function onEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "up") {
        const res = await authClient.signUp.email({ email, password, name: name || email, callbackURL: "/ops" });
        if (res.error) throw new Error(res.error.message);
      } else {
        const res = await authClient.signIn.email({ email, password, callbackURL: "/ops" });
        if (res.error) throw new Error(res.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-[var(--radius-xl)] border border-border bg-surface p-6">
        <div className="mb-6 flex items-center gap-3">
          <NextrelMark />
          <div>
            <div className="text-sm font-semibold tracking-[0.2em]">Nextrel</div>
            <div className="text-xs text-muted">Fleet operations</div>
          </div>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 mb-5 text-sm text-muted">Company, field, and operations access.</p>
        {authEnabled ? (
          <div className="space-y-2">
            {GROK_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => signIn(p.providerId, { callbackURL: "/ops" })}
              >
                Continue with {p.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Sign-in is disabled.</p>
        )}
        <div className="my-5 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-[11px] uppercase tracking-[0.16em] text-subtle">Email</span>
          <Separator className="flex-1" />
        </div>
        <form className="space-y-3" onSubmit={onEmail}>
          {mode === "up" && (
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm text-down">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Working…" : mode === "up" ? "Create account" : "Sign in with email"}
          </Button>
        </form>
        <button
          type="button"
          className="mt-4 text-sm text-muted hover:text-fg"
          onClick={() => setMode(mode === "up" ? "in" : "up")}
        >
          {mode === "up" ? "Already have an account? Sign in" : "Need an account? Create one"}
        </button>
      </div>
    </main>
  );
}

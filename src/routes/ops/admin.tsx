import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createCompany, getHealth, getLandingSettings, inviteUser, listCompanies, setCompanyMark, setCompanyStatus, setLandingSettings, setViewAs } from "@/lib/fleet/api";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/ops/admin")({ component: AdminPage });

function AdminPage() {
  const qc = useQueryClient();
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => listCompanies() });
  const health = useQuery({ queryKey: ["health"], queryFn: () => getHealth(), retry: false });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("Nairobi");
  const [staffEmail, setStaffEmail] = useState("");
  const mut = useMutation({
    mutationFn: () => createCompany({ data: { name, city } }),
    onSuccess: () => {
      toast.success("Company created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const invite = useMutation({
    mutationFn: () => inviteUser({ data: { email: staffEmail, role: "field_admin", companyId: null } }),
    onSuccess: () => {
      toast.success("Field admin invite recorded");
      setStaffEmail("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const status = useMutation({
    mutationFn: (input: { companyId: string; status: "active" | "suspended" }) => setCompanyStatus({ data: input }),
    onSuccess: () => {
      toast.success("Company status updated");
      qc.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Platform"
        subtitle="Companies, field staff, and system health."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">New company</Button>
            </DialogTrigger>
            <DialogContent title="Create company">
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  mut.mutate();
                }}
              >
                <div className="space-y-1"><Label>Name</Label><Input required value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1"><Label>City</Label><Input value={city} onChange={(e) => setCity(e.target.value)} /></div>
                <Button className="w-full" type="submit">Create</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      {health.data && (
        <div className="mb-6 grid grid-cols-2 gap-3 px-4 sm:grid-cols-4 md:px-6">
          <Stat label="Companies" value={health.data.companies} />
          <Stat label="Vehicles" value={health.data.vehicles} />
          <Stat label="Devices" value={health.data.devices} />
          <Stat label="Online" value={`${health.data.linkPct}%`} />
          <Stat label="Positions" value={health.data.positions} />
          <Stat label="Fixes / hour" value={health.data.ingestHour} />
          <Stat label="Rejected / hour" value={health.data.ingestFail} />
          <Stat label="Open alerts" value={health.data.openAlerts} />
        </div>
      )}
      <div className="grid gap-3 px-4 md:grid-cols-2 md:px-6">
        {(companies.data ?? []).map((c) => (
          <Card key={c.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{c.name}</h2>
                <p className="text-sm text-muted">{c.city} · {c.vehicleCount} vehicles · {c.onlineCount} online</p>
              </div>
              <div className="flex gap-2">
                <Badge tone={c.status === "suspended" ? "down" : "live"}>{c.status}</Badge>
                <Badge tone={c.billingStatus === "current" ? "live" : c.billingStatus === "due" ? "idle" : "muted"}>
                  {c.billingStatus}
                </Badge>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => enter(c.id, "company_admin")}>
                Enter as admin
              </Button>
              <Button size="sm" variant="ghost" onClick={() => enter(c.id, "tracker")}>
                Tracker
              </Button>
              {health.data && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    status.mutate({
                      companyId: c.id,
                      status: c.status === "suspended" ? "active" : "suspended",
                    })
                  }
                >
                  {c.status === "suspended" ? "Restore" : "Suspend"}
                </Button>
              )}
              <MarkField companyId={c.id} mark={c.mark} />
            </div>
          </Card>
        ))}
      </div>
      <div className="mt-8 px-4 md:px-6">
        <h2 className="mb-3 text-sm font-semibold">Invite field staff</h2>
        <form
          className="flex max-w-lg flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <Input type="email" required placeholder="tech@installers.co" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)} />
          <Button type="submit">Invite</Button>
        </form>
      </div>

      <LandingMediaPanel />
    </div>
  );
}

function LandingMediaPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["landing-settings"], queryFn: () => getLandingSettings() });
  const [heroType, setHeroType] = useState<"none" | "image" | "video">("none");
  const [heroUrl, setHeroUrl] = useState("");
  const [headline, setHeadline] = useState("");
  const [subhead, setSubhead] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (q.data && !hydrated) {
      setHeroType(q.data.heroType);
      setHeroUrl(q.data.heroUrl);
      setHeadline(q.data.headline);
      setSubhead(q.data.subhead);
      setHydrated(true);
    }
  }, [q.data, hydrated]);

  const save = useMutation({
    mutationFn: () =>
      setLandingSettings({
        data: { heroType, heroUrl, headline, subhead },
      }),
    onSuccess: () => {
      toast.success("Landing page updated");
      qc.invalidateQueries({ queryKey: ["landing-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-10 border-t border-border px-4 pt-8 md:px-6">
      <h2 className="mb-1 text-sm font-semibold">Landing page</h2>
      <p className="mb-4 text-sm text-muted">
        Control the public homepage hero. Use a direct image or muted video URL (Cloudflare R2, CDN, or any public link).
      </p>
      <div className="grid max-w-2xl gap-3">
        <div className="space-y-1.5">
          <Label>Media type</Label>
          <div className="flex flex-wrap gap-2">
            {(["none", "image", "video"] as const).map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={heroType === t ? "default" : "secondary"}
                onClick={() => setHeroType(t)}
              >
                {t === "none" ? "None" : t === "image" ? "Image" : "Video"}
              </Button>
            ))}
          </div>
        </div>
        {heroType !== "none" && (
          <div className="space-y-1.5">
            <Label>Media URL</Label>
            <Input
              value={heroUrl}
              onChange={(e) => setHeroUrl(e.target.value)}
              placeholder="https://…/hero.mp4 or .jpg"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Headline</Label>
          <Input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={160} />
        </div>
        <div className="space-y-1.5">
          <Label>Subhead</Label>
          <Input value={subhead} onChange={(e) => setSubhead(e.target.value)} maxLength={400} />
        </div>
        <div>
          <Button type="button" disabled={save.isPending || !headline.trim()} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save landing"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MarkField({ companyId, mark }: { companyId: string; mark: string | null }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(mark ?? "");
  const save = useMutation({
    mutationFn: () => setCompanyMark({ data: { companyId, mark: value } }),
    onSuccess: () => {
      toast.success("Company mark saved");
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["app-session"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Input
        value={value}
        maxLength={4}
        aria-label="Company mark"
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        className="h-9 w-16 uppercase"
      />
      <Button type="submit" size="sm" variant="ghost" disabled={save.isPending || value.trim().length === 0}>
        Mark
      </Button>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-surface p-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-subtle">{label}</div>
      <div className="tabular text-xl font-semibold">{value}</div>
    </div>
  );
}

async function enter(companyId: string, role: "company_admin" | "tracker") {
  await setViewAs({ data: { role, companyId } });
  window.location.href = "/ops";
}

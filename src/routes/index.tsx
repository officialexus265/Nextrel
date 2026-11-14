import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getLandingSettings } from "@/lib/fleet/api";
import { Button } from "@/components/ui/button";
import { KestrelMark } from "@/components/layout/app-shell";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user } = useCurrentUserState();
  if (user) return <Navigate to="/ops" />;

  const settings = useQuery({
    queryKey: ["landing-settings"],
    queryFn: () => getLandingSettings(),
    staleTime: 60_000,
  });

  const heroType = settings.data?.heroType ?? "none";
  const heroUrl = settings.data?.heroUrl?.trim() ?? "";
  const headline = settings.data?.headline ?? "Command every kilometre.";
  const subhead =
    settings.data?.subhead ??
    "Real-time tracking, fuel integrity, and geofence discipline for fleets that cannot afford surprises.";

  const hasMedia = (heroType === "image" || heroType === "video") && heroUrl.length > 0;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-bg">
      {hasMedia && heroType === "video" && (
        <video
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40"
          autoPlay
          muted
          loop
          playsInline
        >
          <source src={heroUrl} />
        </video>
      )}
      {hasMedia && heroType === "image" && (
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-45"
          style={{ backgroundImage: `url(${heroUrl})` }}
        />
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bg/80 via-bg/55 to-bg" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_transparent_0%,_var(--color-bg)_70%)]" />

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #eceef2 1px, transparent 1px), linear-gradient(to bottom, #eceef2 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <div className="flex items-center gap-2.5">
          <KestrelMark />
          <span className="text-sm font-semibold tracking-[0.22em]">KESTREL</span>
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link to="/login">Sign in</Link>
        </Button>
      </header>

      <section className="relative z-10 mx-auto flex max-w-6xl flex-col justify-center px-5 pb-24 pt-16 md:min-h-[calc(100dvh-5.5rem)] md:pb-32 md:pt-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-live">Fleet operations platform</p>
        <h1 className="mt-5 max-w-3xl text-[2.6rem] font-semibold leading-[1.08] tracking-tight md:text-6xl lg:text-7xl">
          {headline}
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted md:text-lg">{subhead}</p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Button asChild size="lg" className="h-12 px-7 text-sm tracking-wide">
            <Link to="/login">
              Enter console
              <ArrowRight className="ml-1.5 size-4" />
            </Link>
          </Button>
        </div>

        <div className="mt-20 flex flex-wrap gap-x-10 gap-y-3 text-[11px] uppercase tracking-[0.18em] text-subtle">
          <span>Live GPS</span>
          <span className="hidden sm:inline">·</span>
          <span>Fuel integrity</span>
          <span className="hidden sm:inline">·</span>
          <span>Geofence discipline</span>
          <span className="hidden sm:inline">·</span>
          <span>Multi-tenant</span>
        </div>
      </section>
    </main>
  );
}

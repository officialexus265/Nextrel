import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  Building2,
  Camera,
  ChevronDown,
  ClipboardList,
  Fuel,
  Gauge,
  LayoutDashboard,
  Map as MapIcon,
  Menu,
  Radio,
  Route as RouteIcon,
  ScrollText,
  Settings2,
  Shield,
  SlidersHorizontal,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import { UserButton } from "@/lib/auth/gates";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setViewAs } from "@/lib/fleet/api";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import type { Role, SessionContext } from "@/lib/fleet/types";
import { cn } from "@/lib/utils";

type Item = { to: string; label: string; icon: typeof MapIcon };

function navFor(role: Role): Item[] {
  if (role === "accounts") {
    return [
      { to: "/ops/billing", label: "Invoices", icon: ClipboardList },
      { to: "/ops/reports", label: "Usage", icon: Gauge },
    ];
  }
  if (role === "field_admin") {
    return [
      { to: "/ops/admin", label: "Assignments", icon: Building2 },
      { to: "/ops/devices", label: "Devices", icon: Radio },
      { to: "/ops/vehicles", label: "Vehicles", icon: Truck },
    ];
  }
  if (role === "super_admin") {
    return [
      { to: "/ops", label: "Live map", icon: MapIcon },
      { to: "/ops/brief", label: "Brief", icon: LayoutDashboard },
      { to: "/ops/admin", label: "Companies", icon: Building2 },
      { to: "/ops/control", label: "Control", icon: Settings2 },
      { to: "/ops/devices", label: "Inventory", icon: Radio },
      { to: "/ops/alerts", label: "Alerts", icon: Bell },
      { to: "/ops/billing", label: "Billing", icon: ClipboardList },
      { to: "/ops/audit", label: "Audit", icon: ScrollText },
    ];
  }
  const ops: Item[] = [
    { to: "/ops", label: "Live map", icon: MapIcon },
    { to: "/ops/brief", label: "Brief", icon: LayoutDashboard },
    { to: "/ops/alerts", label: "Alerts", icon: Bell },
    { to: "/ops/playback", label: "Playback", icon: RouteIcon },
    { to: "/ops/reports", label: "Reports", icon: Gauge },
  ];
  if (role === "company_admin") {
    ops.push(
      { to: "/ops/vehicles", label: "Vehicles", icon: Truck },
      { to: "/ops/geofences", label: "Geofences", icon: Shield },
      { to: "/ops/rules", label: "Rules", icon: SlidersHorizontal },
      { to: "/ops/drivers", label: "Drivers", icon: Users },
      { to: "/ops/devices", label: "Devices", icon: Radio },
      { to: "/ops/maintenance", label: "Service", icon: Wrench },
      { to: "/ops/media", label: "Media", icon: Camera },
      { to: "/ops/users", label: "Users", icon: Users },
      { to: "/ops/billing", label: "Billing", icon: ClipboardList },
    );
  } else {
    ops.push({ to: "/ops/media", label: "Media", icon: Camera });
  }
  return ops;
}

const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Platform owner",
  field_admin: "Field staff",
  company_admin: "Company admin",
  tracker: "Tracker",
  accounts: "Accounts",
  pending: "Pending",
};

export function AppShell({
  session,
  children,
}: {
  session: SessionContext;
  children: React.ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = navFor(session.role);
  const mobile = items.slice(0, 3);
  const overflow = items.slice(3);
  const moreActive = overflow.some((item) => pathname === item.to || (item.to !== "/ops" && pathname.startsWith(item.to)));

  async function viewAs(role: SessionContext["role"], companyId: string | null) {
    await setViewAs({ data: { role: role as "super_admin" | "field_admin" | "company_admin" | "tracker" | "accounts", companyId } });
    window.location.reload();
  }

  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <NextrelMark />
          <div>
            <div className="text-sm font-semibold tracking-[0.18em]">Nextrel</div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-subtle">Fleet ops</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2 pb-4">
          {items.map((item) => {
            const active = pathname === item.to || (item.to !== "/ops" && pathname.startsWith(item.to));
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex h-10 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-sm text-muted hover:bg-surface-2 hover:text-fg",
                  active && "bg-surface-2 text-fg",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 border-t border-border p-3">
          {session.companyMark ? (
            <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border bg-surface-2 text-[11px] font-semibold tracking-[0.12em]">
              {session.companyMark}
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] text-subtle">{ROLE_LABEL[session.role]}</div>
            <div className="truncate text-sm">{session.companyName ?? session.name ?? "Nextrel"}</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b border-border bg-surface/80 px-3 backdrop-blur md:px-5">
          <div className="flex items-center gap-2 md:hidden">
            <NextrelMark />
            <span className="text-sm font-semibold tracking-[0.14em]">Nextrel</span>
          </div>
          {session.impersonating && (
            <Badge tone="idle">Viewing as {ROLE_LABEL[session.role]}{session.companyName ? ` · ${session.companyName}` : ""}</Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            {session.realRole === "super_admin" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm">
                    View as <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Platform</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => viewAs("super_admin", null)}>Platform owner</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => viewAs("field_admin", null)}>Field staff</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Meridian Logistics</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => viewAs("company_admin", "co_meridian")}>Admin</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => viewAs("tracker", "co_meridian")}>Tracker</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => viewAs("accounts", "co_meridian")}>Accounts</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Harbor Guard</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => viewAs("company_admin", "co_harbor")}>Admin</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => viewAs("tracker", "co_harbor")}>Tracker</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => viewAs("accounts", "co_harbor")}>Accounts</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <div className="hidden items-center gap-2 text-xs text-muted sm:flex">
              <Activity className="size-3.5 text-live" />
              Live
            </div>
            <UserButton />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto pb-16 md:pb-0">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-surface/95 backdrop-blur md:hidden">
          {mobile.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to || (item.to !== "/ops" && pathname.startsWith(item.to));
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 text-[11px] text-muted",
                  active && "text-fg",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
          {overflow.length > 0 ? (
            <Sheet>
              <SheetTrigger className={cn("flex h-14 flex-col items-center justify-center gap-1 text-[11px] text-muted", moreActive && "text-fg")}>
                <Menu className="size-4" />
                More
              </SheetTrigger>
              <SheetContent side="bottom" title="More">
                <div className="grid grid-cols-2 gap-2 pb-2">
                  {overflow.map((item) => {
                    const Icon = item.icon;
                    const active = pathname === item.to || (item.to !== "/ops" && pathname.startsWith(item.to));
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={cn(
                          "flex h-12 items-center gap-2 rounded-[var(--radius-sm)] border border-border px-3 text-sm text-muted",
                          active && "bg-surface-2 text-fg",
                        )}
                      >
                        <Icon className="size-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </div>
  );
}

export function NextrelMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 place-items-center rounded-[var(--radius-sm)] bg-surface-2", className)}>
      <Fuel className="size-4 text-live" />
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-5 md:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-border px-6 py-12 text-center">
      <LayoutDashboard className="mx-auto mb-3 size-6 text-subtle" />
      <div className="font-medium">{title}</div>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}

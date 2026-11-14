import type { Sql } from "@/lib/db";
import { nid, toIso } from "@/lib/utils";

export const FLAG_DEFS = [
  { key: "offline", label: "Offline alerts", detail: "Raise when a unit stops reporting." },
  { key: "speeding", label: "Speeding", detail: "Limit plus the company grace." },
  { key: "fuel_theft", label: "Fuel theft", detail: "Sudden drop while nearly stopped." },
  { key: "long_idle", label: "Long idle", detail: "Engine on and not moving." },
  { key: "geofence", label: "Geofences", detail: "Entry and exit on active fences." },
  { key: "mail_dispatch", label: "Mail desk", detail: "File scheduled reports here. Nothing leaves the platform." },
] as const;

export type FlagKey = (typeof FLAG_DEFS)[number]["key"];
export type EngineFlags = Record<FlagKey, boolean>;

const FLAG_KEYS = new Set<string>(FLAG_DEFS.map((f) => f.key));

export function companyMarkFromName(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const raw = words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? "KX").slice(0, 2);
  const mark = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return mark.slice(0, 4) || "KX";
}

function asBool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === "t" || value === "true" || value === 1 || value === "1") return true;
  if (value === "f" || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

export async function loadFlags(sql: Sql): Promise<EngineFlags> {
  const flags = Object.fromEntries(FLAG_DEFS.map((f) => [f.key, true])) as EngineFlags;
  const rows = await sql<{ key: string; enabled: boolean }>`select key, enabled from feature_flags`;
  for (const row of rows) {
    if (FLAG_KEYS.has(row.key)) flags[row.key as FlagKey] = asBool(row.enabled, true);
  }
  return flags;
}

export function pausedLabels(flags: EngineFlags) {
  return FLAG_DEFS.filter((f) => f.key !== "mail_dispatch" && !flags[f.key]).map((f) => f.label);
}

export async function ensureControlDefaults(sql: Sql) {
  const companies = await sql<{ id: string; name: string; mark: string | null }>`
    select id, name, mark from companies order by name
  `;
  if (companies.length === 0) return;
  for (const company of companies) {
    if (company.mark) continue;
    await sql`
      update companies set mark = ${companyMarkFromName(company.name)}
      where id = ${company.id} and mark is null
    `;
  }
  const count = await sql<{ n: number }>`select count(*)::int as n from report_schedules`;
  if ((count[0]?.n ?? 0) > 0) return;
  const due = new Date(Date.now() - 60 * 60_000).toISOString();
  const meridian = companies.find((c) => c.id === "co_meridian") ?? companies[0];
  const harbor = companies.find((c) => c.id === "co_harbor");
  if (meridian) {
    await sql`
      insert into report_schedules (id, company_id, kind, cadence, recipient, enabled, next_run)
      values (${"sch_seed_trips"}, ${meridian.id}, 'trips', 'daily', ${"ops@meridian.example"}, true, ${due})
      on conflict (id) do nothing
    `;
  }
  if (harbor) {
    await sql`
      insert into report_schedules (id, company_id, kind, cadence, recipient, enabled, next_run)
      values (${"sch_seed_fuel"}, ${harbor.id}, 'fuel', 'weekly', ${"accounts@harbor.example"}, true, ${due})
      on conflict (id) do nothing
    `;
  }
}

type ScheduleSql = {
  id: string;
  company_id: string;
  company_name: string;
  kind: string;
  cadence: string;
  recipient: string;
  enabled: boolean;
  next_run: string;
  last_run: string | null;
};

async function loadSchedule(sql: Sql, id: string) {
  const rows = await sql<ScheduleSql>`
    select s.id, s.company_id, c.name as company_name, s.kind, s.cadence, s.recipient, s.enabled, s.next_run, s.last_run
    from report_schedules s
    join companies c on c.id = s.company_id
    where s.id = ${id}
  `;
  return rows[0];
}

function nextRunFrom(cadence: string, from = Date.now()) {
  const days = cadence === "weekly" ? 7 : 1;
  return new Date(from + days * 86400000).toISOString();
}

async function snapshot(sql: Sql, companyId: string, cadence: string) {
  const daily = cadence !== "weekly";
  const trips = daily
    ? await sql<{ n: number; km: number; litres: number }>`
        select count(*)::int as n,
               coalesce(sum(distance_km), 0) as km,
               coalesce(sum(fuel_used), 0) as litres
        from trips
        where company_id = ${companyId} and started_at > now() - interval '1 day'
      `
    : await sql<{ n: number; km: number; litres: number }>`
        select count(*)::int as n,
               coalesce(sum(distance_km), 0) as km,
               coalesce(sum(fuel_used), 0) as litres
        from trips
        where company_id = ${companyId} and started_at > now() - interval '7 days'
      `;
  const alerts = await sql<{ n: number }>`
    select count(*)::int as n from alerts where company_id = ${companyId} and status = 'open'
  `;
  const row = trips[0];
  return {
    trips: Number(row?.n ?? 0),
    km: Math.round(Number(row?.km ?? 0)),
    litres: Math.round(Number(row?.litres ?? 0) * 10) / 10,
    openAlerts: Number(alerts[0]?.n ?? 0),
    window: daily ? "last 24 hours" : "last 7 days",
  };
}

const KIND_LABEL: Record<string, string> = {
  trips: "Trips",
  fuel: "Fuel",
  offline: "Offline",
  speeding: "Speeding",
  stops: "Stops",
};

export async function fileSchedule(sql: Sql, id: string, force = false) {
  const schedule = await loadSchedule(sql, id);
  if (!schedule || !asBool(schedule.enabled, true)) return false;
  const due = new Date(toIso(schedule.next_run)).getTime() <= Date.now();
  if (!force && !due) return false;
  const next = nextRunFrom(schedule.cadence);
  const claimed = force
    ? await sql<{ id: string }>`
        update report_schedules
        set last_run = now(), next_run = ${next}
        where id = ${id}
        returning id
      `
    : await sql<{ id: string }>`
        update report_schedules
        set last_run = now(), next_run = ${next}
        where id = ${id} and next_run <= now()
        returning id
      `;
  if (!claimed[0]) return false;
  const stats = await snapshot(sql, schedule.company_id, schedule.cadence);
  const label = KIND_LABEL[schedule.kind] ?? schedule.kind;
  const cadenceLabel = schedule.cadence === "weekly" ? "Weekly" : "Daily";
  const subject = `${schedule.company_name} · ${cadenceLabel.toLowerCase()} ${label.toLowerCase()} report`;
  const body = [
    schedule.company_name,
    `${cadenceLabel} ${label.toLowerCase()} report`,
    `Window: ${stats.window} (Africa/Nairobi)`,
    "",
    `Trips: ${stats.trips}`,
    `Distance: ${stats.km} km`,
    `Fuel logged: ${stats.litres} L`,
    `Open alerts: ${stats.openAlerts}`,
    "",
    "Filed on the Nextrel mail desk. A mail relay is not connected, so this copy stayed on the platform.",
  ].join("\n");
  await sql`
    insert into mail_queue (id, company_id, to_email, subject, body, kind, status)
    values (${nid("mail")}, ${schedule.company_id}, ${schedule.recipient}, ${subject}, ${body}, ${schedule.kind}, 'filed')
  `;
  return true;
}

export async function dispatchDueReports(sql: Sql, scope: string[] | null) {
  const flags = await loadFlags(sql);
  if (!flags.mail_dispatch) return { filed: 0, paused: true };
  const due = await sql<{ id: string; company_id: string }>`
    select id, company_id from report_schedules
    where enabled = true and next_run <= now()
  `;
  let filed = 0;
  for (const row of due) {
    if (scope && !scope.includes(row.company_id)) continue;
    if (await fileSchedule(sql, row.id, false)) filed += 1;
  }
  return { filed, paused: false };
}

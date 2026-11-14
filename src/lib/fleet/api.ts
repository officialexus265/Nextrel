import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { nid, toIso } from "@/lib/utils";
import { inScope, parseGeom } from "./session";
import { parseSchedule, reverseGeocode } from "./geo";
import { decode, sniffDecoder, DECODER_NAMES, isDecoderName, type DecoderName, type NormalizedFix } from "./decoders";
import { behaviorLabel } from "./labels";
import { bucketKey, briefAxis, round1, type BriefWindow } from "./brief";
import {
  companyMarkFromName,
  dispatchDueReports,
  ensureControlDefaults,
  fileSchedule,
  FLAG_DEFS,
  loadFlags,
  pausedLabels,
  type FlagKey,
} from "./control";
import {
  AlertRow,
  AlertRuleConfig,
  AlertRuleRow,
  AuditRow,
  BehaviorChip,
  CompanyRow,
  DeviceRow,
  DriverRow,
  FlagRow,
  GeofenceRow,
  InvoiceRow,
  IngestRow,
  KpiSnapshot,
  LivePulse,
  LiveVehicle,
  MailRow,
  MaintenanceRow,
  MediaRow,
  MovementState,
  PositionRow,
  ScheduleRow,
  SessionContext,
  TripRow,
  DeskSession,
} from "./types";

const OFFLINE_MS = 8 * 60_000;

async function ctx(userId: string) {
  const { getSql } = await import("@/lib/db");
  const { bootstrapSession } = await import("./session");
  const sql = await getSql();
  const session = await bootstrapSession(sql, userId);
  return { sql, session };
}

async function companyScope(sql: Awaited<ReturnType<typeof ctx>>["sql"], session: SessionContext) {
  const mod = await import("./session");
  return mod.companyScope(sql, session);
}

function movementOf(args: {
  ts: string | null;
  speed: number;
  ignition: boolean;
}): MovementState {
  if (!args.ts) return "offline";
  const age = Date.now() - new Date(args.ts).getTime();
  if (age > OFFLINE_MS) return "offline";
  if (args.speed > 4) return "moving";
  if (args.ignition) return "idle";
  return "stopped";
}

export const getAppSession = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { session } = await ctx(context.userId);
    return session satisfies SessionContext;
  });

export const setViewAs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      role: z.enum(["super_admin", "field_admin", "company_admin", "tracker", "accounts"]),
      companyId: z.string().nullable(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin") throw new Error("Forbidden");
    if (data.role === "super_admin") {
      await sql`delete from view_overrides where user_id = ${session.userId}`;
    } else {
      await sql`
        insert into view_overrides (user_id, role, company_id, started_at)
        values (${session.userId}, ${data.role}, ${data.companyId}, ${new Date().toISOString()})
        on conflict (user_id) do update set role = excluded.role, company_id = excluded.company_id, started_at = excluded.started_at
      `;
    }
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${data.companyId}, ${session.userId}, 'impersonate', ${data.role})
    `;
    return (await import("./session")).bootstrapSession(sql, session.userId);
  });

const MALAWI_MAP_CENTER = { lat: -13.2543, lng: 34.3015, label: "Malawi" };
const MALAWI_CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  lilongwe: { lat: -13.9626, lng: 33.7741 }, blantyre: { lat: -15.7861, lng: 35.0058 },
  mzuzu: { lat: -11.4448, lng: 34.0118 }, zomba: { lat: -15.3850, lng: 35.3188 },
  kasungu: { lat: -13.0333, lng: 33.4833 }, mangochi: { lat: -14.4780, lng: 35.2640 },
  salima: { lat: -13.7800, lng: 34.4500 }, karonga: { lat: -9.9333, lng: 33.9333 },
  dedza: { lat: -14.3770, lng: 34.3330 }, ntcheu: { lat: -14.8200, lng: 34.6400 },
  chitipa: { lat: -9.7030, lng: 33.2700 }, nkhotakota: { lat: -12.9270, lng: 34.2960 },
  monkeybay: { lat: -14.0830, lng: 34.9170 },
};
function companyMapCenter(city: string | null | undefined) {
  const normalized = city?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  const key = Object.keys(MALAWI_CITY_CENTERS).find((name) => normalized.includes(name));
  return key ? { ...MALAWI_CITY_CENTERS[key], label: city?.trim() || key } : MALAWI_MAP_CENTER;
}

type LiveRow = {
  id: string;
  company_id: string;
  company_name: string;
  name: string;
  plate: string;
  make: string | null;
  model: string | null;
  color: string | null;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  heading: number | null;
  ignition: boolean | null;
  fuel_level: number | null;
  fuel_litres: number | null;
  address: string | null;
  ts: string | null;
  status_since: string;
  driver_name: string | null;
  speed_limit: number | null;
  default_speed: number;
  odometer_km: number;
  engine_hours: number;
  imei: string | null;
  gsm_signal: number | null;
  gps_signal: number | null;
  open_alerts: number | null;
};

function toLive(r: LiveRow): LiveVehicle | null {
  if (r.lat == null || r.lng == null) return null;
  const speed = r.speed ?? 0;
  const ignition = Boolean(r.ignition);
  const movement = movementOf({ ts: r.ts, speed, ignition });
  const statusSince = toIso(r.status_since);
  return {
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_name,
    name: r.name,
    plate: r.plate,
    make: r.make,
    model: r.model,
    color: r.color,
    lat: r.lat,
    lng: r.lng,
    speed,
    heading: r.heading ?? 0,
    ignition,
    fuelLevel: r.fuel_level,
    fuelLitres: r.fuel_litres,
    address: r.address,
    ts: r.ts ? toIso(r.ts) : new Date(0).toISOString(),
    movement,
    statusSince,
    durationMs: Math.max(0, Date.now() - new Date(statusSince).getTime()),
    driverName: r.driver_name,
    speedLimit: r.speed_limit ?? r.default_speed,
    odometerKm: r.odometer_km,
    engineHours: r.engine_hours,
    deviceImei: r.imei,
    gsmSignal: r.gsm_signal,
    gpsSignal: r.gps_signal,
    openAlerts: Number(r.open_alerts ?? 0),
  };
}

export const getLiveFleet = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    try {
      await (await import("./simulate")).tickSimulation(sql);
    } catch (err) {
      console.error("[kestrel] tick failed", err);
    }
    const scope = await companyScope(sql, session);
    let landingCompanyId = session.companyId;
    if (!landingCompanyId && scope?.length) {
      const assigned = await sql<{ id: string }>`select id from companies where id = any(${scope}) order by name limit 1`;
      landingCompanyId = assigned[0]?.id ?? null;
    }
    const landingRows = landingCompanyId
      ? await sql<{ city: string | null }>`select city from companies where id = ${landingCompanyId} limit 1`
      : [];
    const mapCenter = companyMapCenter(landingRows[0]?.city);
    const rows = await sql<LiveRow>`
      with latest as (
        select distinct on (vehicle_id) *
        from positions
        order by vehicle_id, ts desc
      )
      select
        v.id, v.company_id, c.name as company_name, v.name, v.plate, v.make, v.model, v.color,
        p.lat, p.lng, p.speed, p.heading, p.ignition, p.fuel_level, p.fuel_litres, p.address, p.ts,
        v.status_since, d.name as driver_name, v.speed_limit, c.default_speed_limit as default_speed,
        v.odometer_km, v.engine_hours, dev.imei, dev.gsm_signal, dev.gps_signal,
        coalesce(oa.open_alerts, 0) as open_alerts
      from vehicles v
      join companies c on c.id = v.company_id
      left join latest p on p.vehicle_id = v.id
      left join drivers d on d.id = v.assigned_driver_id
      left join devices dev on dev.vehicle_id = v.id
      left join (
        select vehicle_id, count(*)::int as open_alerts
        from alerts
        where status = 'open'
        group by vehicle_id
      ) oa on oa.vehicle_id = v.id
      order by v.name
    `;
    const vehicles = rows
      .filter((r) => inScope(scope, r.company_id))
      .map(toLive)
      .filter((v): v is LiveVehicle => Boolean(v));

    const kpis: KpiSnapshot = {
      vehicles: vehicles.length,
      online: vehicles.filter((v) => v.movement !== "offline").length,
      moving: vehicles.filter((v) => v.movement === "moving").length,
      idle: vehicles.filter((v) => v.movement === "idle").length,
      offline: vehicles.filter((v) => v.movement === "offline").length,
      openAlerts: 0,
      criticalAlerts: 0,
      fuelDrops24h: 0,
      distance24h: 0,
    };

    const alertCounts = await sql<{ open: number; crit: number }>`
      select
        count(*) filter (where status = 'open')::int as open,
        count(*) filter (where status = 'open' and severity = 'critical')::int as crit
      from alerts
    `;
    const fuelRows = await sql<{ company_id: string }>`
      select company_id from fuel_events
      where kind = 'drop' and ts > now() - interval '24 hours'
    `;
    const tripRows = await sql<{ company_id: string; km: number | null }>`
      select company_id, distance_km as km from trips
      where started_at > now() - interval '24 hours'
    `;
    const pulseRows = await sql<{
      id: string;
      title: string;
      severity: string;
      vehicle_id: string | null;
      vehicle_name: string | null;
      created_at: string;
      company_id: string;
    }>`
      select a.id, a.title, a.severity, a.vehicle_id, v.name as vehicle_name, a.created_at, a.company_id
      from alerts a
      left join vehicles v on v.id = a.vehicle_id
      where a.status = 'open'
      order by a.created_at desc
      limit 40
    `;
    kpis.openAlerts = alertCounts[0]?.open ?? 0;
    kpis.criticalAlerts = alertCounts[0]?.crit ?? 0;
    kpis.fuelDrops24h = fuelRows.filter((f) => inScope(scope, f.company_id)).length;
    kpis.distance24h = tripRows
      .filter((t) => inScope(scope, t.company_id))
      .reduce((sum, t) => sum + Number(t.km ?? 0), 0);

    if (scope) {
      const allOpen = await sql<{ company_id: string; severity: string }>`
        select company_id, severity from alerts where status = 'open'
      `;
      const scoped = allOpen.filter((a) => inScope(scope, a.company_id));
      kpis.openAlerts = scoped.length;
      kpis.criticalAlerts = scoped.filter((a) => a.severity === "critical").length;
    }

    const pulse: LivePulse[] = pulseRows
      .filter((a) => inScope(scope, a.company_id))
      .slice(0, 6)
      .map((a) => ({
        id: a.id,
        title: a.title,
        severity: a.severity as LivePulse["severity"],
        vehicleId: a.vehicle_id,
        vehicleName: a.vehicle_name,
        createdAt: toIso(a.created_at),
      }));

    const signalRows = await sql<{
      id: string;
      kind: string;
      severity: string;
      vehicle_id: string;
      vehicle_name: string;
      ts: string;
      company_id: string;
    }>`
      select b.id, b.kind, b.severity, b.vehicle_id, v.name as vehicle_name, b.ts, b.company_id
      from behavior_events b
      join vehicles v on v.id = b.vehicle_id
      where b.ts > now() - interval '12 hours'
      order by b.ts desc
      limit 12
    `;
    const signals: BehaviorChip[] = signalRows
      .filter((b) => inScope(scope, b.company_id))
      .slice(0, 4)
      .map((b) => ({
        id: b.id,
        title: `${behaviorLabel(b.kind)} — ${b.vehicle_name}`,
        kind: b.kind,
        severity: b.severity as BehaviorChip["severity"],
        vehicleId: b.vehicle_id,
        vehicleName: b.vehicle_name,
        ts: toIso(b.ts),
      }));

    const gfRows = await sql<{
      id: string;
      company_id: string;
      name: string;
      kind: string;
      group_name: string | null;
      zone_type: string;
      geometry: unknown;
      schedule: unknown;
      active: boolean;
    }>`select id, company_id, name, kind, group_name, zone_type, geometry, schedule, active from geofences`;
    const geofences: GeofenceRow[] = gfRows
      .filter((g) => inScope(scope, g.company_id))
      .map((g) => toGeofence(g));

    let paused: string[] = [];
    try {
      paused = pausedLabels(await loadFlags(sql));
    } catch {
      paused = [];
    }

    return { session, vehicles, kpis, geofences, pulse, signals, paused, mapCenter };
  });

export const listAlerts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    const rows = await sql<{
      id: string;
      company_id: string;
      company_name: string;
      vehicle_id: string | null;
      vehicle_name: string | null;
      plate: string | null;
      type: string;
      severity: string;
      title: string;
      body: string | null;
      lat: number | null;
      lng: number | null;
      status: string;
      ack_comment: string | null;
      created_at: string;
    }>`
      select a.id, a.company_id, c.name as company_name, a.vehicle_id, v.name as vehicle_name, v.plate,
        a.type, a.severity, a.title, a.body, a.lat, a.lng, a.status, a.ack_comment, a.created_at
      from alerts a
      join companies c on c.id = a.company_id
      left join vehicles v on v.id = a.vehicle_id
      order by a.created_at desc
      limit 200
    `;
    const scoped = rows.filter((r) => inScope(scope, r.company_id));
    const rules = await sql<{
      company_id: string;
      vehicle_id: string | null;
      type: string;
      config: unknown;
      enabled: boolean;
    }>`select company_id, vehicle_id, type, config, enabled from alert_rules`;
    return scoped.map((r): AlertRow => {
      const cfg = ruleConfig(
        pickRule(rules, r.company_id, r.vehicle_id, r.type)?.config,
      );
      const ageMin = (Date.now() - new Date(toIso(r.created_at)).getTime()) / 60_000;
      const escalated =
        r.status === "open" && cfg.escalateMin != null && cfg.escalateMin > 0 && ageMin >= cfg.escalateMin;
      return {
        id: r.id,
        companyId: r.company_id,
        companyName: r.company_name,
        vehicleId: r.vehicle_id,
        vehicleName: r.vehicle_name,
        plate: r.plate,
        type: r.type as AlertRow["type"],
        severity: r.severity as AlertRow["severity"],
        title: r.title,
        body: r.body,
        lat: r.lat,
        lng: r.lng,
        status: r.status as AlertRow["status"],
        ackComment: r.ack_comment,
        createdAt: toIso(r.created_at),
        escalated,
      };
    });
  });

export const ackAlert = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string(), comment: z.string().optional() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    const row = (await sql<{ company_id: string }>`select company_id from alerts where id = ${data.id}`)[0];
    if (!row || !inScope(scope, row.company_id)) throw new Error("Not found");
    await sql`
      update alerts
      set status = 'ack', ack_by = ${session.userId}, ack_comment = ${data.comment ?? null}, ack_at = ${new Date().toISOString()}
      where id = ${data.id}
    `;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${row.company_id}, ${session.userId}, 'alert.ack', ${data.id})
    `;
    return { ok: true };
  });

const ruleConfigSchema = z.object({
  minutes: z.number().optional(),
  graceKmh: z.number().optional(),
  litres: z.number().optional(),
  quietStart: z.string().nullable().optional(),
  quietEnd: z.string().nullable().optional(),
  escalateMin: z.number().nullable().optional(),
});

function ruleConfig(raw: unknown): AlertRuleConfig {
  const g = typeof raw === "string" ? safeJson(raw) : raw;
  const parsed = ruleConfigSchema.safeParse(g ?? {});
  return parsed.success ? parsed.data : {};
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function pickRule<T extends { company_id: string; vehicle_id: string | null; type: string }>(
  rules: T[],
  companyId: string,
  vehicleId: string | null,
  type: string,
) {
  return (
    rules.find((r) => r.company_id === companyId && vehicleId && r.vehicle_id === vehicleId && r.type === type) ??
    rules.find((r) => r.company_id === companyId && !r.vehicle_id && r.type === type)
  );
}

export const listAlertRules = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const rows = await sql<{
      id: string;
      company_id: string;
      company_name: string;
      vehicle_id: string | null;
      type: string;
      config: unknown;
      enabled: boolean;
    }>`
      select r.id, r.company_id, c.name as company_name, r.vehicle_id, r.type, r.config, r.enabled
      from alert_rules r
      join companies c on c.id = r.company_id
      order by c.name, r.type
    `;
    return rows
      .filter((r) => inScope(scope, r.company_id))
      .map(
        (r): AlertRuleRow => ({
          id: r.id,
          companyId: r.company_id,
          companyName: r.company_name,
          vehicleId: r.vehicle_id,
          type: r.type as AlertRuleRow["type"],
          enabled: r.enabled,
          config: ruleConfig(r.config),
        }),
      );
  });

export const updateAlertRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string(),
      enabled: z.boolean().optional(),
      config: ruleConfigSchema.optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const row = (
      await sql<{ company_id: string; config: unknown; enabled: boolean }>`
        select company_id, config, enabled from alert_rules where id = ${data.id}
      `
    )[0];
    if (!row || !inScope(scope, row.company_id)) throw new Error("Not found");
    const next = { ...ruleConfig(row.config), ...(data.config ?? {}) };
    const enabled = data.enabled ?? row.enabled;
    await sql`
      update alert_rules
      set enabled = ${enabled}, config = ${JSON.stringify(next)}::jsonb
      where id = ${data.id}
    `;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${row.company_id}, ${session.userId}, 'alert_rule.updated', ${data.id})
    `;
    return { ok: true };
  });

export const applyQuietHours = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      companyId: z.string().optional(),
      quietStart: z.string().nullable(),
      quietEnd: z.string().nullable(),
      escalateMin: z.number().nullable(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const companyId = data.companyId ?? session.companyId;
    if (!companyId) throw new Error("Open a company first");
    const scope = await companyScope(sql, session);
    if (!inScope(scope, companyId)) throw new Error("Forbidden");
    const rows = await sql<{ id: string; config: unknown }>`
      select id, config from alert_rules where company_id = ${companyId} and vehicle_id is null
    `;
    for (const row of rows) {
      const next = {
        ...ruleConfig(row.config),
        quietStart: data.quietStart,
        quietEnd: data.quietEnd,
        escalateMin: data.escalateMin,
      };
      await sql`update alert_rules set config = ${JSON.stringify(next)}::jsonb where id = ${row.id}`;
    }
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${companyId}, ${session.userId}, 'alert_rule.quiet_hours', ${"fleet"})
    `;
    return { ok: true };
  });

export const getVehicleDossier = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ vehicleId: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.role === "accounts" || session.role === "pending") throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const vehicle = (
      await sql<{
        id: string;
        company_id: string;
        company_name: string;
        name: string;
        plate: string;
        make: string | null;
        model: string | null;
        color: string | null;
        speed_limit: number | null;
        default_speed: number;
        odometer_km: number;
        engine_hours: number;
        tank_litres: number;
        driver_name: string | null;
        assigned_driver_id: string | null;
      }>`
        select v.id, v.company_id, c.name as company_name, v.name, v.plate, v.make, v.model, v.color,
          v.speed_limit, c.default_speed_limit as default_speed, v.odometer_km, v.engine_hours, v.tank_litres,
          d.name as driver_name, v.assigned_driver_id
        from vehicles v
        join companies c on c.id = v.company_id
        left join drivers d on d.id = v.assigned_driver_id
        where v.id = ${data.vehicleId}
      `
    )[0];
    if (!vehicle || !inScope(scope, vehicle.company_id)) throw new Error("Not found");

    const samples = await sql<{
      ts: string;
      fuel_level: number | null;
      fuel_litres: number | null;
      speed: number;
    }>`
      select ts, fuel_level, fuel_litres, speed
      from positions
      where vehicle_id = ${data.vehicleId}
      order by ts desc
      limit 48
    `;
    const fuel = samples
      .slice()
      .reverse()
      .map((s) => ({
        ts: toIso(s.ts),
        fuel: s.fuel_level,
        litres: s.fuel_litres,
        speed: s.speed,
      }));

    const trips = await sql<{
      id: string;
      started_at: string;
      ended_at: string | null;
      start_address: string | null;
      end_address: string | null;
      distance_km: number;
      max_speed: number;
      idle_minutes: number;
      fuel_used: number | null;
    }>`
      select id, started_at, ended_at, start_address, end_address, distance_km, max_speed, idle_minutes, fuel_used
      from trips
      where vehicle_id = ${data.vehicleId}
      order by started_at desc
      limit 8
    `;

    const alerts = await sql<{
      id: string;
      type: string;
      severity: string;
      title: string;
      status: string;
      created_at: string;
    }>`
      select id, type, severity, title, status, created_at
      from alerts
      where vehicle_id = ${data.vehicleId}
      order by created_at desc
      limit 6
    `;

    const device = (
      await sql<{
        id: string;
        imei: string;
        protocol: string;
        decoder: string;
        last_seen: string | null;
        gsm_signal: number | null;
        gps_signal: number | null;
        battery: number | null;
      }>`
        select id, imei, protocol, decoder, last_seen, gsm_signal, gps_signal, battery
        from devices where vehicle_id = ${data.vehicleId} limit 1
      `
    )[0];

    const documents = await sql<{
      id: string;
      title: string;
      kind: string;
      path: string | null;
      expires_on: string | null;
    }>`
      select id, title, kind, path, expires_on
      from documents
      where vehicle_id = ${data.vehicleId}
      order by expires_on nulls last
    `;

    const fuelEvents = await sql<{
      id: string;
      kind: string;
      litres: number;
      ts: string;
      notes: string | null;
    }>`
      select id, kind, litres, ts, notes
      from fuel_events
      where vehicle_id = ${data.vehicleId}
      order by ts desc
      limit 6
    `;

    const assignments = await sql<{
      id: string;
      name: string;
      started_at: string;
      ended_at: string | null;
    }>`
      select da.id, d.name, da.started_at, da.ended_at
      from driver_assignments da
      join drivers d on d.id = da.driver_id
      where da.vehicle_id = ${data.vehicleId}
      order by da.started_at desc
      limit 8
    `;

    const behavior = await sql<{
      id: string;
      kind: string;
      severity: string;
      value: number | null;
      ts: string;
      driver_name: string | null;
    }>`
      select b.id, b.kind, b.severity, b.value, b.ts, d.name as driver_name
      from behavior_events b
      left join drivers d on d.id = b.driver_id
      where b.vehicle_id = ${data.vehicleId}
      order by b.ts desc
      limit 8
    `;

    const plan = (
      await sql<{ km: number | null; litres: number | null; trips: number }>`
        select coalesce(sum(distance_km), 0) as km,
               coalesce(sum(fuel_used), 0) as litres,
               count(*)::int as trips
        from trips
        where vehicle_id = ${data.vehicleId}
          and started_at > now() - interval '7 days'
      `
    )[0];
    const planKm = Number(plan?.km ?? 0);
    const planActual = Number(plan?.litres ?? 0);
    const planExpected = planKm * 0.11;

    const commands = device
      ? await sql<{
          id: string;
          kind: string;
          status: string;
          result: string | null;
          created_at: string;
        }>`
          select id, kind, status, result, created_at
          from device_commands
          where device_id = ${device.id}
          order by created_at desc
          limit 4
        `
      : [];

    const latest = fuel[fuel.length - 1];
    return {
      vehicle: {
        id: vehicle.id,
        companyName: vehicle.company_name,
        name: vehicle.name,
        plate: vehicle.plate,
        make: vehicle.make,
        model: vehicle.model,
        color: vehicle.color,
        speedLimit: vehicle.speed_limit ?? vehicle.default_speed,
        speedOverride: vehicle.speed_limit,
        defaultSpeed: vehicle.default_speed,
        companyId: vehicle.company_id,
        odometerKm: vehicle.odometer_km,
        engineHours: vehicle.engine_hours,
        tankLitres: vehicle.tank_litres,
        driverName: vehicle.driver_name,
        driverId: vehicle.assigned_driver_id,
      },
      fuel,
      latest: latest
        ? { fuel: latest.fuel, litres: latest.litres, speed: latest.speed, ts: latest.ts }
        : null,
      trips: trips.map((t) => ({
        id: t.id,
        startedAt: toIso(t.started_at),
        endedAt: t.ended_at ? toIso(t.ended_at) : null,
        startAddress: t.start_address,
        endAddress: t.end_address,
        distanceKm: t.distance_km,
        maxSpeed: t.max_speed,
        idleMinutes: t.idle_minutes,
        fuelUsed: t.fuel_used,
      })),
      alerts: alerts.map((a) => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        title: a.title,
        status: a.status,
        createdAt: toIso(a.created_at),
      })),
      device: device
        ? {
            id: device.id,
            imei: device.imei,
            protocol: device.protocol,
            decoder: device.decoder,
            lastSeen: device.last_seen ? toIso(device.last_seen) : null,
            gsmSignal: device.gsm_signal,
            gpsSignal: device.gps_signal,
            battery: device.battery,
          }
        : null,
      documents: documents.map((d) => ({
        id: d.id,
        title: d.title,
        kind: d.kind,
        path: d.path,
        expiresOn: d.expires_on ? String(d.expires_on).slice(0, 10) : null,
      })),
      fuelEvents: fuelEvents.map((f) => ({
        id: f.id,
        kind: f.kind,
        litres: Number(f.litres),
        ts: toIso(f.ts),
        notes: f.notes,
      })),
      assignments: assignments.map((a) => ({
        id: a.id,
        name: a.name,
        startedAt: toIso(a.started_at),
        endedAt: a.ended_at ? toIso(a.ended_at) : null,
      })),
      behavior: behavior.map((b) => ({
        id: b.id,
        kind: b.kind,
        label: behaviorLabel(b.kind),
        severity: b.severity,
        value: b.value != null ? Number(b.value) : null,
        ts: toIso(b.ts),
        driverName: b.driver_name,
      })),
      fuelPlan: {
        trips: Number(plan?.trips ?? 0),
        distanceKm: Math.round(planKm),
        actualL: Math.round(planActual * 10) / 10,
        expectedL: Math.round(planExpected * 10) / 10,
        baseline: 11,
      },
      commands: commands.map((c) => ({
        id: c.id,
        kind: c.kind,
        status: c.status,
        result: c.result,
        createdAt: toIso(c.created_at),
      })),
    };
  });

export const logFuel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      vehicleId: z.string(),
      kind: z.enum(["fill", "drop"]),
      litres: z.number().positive().max(2000),
      notes: z.string().max(240).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.role !== "super_admin" && session.role !== "company_admin") throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const vehicle = (
      await sql<{ company_id: string; name: string }>`
        select company_id, name from vehicles where id = ${data.vehicleId}
      `
    )[0];
    if (!vehicle || !inScope(scope, vehicle.company_id)) throw new Error("Not found");
    const id = nid("fe");
    await sql`
      insert into fuel_events (id, company_id, vehicle_id, kind, litres, ts, notes)
      values (
        ${id}, ${vehicle.company_id}, ${data.vehicleId}, ${data.kind}, ${data.litres},
        ${new Date().toISOString()}, ${data.notes?.trim() || null}
      )
    `;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${vehicle.company_id}, ${session.userId}, 'fuel.logged', ${`${vehicle.name} ${data.kind} ${data.litres}L`})
    `;
    return { id };
  });

export const listCompanies = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin" && session.role !== "field_admin" && session.role !== "company_admin") {
      throw new Error("Forbidden");
    }
    const rows = await sql<{
      id: string;
      name: string;
      slug: string;
      status: string;
      billing_status: string;
      default_speed_limit: number;
      city: string | null;
      mark: string | null;
    }>`select id, name, slug, status, billing_status, default_speed_limit, city, mark from companies order by name`;
    const out: CompanyRow[] = [];
    for (const c of rows) {
      const v = await sql<{ n: number; online: number }>`
        select count(*)::int as n,
          count(*) filter (where exists (
            select 1 from positions p where p.vehicle_id = vehicles.id and p.ts > now() - interval '8 minutes'
          ))::int as online
        from vehicles where company_id = ${c.id}
      `;
      const a = await sql<{ n: number }>`select count(*)::int as n from alerts where company_id = ${c.id} and status = 'open'`;
      out.push({
        id: c.id,
        name: c.name,
        slug: c.slug,
        status: c.status,
        billingStatus: c.billing_status,
        defaultSpeedLimit: c.default_speed_limit,
        city: c.city,
        vehicleCount: v[0]?.n ?? 0,
        onlineCount: v[0]?.online ?? 0,
        openAlerts: a[0]?.n ?? 0,
        mark: c.mark,
      });
    }
    const scope = await companyScope(sql, session);
    return scope ? out.filter((c) => scope.includes(c.id)) : out;
  });

export const createCompany = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().optional(), name: z.string().min(2), city: z.string().optional(), speedLimit: z.number().optional() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin") throw new Error("Forbidden");
    if (data.id) {
      const current = (await sql<{ id: string; name: string }>`select id, name from companies where id = ${data.id}`)[0];
      if (!current) throw new Error("Company not found");
      await sql`update companies set name = ${data.name}, city = ${data.city?.trim() || null}, default_speed_limit = ${data.speedLimit ?? 80} where id = ${data.id}`;
      await sql`insert into audit_logs (id, company_id, actor_id, action, target, meta) values (${nid("aud")}, ${data.id}, ${session.userId}, 'company.updated', ${data.name}, ${JSON.stringify({ previousName: current.name })}::jsonb)`;
      return { id: data.id };
    }
    const id = nid("co");
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + id.slice(-4);
    const mark = companyMarkFromName(data.name);
    await sql`
      insert into companies (id, name, slug, status, billing_status, default_speed_limit, city, created_by, mark)
      values (${id}, ${data.name}, ${slug}, 'active', 'trial', ${data.speedLimit ?? 80}, ${data.city ?? null}, ${session.userId}, ${mark})
    `;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${id}, ${session.userId}, 'company.created', ${data.name})`;
    return { id };
  });
export const setCompanyStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ companyId: z.string(), status: z.enum(["active", "suspended"]) }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin") throw new Error("Forbidden");
    const row = (await sql<{ name: string }>`select name from companies where id = ${data.companyId}`)[0];
    if (!row) throw new Error("Not found");
    await sql`update companies set status = ${data.status} where id = ${data.companyId}`;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${data.companyId}, ${session.userId}, 'company.status', ${`${row.name} ${data.status}`})
    `;
    return { ok: true };
  });

export const listVehicles = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    const rows = await sql<{
      id: string;
      company_id: string;
      company_name: string;
      name: string;
      plate: string;
      make: string | null;
      model: string | null;
      year: number | null;
      color: string | null;
      speed_limit: number | null;
      odometer_km: number;
      engine_hours: number;
      tank_litres: number;
      driver_name: string | null;
      imei: string | null;
    }>`
      select v.id, v.company_id, c.name as company_name, v.name, v.plate, v.make, v.model, v.year, v.color,
        v.speed_limit, v.odometer_km, v.engine_hours, v.tank_litres, d.name as driver_name, dev.imei
      from vehicles v
      join companies c on c.id = v.company_id
      left join drivers d on d.id = v.assigned_driver_id
      left join devices dev on dev.vehicle_id = v.id
      order by v.name
    `;
    return rows.filter((r) => inScope(scope, r.company_id));
  });

export const saveVehicle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string().optional(),
      name: z.string().min(2),
      plate: z.string().min(3),
      make: z.string().optional(),
      model: z.string().optional(),
      year: z.number().optional(),
      color: z.string().optional(),
      speedLimit: z.number().optional(),
      tankLitres: z.number().optional(),
      companyId: z.string().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const companyId = data.companyId ?? session.companyId;
    if (!companyId) throw new Error("No company");
    const scope = await companyScope(sql, session);
    if (!inScope(scope, companyId)) throw new Error("Forbidden");
    const id = data.id ?? nid("veh");
    if (data.id) {
      await sql`
        update vehicles set name = ${data.name}, plate = ${data.plate}, make = ${data.make ?? null},
          model = ${data.model ?? null}, year = ${data.year ?? null}, color = ${data.color ?? null},
          speed_limit = ${data.speedLimit ?? null}, tank_litres = ${data.tankLitres ?? 120}
        where id = ${id} and company_id = ${companyId}
      `;
    } else {
      await sql`
        insert into vehicles (id, company_id, name, plate, make, model, year, color, speed_limit, tank_litres, behavior)
        values (${id}, ${companyId}, ${data.name}, ${data.plate}, ${data.make ?? null}, ${data.model ?? null},
          ${data.year ?? null}, ${data.color ?? null}, ${data.speedLimit ?? null}, ${data.tankLitres ?? 120}, 'parked')
      `;
    }
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${companyId}, ${session.userId}, ${data.id ? "vehicle.updated" : "vehicle.created"}, ${data.plate})
    `;
    return { id };
  });

export const listDevices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    const rows = await sql<{
      id: string;
      company_id: string | null;
      company_name: string | null;
      vehicle_id: string | null;
      vehicle_name: string | null;
      imei: string;
      protocol: string;
      decoder: string;
      last_seen: string | null;
      gsm_signal: number | null;
      gps_signal: number | null;
      battery: number | null;
      last_kind: string | null;
      last_status: string | null;
      cal_count: number | null;
    }>`
      select d.id, d.company_id, c.name as company_name, d.vehicle_id, v.name as vehicle_name,
        d.imei, d.protocol, d.decoder, d.last_seen, d.gsm_signal, d.gps_signal, d.battery,
        (select kind from device_commands where device_id = d.id order by created_at desc limit 1) as last_kind,
        (select status from device_commands where device_id = d.id order by created_at desc limit 1) as last_status,
        (select count(*)::int from device_calibrations where device_id = d.id) as cal_count
      from devices d
      left join companies c on c.id = d.company_id
      left join vehicles v on v.id = d.vehicle_id
      order by d.imei
    `;
    return rows
      .filter((r) => session.role === "super_admin" || inScope(scope, r.company_id))
      .map(
        (r): DeviceRow => ({
          id: r.id,
          companyId: r.company_id,
          companyName: r.company_name,
          vehicleId: r.vehicle_id,
          vehicleName: r.vehicle_name,
          imei: r.imei,
          protocol: r.protocol,
          decoder: r.decoder,
          lastSeen: r.last_seen ? toIso(r.last_seen) : null,
          gsmSignal: r.gsm_signal,
          gpsSignal: r.gps_signal,
          battery: r.battery,
          lastCommandKind: r.last_kind,
          lastCommandStatus: r.last_status,
          calibrationCount: Number(r.cal_count ?? 0),
        }),
      );
  });

export const saveDevice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({
    id: z.string().optional(),
    imei: z.string().min(8),
    protocol: z.string(),
    decoder: z.string(),
    companyId: z.string(),
    vehicleId: z.string().nullable().optional(),
  }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "field_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    if (!inScope(scope, data.companyId)) throw new Error("Forbidden");
    if (data.id) {
      const current = (await sql<{ company_id: string | null; imei: string }>`select company_id, imei from devices where id = ${data.id}`)[0];
      if (!current || !inScope(scope, current.company_id)) throw new Error("Device not found");
      await sql`update devices set imei = ${data.imei}, protocol = ${data.protocol}, decoder = ${data.decoder}, company_id = ${data.companyId}, vehicle_id = ${data.vehicleId ?? null} where id = ${data.id}`;
      await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${data.companyId}, ${session.userId}, 'device.updated', ${data.imei})`;
      return { ok: true, id: data.id };
    }
    const id = nid("dev");
    await sql`
      insert into devices (id, company_id, vehicle_id, imei, protocol, decoder, secret)
      values (${id}, ${data.companyId}, ${data.vehicleId ?? null}, ${data.imei}, ${data.protocol}, ${data.decoder}, ${"sec_" + data.imei.slice(-6)})
      on conflict (imei) do update set company_id = excluded.company_id, vehicle_id = excluded.vehicle_id, protocol = excluded.protocol, decoder = excluded.decoder
    `;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${data.companyId}, ${session.userId}, 'device.registered', ${data.imei})`;
    return { ok: true, id };
  });
export const assignDevice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ deviceId: z.string(), vehicleId: z.string().nullable() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "field_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    await sql`update devices set vehicle_id = ${data.vehicleId} where id = ${data.deviceId}`;
    await sql`
      insert into audit_logs (id, actor_id, action, target)
      values (${nid("aud")}, ${session.userId}, 'device.assigned', ${data.deviceId})
    `;
    return { ok: true };
  });

export const saveCalibration = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      deviceId: z.string(),
      emptyVoltage: z.number(),
      fullVoltage: z.number(),
      tankLitres: z.number(),
      notes: z.string().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "field_admin"].includes(session.role) && session.realRole !== "super_admin") {
      throw new Error("Forbidden");
    }
    await sql`
      insert into device_calibrations (id, device_id, empty_voltage, full_voltage, tank_litres, notes, recorded_by)
      values (${nid("cal")}, ${data.deviceId}, ${data.emptyVoltage}, ${data.fullVoltage}, ${data.tankLitres}, ${data.notes ?? null}, ${session.userId})
    `;
    return { ok: true };
  });

export const listCalibrations = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ deviceId: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    const device = (
      await sql<{ company_id: string | null }>`select company_id from devices where id = ${data.deviceId}`
    )[0];
    if (!device || !inScope(scope, device.company_id)) throw new Error("Not found");
    const rows = await sql<{
      id: string;
      empty_voltage: number;
      full_voltage: number;
      tank_litres: number;
      notes: string | null;
      created_at: string;
    }>`
      select id, empty_voltage, full_voltage, tank_litres, notes, created_at
      from device_calibrations
      where device_id = ${data.deviceId}
      order by created_at desc
      limit 6
    `;
    return rows.map((r) => ({
      id: r.id,
      emptyVoltage: r.empty_voltage,
      fullVoltage: r.full_voltage,
      tankLitres: r.tank_litres,
      notes: r.notes,
      createdAt: toIso(r.created_at),
    }));
  });

export const queueDeviceCommand = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      kind: z.enum(["restart", "locate", "snapshot"]),
      deviceId: z.string().optional(),
      vehicleId: z.string().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    const soft = ["super_admin", "company_admin", "field_admin", "tracker"];
    const hard = ["super_admin", "company_admin", "field_admin"];
    if (data.kind === "restart" ? !hard.includes(session.role) : !soft.includes(session.role)) {
      throw new Error("Forbidden");
    }
    if (!data.deviceId && !data.vehicleId) throw new Error("Device or vehicle required");
    const scope = await companyScope(sql, session);
    const device = data.deviceId
      ? (
          await sql<{ id: string; company_id: string | null; vehicle_id: string | null; imei: string }>`
            select id, company_id, vehicle_id, imei from devices where id = ${data.deviceId} limit 1
          `
        )[0]
      : (
          await sql<{ id: string; company_id: string | null; vehicle_id: string | null; imei: string }>`
            select id, company_id, vehicle_id, imei from devices where vehicle_id = ${data.vehicleId ?? ""} limit 1
          `
        )[0];
    if (!device || !inScope(scope, device.company_id)) throw new Error("Not found");
    const id = nid("cmd");
    await sql`
      insert into device_commands (id, company_id, device_id, vehicle_id, kind, status, requested_by)
      values (
        ${id}, ${device.company_id}, ${device.id}, ${device.vehicle_id}, ${data.kind}, 'queued', ${session.userId}
      )
    `;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${device.company_id}, ${session.userId}, ${`device.${data.kind}`}, ${device.imei})
    `;
    await (await import("./simulate")).fulfillCommand(sql, id);
    return { id };
  });

export const listGeofences = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    const rows = await sql<{
      id: string;
      company_id: string;
      name: string;
      kind: string;
      group_name: string | null;
      zone_type: string;
      geometry: unknown;
      schedule: unknown;
      active: boolean;
    }>`select id, company_id, name, kind, group_name, zone_type, geometry, schedule, active from geofences order by name`;
    return rows.filter((g) => inScope(scope, g.company_id)).map((g) => toGeofence(g));
  });

const fenceGeometry = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("circle"),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusM: z.number().min(30).max(50_000),
  }),
  z.object({
    type: z.literal("polygon"),
    points: z.array(z.tuple([z.number(), z.number()])).min(3).max(40),
  }),
  z.object({
    type: z.literal("route"),
    path: z.array(z.tuple([z.number(), z.number()])).min(2).max(80),
    widthM: z.number().min(20).max(2000),
  }),
]);

const fenceSchedule = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .nullable();

type FenceSql = {
  id: string;
  company_id: string;
  name: string;
  kind: string;
  group_name: string | null;
  zone_type: string;
  geometry: unknown;
  schedule: unknown;
  active: boolean;
};

function toGeofence(g: FenceSql): GeofenceRow {
  return {
    id: g.id,
    companyId: g.company_id,
    name: g.name,
    kind: g.kind as GeofenceRow["kind"],
    groupName: g.group_name,
    zoneType: g.zone_type as GeofenceRow["zoneType"],
    geometry: parseGeom<GeofenceRow["geometry"]>(g.geometry),
    schedule: parseSchedule(g.schedule),
    active: g.active,
  };
}

export const saveGeofence = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string().optional(),
      name: z.string().min(2).max(80),
      kind: z.enum(["circle", "polygon", "route"]),
      zoneType: z.enum(["allowed", "forbidden"]),
      groupName: z.string().max(48).optional(),
      geometry: fenceGeometry,
      schedule: fenceSchedule.nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const companyId = session.companyId;
    if (!companyId) throw new Error("View as a company admin before drawing fences");
    if (data.geometry.type !== data.kind) throw new Error("Geometry does not match kind");
    const id = data.id ?? nid("gf");
    const schedule = data.schedule ?? null;
    if (data.id) {
      const current = (await sql<{ company_id: string; name: string }>`select company_id, name from geofences where id = ${data.id}`)[0];
      if (!current || !inScope(await companyScope(sql, session), current.company_id)) throw new Error("Geofence not found");
      await sql`
        update geofences
        set name = ${data.name}, kind = ${data.kind}, group_name = ${data.groupName?.trim() || null},
          zone_type = ${data.zoneType}, geometry = ${JSON.stringify(data.geometry)}::jsonb,
          schedule = ${schedule ? JSON.stringify(schedule) : null}::jsonb
        where id = ${data.id}
      `;
      await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${current.company_id}, ${session.userId}, 'geofence.updated', ${data.name})`;
    } else {
      await sql`
        insert into geofences (id, company_id, name, kind, group_name, zone_type, geometry, schedule, active)
        values (${id}, ${companyId}, ${data.name}, ${data.kind}, ${data.groupName?.trim() || null},
          ${data.zoneType}, ${JSON.stringify(data.geometry)}::jsonb,
          ${schedule ? JSON.stringify(schedule) : null}::jsonb, true)
      `;
      await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${companyId}, ${session.userId}, 'geofence.created', ${data.name})`;
    }
    return { id };
  });

export const setGeofenceActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string(), active: z.boolean() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const row = (await sql<{ company_id: string; name: string }>`select company_id, name from geofences where id = ${data.id}`)[0];
    if (!row || !inScope(scope, row.company_id)) throw new Error("Not found");
    await sql`update geofences set active = ${data.active} where id = ${data.id}`;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${row.company_id}, ${session.userId}, ${data.active ? "geofence.enabled" : "geofence.disabled"}, ${row.name})
    `;
    return { ok: true };
  });

export const deleteGeofence = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const row = (await sql<{ company_id: string; name: string }>`select company_id, name from geofences where id = ${data.id}`)[0];
    if (!row || !inScope(scope, row.company_id)) throw new Error("Not found");
    const events = await sql<{ n: number }>`select count(*)::int as n from geofence_events where geofence_id = ${data.id}`;
    if ((events[0]?.n ?? 0) > 0) throw new Error("This geofence has event history. Pause it instead of deleting it.");
    await sql`delete from geofences where id = ${data.id}`;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${row.company_id}, ${session.userId}, 'geofence.deleted', ${row.name})
    `;
    return { ok: true };
  });

export const getPlayback = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ vehicleId: z.string(), from: z.string(), to: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    const veh = (await sql<{ company_id: string; name: string; plate: string }>`
      select company_id, name, plate from vehicles where id = ${data.vehicleId}
    `)[0];
    if (!veh || !inScope(scope, veh.company_id)) throw new Error("Not found");
    const rows = await sql<{
      id: string;
      vehicle_id: string;
      ts: string;
      lat: number;
      lng: number;
      speed: number;
      heading: number;
      ignition: boolean;
      fuel_level: number | null;
      address: string | null;
      event: string;
    }>`
      select id, vehicle_id, ts, lat, lng, speed, heading, ignition, fuel_level, address, event
      from positions
      where vehicle_id = ${data.vehicleId} and ts >= ${data.from} and ts <= ${data.to}
      order by ts asc
      limit 2500
    `;
    const points: PositionRow[] = rows.map((r) => ({
      id: r.id,
      vehicleId: r.vehicle_id,
      ts: toIso(r.ts),
      lat: r.lat,
      lng: r.lng,
      speed: r.speed,
      heading: r.heading,
      ignition: r.ignition,
      fuelLevel: r.fuel_level,
      address: r.address,
      event: r.event,
    }));
    const alerts = await sql<{
      id: string;
      type: string;
      title: string;
      ts: string;
      lat: number | null;
      lng: number | null;
    }>`
      select id, type, title, created_at as ts, lat, lng from alerts
      where vehicle_id = ${data.vehicleId} and created_at >= ${data.from} and created_at <= ${data.to}
      order by created_at
    `;
    const fuels = await sql<{
      id: string;
      type: string;
      title: string | null;
      ts: string;
      lat: number | null;
      lng: number | null;
    }>`
      select id, kind as type, notes as title, ts, lat, lng from fuel_events
      where vehicle_id = ${data.vehicleId} and ts >= ${data.from} and ts <= ${data.to}
      order by ts
    `;
    const stops = await sql<{
      id: string;
      title: string | null;
      ts: string;
      lat: number | null;
      lng: number | null;
    }>`
      select id, address as title, started_at as ts, lat, lng from stops
      where vehicle_id = ${data.vehicleId} and started_at >= ${data.from} and started_at <= ${data.to}
      order by started_at
      limit 40
    `;
    const events = [
      ...alerts.map((e) => ({ id: e.id, kind: "alert" as const, type: e.type, title: e.title, ts: toIso(e.ts), lat: e.lat, lng: e.lng })),
      ...fuels.map((e) => ({
        id: e.id,
        kind: "fuel" as const,
        type: e.type,
        title: e.title ?? e.type,
        ts: toIso(e.ts),
        lat: e.lat,
        lng: e.lng,
      })),
      ...stops.map((e) => ({
        id: e.id,
        kind: "stop" as const,
        type: "stop",
        title: e.title ?? "Stop",
        ts: toIso(e.ts),
        lat: e.lat,
        lng: e.lng,
      })),
      ...(
        await sql<{
          id: string;
          kind: string;
          value: number | null;
          ts: string;
          lat: number | null;
          lng: number | null;
        }>`
          select id, kind, value, ts, lat, lng from behavior_events
          where vehicle_id = ${data.vehicleId} and ts >= ${data.from} and ts <= ${data.to}
          order by ts
        `
      ).map((e) => ({
        id: e.id,
        kind: "behavior" as const,
        type: e.kind,
        title: `${behaviorLabel(e.kind)}${e.value != null ? ` · ${e.value.toFixed(2)} g` : ""}`,
        ts: toIso(e.ts),
        lat: e.lat,
        lng: e.lng,
      })),
    ];
    return { vehicle: veh, points, events };
  });

export const getReports = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      kind: z.enum(["trips", "stops", "speeding", "fuel", "offline", "idle", "geofence", "distance", "hours", "behaviour"]),
      from: z.string(),
      to: z.string(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    if (data.kind === "behaviour") {
      const rows = await sql<{
        id: string;
        vehicle_name: string;
        plate: string;
        driver_name: string | null;
        kind: string;
        severity: string;
        value: number | null;
        ts: string;
        company_id: string;
      }>`
        select b.id, v.name as vehicle_name, v.plate, d.name as driver_name, b.kind, b.severity, b.value, b.ts, b.company_id
        from behavior_events b
        join vehicles v on v.id = b.vehicle_id
        left join drivers d on d.id = b.driver_id
        where b.ts >= ${data.from} and b.ts <= ${data.to}
        order by b.ts desc
        limit 300
      `;
      return rows
        .filter((r) => inScope(scope, r.company_id))
        .map((r) => ({
          id: r.id,
          vehicleName: r.vehicle_name,
          plate: r.plate,
          driver: r.driver_name ?? "Unassigned",
          kind: behaviorLabel(r.kind),
          severity: r.severity,
          g: r.value != null ? Number(r.value) : null,
          ts: toIso(r.ts),
        }));
    }
    if (data.kind === "trips") {
      const rows = await sql<{
        id: string;
        vehicle_name: string;
        plate: string;
        started_at: string;
        ended_at: string | null;
        start_address: string | null;
        end_address: string | null;
        distance_km: number;
        max_speed: number;
        idle_minutes: number;
        fuel_used: number | null;
        company_id: string;
      }>`
        select t.id, v.name as vehicle_name, v.plate, t.started_at, t.ended_at, t.start_address, t.end_address,
          t.distance_km, t.max_speed, t.idle_minutes, t.fuel_used, t.company_id
        from trips t join vehicles v on v.id = t.vehicle_id
        where t.started_at >= ${data.from} and t.started_at <= ${data.to}
        order by t.started_at desc
        limit 300
      `;
      return rows
        .filter((r) => inScope(scope, r.company_id))
        .map(
          (r): TripRow => ({
            id: r.id,
            vehicleName: r.vehicle_name,
            plate: r.plate,
            startedAt: toIso(r.started_at),
            endedAt: r.ended_at ? toIso(r.ended_at) : null,
            startAddress: r.start_address,
            endAddress: r.end_address,
            distanceKm: r.distance_km,
            maxSpeed: r.max_speed,
            idleMinutes: r.idle_minutes,
            fuelUsed: r.fuel_used,
          }),
        );
    }
    if (data.kind === "stops" || data.kind === "idle") {
      const rows = await sql<{
        id: string;
        vehicle_name: string;
        plate: string;
        started_at: string;
        ended_at: string | null;
        duration_min: number | null;
        address: string | null;
        ignition: boolean;
        company_id: string;
      }>`
        select s.id, v.name as vehicle_name, v.plate, s.started_at, s.ended_at, s.duration_min, s.address, s.ignition, s.company_id
        from stops s join vehicles v on v.id = s.vehicle_id
        where s.started_at >= ${data.from} and s.started_at <= ${data.to}
        order by s.started_at desc
        limit 300
      `;
      return rows
        .filter((r) => inScope(scope, r.company_id))
        .filter((r) => (data.kind === "idle" ? r.ignition : true))
        .map((r) => ({
          id: r.id,
          vehicleName: r.vehicle_name,
          plate: r.plate,
          startedAt: toIso(r.started_at),
          endedAt: r.ended_at ? toIso(r.ended_at) : null,
          durationMin: r.duration_min,
          address: r.address,
          ignition: r.ignition,
        }));
    }
    if (data.kind === "speeding" || data.kind === "offline") {
      const type = data.kind === "speeding" ? "speeding" : "offline";
      const rows = await sql<{
        id: string;
        title: string;
        body: string | null;
        created_at: string;
        vehicle_name: string | null;
        plate: string | null;
        company_id: string;
      }>`
        select a.id, a.title, a.body, a.created_at, v.name as vehicle_name, v.plate, a.company_id
        from alerts a left join vehicles v on v.id = a.vehicle_id
        where a.type = ${type} and a.created_at >= ${data.from} and a.created_at <= ${data.to}
        order by a.created_at desc
      `;
      return rows.filter((r) => inScope(scope, r.company_id)).map((r) => ({
        id: r.id,
        vehicleName: r.vehicle_name,
        plate: r.plate,
        title: r.title,
        body: r.body,
        createdAt: toIso(r.created_at),
      }));
    }
    if (data.kind === "geofence") {
      const rows = await sql<{
        id: string;
        fence: string;
        kind: string;
        zone_type: string;
        vehicle_name: string;
        plate: string;
        ts: string;
        company_id: string;
      }>`
        select e.id, g.name as fence, e.kind, g.zone_type, v.name as vehicle_name, v.plate, e.ts, e.company_id
        from geofence_events e
        join geofences g on g.id = e.geofence_id
        join vehicles v on v.id = e.vehicle_id
        where e.ts >= ${data.from} and e.ts <= ${data.to}
        order by e.ts desc
        limit 300
      `;
      return rows.filter((r) => inScope(scope, r.company_id)).map((r) => ({
        id: r.id,
        fence: r.fence,
        kind: r.kind,
        zone: r.zone_type,
        vehicleName: r.vehicle_name,
        plate: r.plate,
        ts: toIso(r.ts),
      }));
    }
    if (data.kind === "distance" || data.kind === "hours") {
      const trips = await sql<{
        vehicle_id: string;
        vehicle_name: string;
        plate: string;
        company_id: string;
        started_at: string;
        ended_at: string | null;
        distance_km: number;
        fuel_used: number | null;
        idle_minutes: number;
        max_speed: number;
        engine_hours: number;
      }>`
        select t.vehicle_id, v.name as vehicle_name, v.plate, t.company_id, t.started_at, t.ended_at,
          t.distance_km, t.fuel_used, t.idle_minutes, t.max_speed, v.engine_hours
        from trips t
        join vehicles v on v.id = t.vehicle_id
        where t.started_at >= ${data.from} and t.started_at <= ${data.to}
      `;
      const grouped = new Map<
        string,
        {
          id: string;
          vehicleName: string;
          plate: string;
          distanceKm: number;
          fuelUsed: number;
          idleMin: number;
          maxSpeed: number;
          windowHours: number;
          trips: number;
          meterHours: number;
        }
      >();
      for (const t of trips) {
        if (!inScope(scope, t.company_id)) continue;
        const row = grouped.get(t.vehicle_id) ?? {
          id: t.vehicle_id,
          vehicleName: t.vehicle_name,
          plate: t.plate,
          distanceKm: 0,
          fuelUsed: 0,
          idleMin: 0,
          maxSpeed: 0,
          windowHours: 0,
          trips: 0,
          meterHours: Number(t.engine_hours) || 0,
        };
        const start = new Date(toIso(t.started_at)).getTime();
        const end = t.ended_at ? new Date(toIso(t.ended_at)).getTime() : start;
        row.distanceKm += Number(t.distance_km) || 0;
        row.fuelUsed += Number(t.fuel_used) || 0;
        row.idleMin += Number(t.idle_minutes) || 0;
        row.maxSpeed = Math.max(row.maxSpeed, Number(t.max_speed) || 0);
        row.windowHours += Math.max(0, end - start) / 3600000;
        row.trips += 1;
        grouped.set(t.vehicle_id, row);
      }
      return [...grouped.values()]
        .map((r) => ({
          id: r.id,
          vehicleName: r.vehicleName,
          plate: r.plate,
          trips: r.trips,
          distanceKm: round1(r.distanceKm),
          fuelUsed: round1(r.fuelUsed),
          idleMin: Math.round(r.idleMin),
          maxSpeed: Math.round(r.maxSpeed),
          windowHours: round1(r.windowHours),
          ...(data.kind === "hours" ? { meterHours: round1(r.meterHours) } : {}),
        }))
        .sort((a, b) => b.distanceKm - a.distanceKm);
    }
    const rows = await sql<{
      id: string;
      kind: string;
      litres: number;
      ts: string;
      notes: string | null;
      vehicle_name: string;
      plate: string;
      company_id: string;
    }>`
      select f.id, f.kind, f.litres, f.ts, f.notes, v.name as vehicle_name, v.plate, f.company_id
      from fuel_events f join vehicles v on v.id = f.vehicle_id
      where f.ts >= ${data.from} and f.ts <= ${data.to}
      order by f.ts desc
    `;
    return rows.filter((r) => inScope(scope, r.company_id)).map((r) => ({
      id: r.id,
      vehicleName: r.vehicle_name,
      plate: r.plate,
      kind: r.kind,
      litres: Number(r.litres),
      ts: toIso(r.ts),
      notes: r.notes,
    }));
  });

export const listDrivers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    const rows = await sql<{
      id: string;
      company_id: string;
      name: string;
      license_no: string | null;
      license_expiry: string | null;
      phone: string | null;
      vehicle_id: string | null;
      vehicle_name: string | null;
      harsh_week: number | null;
      last_kind: string | null;
    }>`
      select d.id, d.company_id, d.name, d.license_no, d.license_expiry, d.phone,
        (select v.id from vehicles v where v.assigned_driver_id = d.id limit 1) as vehicle_id,
        (select v.name from vehicles v where v.assigned_driver_id = d.id limit 1) as vehicle_name,
        (
          select count(*)::int from behavior_events be
          where be.driver_id = d.id and be.ts > now() - interval '7 days'
        ) as harsh_week,
        (
          select kind from behavior_events be
          where be.driver_id = d.id
          order by be.ts desc
          limit 1
        ) as last_kind
      from drivers d
      order by d.name
    `;
    return rows
      .filter((r) => inScope(scope, r.company_id))
      .map(
        (r): DriverRow => ({
          id: r.id,
          companyId: r.company_id,
          name: r.name,
          licenseNo: r.license_no,
          licenseExpiry: r.license_expiry,
          phone: r.phone,
          vehicleId: r.vehicle_id,
          vehicleName: r.vehicle_name,
          harshWeek: Number(r.harsh_week ?? 0),
          lastBehavior: r.last_kind,
        }),
      );
  });

export const saveDriver = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().optional(), name: z.string().min(2), licenseNo: z.string().optional(), phone: z.string().optional() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const companyId = session.companyId;
    if (!companyId) throw new Error("Select a company first");
    if (data.id) {
      const scope = await companyScope(sql, session);
      const current = (await sql<{ company_id: string; name: string }>`select company_id, name from drivers where id = ${data.id}`)[0];
      if (!current || !inScope(scope, current.company_id)) throw new Error("Driver not found");
      await sql`update drivers set name = ${data.name}, license_no = ${data.licenseNo ?? null}, phone = ${data.phone ?? null} where id = ${data.id}`;
      await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${current.company_id}, ${session.userId}, 'driver.updated', ${data.name})`;
    } else {
      const id = nid("drv");
      await sql`
        insert into drivers (id, company_id, name, license_no, phone)
        values (${id}, ${companyId}, ${data.name}, ${data.licenseNo ?? null}, ${data.phone ?? null})
      `;
      await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${companyId}, ${session.userId}, 'driver.created', ${data.name})`;
    }
    return { ok: true };
  });

export const assignDriver = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ driverId: z.string(), vehicleId: z.string().nullable() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const driver = (
      await sql<{ id: string; company_id: string; name: string }>`
        select id, company_id, name from drivers where id = ${data.driverId}
      `
    )[0];
    if (!driver || !inScope(scope, driver.company_id)) throw new Error("Not found");

    const current = await sql<{ id: string }>`
      select id from vehicles where assigned_driver_id = ${driver.id} and company_id = ${driver.company_id}
    `;
    if (!data.vehicleId && current.length === 0) return { ok: true };
    if (data.vehicleId && current.length === 1 && current[0]?.id === data.vehicleId) return { ok: true };

    const now = new Date().toISOString();
    await sql`
      update driver_assignments set ended_at = ${now}
      where driver_id = ${driver.id} and ended_at is null
    `;
    await sql`
      update vehicles set assigned_driver_id = null
      where assigned_driver_id = ${driver.id} and company_id = ${driver.company_id}
    `;

    if (!data.vehicleId) {
      await sql`
        insert into audit_logs (id, company_id, actor_id, action, target)
        values (${nid("aud")}, ${driver.company_id}, ${session.userId}, 'driver.unassigned', ${driver.name})
      `;
      return { ok: true };
    }

    const vehicle = (
      await sql<{ id: string; company_id: string; plate: string }>`
        select id, company_id, plate from vehicles where id = ${data.vehicleId}
      `
    )[0];
    if (!vehicle || vehicle.company_id !== driver.company_id || !inScope(scope, vehicle.company_id)) {
      throw new Error("Vehicle is not in this company");
    }
    await sql`
      update driver_assignments set ended_at = ${now}
      where vehicle_id = ${vehicle.id} and ended_at is null
    `;
    await sql`update vehicles set assigned_driver_id = null where id = ${vehicle.id}`;
    await sql`update vehicles set assigned_driver_id = ${driver.id} where id = ${vehicle.id}`;
    await sql`
      insert into driver_assignments (id, driver_id, vehicle_id, started_at)
      values (${nid("asg")}, ${driver.id}, ${vehicle.id}, ${now})
    `;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${driver.company_id}, ${session.userId}, 'driver.assigned', ${`${driver.name} → ${vehicle.plate}`})
    `;
    return { ok: true };
  });

export const setSpeedLimit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      target: z.enum(["company", "vehicle"]),
      companyId: z.string().optional(),
      vehicleId: z.string().optional(),
      speedLimit: z.number().int().min(20).max(180).optional(),
      clear: z.boolean().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    if (data.target === "company") {
      if (!data.companyId || data.speedLimit == null) throw new Error("Company speed required");
      if (!inScope(scope, data.companyId)) throw new Error("Forbidden");
      await sql`update companies set default_speed_limit = ${data.speedLimit} where id = ${data.companyId}`;
      await sql`
        insert into audit_logs (id, company_id, actor_id, action, target)
        values (${nid("aud")}, ${data.companyId}, ${session.userId}, 'speed.company', ${`${data.speedLimit} km/h`})
      `;
      return { ok: true };
    }
    if (!data.vehicleId) throw new Error("Vehicle required");
    const vehicle = (
      await sql<{ id: string; company_id: string; plate: string }>`
        select id, company_id, plate from vehicles where id = ${data.vehicleId}
      `
    )[0];
    if (!vehicle || !inScope(scope, vehicle.company_id)) throw new Error("Not found");
    const next = data.clear ? null : data.speedLimit;
    if (next == null && !data.clear) throw new Error("Speed required");
    await sql`update vehicles set speed_limit = ${next} where id = ${vehicle.id}`;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${vehicle.company_id}, ${session.userId}, 'speed.vehicle', ${`${vehicle.plate} ${next ?? "company default"}`})
    `;
    return { ok: true };
  });

export const saveDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string().optional(),
      vehicleId: z.string(),
      title: z.string().min(2).max(120),
      kind: z.enum(["insurance", "registration", "permit", "service"]),
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const vehicle = (await sql<{ id: string; company_id: string; plate: string }>`select id, company_id, plate from vehicles where id = ${data.vehicleId}`)[0];
    if (!vehicle || !inScope(scope, vehicle.company_id)) throw new Error("Not found");
    if (data.id) {
      const current = (await sql<{ company_id: string; title: string }>`select company_id, title from documents where id = ${data.id}`)[0];
      if (!current || !inScope(scope, current.company_id)) throw new Error("Document not found");
      await sql`update documents set vehicle_id = ${vehicle.id}, company_id = ${vehicle.company_id}, title = ${data.title}, kind = ${data.kind}, expires_on = ${data.expiresOn ?? null} where id = ${data.id}`;
      await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${vehicle.company_id}, ${session.userId}, 'document.updated', ${`${vehicle.plate} ${data.title}`})`;
      return { id: data.id };
    }
    const id = nid("doc");
    await sql`insert into documents (id, company_id, vehicle_id, title, kind, path, expires_on) values (${id}, ${vehicle.company_id}, ${vehicle.id}, ${data.title}, ${data.kind}, ${"/media/document.svg"}, ${data.expiresOn ?? null})`;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${vehicle.company_id}, ${session.userId}, 'document.filed', ${`${vehicle.plate} ${data.title}`})`;
    return { id };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const row = (await sql<{ company_id: string; title: string }>`select company_id, title from documents where id = ${data.id}`)[0];
    if (!row || !inScope(scope, row.company_id)) throw new Error("Document not found");
    await sql`delete from documents where id = ${data.id}`;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${row.company_id}, ${session.userId}, 'document.deleted', ${row.title})`;
    return { ok: true };
  });

export const listMaintenance = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    const rows = await sql<{
      id: string;
      vehicle_id: string;
      vehicle_name: string;
      title: string;
      due_odometer: number | null;
      due_hours: number | null;
      due_date: string | null;
      status: string;
      notes: string | null;
      company_id: string;
      odometer_km: number;
      engine_hours: number;
    }>`
      select m.id, m.vehicle_id, v.name as vehicle_name, m.title, m.due_odometer, m.due_hours, m.due_date,
        m.status, m.notes, m.company_id, v.odometer_km, v.engine_hours
      from maintenance_reminders m join vehicles v on v.id = m.vehicle_id
      order by m.status desc, m.due_date asc nulls last
    `;
    return rows
      .filter((r) => inScope(scope, r.company_id))
      .map(
        (r): MaintenanceRow => ({
          id: r.id,
          vehicleId: r.vehicle_id,
          vehicleName: r.vehicle_name,
          title: r.title,
          dueOdometer: r.due_odometer,
          dueHours: r.due_hours,
          dueDate: r.due_date,
          status: r.status,
          notes: r.notes,
          odometerKm: r.odometer_km,
          engineHours: r.engine_hours,
        }),
      );
  });

export const saveMaintenance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({
    id: z.string().optional(),
    vehicleId: z.string(),
    title: z.string().min(2).max(120),
    dueOdometer: z.number().positive().optional(),
    dueHours: z.number().positive().optional(),
    dueDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
    notes: z.string().max(240).optional(),
  }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    if (data.dueOdometer == null && data.dueHours == null && !data.dueDate) throw new Error("Set a due date, odometer, or engine hours");
    const scope = await companyScope(sql, session);
    const vehicle = (await sql<{ id: string; company_id: string; plate: string }>`select id, company_id, plate from vehicles where id = ${data.vehicleId}`)[0];
    if (!vehicle || !inScope(scope, vehicle.company_id)) throw new Error("Not found");
    if (data.id) {
      const current = (await sql<{ company_id: string; status: string }>`select company_id, status from maintenance_reminders where id = ${data.id}`)[0];
      if (!current || !inScope(scope, current.company_id)) throw new Error("Reminder not found");
      if (current.status !== "open") throw new Error("Completed maintenance records cannot be edited.");
      await sql`update maintenance_reminders set vehicle_id = ${vehicle.id}, company_id = ${vehicle.company_id}, title = ${data.title}, due_odometer = ${data.dueOdometer ?? null}, due_hours = ${data.dueHours ?? null}, due_date = ${data.dueDate ?? null}, notes = ${data.notes ?? null} where id = ${data.id}`;
      await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${vehicle.company_id}, ${session.userId}, 'maintenance.updated', ${`${vehicle.plate} ${data.title}`})`;
      return { id: data.id };
    }
    const id = nid("mn");
    await sql`insert into maintenance_reminders (id, company_id, vehicle_id, title, due_odometer, due_hours, due_date, status, notes)
      values (${id}, ${vehicle.company_id}, ${vehicle.id}, ${data.title}, ${data.dueOdometer ?? null}, ${data.dueHours ?? null}, ${data.dueDate ?? null}, 'open', ${data.notes ?? null})`;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${vehicle.company_id}, ${session.userId}, 'maintenance.created', ${`${vehicle.plate} ${data.title}`})`;
    return { id };
  });
export const completeMaintenance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const row = (
      await sql<{ company_id: string; title: string }>`
        select company_id, title from maintenance_reminders where id = ${data.id}
      `
    )[0];
    if (!row || !inScope(scope, row.company_id)) throw new Error("Not found");
    await sql`
      update maintenance_reminders set status = 'done', completed_at = ${new Date().toISOString()} where id = ${data.id}
    `;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${row.company_id}, ${session.userId}, 'maintenance.completed', ${row.title})
    `;
    return { ok: true };
  });

export const listMedia = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    const rows = await sql<{
      id: string;
      vehicle_id: string;
      vehicle_name: string;
      kind: string;
      path: string;
      caption: string | null;
      event_type: string | null;
      ts: string;
      company_id: string;
    }>`
      select m.id, m.vehicle_id, v.name as vehicle_name, m.kind, m.path, m.caption, m.event_type, m.ts, m.company_id
      from media_files m join vehicles v on v.id = m.vehicle_id
      order by m.ts desc
    `;
    return rows
      .filter((r) => inScope(scope, r.company_id))
      .map(
        (r): MediaRow => ({
          id: r.id,
          vehicleId: r.vehicle_id,
          vehicleName: r.vehicle_name,
          kind: r.kind,
          path: r.path,
          caption: r.caption,
          eventType: r.event_type,
          ts: toIso(r.ts),
        }),
      );
  });

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "company_admin", "accounts"].includes(session.role) && session.realRole !== "super_admin") {
      throw new Error("Forbidden");
    }
    const scope = await companyScope(sql, session);
    const rows = await sql<{
      id: string;
      company_id: string;
      company_name: string;
      number: string;
      period: string;
      amount_cents: number;
      vehicle_count: number;
      status: string;
      due_date: string | null;
    }>`
      select i.id, i.company_id, c.name as company_name, i.number, i.period, i.amount_cents, i.vehicle_count, i.status, i.due_date
      from invoices i join companies c on c.id = i.company_id
      order by i.due_date desc
    `;
    return rows
      .filter((r) => inScope(scope, r.company_id) || session.role === "super_admin")
      .map(
        (r): InvoiceRow => ({
          id: r.id,
          companyId: r.company_id,
          companyName: r.company_name,
          number: r.number,
          period: r.period,
          amountCents: r.amount_cents,
          vehicleCount: r.vehicle_count,
          status: r.status,
          dueDate: r.due_date,
        }),
      );
  });

export const markInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string(), status: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin") throw new Error("Forbidden");
    await sql`update invoices set status = ${data.status} where id = ${data.id}`;
    return { ok: true };
  });

export const listAudit = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    const scope = await companyScope(sql, session);
    const rows = await sql<{
      id: string;
      company_id: string | null;
      actor_id: string | null;
      action: string;
      target: string | null;
      created_at: string;
    }>`
      select id, company_id, actor_id, action, target, created_at from audit_logs
      order by created_at desc limit 150
    `;
    return rows
      .filter((r) => session.role === "super_admin" || inScope(scope, r.company_id))
      .map(
        (r): AuditRow => ({
          id: r.id,
          companyId: r.company_id,
          actor: r.actor_id,
          action: r.action,
          target: r.target,
          createdAt: toIso(r.created_at),
        }),
      );
  });

export const listTeam = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    const rows = await sql<{
      user_id: string;
      role: string;
      company_id: string | null;
      name: string | null;
      email: string | null;
      created_at: string;
      active: boolean;
    }>`select user_id, role, company_id, name, email, created_at, active from profiles order by created_at`;
    const invites = await sql<{
      id: string;
      email: string;
      role: string;
      company_id: string | null;
      created_at: string;
    }>`select id, email, role, company_id, created_at from invites order by created_at desc`;
    const scope = await companyScope(sql, session);
    return {
      profiles: rows.filter((r) => session.role === "super_admin" || inScope(scope, r.company_id) || r.user_id === session.userId),
      invites: invites.filter((r) => session.role === "super_admin" || inScope(scope, r.company_id)),
    };
  });

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      email: z.string().min(3),
      role: z.enum(["field_admin", "company_admin", "tracker", "accounts"]),
      companyId: z.string().nullable(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.role === "company_admin") {
      if (!["tracker", "accounts", "company_admin"].includes(data.role)) throw new Error("Forbidden");
    } else if (session.realRole !== "super_admin") {
      throw new Error("Forbidden");
    }
    const companyId = data.companyId ?? session.companyId;
    await sql`
      insert into invites (id, email, role, company_id, created_by)
      values (${nid("inv")}, ${data.email.toLowerCase()}, ${data.role}, ${companyId}, ${session.userId})
    `;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${companyId}, ${session.userId}, 'user.invited', ${data.email})
    `;
    return { ok: true };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    const row = (await sql<{ id: string; email: string; company_id: string | null }>`select id, email, company_id from invites where id = ${data.id}`)[0];
    const scope = await companyScope(sql, session);
    if (!row || (session.realRole !== "super_admin" && !inScope(scope, row.company_id))) throw new Error("Invite not found");
    if (session.realRole !== "super_admin" && session.role !== "company_admin") throw new Error("Forbidden");
    await sql`delete from invites where id = ${data.id}`;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${row.company_id}, ${session.userId}, 'user.invite_revoked', ${row.email})`;
    return { ok: true };
  });

export const getFleetBrief = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ window: z.enum(["day", "week", "month"]) }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.role === "accounts" || session.role === "pending" || session.role === "field_admin") {
      throw new Error("Forbidden");
    }
    const scope = await companyScope(sql, session);
    const hours = data.window === "day" ? 24 : data.window === "week" ? 24 * 7 : 24 * 30;
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600_000);
    const fromIso = from.toISOString();
    const toIsoStr = to.toISOString();
    const window = data.window satisfies BriefWindow;

    const trips = await sql<{
      company_id: string;
      vehicle_id: string;
      vehicle_name: string;
      plate: string;
      company_name: string;
      started_at: string;
      ended_at: string | null;
      distance_km: number;
      max_speed: number;
      idle_minutes: number;
      fuel_used: number | null;
    }>`
      select t.company_id, t.vehicle_id, v.name as vehicle_name, v.plate, c.name as company_name,
        t.started_at, t.ended_at, t.distance_km, t.max_speed, t.idle_minutes, t.fuel_used
      from trips t
      join vehicles v on v.id = t.vehicle_id
      join companies c on c.id = t.company_id
      where t.started_at >= ${fromIso} and t.started_at <= ${toIsoStr}
    `;
    const alerts = await sql<{ company_id: string; vehicle_id: string | null; type: string; created_at: string }>`
      select company_id, vehicle_id, type, created_at from alerts
      where created_at >= ${fromIso} and created_at <= ${toIsoStr}
    `;
    const fuels = await sql<{
      id: string;
      company_id: string;
      kind: string;
      litres: number;
      ts: string;
      notes: string | null;
      vehicle_name: string;
      plate: string;
    }>`
      select f.id, f.company_id, f.kind, f.litres, f.ts, f.notes, v.name as vehicle_name, v.plate
      from fuel_events f
      join vehicles v on v.id = f.vehicle_id
      where f.ts >= ${fromIso} and f.ts <= ${toIsoStr}
      order by f.ts desc
    `;
    const fences = await sql<{ company_id: string; name: string; zone_type: string; kind: string }>`
      select e.company_id, g.name, g.zone_type, e.kind
      from geofence_events e
      join geofences g on g.id = e.geofence_id
      where e.ts >= ${fromIso} and e.ts <= ${toIsoStr}
    `;
    const docs = await sql<{
      id: string;
      title: string;
      kind: string;
      expires_on: string | null;
      company_id: string;
      vehicle_name: string | null;
    }>`
      select d.id, d.title, d.kind, d.expires_on, d.company_id, v.name as vehicle_name
      from documents d
      left join vehicles v on v.id = d.vehicle_id
      where d.expires_on is not null
      order by d.expires_on asc
    `;

    const scopedTrips = trips.filter((t) => inScope(scope, t.company_id));
    const scopedAlerts = alerts.filter((a) => inScope(scope, a.company_id));
    const buckets = briefAxis(window);
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    let distanceKm = 0;
    let fuelUsed = 0;
    let idleMin = 0;
    let movingMs = 0;
    const vehicles = new Map<
      string,
      {
        id: string;
        name: string;
        plate: string;
        companyName: string;
        distanceKm: number;
        fuelUsed: number;
        idleMin: number;
        maxSpeed: number;
        alerts: number;
      }
    >();

    for (const t of scopedTrips) {
      const dist = Number(t.distance_km) || 0;
      const fuel = Number(t.fuel_used) || 0;
      const idle = Number(t.idle_minutes) || 0;
      distanceKm += dist;
      fuelUsed += fuel;
      idleMin += idle;
      const started = toIso(t.started_at);
      const ended = t.ended_at ? new Date(toIso(t.ended_at)).getTime() : new Date(started).getTime();
      movingMs += Math.max(0, ended - new Date(started).getTime());
      const bucket = byKey.get(bucketKey(started, window));
      if (bucket) {
        bucket.distanceKm += dist;
        bucket.fuelUsed += fuel;
      }
      const veh = vehicles.get(t.vehicle_id) ?? {
        id: t.vehicle_id,
        name: t.vehicle_name,
        plate: t.plate,
        companyName: t.company_name,
        distanceKm: 0,
        fuelUsed: 0,
        idleMin: 0,
        maxSpeed: 0,
        alerts: 0,
      };
      veh.distanceKm += dist;
      veh.fuelUsed += fuel;
      veh.idleMin += idle;
      veh.maxSpeed = Math.max(veh.maxSpeed, Number(t.max_speed) || 0);
      vehicles.set(t.vehicle_id, veh);
    }

    for (const a of scopedAlerts) {
      const bucket = byKey.get(bucketKey(toIso(a.created_at), window));
      if (bucket) bucket.alerts += 1;
      if (a.vehicle_id && vehicles.has(a.vehicle_id)) {
        vehicles.get(a.vehicle_id)!.alerts += 1;
      }
    }

    const fenceMap = new Map<string, { name: string; zoneType: string; enters: number; exits: number; dwells: number }>();
    for (const f of fences) {
      if (!inScope(scope, f.company_id)) continue;
      const row = fenceMap.get(f.name) ?? { name: f.name, zoneType: f.zone_type, enters: 0, exits: 0, dwells: 0 };
      if (f.kind === "exit") row.exits += 1;
      else if (f.kind === "dwell") row.dwells += 1;
      else row.enters += 1;
      fenceMap.set(f.name, row);
    }

    const horizon = Date.now() + 90 * 86400000;
    const documents = docs
      .filter((d) => inScope(scope, d.company_id) && d.expires_on && new Date(d.expires_on).getTime() <= horizon)
      .slice(0, 6)
      .map((d) => ({
        id: d.id,
        title: d.title,
        kind: d.kind,
        vehicleName: d.vehicle_name,
        expiresOn: String(d.expires_on).slice(0, 10),
      }));

    return {
      window,
      from: fromIso,
      to: toIsoStr,
      distanceKm: round1(distanceKm),
      fuelUsed: round1(fuelUsed),
      efficiency: distanceKm > 1 ? round1((fuelUsed / distanceKm) * 100) : null,
      idleMin: Math.round(idleMin),
      tripCount: scopedTrips.length,
      movingHours: round1(movingMs / 3600000),
      speeding: scopedAlerts.filter((a) => a.type === "speeding").length,
      offline: scopedAlerts.filter((a) => a.type === "offline").length,
      geofenceCount: [...fenceMap.values()].reduce((n, f) => n + f.enters + f.exits + f.dwells, 0),
      fuelDrops: fuels.filter((f) => inScope(scope, f.company_id) && f.kind === "drop").length,
      fuelFills: fuels.filter((f) => inScope(scope, f.company_id) && f.kind === "fill").length,
      buckets: buckets.map((b) => ({
        ...b,
        distanceKm: round1(b.distanceKm),
        fuelUsed: round1(b.fuelUsed),
      })),
      vehicles: [...vehicles.values()]
        .map((v) => ({
          ...v,
          distanceKm: round1(v.distanceKm),
          fuelUsed: round1(v.fuelUsed),
          idleMin: Math.round(v.idleMin),
          maxSpeed: Math.round(v.maxSpeed),
        }))
        .sort((a, b) => b.distanceKm - a.distanceKm)
        .slice(0, 8),
      fences: [...fenceMap.values()].sort((a, b) => b.enters + b.exits - (a.enters + a.exits)),
      fuelEvents: fuels
        .filter((f) => inScope(scope, f.company_id))
        .slice(0, 8)
        .map((f) => ({
          id: f.id,
          vehicleName: f.vehicle_name,
          plate: f.plate,
          kind: f.kind,
          litres: Number(f.litres),
          ts: toIso(f.ts),
          notes: f.notes,
        })),
      documents,
    };
  });

export const getHealth = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin") throw new Error("Forbidden");
    const companies = await sql<{ n: number }>`select count(*)::int as n from companies`;
    const vehicles = await sql<{ n: number }>`select count(*)::int as n from vehicles`;
    const devices = await sql<{ n: number }>`select count(*)::int as n from devices`;
    const positions = await sql<{ n: number }>`select count(*)::int as n from positions`;
    const lastHour = await sql<{ n: number }>`
      select count(*)::int as n from positions where ts > now() - interval '1 hour'
    `;
    const open = await sql<{ n: number }>`select count(*)::int as n from alerts where status = 'open'`;
    const assigned = await sql<{ n: number }>`
      select count(*)::int as n from devices where vehicle_id is not null
    `;
    const online = await sql<{ n: number }>`
      select count(*)::int as n from devices
      where vehicle_id is not null and last_seen > now() - interval '8 minutes'
    `;
    const journal = await sql<{ status: string; n: number }>`
      select status, count(*)::int as n from ingest_journal
      where created_at > now() - interval '1 hour'
      group by status
    `;
    const assignedN = assigned[0]?.n ?? 0;
    const onlineN = online[0]?.n ?? 0;
    const ingestFail = journal.filter((row) => row.status !== "ok").reduce((sum, row) => sum + row.n, 0);
    const ingestOk = journal.filter((row) => row.status === "ok").reduce((sum, row) => sum + row.n, 0);
    return {
      companies: companies[0]?.n ?? 0,
      vehicles: vehicles[0]?.n ?? 0,
      devices: devices[0]?.n ?? 0,
      positions: positions[0]?.n ?? 0,
      ingestHour: lastHour[0]?.n ?? 0,
      openAlerts: open[0]?.n ?? 0,
      onlineDevices: onlineN,
      linkPct: assignedN ? Math.round((onlineN / assignedN) * 100) : 0,
      ingestOk,
      ingestFail,
    };
  });

export const ingestNormalized = async (payload: {
  imei: string;
  secret?: string;
  timestamp?: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  ignition?: boolean;
  fuel_level?: number;
  event?: string;
}) => {
  const fix: NormalizedFix = {
    imei: payload.imei,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    lat: payload.lat,
    lng: payload.lng,
    speed: payload.speed ?? 0,
    heading: payload.heading ?? 0,
    altitude: null,
    ignition: payload.ignition ?? false,
    fuelLevel: payload.fuel_level ?? null,
    event: payload.event ?? "location",
    satellites: null,
    decoder: "generic_http",
  };
  await acceptDevicePayload(JSON.stringify(fixToGeneric(fix, payload.secret)), { decoder: "generic_http" });
  return { ok: true };
};

const hits = new Map<string, number[]>();

function rateOk(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 30) return false;
  recent.push(now);
  hits.set(key, recent);
  return true;
}

function fixToGeneric(fix: NormalizedFix, secret?: string) {
  return {
    imei: fix.imei,
    timestamp: fix.timestamp,
    lat: fix.lat,
    lng: fix.lng,
    speed: fix.speed,
    heading: fix.heading,
    ignition: fix.ignition,
    fuel_level: fix.fuelLevel,
    event: fix.event,
    secret,
  };
}

export async function acceptDevicePayload(
  raw: string,
  opts?: { decoder?: DecoderName; scope?: string[] | null; enforceScope?: boolean; actorId?: string },
) {
  const sql = await (await import("@/lib/db")).getSql();
  if (raw.length > 8000) throw new Error("Packet is too large");
  let decoder = opts?.decoder;
  let fixes: NormalizedFix[];
  try {
    if (!decoder) {
      let sniffed: DecoderName | null = null;
      try {
        sniffed = sniffDecoder(raw);
      } catch {
        sniffed = null;
      }
      if (sniffed === "generic_http") {
        decoder = "generic_http";
      } else {
        const imei = guessImei(raw);
        if (imei) {
          const known = (await sql<{ decoder: string }>`select decoder from devices where imei = ${imei}`)[0];
          if (known && isDecoderName(known.decoder)) decoder = known.decoder;
        }
        decoder ??= sniffed ?? undefined;
      }
    }
    if (!decoder) throw new Error("Unrecognised packet. Pick a decoder or send JSON.");
    fixes = decode(decoder, raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not decode";
    await writeJournal(sql, {
      imei: guessImei(raw),
      decoder: decoder ?? null,
      status: "rejected",
      detail: message,
      companyId: null,
      lat: null,
      lng: null,
    });
    throw new Error(message);
  }
  if (!rateOk(fixes[0]?.imei || "anon")) {
    await writeJournal(sql, {
      imei: fixes[0]?.imei ?? null,
      decoder,
      status: "rejected",
      detail: "Too many packets for this device. Wait a minute.",
      companyId: null,
      lat: fixes[0]?.lat ?? null,
      lng: fixes[0]?.lng ?? null,
    });
    throw new Error("Too many packets for this device. Wait a minute.");
  }
  const secret = readSecret(raw);
  let vehicleName: string | null = null;
  let address: string | null = null;
  for (const fix of fixes) {
    const device = (
      await sql<{
        id: string;
        vehicle_id: string | null;
        company_id: string | null;
        secret: string | null;
        vehicle_name: string | null;
        tank_litres: number | null;
      }>`
        select d.id, d.vehicle_id, d.company_id, d.secret, v.name as vehicle_name, v.tank_litres
        from devices d
        left join vehicles v on v.id = d.vehicle_id
        where d.imei = ${fix.imei}
      `
    )[0];
    try {
      if (!device) throw new Error("Unknown device");
      if (opts?.enforceScope && !inScope(opts.scope ?? null, device.company_id)) throw new Error("Forbidden");
      if (device.secret && secret && device.secret !== secret) throw new Error("Unauthorized device");
      if (!device.vehicle_id || !device.company_id) throw new Error("Device not assigned");
      const ts = fix.timestamp || new Date().toISOString();
      address = reverseGeocode(fix.lat, fix.lng);
      const litres = fix.fuelLevel != null ? (fix.fuelLevel / 100) * Number(device.tank_litres ?? 0) : null;
      await sql`
        insert into positions (id, vehicle_id, company_id, ts, lat, lng, speed, heading, altitude, ignition, fuel_level, fuel_litres, address, event)
        values (${nid("pos")}, ${device.vehicle_id}, ${device.company_id}, ${ts}, ${fix.lat}, ${fix.lng},
          ${fix.speed}, ${fix.heading}, ${fix.altitude}, ${fix.ignition}, ${fix.fuelLevel}, ${litres}, ${address}, ${fix.event})
      `;
      await sql`
        update devices
        set last_seen = ${ts}, gps_signal = coalesce(${fix.satellites}, gps_signal)
        where id = ${device.id}
      `;
      vehicleName = device.vehicle_name;
      await writeJournal(sql, {
        imei: fix.imei,
        decoder: fix.decoder,
        status: "ok",
        detail: `${device.vehicle_name ?? fix.imei} · ${fix.lat.toFixed(4)}, ${fix.lng.toFixed(4)} · ${Math.round(fix.speed)} km/h`,
        companyId: device.company_id,
        lat: fix.lat,
        lng: fix.lng,
      });
      if (opts?.actorId) {
        await sql`
          insert into audit_logs (id, company_id, actor_id, action, target)
          values (${nid("aud")}, ${device.company_id}, ${opts.actorId}, 'ingest.filed', ${fix.imei})
        `;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ingest failed";
      await writeJournal(sql, {
        imei: fix.imei,
        decoder: fix.decoder,
        status: "rejected",
        detail: message,
        companyId: device?.company_id ?? null,
        lat: fix.lat,
        lng: fix.lng,
      });
      throw new Error(message);
    }
  }
  return { fixes, vehicleName, address };
}

async function writeJournal(
  sql: Awaited<ReturnType<typeof ctx>>["sql"],
  row: {
    imei: string | null;
    decoder: string | null;
    status: "ok" | "rejected";
    detail: string;
    companyId: string | null;
    lat: number | null;
    lng: number | null;
  },
) {
  await sql`
    insert into ingest_journal (id, company_id, imei, decoder, status, detail, lat, lng)
    values (${nid("ing")}, ${row.companyId}, ${row.imei}, ${row.decoder}, ${row.status}, ${row.detail}, ${row.lat}, ${row.lng})
  `;
  await sql`
    delete from ingest_journal where created_at < (
      select created_at from ingest_journal order by created_at desc offset 180 limit 1
    )
  `;
}

function guessImei(raw: string): string | null {
  const match = raw.match(/\d{14,16}/);
  return match ? match[0] : null;
}

function readSecret(raw: string): string | undefined {
  const text = raw.trim();
  if (!text.startsWith("{")) return undefined;
  try {
    const obj = JSON.parse(text) as { secret?: unknown };
    return typeof obj.secret === "string" ? obj.secret : undefined;
  } catch {
    return undefined;
  }
}

const decoderEnum = z.enum(DECODER_NAMES);

export const listIngestJournal = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "field_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const rows = await sql<{
      id: string;
      imei: string | null;
      decoder: string | null;
      status: string;
      detail: string | null;
      lat: number | null;
      lng: number | null;
      vehicle_name: string | null;
      company_id: string | null;
      created_at: string;
    }>`
      select j.id, j.imei, j.decoder, j.status, j.detail, j.lat, j.lng, j.company_id, j.created_at,
        v.name as vehicle_name
      from ingest_journal j
      left join devices d on d.imei = j.imei
      left join vehicles v on v.id = d.vehicle_id
      order by j.created_at desc
      limit 80
    `;
    return rows
      .filter((row) => {
        if (scope === null) return true;
        if (row.company_id) return inScope(scope, row.company_id);
        return session.role === "field_admin";
      })
      .slice(0, 12)
      .map(
        (row): IngestRow => ({
          id: row.id,
          imei: row.imei,
          decoder: row.decoder,
          status: row.status === "ok" ? "ok" : "rejected",
          detail: row.detail,
          lat: row.lat,
          lng: row.lng,
          vehicleName: row.vehicle_name,
          createdAt: toIso(row.created_at),
        }),
      );
  });

export const filePacket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ decoder: decoderEnum, raw: z.string().min(2).max(8000) }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (!["super_admin", "field_admin", "company_admin"].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const result = await acceptDevicePayload(data.raw, {
      decoder: data.decoder,
      scope,
      enforceScope: true,
      actorId: session.userId,
    });
    const fix = result.fixes[result.fixes.length - 1];
    return {
      vehicleName: result.vehicleName,
      address: result.address,
      count: result.fixes.length,
      fix,
    };
  });

const FLAG_KEY = z.enum(["offline", "speeding", "fuel_theft", "long_idle", "geofence", "mail_dispatch"]);

function mapSchedule(row: {
  id: string;
  company_id: string;
  company_name: string;
  kind: string;
  cadence: string;
  recipient: string;
  enabled: boolean;
  next_run: string;
  last_run: string | null;
}): ScheduleRow {
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    kind: row.kind,
    cadence: row.cadence === "weekly" ? "weekly" : "daily",
    recipient: row.recipient,
    enabled: row.enabled === true || String(row.enabled) === "t" || String(row.enabled) === "true",
    nextRun: toIso(row.next_run),
    lastRun: row.last_run ? toIso(row.last_run) : null,
  };
}

async function readSchedules(sql: Awaited<ReturnType<typeof ctx>>["sql"], scope: string[] | null) {
  const rows = await sql<{
    id: string;
    company_id: string;
    company_name: string;
    kind: string;
    cadence: string;
    recipient: string;
    enabled: boolean;
    next_run: string;
    last_run: string | null;
  }>`
    select s.id, s.company_id, c.name as company_name, s.kind, s.cadence, s.recipient, s.enabled, s.next_run, s.last_run
    from report_schedules s
    join companies c on c.id = s.company_id
    order by c.name, s.cadence
  `;
  return rows.filter((row) => inScope(scope, row.company_id)).map(mapSchedule);
}

async function readMail(sql: Awaited<ReturnType<typeof ctx>>["sql"], scope: string[] | null) {
  const rows = await sql<{
    id: string;
    company_id: string | null;
    company_name: string | null;
    to_email: string;
    subject: string;
    body: string;
    kind: string;
    created_at: string;
  }>`
    select m.id, m.company_id, c.name as company_name, m.to_email, m.subject, m.body, m.kind, m.created_at
    from mail_queue m
    left join companies c on c.id = m.company_id
    order by m.created_at desc
    limit 40
  `;
  return rows
    .filter((row) => inScope(scope, row.company_id))
    .slice(0, 16)
    .map(
      (row): MailRow => ({
        id: row.id,
        companyId: row.company_id,
        companyName: row.company_name,
        to: row.to_email,
        subject: row.subject,
        body: row.body,
        kind: row.kind,
        createdAt: toIso(row.created_at),
      }),
    );
}

export const getControlDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin") throw new Error("Forbidden");
    await ensureControlDefaults(sql);
    const dispatch = await dispatchDueReports(sql, null);
    const flagsNow = await loadFlags(sql);
    const flags: FlagRow[] = FLAG_DEFS.map((flag) => ({
      key: flag.key,
      label: flag.label,
      detail: flag.detail,
      enabled: flagsNow[flag.key],
    }));
    const sessions = await sql<{
      id: string;
      user_id: string;
      name: string | null;
      email: string | null;
      role: string | null;
      company_name: string | null;
      updated_at: string;
      ip_address: string | null;
      user_agent: string | null;
    }>`
      select s.id,
             s."userId" as user_id,
             u.name,
             u.email,
             p.role,
             c.name as company_name,
             s."updatedAt" as updated_at,
             s."ipAddress" as ip_address,
             s."userAgent" as user_agent
      from "session" s
      join "user" u on u.id = s."userId"
      left join profiles p on p.user_id = s."userId"
      left join companies c on c.id = p.company_id
      where s."expiresAt" > now()
      order by s."updatedAt" desc
    `;
    const health = await sql<{ companies: number; vehicles: number; open_alerts: number }>`
      select
        (select count(*)::int from companies) as companies,
        (select count(*)::int from vehicles) as vehicles,
        (select count(*)::int from alerts where status = 'open') as open_alerts
    `;
    return {
      flags,
      dispatch,
      sessions: sessions.map(
        (row): DeskSession => ({
          id: row.id,
          userId: row.user_id,
          name: row.name,
          email: row.email,
          role: row.role,
          companyName: row.company_name,
          updatedAt: toIso(row.updated_at),
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          self: row.user_id === session.userId,
        }),
      ),
      schedules: await readSchedules(sql, null),
      mail: await readMail(sql, null),
      totals: {
        companies: health[0]?.companies ?? 0,
        vehicles: health[0]?.vehicles ?? 0,
        openAlerts: health[0]?.open_alerts ?? 0,
      },
    };
  });

export const setFeatureFlag = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ key: FLAG_KEY, enabled: z.boolean() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin") throw new Error("Forbidden");
    const key = data.key as FlagKey;
    await sql`
      insert into feature_flags (key, enabled, updated_at)
      values (${key}, ${data.enabled}, now())
      on conflict (key) do update set enabled = excluded.enabled, updated_at = now()
    `;
    await sql`
      insert into audit_logs (id, actor_id, action, target)
      values (${nid("aud")}, ${session.userId}, 'flag.set', ${`${key} ${data.enabled ? "on" : "off"}`})
    `;
    return { ok: true };
  });

export const revokeSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ sessionId: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin") throw new Error("Forbidden");
    const row = (
      await sql<{ id: string; user_id: string; email: string | null }>`
        select s.id, s."userId" as user_id, u.email
        from "session" s
        join "user" u on u.id = s."userId"
        where s.id = ${data.sessionId}
      `
    )[0];
    if (!row) throw new Error("Session already ended");
    if (row.user_id === session.userId) throw new Error("Use Sign out for your own console");
    await sql`delete from "session" where id = ${data.sessionId}`;
    await sql`
      insert into audit_logs (id, actor_id, action, target)
      values (${nid("aud")}, ${session.userId}, 'session.revoked', ${row.email ?? row.user_id})
    `;
    return { ok: true };
  });

export const setCompanyMark = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ companyId: z.string(), mark: z.string().min(1).max(4) }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    const mark = data.mark.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (mark.length < 1 || mark.length > 4) throw new Error("Use 1–4 letters");
    const allowed =
      session.realRole === "super_admin" ||
      (session.role === "company_admin" && session.companyId === data.companyId);
    if (!allowed) throw new Error("Forbidden");
    const company = (await sql<{ id: string }>`select id from companies where id = ${data.companyId}`)[0];
    if (!company) throw new Error("Not found");
    await sql`update companies set mark = ${mark} where id = ${data.companyId}`;
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${data.companyId}, ${session.userId}, 'company.mark', ${mark})
    `;
    return { mark };
  });

export const listReportDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.role !== "super_admin" && session.role !== "company_admin") throw new Error("Forbidden");
    await ensureControlDefaults(sql);
    const scope = await companyScope(sql, session);
    const dispatch = await dispatchDueReports(sql, scope);
    return {
      schedules: await readSchedules(sql, scope),
      mail: await readMail(sql, scope),
      dispatch,
    };
  });

export const saveReportSchedule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string().optional(),
      companyId: z.string(),
      kind: z.enum(["trips", "fuel", "offline", "speeding", "stops"]),
      cadence: z.enum(["daily", "weekly"]),
      recipient: z.string().trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter an email address"),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.role !== "super_admin" && session.role !== "company_admin") throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    if (!inScope(scope, data.companyId)) throw new Error("Forbidden");
    const company = (await sql<{ id: string }>`select id from companies where id = ${data.companyId}`)[0];
    if (!company) throw new Error("Company not found");
    const next = new Date(Date.now() + (data.cadence === "weekly" ? 7 : 1) * 86400000).toISOString();
    if (data.id) {
      const current = (await sql<{ company_id: string }>`select company_id from report_schedules where id = ${data.id}`)[0];
      if (!current || !inScope(scope, current.company_id)) throw new Error("Schedule not found");
      await sql`update report_schedules set company_id = ${data.companyId}, kind = ${data.kind}, cadence = ${data.cadence}, recipient = ${data.recipient}, next_run = ${next} where id = ${data.id}`;
      await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${data.companyId}, ${session.userId}, 'report_schedule.updated', ${`${data.cadence} ${data.kind} ${data.recipient}`})`;
      return { id: data.id };
    }
    const id = nid("sch");
    await sql`
      insert into report_schedules (id, company_id, kind, cadence, recipient, enabled, next_run, created_by)
      values (${id}, ${data.companyId}, ${data.kind}, ${data.cadence}, ${data.recipient}, true, ${next}, ${session.userId})
    `;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${data.companyId}, ${session.userId}, 'report.scheduled', ${`${data.cadence} ${data.kind}`})`;
    return { id };
  });

export const setScheduleEnabled = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string(), enabled: z.boolean() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.role !== "super_admin" && session.role !== "company_admin") throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const row = (await sql<{ company_id: string }>`select company_id from report_schedules where id = ${data.id}`)[0];
    if (!row || !inScope(scope, row.company_id)) throw new Error("Not found");
    await sql`update report_schedules set enabled = ${data.enabled} where id = ${data.id}`;
    return { ok: true };
  });

export const fileReportNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.role !== "super_admin" && session.role !== "company_admin") throw new Error("Forbidden");
    const flags = await loadFlags(sql);
    if (!flags.mail_dispatch) throw new Error("Mail desk is paused");
    const scope = await companyScope(sql, session);
    const row = (await sql<{ company_id: string }>`select company_id from report_schedules where id = ${data.id}`)[0];
    if (!row || !inScope(scope, row.company_id)) throw new Error("Not found");
    const filed = await fileSchedule(sql, data.id, true);
    if (!filed) throw new Error("Could not file that report");
    return { ok: true };
  });


// ── Platform landing settings (Super Admin only) ─────────────────────────────

export type LandingSettings = {
  heroType: "none" | "image" | "video";
  heroUrl: string;
  headline: string;
  subhead: string;
};

export const getLandingSettings = createServerFn({ method: "GET" }).handler(async () => {
  const defaults: LandingSettings = {
    heroType: "none",
    heroUrl: "",
    headline: "Command every kilometre.",
    subhead:
      "Real-time tracking, fuel integrity, and geofence discipline for fleets that cannot afford surprises.",
  };
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ key: string; value: string }>`
      select key, value from platform_settings
      where key in ('landing_hero_type', 'landing_hero_url', 'landing_headline', 'landing_subhead')
    `;
    if (!rows.length) return defaults;
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const heroType = (map.landing_hero_type as LandingSettings["heroType"]) || "none";
    return {
      heroType: ["none", "image", "video"].includes(heroType) ? heroType : "none",
      heroUrl: map.landing_hero_url ?? "",
      headline: map.landing_headline ?? defaults.headline,
      subhead: map.landing_subhead ?? defaults.subhead,
    } satisfies LandingSettings;
  } catch {
    return defaults;
  }
});

export const setLandingSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      heroType: z.enum(["none", "image", "video"]),
      heroUrl: z.string().max(2000),
      headline: z.string().min(1).max(160),
      subhead: z.string().min(1).max(400),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin") throw new Error("Forbidden");
    const now = new Date().toISOString();
    const entries: [string, string][] = [
      ["landing_hero_type", data.heroType],
      ["landing_hero_url", data.heroUrl.trim()],
      ["landing_headline", data.headline.trim()],
      ["landing_subhead", data.subhead.trim()],
    ];
    for (const [key, value] of entries) {
      await sql`
        insert into platform_settings (key, value, updated_at, updated_by)
        values (${key}, ${value}, ${now}, ${session.userId})
        on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
      `;
    }
    return { ok: true };
  });


// Safe removal actions for manually created fleet records. Historical telemetry,
// assignments, calibrations, and completed maintenance are deliberately retained.
export const deleteVehicle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (![ "super_admin", "company_admin" ].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const vehicle = (await sql<{ id: string; company_id: string; plate: string }>`select id, company_id, plate from vehicles where id = ${data.id}`)[0];
    if (!vehicle || !inScope(scope, vehicle.company_id)) throw new Error("Vehicle not found");
    const history = await sql<{ n: number }>`
      select (
        (select count(*) from positions where vehicle_id = ${data.id}) +
        (select count(*) from trips where vehicle_id = ${data.id}) +
        (select count(*) from stops where vehicle_id = ${data.id}) +
        (select count(*) from fuel_events where vehicle_id = ${data.id}) +
        (select count(*) from alerts where vehicle_id = ${data.id}) +
        (select count(*) from maintenance_reminders where vehicle_id = ${data.id}) +
        (select count(*) from documents where vehicle_id = ${data.id}) +
        (select count(*) from media_files where vehicle_id = ${data.id}) +
        (select count(*) from driver_assignments where vehicle_id = ${data.id}) +
        (select count(*) from behavior_events where vehicle_id = ${data.id}) +
        (select count(*) from device_commands where vehicle_id = ${data.id})
      )::int as n
    `;
    if ((history[0]?.n ?? 0) > 0) throw new Error("This vehicle has operational history. Keep it in the fleet register; historical records must not be deleted.");
    await sql`update devices set vehicle_id = null where vehicle_id = ${data.id}`;
    await sql`delete from vehicles where id = ${data.id} and company_id = ${vehicle.company_id}`;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${vehicle.company_id}, ${session.userId}, 'vehicle.deleted', ${vehicle.plate})`;
    return { ok: true };
  });

export const deleteDriver = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (![ "super_admin", "company_admin" ].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const driver = (await sql<{ id: string; company_id: string; name: string }>`select id, company_id, name from drivers where id = ${data.id}`)[0];
    if (!driver || !inScope(scope, driver.company_id)) throw new Error("Driver not found");
    const assignments = await sql<{ n: number }>`select count(*)::int as n from driver_assignments where driver_id = ${data.id}`;
    if ((assignments[0]?.n ?? 0) > 0) throw new Error("This driver has assignment history. Keep the record to preserve the audit trail.");
    await sql`update vehicles set assigned_driver_id = null where assigned_driver_id = ${data.id}`;
    await sql`delete from drivers where id = ${data.id} and company_id = ${driver.company_id}`;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${driver.company_id}, ${session.userId}, 'driver.deleted', ${driver.name})`;
    return { ok: true };
  });

export const deleteDevice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (![ "super_admin", "field_admin", "company_admin" ].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const device = (await sql<{ id: string; company_id: string | null; imei: string }>`select id, company_id, imei from devices where id = ${data.id}`)[0];
    if (!device || !inScope(scope, device.company_id)) throw new Error("Device not found");
    const protectedRows = await sql<{ calibrations: number; commands: number }>`
      select
        (select count(*)::int from device_calibrations where device_id = ${data.id}) as calibrations,
        (select count(*)::int from device_commands where device_id = ${data.id}) as commands
    `;
    if ((protectedRows[0]?.calibrations ?? 0) > 0 || (protectedRows[0]?.commands ?? 0) > 0) {
      throw new Error("This device has calibration or command history. It cannot be permanently removed; retain the record for audit purposes.");
    }
    await sql`delete from devices where id = ${data.id}`;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${device.company_id}, ${session.userId}, 'device.deleted', ${device.imei})`;
    return { ok: true };
  });

export const deleteMaintenance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (![ "super_admin", "company_admin" ].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const row = (await sql<{ id: string; company_id: string; title: string; status: string }>`select id, company_id, title, status from maintenance_reminders where id = ${data.id}`)[0];
    if (!row || !inScope(scope, row.company_id)) throw new Error("Maintenance reminder not found");
    if (row.status !== "open") throw new Error("Completed maintenance records are retained as operational history.");
    await sql`delete from maintenance_reminders where id = ${data.id}`;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${row.company_id}, ${session.userId}, 'maintenance.deleted', ${row.title})`;
    return { ok: true };
  });

export const deleteReportSchedule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (![ "super_admin", "company_admin" ].includes(session.role)) throw new Error("Forbidden");
    const scope = await companyScope(sql, session);
    const row = (await sql<{ id: string; company_id: string; kind: string; recipient: string }>`select id, company_id, kind, recipient from report_schedules where id = ${data.id}`)[0];
    if (!row || !inScope(scope, row.company_id)) throw new Error("Schedule not found");
    await sql`delete from report_schedules where id = ${data.id}`;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target) values (${nid("aud")}, ${row.company_id}, ${session.userId}, 'report_schedule.deleted', ${row.kind + " " + row.recipient})`;
    return { ok: true };
  });


export const setUserActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ userId: z.string(), active: z.boolean() }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin") throw new Error("Forbidden");
    if (data.userId === session.userId) throw new Error("You cannot deactivate your own account.");
    const target = (await sql<{ role: string; email: string | null }>`select role, email from profiles where user_id = ${data.userId}`)[0];
    if (!target) throw new Error("User not found");
    if (target.role === "super_admin") throw new Error("Platform administrator accounts are protected.");
    await sql`update profiles set active = ${data.active} where user_id = ${data.userId}`;
    await sql`delete from view_overrides where user_id = ${data.userId}`;
    await sql`insert into audit_logs (id, actor_id, action, target) values (${nid("aud")}, ${session.userId}, ${data.active ? "user.activated" : "user.deactivated"}, ${target.email ?? data.userId})`;
    return { ok: true };
  });

export const updateUserRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ userId: z.string(), role: z.enum(["field_admin", "company_admin", "tracker", "accounts", "pending"]) }))
  .handler(async ({ context, data }) => {
    const { sql, session } = await ctx(context.userId);
    if (session.realRole !== "super_admin") throw new Error("Forbidden");
    if (data.userId === session.userId) throw new Error("You cannot change your own role here.");
    const target = (await sql<{ role: string; email: string | null; company_id: string | null }>`select role, email, company_id from profiles where user_id = ${data.userId}`)[0];
    if (!target) throw new Error("User not found");
    if (target.role === "super_admin") throw new Error("Platform administrator roles are protected.");
    await sql`update profiles set role = ${data.role} where user_id = ${data.userId}`;
    await sql`insert into audit_logs (id, company_id, actor_id, action, target, meta) values (${nid("aud")}, ${target.company_id}, ${session.userId}, 'user.role_updated', ${target.email ?? data.userId}, ${JSON.stringify({ from: target.role, to: data.role })}::jsonb)`;
    return { ok: true };
  });

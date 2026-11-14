import type { Sql } from "@/lib/db";
import { nid } from "@/lib/utils";
import {
  alongRoute,
  distToPolyline,
  haversine,
  parseSchedule,
  pointInCircle,
  pointInPolygon,
  reverseGeocode,
  routeLength,
  scheduleIsOpen,
  type LatLng,
} from "./geo";
import { ROUTES } from "./seed-data";
import { dispatchDueReports, ensureControlDefaults, loadFlags, type EngineFlags } from "./control";
import type { CircleGeom, PolygonGeom, RouteGeom } from "./types";

type VehRow = {
  id: string;
  company_id: string;
  route_key: string | null;
  behavior: string;
  tank_litres: number;
  speed_limit: number;
  odometer_km: number;
  engine_hours: number;
  status_since: string;
  name: string;
};

type PosRow = {
  vehicle_id: string;
  ts: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  ignition: boolean;
  fuel_level: number | null;
  fuel_litres: number | null;
};

type RuleRow = {
  company_id: string;
  vehicle_id: string | null;
  type: string;
  enabled: boolean;
  config: unknown;
};

type RuleConfig = {
  minutes?: number;
  graceKmh?: number;
  litres?: number;
  quietStart?: string | null;
  quietEnd?: string | null;
  escalateMin?: number | null;
};

type GfRow = {
  id: string;
  company_id: string;
  name: string;
  kind: string;
  zone_type: string;
  geometry: unknown;
  schedule: unknown;
};

const OFFLINE_MS = 10 * 60_000;

export async function tickSimulation(sql: Sql) {
  const state = await sql<{ last_tick: string | null; seeded: boolean }>`
    select last_tick, seeded from sim_state where id = 1
  `;
  if (!state[0]?.seeded) return;
  await ensureControlDefaults(sql);
  const flags = await loadFlags(sql);
  const now = Date.now();
  const last = state[0].last_tick ? new Date(state[0].last_tick).getTime() : now - 8_000;
  const dtSec = Math.min(90, Math.max(1, (now - last) / 1000));
  if (now - last < 2500) return;

  const vehicles = await sql<VehRow>`
    select id, company_id, route_key, behavior, tank_litres, speed_limit, odometer_km, engine_hours, status_since, name
    from vehicles
  `;
  const lastPos = await sql<PosRow>`
    select distinct on (vehicle_id) vehicle_id, ts, lat, lng, speed, heading, ignition, fuel_level, fuel_litres
    from positions
    order by vehicle_id, ts desc
  `;
  const posByVeh = new Map(lastPos.map((p) => [p.vehicle_id, p]));
  const geofences = await sql<GfRow>`select id, company_id, name, kind, zone_type, geometry, schedule from geofences where active = true`;
  const rules = await sql<RuleRow>`select company_id, vehicle_id, type, enabled, config from alert_rules`;

  const gfInside = await loadInsideState(sql, vehicles, geofences);

  for (const v of vehicles) {
    const prev = posByVeh.get(v.id);
    if (!prev) continue;
    if (v.behavior === "offline") {
      const rule = pickRule(rules, v.company_id, v.id, "offline");
      const minutes = num(asConfig(rule?.config).minutes, 10);
      const age = prev ? Date.now() - new Date(prev.ts).getTime() : Infinity;
      if (flags.offline && (!rule || rule.enabled) && age > minutes * 60_000) {
        await raiseAlert(sql, {
          companyId: v.company_id,
          vehicleId: v.id,
          type: "offline",
          severity: "critical",
          title: `Offline — ${v.name}`,
          body: `No position for ${minutes}+ minutes.`,
          lat: prev?.lat ?? 0,
          lng: prev?.lng ?? 0,
          dedupeMin: 25,
          config: asConfig(rule?.config),
        });
      }
      continue;
    }

    const route = v.route_key ? ROUTES[v.route_key] : null;
    const moving = v.behavior === "transit";
    const idle = v.behavior === "idle";
    const parked = v.behavior === "parked";

    let lat = prev.lat;
    let lng = prev.lng;
    let heading = prev.heading;
    let speed = 0;
    let ignition = idle || moving;

    if (moving && route && route.length > 1) {
      const len = routeLength(route);
      const cruise = 11 + (hash(v.id) % 10); // m/s ~ 40-75 km/h
      const along = estimateAlong(route, { lat: prev.lat, lng: prev.lng });
      const nextAlong = along + cruise * dtSec;
      const loc = alongRoute(route, nextAlong % len);
      lat = loc.point.lat;
      lng = loc.point.lng;
      heading = loc.heading;
      speed = cruise * 3.6 + Math.sin(now / 9000 + hash(v.id)) * 6;
      if (speed < 0) speed = 4;
    }

    const fuelLevel = Math.max(
      8,
      (prev.fuel_level ?? 60) - (moving ? dtSec * 0.004 : idle ? dtSec * 0.001 : 0),
    );
    const fuelLitres = (fuelLevel / 100) * v.tank_litres;
    const address = reverseGeocode(lat, lng);
    const ts = new Date(now).toISOString();

    await sql`
      insert into positions (id, vehicle_id, company_id, ts, lat, lng, speed, heading, altitude, ignition, fuel_level, fuel_litres, address, event)
      values (${nid("pos")}, ${v.id}, ${v.company_id}, ${ts}, ${lat}, ${lng}, ${speed}, ${heading}, 1660, ${ignition}, ${fuelLevel}, ${fuelLitres}, ${address}, ${"location"})
    `;

    const odoAdd = moving ? (speed / 3600) * dtSec : 0;
    const hoursAdd = ignition ? dtSec / 3600 : 0;
    await sql`
      update vehicles
      set odometer_km = odometer_km + ${odoAdd}, engine_hours = engine_hours + ${hoursAdd}
      where id = ${v.id}
    `;
    await sql`
      update devices set last_seen = ${ts}, gsm_signal = ${16 + (hash(v.id + String(now)) % 10)}, gps_signal = 9
      where vehicle_id = ${v.id}
    `;

    await maybeAlerts(sql, v, prev, rules, flags, {
      lat,
      lng,
      speed,
      ignition,
      fuelLevel,
      fuelLitres,
      ts,
      moving,
      idle,
      parked,
    });

    if (moving) await maybeBehavior(sql, v, { lat, lng }, now);

    if (flags.geofence) {
      await checkGeofences(sql, v, geofences, rules, gfInside, { lat, lng }, ts);
    }
  }

  await maybeRotateBehaviors(sql, vehicles, now);
  await settleQueuedCommands(sql);
  if (flags.mail_dispatch) {
    try {
      await dispatchDueReports(sql, null);
    } catch (err) {
      console.error("[kestrel] mail desk failed", err);
    }
  }

  await sql`update sim_state set last_tick = ${new Date(now).toISOString()} where id = 1`;

  // Keep positions table bounded
  await sql`
    delete from positions where id in (
      select id from (
        select id, row_number() over (partition by vehicle_id order by ts desc) as rn
        from positions
      ) s where rn > 800
    )
  `;
}

async function loadInsideState(sql: Sql, vehicles: VehRow[], geofences: GfRow[]) {
  const map = new Map<string, Set<string>>();
  const lastEvents = await sql<{ geofence_id: string; vehicle_id: string; kind: string }>`
    select distinct on (geofence_id, vehicle_id) geofence_id, vehicle_id, kind
    from geofence_events
    order by geofence_id, vehicle_id, ts desc
  `;
  for (const e of lastEvents) {
    const key = e.vehicle_id;
    if (!map.has(key)) map.set(key, new Set());
    if (e.kind === "enter") map.get(key)!.add(e.geofence_id);
  }
  // if no events, infer from current positions later
  void vehicles;
  void geofences;
  return map;
}

function contains(gf: GfRow, p: LatLng): boolean {
  const g = parseGeom(gf.geometry);
  if (!g) return false;
  if (g.type === "circle") return pointInCircle(p, { lat: g.lat, lng: g.lng }, g.radiusM);
  if (g.type === "polygon")
    return pointInPolygon(
      p,
      g.points.map(([lat, lng]) => ({ lat, lng })),
    );
  if (g.type === "route")
    return (
      distToPolyline(
        p,
        g.path.map(([lat, lng]) => ({ lat, lng })),
      ) <= g.widthM
    );
  return false;
}

function parseGeom(raw: unknown): CircleGeom | PolygonGeom | RouteGeom | null {
  if (!raw) return null;
  const g = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (g && typeof g === "object" && "type" in (g as object)) return g as CircleGeom | PolygonGeom | RouteGeom;
  return null;
}

async function checkGeofences(
  sql: Sql,
  v: VehRow,
  geofences: GfRow[],
  rules: RuleRow[],
  inside: Map<string, Set<string>>,
  p: LatLng,
  ts: string,
) {
  const set = inside.get(v.id) ?? new Set<string>();
  for (const gf of geofences) {
    if (gf.company_id !== v.company_id) continue;
    if (!scheduleIsOpen(parseSchedule(gf.schedule))) continue;
    const nowIn = contains(gf, p);
    const wasIn = set.has(gf.id);
    if (nowIn && !wasIn) {
      set.add(gf.id);
      await sql`
        insert into geofence_events (id, geofence_id, vehicle_id, company_id, kind, ts, lat, lng)
        values (${nid("gfe")}, ${gf.id}, ${v.id}, ${v.company_id}, ${"enter"}, ${ts}, ${p.lat}, ${p.lng})
      `;
      const rule = pickRule(rules, v.company_id, v.id, "geofence_enter");
      if (!rule || rule.enabled) {
        await raiseAlert(sql, {
          companyId: v.company_id,
          vehicleId: v.id,
          type: "geofence_enter",
          severity: gf.zone_type === "forbidden" ? "critical" : "info",
          title: `Entered ${gf.name}`,
          body: `${v.name} entered ${gf.zone_type === "forbidden" ? "forbidden zone" : "geofence"} ${gf.name}.`,
          lat: p.lat,
          lng: p.lng,
          config: asConfig(rule?.config),
        });
      }
    } else if (!nowIn && wasIn) {
      set.delete(gf.id);
      await sql`
        insert into geofence_events (id, geofence_id, vehicle_id, company_id, kind, ts, lat, lng)
        values (${nid("gfe")}, ${gf.id}, ${v.id}, ${v.company_id}, ${"exit"}, ${ts}, ${p.lat}, ${p.lng})
      `;
      const rule = pickRule(rules, v.company_id, v.id, "geofence_exit");
      if (!rule || rule.enabled) {
        await raiseAlert(sql, {
          companyId: v.company_id,
          vehicleId: v.id,
          type: "geofence_exit",
          severity: "warning",
          title: `Left ${gf.name}`,
          body: `${v.name} exited ${gf.name}.`,
          lat: p.lat,
          lng: p.lng,
          config: asConfig(rule?.config),
        });
      }
    }
  }
  inside.set(v.id, set);
}

async function maybeAlerts(
  sql: Sql,
  v: VehRow,
  prev: PosRow,
  rules: RuleRow[],
  flags: EngineFlags,
  cur: {
    lat: number;
    lng: number;
    speed: number;
    ignition: boolean;
    fuelLevel: number;
    fuelLitres: number;
    ts: string;
    moving: boolean;
    idle: boolean;
    parked: boolean;
  },
) {
  const speeding = pickRule(rules, v.company_id, v.id, "speeding");
  if (flags.speeding && (!speeding || speeding.enabled)) {
    const grace = num(asConfig(speeding?.config).graceKmh, 8);
    if (cur.speed > v.speed_limit + grace) {
      await raiseAlert(sql, {
        companyId: v.company_id,
        vehicleId: v.id,
        type: "speeding",
        severity: cur.speed > v.speed_limit + grace + 15 ? "critical" : "warning",
        title: `Speeding — ${v.name}`,
        body: `${Math.round(cur.speed)} km/h in a ${v.speed_limit} km/h limit.`,
        lat: cur.lat,
        lng: cur.lng,
        dedupeMin: 12,
        config: asConfig(speeding?.config),
      });
    }
  }

  const fuelRule = pickRule(rules, v.company_id, v.id, "fuel_drop");
  if (flags.fuel_theft && (!fuelRule || fuelRule.enabled)) {
    const threshold = num(asConfig(fuelRule?.config).litres, 8);
    const prevL = prev.fuel_litres ?? cur.fuelLitres;
    const drop = prevL - cur.fuelLitres;
    if (drop > threshold && cur.speed < 5) {
      await sql`
        insert into fuel_events (id, company_id, vehicle_id, kind, litres, ts, lat, lng, notes)
        values (${nid("fe")}, ${v.company_id}, ${v.id}, ${"drop"}, ${drop}, ${cur.ts}, ${cur.lat}, ${cur.lng}, ${"Sudden drop"})
      `;
      await raiseAlert(sql, {
        companyId: v.company_id,
        vehicleId: v.id,
        type: "fuel_drop",
        severity: "critical",
        title: `Sudden fuel drop — ${v.name}`,
        body: `${drop.toFixed(1)} L drop while nearly stationary. Possible theft.`,
        lat: cur.lat,
        lng: cur.lng,
        dedupeMin: 40,
        config: asConfig(fuelRule?.config),
      });
    }
  }

  const idleRule = pickRule(rules, v.company_id, v.id, "long_idle");
  if (flags.long_idle && cur.idle && (!idleRule || idleRule.enabled)) {
    const minutes = num(asConfig(idleRule?.config).minutes, 15);
    const since = new Date(v.status_since).getTime();
    if (Date.now() - since > minutes * 60_000) {
      await raiseAlert(sql, {
        companyId: v.company_id,
        vehicleId: v.id,
        type: "long_idle",
        severity: "warning",
        title: `Long idle — ${v.name}`,
        body: `Engine on, stationary for more than ${minutes} minutes.`,
        lat: cur.lat,
        lng: cur.lng,
        dedupeMin: 20,
        config: asConfig(idleRule?.config),
      });
    }
  }
}

async function raiseAlert(
  sql: Sql,
  a: {
    companyId: string;
    vehicleId: string;
    type: string;
    severity: string;
    title: string;
    body: string;
    lat: number;
    lng: number;
    dedupeMin?: number;
    config?: RuleConfig;
  },
) {
  if (a.severity !== "critical" && inQuietHours(a.config)) return;
  const windowMin = a.dedupeMin ?? 8;
  const cutoff = new Date(Date.now() - windowMin * 60_000).toISOString();
  const recent = await sql<{ id: string }>`
    select id from alerts
    where vehicle_id = ${a.vehicleId} and type = ${a.type} and status = 'open'
      and created_at > ${cutoff}
    limit 1
  `;
  if (recent[0]) return;
  await sql`
    insert into alerts (id, company_id, vehicle_id, type, severity, title, body, lat, lng, status)
    values (${nid("al")}, ${a.companyId}, ${a.vehicleId}, ${a.type}, ${a.severity}, ${a.title}, ${a.body}, ${a.lat}, ${a.lng}, 'open')
  `;
}

function pickRule(rules: RuleRow[], companyId: string, vehicleId: string, type: string) {
  return (
    rules.find((r) => r.company_id === companyId && r.vehicle_id === vehicleId && r.type === type) ??
    rules.find((r) => r.company_id === companyId && !r.vehicle_id && r.type === type)
  );
}

function asConfig(raw: unknown): RuleConfig {
  if (!raw) return {};
  try {
    const g = typeof raw === "string" ? JSON.parse(raw) : raw;
    return g && typeof g === "object" ? (g as RuleConfig) : {};
  } catch {
    return {};
  }
}

function num(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function inQuietHours(config: RuleConfig | undefined) {
  if (!config?.quietStart || !config.quietEnd) return false;
  const start = clockToMinutes(config.quietStart);
  const end = clockToMinutes(config.quietEnd);
  if (start == null || end == null || start === end) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const now = hour * 60 + minute;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

function clockToMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

async function maybeRotateBehaviors(sql: Sql, vehicles: VehRow[], now: number) {
  // Every ~4 minutes, swap one idle/transit so the map stays alive without chaos
  const cycle = Math.floor(now / 240_000);
  const idx = cycle % vehicles.length;
  const v = vehicles[idx];
  if (!v || v.behavior === "offline") return;
  const next = v.behavior === "transit" ? "idle" : v.behavior === "idle" ? "transit" : v.behavior;
  if (next === v.behavior) return;
  await sql`
    update vehicles set behavior = ${next}, status_since = ${new Date(now).toISOString()}
    where id = ${v.id} and behavior <> 'offline' and behavior <> 'parked'
  `;
}

function estimateAlong(route: LatLng[], p: LatLng): number {
  let best = 0;
  let bestD = Infinity;
  let acc = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const seg = haversine(a, b);
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    const d = haversine(p, mid);
    if (d < bestD) {
      bestD = d;
      best = acc + seg / 2;
    }
    acc += seg;
  }
  return best;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function maybeBehavior(sql: Sql, v: VehRow, p: LatLng, now: number) {
  const bucket = Math.floor(now / 60_000);
  if (hash(`${v.id}:${bucket}`) % 90 !== 0) return;
  const recent = await sql<{ id: string }>`
    select id from behavior_events
    where vehicle_id = ${v.id} and ts > ${new Date(now - 25 * 60_000).toISOString()}
    limit 1
  `;
  if (recent[0]) return;
  const kinds = ["harsh_brake", "harsh_accel", "harsh_corner"] as const;
  const kind = kinds[hash(v.id + String(bucket)) % kinds.length];
  const value = Number((0.42 + (hash(v.id + "g" + bucket) % 50) / 100).toFixed(2));
  const severity = value >= 0.8 ? "critical" : value >= 0.55 ? "warning" : "info";
  const driver = (
    await sql<{ assigned_driver_id: string | null }>`
      select assigned_driver_id from vehicles where id = ${v.id}
    `
  )[0];
  await sql`
    insert into behavior_events (id, company_id, vehicle_id, driver_id, kind, severity, value, lat, lng, ts)
    values (
      ${nid("beh")}, ${v.company_id}, ${v.id}, ${driver?.assigned_driver_id ?? null},
      ${kind}, ${severity}, ${value}, ${p.lat}, ${p.lng}, ${new Date(now).toISOString()}
    )
  `;
}

export async function fulfillCommand(sql: Sql, commandId: string) {
  const cmd = (
    await sql<{
      id: string;
      company_id: string | null;
      device_id: string;
      vehicle_id: string | null;
      kind: string;
    }>`
      select id, company_id, device_id, vehicle_id, kind
      from device_commands
      where id = ${commandId} and status = 'queued'
    `
  )[0];
  if (!cmd) return;
  const now = new Date().toISOString();
  if ((cmd.kind === "locate" || cmd.kind === "snapshot") && (!cmd.vehicle_id || !cmd.company_id)) {
    await sql`
      update device_commands
      set status = 'failed', result = ${"No vehicle linked"}, completed_at = ${now}
      where id = ${cmd.id}
    `;
    return;
  }
  if (cmd.kind === "locate" && cmd.vehicle_id) {
    const pos = (
      await sql<{ lat: number; lng: number; speed: number; heading: number; ignition: boolean; fuel_level: number | null; fuel_litres: number | null; address: string | null }>`
        select lat, lng, speed, heading, ignition, fuel_level, fuel_litres, address
        from positions where vehicle_id = ${cmd.vehicle_id}
        order by ts desc limit 1
      `
    )[0];
    if (pos) {
      await sql`
        insert into positions (id, vehicle_id, company_id, ts, lat, lng, speed, heading, altitude, ignition, fuel_level, fuel_litres, address, event)
        values (
          ${nid("pos")}, ${cmd.vehicle_id}, ${cmd.company_id}, ${now},
          ${pos.lat}, ${pos.lng}, ${pos.speed}, ${pos.heading}, 1660, ${pos.ignition},
          ${pos.fuel_level}, ${pos.fuel_litres}, ${pos.address}, ${"locate"}
        )
      `;
    }
    await sql`update devices set last_seen = ${now} where id = ${cmd.device_id}`;
    await sql`
      update device_commands
      set status = 'done', result = ${pos ? "Fresh fix stored" : "No previous fix"}, completed_at = ${now}
      where id = ${cmd.id}
    `;
    return;
  }
  if (cmd.kind === "snapshot" && cmd.vehicle_id && cmd.company_id) {
    await sql`
      insert into media_files (id, company_id, vehicle_id, kind, path, caption, event_type, ts)
      values (
        ${nid("med")}, ${cmd.company_id}, ${cmd.vehicle_id}, ${"snapshot"},
        ${"/media/dashcam.svg"}, ${"Manual snapshot"}, ${"snapshot"}, ${now}
      )
    `;
    await sql`
      update device_commands
      set status = 'done', result = ${"Snapshot stored"}, completed_at = ${now}
      where id = ${cmd.id}
    `;
    return;
  }
  if (cmd.kind === "restart") {
    await sql`update devices set last_seen = ${now}, gsm_signal = 20 where id = ${cmd.device_id}`;
    await sql`
      update device_commands
      set status = 'done', result = ${"Restart acknowledged"}, completed_at = ${now}
      where id = ${cmd.id}
    `;
    return;
  }
  await sql`
    update device_commands
    set status = 'failed', result = ${"Unsupported command"}, completed_at = ${now}
    where id = ${cmd.id}
  `;
}

async function settleQueuedCommands(sql: Sql) {
  const queued = await sql<{ id: string }>`
    select id from device_commands where status = 'queued' order by created_at limit 6
  `;
  for (const row of queued) await fulfillCommand(sql, row.id);
}

export { OFFLINE_MS };

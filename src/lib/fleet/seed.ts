import type { Sql } from "@/lib/db";
import { nid } from "@/lib/utils";
import { alongRoute, reverseGeocode, routeLength } from "./geo";
import { COMPANY_A, COMPANY_B, ROUTES, SEED_VEHICLES } from "./seed-data";

function iso(d: Date) {
  return d.toISOString();
}

let inflight: Promise<void> | null = null;

export function seedIfNeeded(sql: Sql, actorId: string): Promise<void> {
  if (!inflight) {
    inflight = seedBody(sql, actorId).catch((err) => {
      inflight = null;
      throw err;
    });
  }
  return inflight;
}

async function seedBody(sql: Sql, actorId: string) {
  const state = await sql<{ seeded: boolean }>`select seeded from sim_state where id = 1`;
  const meta = await sql<{ value: string }>`select value from app_meta where key = ${"fleet_seed"}`;
  if (state[0]?.seeded && meta[0]?.value === "2") {
    await ensureFieldOps(sql);
    return;
  }
  await wipePartialDemo(sql);

  await sql`
    insert into companies (id, name, slug, status, billing_status, default_speed_limit, city, created_by, mark)
    values
      (${COMPANY_A.id}, ${COMPANY_A.name}, ${COMPANY_A.slug}, 'active', 'current', 80, ${COMPANY_A.city}, ${actorId}, 'ML'),
      (${COMPANY_B.id}, ${COMPANY_B.name}, ${COMPANY_B.slug}, 'active', 'trial', 100, ${COMPANY_B.city}, ${actorId}, 'HG')
    on conflict (id) do nothing
  `;

  const now = Date.now();

  for (const v of SEED_VEHICLES) {
    const route = ROUTES[v.route];
    const len = routeLength(route);
    const offset = (hash(v.id) % 1000) / 1000;
    const dist = offset * len;
    const { point, heading } = alongRoute(route, dist);
    const parked = v.behavior === "parked" || v.behavior === "offline";
    const idle = v.behavior === "idle";
    const speed = parked || idle ? 0 : 35 + (hash(v.id) % 40);
    const ignition = v.behavior !== "parked" && v.behavior !== "offline";
    const fuelPct = 35 + (hash(v.id + "f") % 55);
    const fuelL = (fuelPct / 100) * v.tank;
    const statusAgeMin =
      v.behavior === "offline" ? 47 : v.behavior === "parked" ? 18 : v.behavior === "idle" ? 12 : 0;
    const statusSince = new Date(now - statusAgeMin * 60000);
    const lastSeen = v.behavior === "offline" ? new Date(now - 47 * 60000) : new Date(now - 8_000);
    const address = reverseGeocode(point.lat, point.lng);

    await sql`
      insert into drivers (id, company_id, name, license_no, phone)
      values (${v.driver.id}, ${v.companyId}, ${v.driver.name}, ${v.driver.license}, ${v.driver.phone})
      on conflict (id) do nothing
    `;

    await sql`
      insert into vehicles (
        id, company_id, name, plate, make, model, year, color, speed_limit,
        odometer_km, engine_hours, tank_litres, assigned_driver_id, route_key, behavior, status_since
      ) values (
        ${v.id}, ${v.companyId}, ${v.name}, ${v.plate}, ${v.make}, ${v.model}, ${v.year}, ${v.color},
        ${v.speedLimit}, ${v.odometer}, ${v.hours}, ${v.tank}, ${v.driver.id}, ${v.route}, ${v.behavior}, ${iso(statusSince)}
      )
      on conflict (id) do nothing
    `;

    await sql`
      insert into driver_assignments (id, driver_id, vehicle_id, started_at)
      values (${`${v.id}_asg`}, ${v.driver.id}, ${v.id}, ${iso(new Date(now - 14 * 86400000))})
      on conflict (id) do nothing
    `;

    await sql`
      insert into devices (
        id, company_id, vehicle_id, imei, protocol, decoder, secret, last_seen, gsm_signal, gps_signal, battery
      ) values (
        ${nid("dev")}, ${v.companyId}, ${v.id}, ${v.imei}, 'HTTP', ${v.decoder}, ${"sec_" + v.imei.slice(-6)},
        ${iso(lastSeen)}, ${v.behavior === "offline" ? 4 : 18 + (hash(v.id) % 12)},
        ${v.behavior === "offline" ? 3 : 8 + (hash(v.id) % 4)},
        ${72 + (hash(v.id) % 25)}
      )
      on conflict (imei) do nothing
    `;

    await seedHistory(sql, v, now, fuelPct, fuelL, ignition, speed, heading, address);
  }

  await seedGeofences(sql);
  await seedAlerts(sql, now);
  await seedOpsExtras(sql, actorId, now);
  await seedShiftArchive(sql, now);
  await ensureFieldOps(sql);

  await sql`update sim_state set seeded = true, last_tick = ${iso(new Date(now))} where id = 1`;
  await sql`
    insert into app_meta (key, value) values ('fleet_seed', '2')
    on conflict (key) do update set value = excluded.value
  `;
  await sql`
    insert into audit_logs (id, actor_id, action, target, meta)
    values (${nid("aud")}, ${actorId}, 'platform.seeded', 'demo fleet', ${JSON.stringify({ vehicles: SEED_VEHICLES.length })})
  `;
}

async function seedHistory(
  sql: Sql,
  v: (typeof SEED_VEHICLES)[number],
  now: number,
  fuelPct: number,
  fuelL: number,
  ignition: boolean,
  speed: number,
  heading: number,
  address: string,
) {
  const route = ROUTES[v.route];
  const len = routeLength(route);
  const hours = v.behavior === "offline" ? 5 : 6;
  const stepMs = 180_000;
  const points = Math.floor((hours * 3600 * 1000) / stepMs);
  const startOffset = ((hash(v.id) % 1000) / 1000) * len;

  const posRows: string[] = [];
  const posParams: unknown[] = [];
  const trips: unknown[][] = [];
  const stops: unknown[][] = [];

  let tripStart: Date | null = null;
  let tripDist = 0;
  let tripMax = 0;
  let lastMoving = false;
  let stopStart: Date | null = null;
  let stopLat = 0;
  let stopLng = 0;
  let stopAddr = address;

  for (let i = 0; i < points; i++) {
    const t = now - (points - i) * stepMs;
    const moving = v.behavior === "transit" || (v.behavior === "idle" && i < points - 8);
    const offlineTail = v.behavior === "offline" && i > points - 16;
    if (offlineTail) continue;
    const parked = v.behavior === "parked" || (!moving && v.behavior !== "idle");
    const dist = (startOffset + (moving ? i * 55 : 0)) % len;
    const { point, heading: hd } = alongRoute(route, moving ? dist : startOffset);
    const spd = parked ? 0 : v.behavior === "idle" && !moving ? 0 : 28 + ((i * 7 + hash(v.id)) % 42);
    const ign = !parked;
    const fuel = Math.max(12, fuelPct + (points - i) * 0.04);
    const addr = reverseGeocode(point.lat, point.lng);
    const id = `${v.id}_p${i}`;
    const n = posParams.length;
    posRows.push(
      `($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6},$${n + 7},$${n + 8},$${n + 9},$${n + 10},$${n + 11},$${n + 12},$${n + 13},$${n + 14})`,
    );
    posParams.push(
      id,
      v.id,
      v.companyId,
      new Date(t).toISOString(),
      point.lat,
      point.lng,
      spd,
      hd,
      1660,
      ign,
      fuel,
      (fuel / 100) * v.tank,
      addr,
      "location",
    );

    if (moving) {
      if (!lastMoving) {
        if (stopStart) {
          stops.push([
            nid("st"),
            v.companyId,
            v.id,
            stopStart.toISOString(),
            new Date(t).toISOString(),
            (t - stopStart.getTime()) / 60000,
            stopLat,
            stopLng,
            stopAddr,
            false,
          ]);
          stopStart = null;
        }
        tripStart = new Date(t);
        tripDist = 0;
        tripMax = spd;
      } else {
        tripDist += 0.08;
        tripMax = Math.max(tripMax, spd);
      }
      lastMoving = true;
    } else {
      if (lastMoving && tripStart) {
        trips.push([
          nid("tr"),
          v.companyId,
          v.id,
          tripStart.toISOString(),
          new Date(t).toISOString(),
          address,
          addr,
          tripDist,
          tripMax,
          4 + (hash(v.id) % 12),
          Number((tripDist / 8).toFixed(1)),
        ]);
        tripStart = null;
      }
      if (!stopStart) {
        stopStart = new Date(t);
        stopLat = point.lat;
        stopLng = point.lng;
        stopAddr = addr;
      }
      lastMoving = false;
    }
  }

  if (posRows.length) {
    await sql.query(
      `insert into positions (id, vehicle_id, company_id, ts, lat, lng, speed, heading, altitude, ignition, fuel_level, fuel_litres, address, event) values ${posRows.join(",")} on conflict (id) do nothing`,
      posParams,
    );
  }

  for (const t of trips) {
    await sql.query(
      `insert into trips (id, company_id, vehicle_id, started_at, ended_at, start_address, end_address, distance_km, max_speed, idle_minutes, fuel_used) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      t,
    );
  }
  for (const s of stops) {
    await sql.query(
      `insert into stops (id, company_id, vehicle_id, started_at, ended_at, duration_min, lat, lng, address, ignition) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      s,
    );
  }

  const live = alongRoute(route, startOffset);
  const liveTs = v.behavior === "offline" ? now - 47 * 60000 : now - 6000;
  await sql`
    insert into positions (id, vehicle_id, company_id, ts, lat, lng, speed, heading, altitude, ignition, fuel_level, fuel_litres, address, event)
    values (
      ${nid("pos")}, ${v.id}, ${v.companyId}, ${new Date(liveTs).toISOString()},
      ${live.point.lat}, ${live.point.lng}, ${speed}, ${heading}, 1660, ${ignition},
      ${fuelPct}, ${fuelL}, ${address}, ${"location"}
    )
  `;
}

async function seedGeofences(sql: Sql) {
  const rows = [
    {
      id: "gf_depot_a",
      co: COMPANY_A.id,
      name: "Meridian Depot",
      kind: "circle",
      group: "Depots",
      zone: "allowed",
      geom: { type: "circle", lat: -1.3185, lng: 36.8448, radiusM: 280 },
    },
    {
      id: "gf_jkia",
      co: COMPANY_A.id,
      name: "JKIA Cargo",
      kind: "circle",
      group: "Client Sites",
      zone: "allowed",
      geom: { type: "circle", lat: -1.3194, lng: 36.9275, radiusM: 450 },
    },
    {
      id: "gf_cbd",
      co: COMPANY_A.id,
      name: "CBD Restricted Hours",
      kind: "polygon",
      group: "City",
      zone: "forbidden",
      geom: {
        type: "polygon",
        points: [
          [-1.2805, 36.813],
          [-1.2805, 36.8245],
          [-1.2915, 36.8245],
          [-1.2915, 36.813],
        ],
      },
    },
    {
      id: "gf_mombasa_corridor",
      co: COMPANY_A.id,
      name: "Mombasa Road Corridor",
      kind: "route",
      group: "Routes",
      zone: "allowed",
      geom: {
        type: "route",
        path: ROUTES.mombasa_road.map((p) => [p.lat, p.lng]),
        widthM: 120,
      },
    },
    {
      id: "gf_hq_b",
      co: COMPANY_B.id,
      name: "Harbor HQ",
      kind: "circle",
      group: "Depots",
      zone: "allowed",
      geom: { type: "circle", lat: -1.2673, lng: 36.811, radiusM: 220 },
    },
    {
      id: "gf_gigiri",
      co: COMPANY_B.id,
      name: "Gigiri Diplomatic",
      kind: "polygon",
      group: "Client Sites",
      zone: "allowed",
      geom: {
        type: "polygon",
        points: [
          [-1.228, 36.802],
          [-1.228, 36.818],
          [-1.242, 36.818],
          [-1.242, 36.802],
        ],
      },
    },
    {
      id: "gf_no_go",
      co: COMPANY_B.id,
      name: "Eastlands No-Go",
      kind: "circle",
      group: "Forbidden",
      zone: "forbidden",
      geom: { type: "circle", lat: -1.28, lng: 36.89, radiusM: 900 },
    },
  ];
  for (const g of rows) {
    await sql`
      insert into geofences (id, company_id, name, kind, group_name, zone_type, geometry, active)
      values (${g.id}, ${g.co}, ${g.name}, ${g.kind}, ${g.group}, ${g.zone}, ${JSON.stringify(g.geom)}::jsonb, true)
      on conflict (id) do nothing
    `;
  }
  const rules = [
    ["offline", { minutes: 10 }],
    ["speeding", { graceKmh: 5 }],
    ["fuel_drop", { litres: 12 }],
    ["long_idle", { minutes: 15 }],
    ["geofence_enter", {}],
    ["geofence_exit", {}],
  ] as const;
  for (const co of [COMPANY_A.id, COMPANY_B.id]) {
    for (const [type, config] of rules) {
      await sql`
        insert into alert_rules (id, company_id, type, config, enabled)
        values (${nid("rule")}, ${co}, ${type}, ${JSON.stringify(config)}::jsonb, true)
      `;
    }
  }
}

async function seedAlerts(sql: Sql, now: number) {
  const alerts = [
    {
      co: COMPANY_A.id,
      veh: "veh_ml_07",
      type: "offline",
      sev: "critical",
      title: "Unit 07 offline",
      body: "No GPS packet for 47 minutes. Last seen on Ngong Road near Karen.",
      lat: -1.3196,
      lng: 36.71,
      ageMin: 47,
      status: "open",
    },
    {
      co: COMPANY_A.id,
      veh: "veh_ml_02",
      type: "speeding",
      sev: "warning",
      title: "Speeding — KDC 908B",
      body: "96 km/h in an 80 km/h zone on Mombasa Road.",
      lat: -1.334,
      lng: 36.896,
      ageMin: 22,
      status: "open",
    },
    {
      co: COMPANY_A.id,
      veh: "veh_ml_03",
      type: "long_idle",
      sev: "warning",
      title: "Long idle — City Van",
      body: "Engine on, stationary for 12 minutes in Nairobi CBD.",
      lat: -1.2864,
      lng: 36.8172,
      ageMin: 12,
      status: "open",
    },
    {
      co: COMPANY_A.id,
      veh: "veh_ml_06",
      type: "fuel_drop",
      sev: "critical",
      title: "Sudden fuel drop",
      body: "18 L drop in under 3 minutes while stopped on Eastern Bypass. Possible theft.",
      lat: -1.286,
      lng: 36.92,
      ageMin: 95,
      status: "ack",
    },
    {
      co: COMPANY_A.id,
      veh: "veh_ml_01",
      type: "geofence_enter",
      sev: "info",
      title: "Entered JKIA Cargo",
      body: "Unit 01 entered the JKIA Cargo geofence.",
      lat: -1.3194,
      lng: 36.9275,
      ageMin: 140,
      status: "resolved",
    },
    {
      co: COMPANY_B.id,
      veh: "veh_hg_03",
      type: "long_idle",
      sev: "warning",
      title: "Patrol Charlie idling",
      body: "Stationary with engine on near Eastern Bypass.",
      lat: -1.286,
      lng: 36.92,
      ageMin: 9,
      status: "open",
    },
    {
      co: COMPANY_B.id,
      veh: "veh_hg_01",
      type: "geofence_exit",
      sev: "warning",
      title: "Left Gigiri Diplomatic",
      body: "Patrol Alpha exited the Gigiri allowed zone.",
      lat: -1.234,
      lng: 36.81,
      ageMin: 31,
      status: "open",
    },
    {
      co: COMPANY_B.id,
      veh: "veh_hg_04",
      type: "offline",
      sev: "info",
      title: "Response Delta parked",
      body: "Ignition off at Harbor HQ. No movement for 18 minutes.",
      lat: -1.2673,
      lng: 36.811,
      ageMin: 18,
      status: "resolved",
    },
  ];
  for (const a of alerts) {
    await sql`
      insert into alerts (id, company_id, vehicle_id, type, severity, title, body, lat, lng, status, ack_comment, ack_at, created_at)
      values (
        ${nid("al")}, ${a.co}, ${a.veh}, ${a.type}, ${a.sev}, ${a.title}, ${a.body}, ${a.lat}, ${a.lng}, ${a.status},
        ${a.status === "ack" ? "Investigating with driver. Requested dashcam clip." : null},
        ${a.status === "ack" ? new Date(now - 40 * 60000).toISOString() : null},
        ${new Date(now - a.ageMin * 60000).toISOString()}
      )
    `;
  }

  await sql`
    insert into fuel_events (id, company_id, vehicle_id, kind, litres, ts, lat, lng, notes)
    values
      (${nid("fe")}, ${COMPANY_A.id}, ${"veh_ml_06"}, ${"drop"}, 18, ${new Date(now - 95 * 60000).toISOString()}, -1.286, 36.92, ${"Possible siphon"}),
      (${nid("fe")}, ${COMPANY_A.id}, ${"veh_ml_01"}, ${"fill"}, 240, ${new Date(now - 6 * 3600000).toISOString()}, -1.3185, 36.8448, ${"Depot fill"}),
      (${nid("fe")}, ${COMPANY_B.id}, ${"veh_hg_01"}, ${"fill"}, 60, ${new Date(now - 10 * 3600000).toISOString()}, -1.2673, 36.811, ${"HQ pump"})
  `;
}

async function seedOpsExtras(sql: Sql, actorId: string, now: number) {
  const maint = [
    ["veh_ml_01", "Service A — oil & filters", 185000, 6200, 12],
    ["veh_ml_02", "Reefer compressor check", 212000, 7100, 4],
    ["veh_ml_07", "Tracker power harness inspect", 133000, 5000, 1],
    ["veh_hg_02", "Brake pads", 70000, 2500, 20],
  ] as const;
  for (const [veh, title, odo, hours, days] of maint) {
    const co = veh.startsWith("veh_ml") ? COMPANY_A.id : COMPANY_B.id;
    await sql`
      insert into maintenance_reminders (id, company_id, vehicle_id, title, due_odometer, due_hours, due_date, status)
      values (${nid("mn")}, ${co}, ${veh}, ${title}, ${odo}, ${hours}, ${new Date(now + days * 86400000).toISOString().slice(0, 10)}, 'open')
    `;
  }

  const docs = [
    ["veh_ml_01", "Insurance — comprehensive", "insurance", 80],
    ["veh_ml_01", "Logbook", "registration", 400],
    ["veh_ml_02", "Reefer hygiene cert", "permit", 40],
    ["veh_hg_01", "PSV insurance", "insurance", 55],
  ] as const;
  for (const [veh, title, kind, days] of docs) {
    const co = veh.startsWith("veh_ml") ? COMPANY_A.id : COMPANY_B.id;
    await sql`
      insert into documents (id, company_id, vehicle_id, title, kind, path, expires_on)
      values (${nid("doc")}, ${co}, ${veh}, ${title}, ${kind}, ${"/media/document.svg"}, ${new Date(now + days * 86400000).toISOString().slice(0, 10)})
    `;
  }

  const media = [
    ["veh_ml_06", "snapshot", "Fuel drop — Eastern Bypass", "fuel_drop"],
    ["veh_ml_02", "snapshot", "Speeding event still", "speeding"],
    ["veh_ml_01", "clip", "JKIA gate entry", "geofence_enter"],
    ["veh_hg_01", "snapshot", "Gigiri checkpoint", "geofence_exit"],
    ["veh_ml_03", "snapshot", "CBD idle", "long_idle"],
  ] as const;
  for (const [veh, kind, caption, event] of media) {
    const co = veh.startsWith("veh_ml") ? COMPANY_A.id : COMPANY_B.id;
    await sql`
      insert into media_files (id, company_id, vehicle_id, kind, path, caption, event_type, ts)
      values (${nid("med")}, ${co}, ${veh}, ${kind}, ${"/media/dashcam.svg"}, ${caption}, ${event}, ${new Date(now - (20 + (hash(caption) % 180)) * 60000).toISOString()})
    `;
  }

  await sql`
    insert into invoices (id, company_id, number, period, amount_cents, vehicle_count, status, due_date)
    values
      (${nid("inv")}, ${COMPANY_A.id}, ${"INV-2026-09"}, ${"Sep 2026"}, 96000, 8, 'paid', ${"2026-09-07"}),
      (${nid("inv")}, ${COMPANY_A.id}, ${"INV-2026-08"}, ${"Aug 2026"}, 96000, 8, 'paid', ${"2026-08-07"}),
      (${nid("inv")}, ${COMPANY_A.id}, ${"INV-2026-10"}, ${"Oct 2026"}, 104000, 8, 'due', ${"2026-10-07"}),
      (${nid("inv")}, ${COMPANY_B.id}, ${"INV-HG-09"}, ${"Sep 2026"}, 45000, 5, 'paid', ${"2026-09-10"}),
      (${nid("inv")}, ${COMPANY_B.id}, ${"INV-HG-10"}, ${"Oct 2026"}, 45000, 5, 'trial', ${"2026-10-10"})
  `;

  await sql`
    insert into audit_logs (id, company_id, actor_id, action, target)
    values
      (${nid("aud")}, ${COMPANY_A.id}, ${actorId}, 'company.created', ${COMPANY_A.name}),
      (${nid("aud")}, ${COMPANY_B.id}, ${actorId}, 'company.created', ${COMPANY_B.name}),
      (${nid("aud")}, ${COMPANY_A.id}, ${actorId}, 'device.assigned', 'Unit 01 — 356938035643801'),
      (${nid("aud")}, ${COMPANY_A.id}, ${actorId}, 'geofence.created', 'Meridian Depot'),
      (${nid("aud")}, ${COMPANY_B.id}, ${actorId}, 'alert.acknowledged', 'Fuel drop Unit 06')
  `;
}

async function wipePartialDemo(sql: Sql) {
  const a = COMPANY_A.id;
  const b = COMPANY_B.id;
  await sql`delete from driver_assignments where vehicle_id in (select id from vehicles where company_id in (${a}, ${b}))`;
  const tables = [
    "behavior_events",
    "device_commands",
    "geofence_events",
    "positions",
    "trips",
    "stops",
    "alerts",
    "fuel_events",
    "maintenance_reminders",
    "documents",
    "media_files",
    "devices",
    "geofences",
    "alert_rules",
    "invoices",
    "audit_logs",
    "vehicles",
    "drivers",
  ];
  for (const table of tables) {
    await sql.query(`delete from ${table} where company_id in ($1, $2)`, [a, b]);
  }
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function ensureFieldOps(sql: Sql) {
  const now = Date.now();
  const existing = await sql<{ n: number }>`select count(*)::int as n from behavior_events`;
  if (Number(existing[0]?.n ?? 0) === 0) {
    const samples = [
      ["beh_ml_02_brake", "veh_ml_02", "harsh_brake", "warning", 0.62, 3],
      ["beh_ml_02_accel", "veh_ml_02", "harsh_accel", "warning", 0.51, 26],
      ["beh_ml_01_corner", "veh_ml_01", "harsh_corner", "info", 0.44, 1.5],
      ["beh_ml_06_brake", "veh_ml_06", "harsh_brake", "critical", 0.88, 5],
      ["beh_hg_01_corner", "veh_hg_01", "harsh_corner", "warning", 0.57, 2],
      ["beh_hg_03_accel", "veh_hg_03", "harsh_accel", "warning", 0.49, 11],
    ] as const;
    for (const [id, veh, kind, severity, value, hours] of samples) {
      const row = (
        await sql<{ company_id: string; driver_id: string | null }>`
          select company_id, assigned_driver_id as driver_id from vehicles where id = ${veh}
        `
      )[0];
      if (!row) continue;
      const pos = (
        await sql<{ lat: number; lng: number }>`
          select lat, lng from positions where vehicle_id = ${veh} order by ts desc limit 1
        `
      )[0];
      await sql`
        insert into behavior_events (id, company_id, vehicle_id, driver_id, kind, severity, value, lat, lng, ts)
        values (
          ${id}, ${row.company_id}, ${veh}, ${row.driver_id}, ${kind}, ${severity}, ${value},
          ${pos?.lat ?? null}, ${pos?.lng ?? null}, ${iso(new Date(now - hours * 3600000))}
        )
        on conflict (id) do nothing
      `;
    }
  }

  const linked = await sql<{ n: number }>`
    select count(*)::int as n
    from device_calibrations c
    join devices d on d.id = c.device_id
  `;
  if (Number(linked[0]?.n ?? 0) === 0) {
    const devices = await sql<{ id: string; vehicle_id: string | null }>`
      select id, vehicle_id from devices
    `;
    for (const d of devices) {
      const tank = d.vehicle_id?.startsWith("veh_hg") ? 80 : 180;
      await sql`
        insert into device_calibrations (id, device_id, empty_voltage, full_voltage, tank_litres, notes, recorded_by)
        values (${`cal_${d.id}`}, ${d.id}, 0.45, 4.7, ${tank}, ${"Bench calibration at install"}, ${"seed"})
        on conflict (id) do nothing
      `;
    }
  }
}

const ARCHIVE_PLACES = [
  "Industrial Area",
  "JKIA Cargo",
  "Westlands",
  "Mombasa Road",
  "Ngong Road",
  "Gigiri",
  "Upper Hill",
  "Embakasi",
];

async function seedShiftArchive(sql: Sql, now: number) {
  for (const v of SEED_VEHICLES) {
    for (let d = 1; d <= 14; d++) {
      const roll = hash(v.id + ":" + d);
      const dist = 32 + (roll % 150);
      const fuel = Number((dist * (0.09 + (roll % 5) * 0.008)).toFixed(1));
      const idle = 15 + (roll % 55);
      const maxSpd = 58 + (roll % 48);
      const hoursOnRoad = 3 + (roll % 6);
      const end = new Date(now - d * 86400000 - 3 * 3600000);
      const start = new Date(end.getTime() - hoursOnRoad * 3600000);
      const from = ARCHIVE_PLACES[roll % ARCHIVE_PLACES.length];
      const to = ARCHIVE_PLACES[(roll + 3) % ARCHIVE_PLACES.length];
      await sql`
        insert into trips (
          id, company_id, vehicle_id, started_at, ended_at, start_address, end_address,
          distance_km, max_speed, idle_minutes, fuel_used
        ) values (
          ${`${v.id}_d${d}`}, ${v.companyId}, ${v.id}, ${iso(start)}, ${iso(end)}, ${from}, ${to},
          ${dist}, ${maxSpd}, ${idle}, ${fuel}
        )
        on conflict (id) do nothing
      `;
    }
  }

  const fences = [
    ["gf_depot_a", "veh_ml_01", "enter", 5, -1.3185, 36.8448],
    ["gf_jkia", "veh_ml_01", "exit", 2.5, -1.3194, 36.9275],
    ["gf_jkia", "veh_ml_02", "enter", 4, -1.3194, 36.9275],
    ["gf_cbd", "veh_ml_03", "enter", 3, -1.286, 36.818],
    ["gf_mombasa_corridor", "veh_ml_04", "enter", 6, -1.32, 36.86],
    ["gf_depot_a", "veh_ml_05", "exit", 26, -1.3185, 36.8448],
    ["gf_jkia", "veh_ml_06", "enter", 50, -1.3194, 36.9275],
    ["gf_gigiri", "veh_hg_01", "exit", 1.2, -1.234, 36.81],
    ["gf_hq_b", "veh_hg_02", "enter", 7, -1.2673, 36.811],
    ["gf_no_go", "veh_hg_03", "enter", 30, -1.28, 36.89],
    ["gf_hq_b", "veh_hg_01", "enter", 72, -1.2673, 36.811],
    ["gf_gigiri", "veh_hg_05", "dwell", 20, -1.234, 36.81],
  ] as const;
  for (const [gf, veh, kind, hoursAgo, lat, lng] of fences) {
    const co = veh.startsWith("veh_ml") ? COMPANY_A.id : COMPANY_B.id;
    await sql`
      insert into geofence_events (id, geofence_id, vehicle_id, company_id, kind, ts, lat, lng)
      values (
        ${`${veh}_${gf}_${kind}`}, ${gf}, ${veh}, ${co}, ${kind},
        ${iso(new Date(now - hoursAgo * 3600000))}, ${lat}, ${lng}
      )
      on conflict (id) do nothing
    `;
  }

  const fills = [
    ["veh_ml_02", "fill", 180, 28, "Westlands pump"],
    ["veh_ml_04", "fill", 90, 52, "Mombasa Road station"],
    ["veh_hg_02", "drop", 14, 40, "Unscheduled drop near Gigiri"],
    ["veh_ml_08", "fill", 70, 80, "Depot overnight"],
  ] as const;
  for (const [veh, kind, litres, hoursAgo, notes] of fills) {
    const co = veh.startsWith("veh_ml") ? COMPANY_A.id : COMPANY_B.id;
    await sql`
      insert into fuel_events (id, company_id, vehicle_id, kind, litres, ts, notes)
      values (${`${veh}_${kind}_${hoursAgo}`}, ${co}, ${veh}, ${kind}, ${litres}, ${iso(new Date(now - hoursAgo * 3600000))}, ${notes})
      on conflict (id) do nothing
    `;
  }
}

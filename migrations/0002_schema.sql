-- Kestrel fleet platform schema

create table if not exists profiles (
  user_id text primary key,
  role text not null default 'pending',
  company_id text,
  name text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists companies (
  id text primary key,
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  billing_status text not null default 'trial',
  default_speed_limit integer not null default 80,
  logo_path text,
  city text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists field_assignments (
  user_id text not null,
  company_id text not null,
  primary key (user_id, company_id)
);

create table if not exists view_overrides (
  user_id text primary key,
  role text not null,
  company_id text,
  started_at timestamptz not null default now()
);

create table if not exists invites (
  id text primary key,
  email text not null,
  role text not null,
  company_id text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists vehicles (
  id text primary key,
  company_id text not null,
  name text not null,
  plate text not null,
  make text,
  model text,
  year integer,
  color text,
  vin text,
  speed_limit integer,
  odometer_km double precision not null default 0,
  engine_hours double precision not null default 0,
  tank_litres double precision not null default 120,
  assigned_driver_id text,
  route_key text,
  behavior text not null default 'transit',
  status_since timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id text primary key,
  company_id text,
  vehicle_id text,
  imei text not null unique,
  protocol text not null default 'HTTP',
  decoder text not null default 'generic_http',
  secret text,
  last_seen timestamptz,
  gsm_signal integer,
  gps_signal integer,
  battery double precision,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists device_calibrations (
  id text primary key,
  device_id text not null,
  empty_voltage double precision not null,
  full_voltage double precision not null,
  tank_litres double precision not null,
  notes text,
  recorded_by text,
  created_at timestamptz not null default now()
);

create table if not exists positions (
  id text primary key,
  vehicle_id text not null,
  company_id text not null,
  ts timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  speed double precision not null default 0,
  heading double precision not null default 0,
  altitude double precision,
  ignition boolean not null default false,
  fuel_level double precision,
  fuel_litres double precision,
  address text,
  event text not null default 'location'
);

create table if not exists geofences (
  id text primary key,
  company_id text not null,
  name text not null,
  kind text not null,
  group_name text,
  zone_type text not null default 'allowed',
  geometry jsonb not null,
  schedule jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists geofence_events (
  id text primary key,
  geofence_id text not null,
  vehicle_id text not null,
  company_id text not null,
  kind text not null,
  ts timestamptz not null default now(),
  lat double precision,
  lng double precision
);

create table if not exists alerts (
  id text primary key,
  company_id text not null,
  vehicle_id text,
  type text not null,
  severity text not null default 'warning',
  title text not null,
  body text,
  lat double precision,
  lng double precision,
  status text not null default 'open',
  ack_by text,
  ack_comment text,
  ack_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists alert_rules (
  id text primary key,
  company_id text not null,
  vehicle_id text,
  type text not null,
  config jsonb not null default '{}',
  enabled boolean not null default true
);

create table if not exists drivers (
  id text primary key,
  company_id text not null,
  name text not null,
  license_no text,
  license_expiry date,
  phone text,
  national_id text,
  created_at timestamptz not null default now()
);

create table if not exists driver_assignments (
  id text primary key,
  driver_id text not null,
  vehicle_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists trips (
  id text primary key,
  company_id text not null,
  vehicle_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  start_address text,
  end_address text,
  distance_km double precision not null default 0,
  max_speed double precision not null default 0,
  idle_minutes double precision not null default 0,
  fuel_used double precision
);

create table if not exists stops (
  id text primary key,
  company_id text not null,
  vehicle_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_min double precision,
  lat double precision,
  lng double precision,
  address text,
  ignition boolean not null default false
);

create table if not exists fuel_events (
  id text primary key,
  company_id text not null,
  vehicle_id text not null,
  kind text not null,
  litres double precision not null,
  ts timestamptz not null default now(),
  lat double precision,
  lng double precision,
  notes text,
  receipt_path text
);

create table if not exists maintenance_reminders (
  id text primary key,
  company_id text not null,
  vehicle_id text not null,
  title text not null,
  due_odometer double precision,
  due_hours double precision,
  due_date date,
  status text not null default 'open',
  notes text,
  completed_at timestamptz
);

create table if not exists documents (
  id text primary key,
  company_id text not null,
  vehicle_id text,
  title text not null,
  kind text not null,
  path text,
  expires_on date,
  created_at timestamptz not null default now()
);

create table if not exists invoices (
  id text primary key,
  company_id text not null,
  number text not null,
  period text not null,
  amount_cents integer not null,
  vehicle_count integer not null default 0,
  status text not null default 'due',
  due_date date,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id text primary key,
  company_id text,
  actor_id text,
  action text not null,
  target text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create table if not exists media_files (
  id text primary key,
  company_id text not null,
  vehicle_id text not null,
  kind text not null,
  path text not null,
  caption text,
  event_type text,
  ts timestamptz not null default now()
);

create table if not exists sim_state (
  id integer primary key,
  last_tick timestamptz,
  seeded boolean not null default false
);

insert into sim_state (id, seeded) values (1, false) on conflict (id) do nothing;

create index if not exists vehicles_company_idx on vehicles (company_id);
create index if not exists devices_vehicle_idx on devices (vehicle_id);
create index if not exists positions_vehicle_ts_idx on positions (vehicle_id, ts desc);
create index if not exists positions_company_ts_idx on positions (company_id, ts desc);
create index if not exists alerts_company_status_idx on alerts (company_id, status, created_at desc);
create index if not exists geofences_company_idx on geofences (company_id);
create index if not exists trips_vehicle_idx on trips (vehicle_id, started_at desc);
create index if not exists audit_created_idx on audit_logs (created_at desc);

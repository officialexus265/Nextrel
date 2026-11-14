-- Driving behaviour and device commands (blueprint 3.2, 3.8, 3.9)

create table if not exists behavior_events (
  id text primary key,
  company_id text not null,
  vehicle_id text not null,
  driver_id text,
  kind text not null,
  severity text not null default 'warning',
  value double precision,
  lat double precision,
  lng double precision,
  ts timestamptz not null default now()
);

create table if not exists device_commands (
  id text primary key,
  company_id text,
  device_id text not null,
  vehicle_id text,
  kind text not null,
  status text not null default 'queued',
  requested_by text,
  result text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists behavior_vehicle_ts_idx on behavior_events (vehicle_id, ts desc);
create index if not exists behavior_driver_ts_idx on behavior_events (driver_id, ts desc);
create index if not exists commands_device_idx on device_commands (device_id, created_at desc);

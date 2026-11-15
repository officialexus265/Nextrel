-- Capability-driven device registry and explicit simulator/live command routing.
alter table devices
  add column if not exists capabilities jsonb not null default '[]'::jsonb,
  add column if not exists capability_source text not null default 'unverified',
  add column if not exists capabilities_verified_at timestamptz,
  add column if not exists connection_mode text not null default 'live';

alter table devices
  drop constraint if exists devices_connection_mode_check;

alter table devices
  add constraint devices_connection_mode_check
  check (connection_mode in ('live', 'simulated'));

create index if not exists devices_connection_mode_idx on devices (connection_mode);

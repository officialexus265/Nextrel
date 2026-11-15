-- Flexible tracker hardware metadata and capability profiles.
alter table devices
  add column if not exists manufacturer text,
  add column if not exists model text,
  add column if not exists capabilities jsonb not null default '[]'::jsonb,
  add column if not exists capability_source text not null default 'unverified',
  add column if not exists capabilities_verified_at timestamptz,
  add column if not exists connection_mode text not null default 'live';

alter table devices drop constraint if exists devices_connection_mode_check;
alter table devices add constraint devices_connection_mode_check check (connection_mode in ('live', 'simulated'));
alter table devices drop constraint if exists devices_capability_source_check;
alter table devices add constraint devices_capability_source_check check (capability_source in ('unverified', 'manual', 'protocol', 'reported'));
alter table devices drop constraint if exists devices_capabilities_array_check;
alter table devices add constraint devices_capabilities_array_check check (jsonb_typeof(capabilities) = 'array');

create index if not exists devices_connection_mode_idx on devices (connection_mode);
create index if not exists devices_manufacturer_model_idx on devices (manufacturer, model);

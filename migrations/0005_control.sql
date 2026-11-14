-- Platform control: engine flags, company mark, scheduled report desk.

alter table companies add column if not exists mark text;

create table if not exists feature_flags (
  key text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into feature_flags (key, enabled) values
  ('offline', true),
  ('speeding', true),
  ('fuel_theft', true),
  ('long_idle', true),
  ('geofence', true),
  ('mail_dispatch', true)
on conflict (key) do nothing;

create table if not exists report_schedules (
  id text primary key,
  company_id text not null,
  kind text not null,
  cadence text not null,
  recipient text not null,
  enabled boolean not null default true,
  next_run timestamptz not null,
  last_run timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists mail_queue (
  id text primary key,
  company_id text,
  to_email text not null,
  subject text not null,
  body text not null,
  kind text not null,
  status text not null default 'filed',
  created_at timestamptz not null default now()
);

create index if not exists report_schedules_company_idx on report_schedules (company_id, next_run);
create index if not exists mail_queue_company_idx on mail_queue (company_id, created_at desc);

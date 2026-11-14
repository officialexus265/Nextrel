-- Platform-level settings (landing page media, etc.)

create table if not exists platform_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into platform_settings (key, value)
values
  ('landing_hero_type', 'none'),
  ('landing_hero_url', ''),
  ('landing_headline', 'Command every kilometre.'),
  ('landing_subhead', 'Real-time tracking, fuel integrity, and geofence discipline for fleets that cannot afford surprises.')
on conflict (key) do nothing;

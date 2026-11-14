-- Seed version for demo rollups (daily trips, fence events) without altering live tables.
create table if not exists app_meta (
  key text primary key,
  value text not null
);

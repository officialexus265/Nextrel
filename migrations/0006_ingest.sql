-- Ingest journal for decoder rejects and accepted fixes.

create table if not exists ingest_journal (
  id text primary key,
  company_id text,
  imei text,
  decoder text,
  status text not null,
  detail text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

create index if not exists ingest_journal_created_idx on ingest_journal (created_at desc);

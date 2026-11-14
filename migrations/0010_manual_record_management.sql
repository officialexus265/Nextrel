-- Preserve auth identities while allowing administrators to deactivate application access.
alter table profiles add column if not exists active boolean not null default true;

-- Permanently remove the original demo fleet without touching registered accounts.
-- Company-owned records are deleted by the two fixed demo company IDs only.

begin;

delete from device_calibrations
where device_id in (
  select id from devices
  where company_id in ('co_meridian', 'co_harbor')
     or vehicle_id in (select id from vehicles where company_id in ('co_meridian', 'co_harbor'))
);

delete from driver_assignments
where vehicle_id in (select id from vehicles where company_id in ('co_meridian', 'co_harbor'))
   or driver_id in (select id from drivers where company_id in ('co_meridian', 'co_harbor'));

delete from behavior_events where company_id in ('co_meridian', 'co_harbor');
delete from device_commands where company_id in ('co_meridian', 'co_harbor')
   or vehicle_id in (select id from vehicles where company_id in ('co_meridian', 'co_harbor'));
delete from geofence_events where company_id in ('co_meridian', 'co_harbor');
delete from positions where company_id in ('co_meridian', 'co_harbor');
delete from trips where company_id in ('co_meridian', 'co_harbor');
delete from stops where company_id in ('co_meridian', 'co_harbor');
delete from alerts where company_id in ('co_meridian', 'co_harbor');
delete from fuel_events where company_id in ('co_meridian', 'co_harbor');
delete from maintenance_reminders where company_id in ('co_meridian', 'co_harbor');
delete from documents where company_id in ('co_meridian', 'co_harbor');
delete from media_files where company_id in ('co_meridian', 'co_harbor');
delete from devices where company_id in ('co_meridian', 'co_harbor')
   or vehicle_id in (select id from vehicles where company_id in ('co_meridian', 'co_harbor'));
delete from geofences where company_id in ('co_meridian', 'co_harbor');
delete from alert_rules where company_id in ('co_meridian', 'co_harbor');
delete from invoices where company_id in ('co_meridian', 'co_harbor');
delete from report_schedules where company_id in ('co_meridian', 'co_harbor');
delete from mail_queue where company_id in ('co_meridian', 'co_harbor');
delete from ingest_journal where company_id in ('co_meridian', 'co_harbor');
delete from audit_logs
where company_id in ('co_meridian', 'co_harbor')
   or (action = 'platform.seeded' and target = 'demo fleet');

delete from drivers where company_id in ('co_meridian', 'co_harbor');
delete from vehicles where company_id in ('co_meridian', 'co_harbor');

delete from field_assignments where company_id in ('co_meridian', 'co_harbor');
delete from invites where company_id in ('co_meridian', 'co_harbor');
delete from view_overrides where company_id in ('co_meridian', 'co_harbor');

-- Keep every profile/auth user row; only detach any profile from the deleted demo companies.
update profiles set company_id = null where company_id in ('co_meridian', 'co_harbor');

delete from companies where id in ('co_meridian', 'co_harbor');

-- Stop the legacy demo simulation state and mark the seed as permanently retired.
update sim_state set seeded = false, last_tick = null where id = 1;
insert into app_meta (key, value) values ('fleet_seed', 'disabled')
on conflict (key) do update set value = excluded.value;

commit;

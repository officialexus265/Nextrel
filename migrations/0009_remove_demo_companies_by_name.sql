-- Permanently remove the original demo fleet without touching registered accounts.
-- Resolve the original demo companies by their IDs and exact names. This follow-up
-- also handles databases where the demo company IDs differ from the original seed IDs.
create temp table _demo_company_ids on commit drop as
select id from companies
where id in ('co_meridian', 'co_harbor')
   or lower(trim(name)) in ('meridian logistics', 'harbor guard');


delete from device_calibrations
where device_id in (
  select id from devices
  where company_id in (select id from _demo_company_ids)
     or vehicle_id in (select id from vehicles where company_id in (select id from _demo_company_ids))
);

delete from driver_assignments
where vehicle_id in (select id from vehicles where company_id in (select id from _demo_company_ids))
   or driver_id in (select id from drivers where company_id in (select id from _demo_company_ids));

delete from behavior_events where company_id in (select id from _demo_company_ids);
delete from device_commands where company_id in (select id from _demo_company_ids)
   or vehicle_id in (select id from vehicles where company_id in (select id from _demo_company_ids));
delete from geofence_events where company_id in (select id from _demo_company_ids);
delete from positions where company_id in (select id from _demo_company_ids);
delete from trips where company_id in (select id from _demo_company_ids);
delete from stops where company_id in (select id from _demo_company_ids);
delete from alerts where company_id in (select id from _demo_company_ids);
delete from fuel_events where company_id in (select id from _demo_company_ids);
delete from maintenance_reminders where company_id in (select id from _demo_company_ids);
delete from documents where company_id in (select id from _demo_company_ids);
delete from media_files where company_id in (select id from _demo_company_ids);
delete from devices where company_id in (select id from _demo_company_ids)
   or vehicle_id in (select id from vehicles where company_id in (select id from _demo_company_ids));
delete from geofences where company_id in (select id from _demo_company_ids);
delete from alert_rules where company_id in (select id from _demo_company_ids);
delete from invoices where company_id in (select id from _demo_company_ids);
delete from report_schedules where company_id in (select id from _demo_company_ids);
delete from mail_queue where company_id in (select id from _demo_company_ids);
delete from ingest_journal where company_id in (select id from _demo_company_ids);
delete from audit_logs
where company_id in (select id from _demo_company_ids)
   or (action = 'platform.seeded' and target = 'demo fleet');

delete from drivers where company_id in (select id from _demo_company_ids);
delete from vehicles where company_id in (select id from _demo_company_ids);

delete from field_assignments where company_id in (select id from _demo_company_ids);
delete from invites where company_id in (select id from _demo_company_ids);
delete from view_overrides where company_id in (select id from _demo_company_ids);

-- Keep every profile/auth user row; only detach any profile from the deleted demo companies.
update profiles set company_id = null where company_id in (select id from _demo_company_ids);

delete from companies where id in (select id from _demo_company_ids);

-- Stop the legacy demo simulation state and mark the seed as permanently retired.
update sim_state set seeded = false, last_tick = null where id = 1;
insert into app_meta (key, value) values ('fleet_seed', 'disabled')
on conflict (key) do update set value = excluded.value;


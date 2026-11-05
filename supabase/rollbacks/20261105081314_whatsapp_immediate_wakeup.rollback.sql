-- Run only after disabling immediate_enabled and confirming the deployment target.
begin;
do $$begin
 if exists(select 1 from private.whatsapp_worker_scheduler_settings where immediate_enabled) then
  raise exception 'WHATSAPP_IMMEDIATE_WAKE_MUST_BE_DISABLED';
 end if;
end$$;
drop trigger if exists whatsapp_wake_new_inbound_job on public.whatsapp_inbound_jobs;
drop function if exists public.whatsapp_worker_live_active();
drop function if exists public.whatsapp_queue_health();
drop index if exists public.whatsapp_jobs_health_idx;
drop function if exists private.whatsapp_wake_new_inbound_job();
drop index if exists private.whatsapp_worker_tick_runs_queued_at_idx;
alter table private.whatsapp_worker_scheduler_settings drop column if exists immediate_enabled;
commit;

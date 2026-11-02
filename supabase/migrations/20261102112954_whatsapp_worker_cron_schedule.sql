-- Installs a dormant recurring schedule. Activation is a separate reviewed
-- operation after the runtime, readiness, queue and provider checks pass.
begin;
create extension if not exists pg_net with schema extensions;
do $migration$
declare worker_job bigint;
begin
 if not exists(select 1 from pg_extension where extname='pg_cron')
  or not exists(select 1 from pg_extension where extname='pg_net')
  or to_regprocedure('private.whatsapp_schedule_worker_tick()') is null
  or not exists(select 1 from private.whatsapp_worker_scheduler_settings where singleton and not enabled)
  or exists(select 1 from cron.job where jobname='velora-whatsapp-worker-v1') then
  raise exception 'WHATSAPP_WORKER_SCHEDULE_PREREQUISITE_MISMATCH';
 end if;
 worker_job:=cron.schedule('velora-whatsapp-worker-v1','30 seconds','select private.whatsapp_schedule_worker_tick()');
 if worker_job is null then raise exception 'WHATSAPP_WORKER_SCHEDULE_FAILED'; end if;
 perform cron.alter_job(job_id:=worker_job,active:=false);
end;
$migration$;
-- Operational telemetry contains only counts and timestamps, never headers,
-- message bodies, destination numbers, or scheduled capabilities.
create function private.whatsapp_worker_scheduler_health() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'enabled',coalesce((select s.enabled from private.whatsapp_worker_scheduler_settings s where s.singleton),false),
  'cron_active',coalesce((select j.active from cron.job j where j.jobname='velora-whatsapp-worker-v1'),false),
  'last_queued_at',(select max(t.queued_at) from private.whatsapp_worker_tick_runs t),
  'queued_15m',(select count(*) from private.whatsapp_worker_tick_runs t where t.queued_at>=now()-interval '15 minutes'),
  'failures_15m',(select count(*) from private.whatsapp_worker_tick_runs t join net._http_response r on r.id=t.request_id
    where t.queued_at>=now()-interval '15 minutes' and (r.timed_out or r.error_msg is not null or r.status_code is null or r.status_code>=400)),
  'blocked_15m',(select count(*) from private.whatsapp_worker_tick_runs t join net._http_response r on r.id=t.request_id
    where t.queued_at>=now()-interval '15 minutes' and case when pg_input_is_valid(r.content,'jsonb') then r.content::jsonb->>'code' in ('WORKER_BATCH_BLOCKED','CUSTOMER_ANSWERING_DISABLED') else false end),
  'reconciliation_15m',(select count(*) from private.whatsapp_worker_tick_runs t join net._http_response r on r.id=t.request_id
    where t.queued_at>=now()-interval '15 minutes' and case when pg_input_is_valid(r.content,'jsonb') then r.content::jsonb->>'code'='RECONCILIATION_REQUIRED' else false end),
  'invalid_response_15m',(select count(*) from private.whatsapp_worker_tick_runs t join net._http_response r on r.id=t.request_id
    where t.queued_at>=now()-interval '15 minutes' and r.status_code between 200 and 299 and not coalesce(pg_input_is_valid(r.content,'jsonb'),false)),
  'unanswered_15m',(select count(*) from private.whatsapp_worker_tick_runs t left join net._http_response r on r.id=t.request_id
    where t.queued_at>=now()-interval '15 minutes' and t.queued_at<now()-interval '6 minutes' and r.id is null)
 );
$$;
revoke all on function private.whatsapp_worker_scheduler_health() from public,anon,authenticated,service_role;
commit;
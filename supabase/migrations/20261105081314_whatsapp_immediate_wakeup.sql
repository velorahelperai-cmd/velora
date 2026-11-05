-- Dormant immediate wake-up: durable job remains authoritative; pg_net is only a hint.
begin;
alter table private.whatsapp_worker_scheduler_settings
  add column immediate_enabled boolean not null default false;
create index whatsapp_worker_tick_runs_queued_at_idx on private.whatsapp_worker_tick_runs(queued_at);
-- Bounded, on-demand operational view. No customer text, identities or tokens.
create index whatsapp_jobs_health_idx on public.whatsapp_inbound_jobs(status,created_at)
 where status in ('pending','retry_wait','claimed','review_required','dead_letter');
create function public.whatsapp_queue_health() returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='2s' as $$
declare s text;n integer;oldest timestamptz;result jsonb:='{}'::jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 foreach s in array array['pending','retry_wait','claimed','review_required','dead_letter'] loop
  select count(*)::integer,min(created_at) into n,oldest from (
   select created_at from public.whatsapp_inbound_jobs where status=s
    and status in ('pending','retry_wait','claimed','review_required','dead_letter') order by created_at limit 1001
  ) q;
  result:=result||jsonb_build_object(s,jsonb_build_object('count',least(n,1000),'capped',n>1000,'oldest_created_at',oldest));
 end loop;
 return jsonb_build_object('observed_at',clock_timestamp(),'states',result);
end;$$;
revoke all on function public.whatsapp_queue_health() from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_queue_health() to service_role;

create function public.whatsapp_worker_live_active() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select s.enabled from private.whatsapp_worker_scheduler_settings s where s.singleton), false);
$$;
revoke all on function public.whatsapp_worker_live_active() from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_worker_live_active() to service_role;

create function private.whatsapp_wake_new_inbound_job() returns trigger
language plpgsql security definer set search_path='' as $$
declare active_requests integer;
begin
  -- Deferred execution sees the final state: receive-only test jobs are completed
  -- in the same transaction and must not wake the worker.
  if not exists (select 1 from private.whatsapp_worker_scheduler_settings s
                 where s.singleton and s.enabled and s.immediate_enabled) then return null; end if;
  if not exists (select 1 from public.whatsapp_inbound_jobs j
                 where j.id=new.id and j.company_id=new.company_id and j.status='pending'
                   and j.next_attempt_at<=clock_timestamp()) then return null; end if;
  -- Bound concurrent wakeups. Contention or a lost hint leaves the durable job
  -- for the independently configured recovery scheduler.
  if not pg_catalog.pg_try_advisory_xact_lock(18745220, 1) then return null; end if;
  select count(*) into active_requests from private.whatsapp_worker_tick_runs t
    where t.queued_at > clock_timestamp()-interval '6 minutes'
      and not exists(select 1 from net._http_response r where r.id=t.request_id);
  if active_requests >= 8 then return null; end if;
  perform private.whatsapp_schedule_worker_tick();
  return null;
exception when others then
  -- Wake-up failure must not roll back an otherwise durable inbound message.
  raise log 'whatsapp immediate worker wake unavailable';
  return null;
end;$$;
revoke all on function private.whatsapp_wake_new_inbound_job() from public,anon,authenticated,service_role;
create constraint trigger whatsapp_wake_new_inbound_job
  after insert on public.whatsapp_inbound_jobs deferrable initially deferred
  for each row execute function private.whatsapp_wake_new_inbound_job();
commit;

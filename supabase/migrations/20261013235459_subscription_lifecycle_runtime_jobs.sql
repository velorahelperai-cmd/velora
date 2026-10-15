-- Durable native expiry worker; never invokes Meta, AI, payments or mail.
-- Install disabled, verify the release, then enable the protected singleton.
begin;
create table private.billing_lifecycle_scheduler_settings(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 last_started_at timestamptz,last_finished_at timestamptz,last_processed integer,last_failed integer
);
insert into private.billing_lifecycle_scheduler_settings(singleton) values(true);
alter table private.billing_lifecycle_scheduler_settings enable row level security;
revoke all on private.billing_lifecycle_scheduler_settings from public,anon,authenticated,service_role;
create function public.billing_run_expiry_tick() returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;result jsonb;candidates jsonb;processed integer:=0;failed integer:=0;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not (select enabled from private.billing_lifecycle_scheduler_settings where singleton) then return jsonb_build_object('ok',false,'code','LIFECYCLE_DISABLED');end if;
 if not pg_try_advisory_xact_lock(20261014,301) then return jsonb_build_object('ok',true,'code','BUSY','processed',0);end if;
 update private.billing_lifecycle_scheduler_settings set last_started_at=clock_timestamp() where singleton;
 candidates:=public.billing_expiry_candidates(10);
 for cid in select value::uuid from jsonb_array_elements_text(candidates) loop
  begin
   result:=public.billing_run_expiry_company(cid);
   if result->>'ok'='true' then processed:=processed+1;else failed:=failed+1;end if;
  exception when others then failed:=failed+1;end;
 end loop;
 update private.billing_lifecycle_scheduler_settings set last_finished_at=clock_timestamp(),last_processed=processed,last_failed=failed where singleton;
 return jsonb_build_object('ok',failed=0,'processed',processed,'failed',failed);
end;$$;
revoke all on function public.billing_run_expiry_tick() from public,anon,authenticated,service_role;
grant execute on function public.billing_run_expiry_tick() to service_role;
-- Managed Supabase Cron installation. The isolated test exercises the function
-- above; the actual extension and job are verified separately on Supabase.
create extension if not exists pg_cron;
select cron.schedule('velora-subscription-lifecycle-v1','* * * * *','set role service_role; select public.billing_run_expiry_tick(); reset role;');
notify pgrst,'reload schema';
commit;

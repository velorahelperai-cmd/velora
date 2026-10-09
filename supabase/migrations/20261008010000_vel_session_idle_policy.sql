-- Two-hour activity policy. Install safely, then activate only alongside the new frontend.
create schema if not exists private;
create table if not exists private.app_session_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into private.app_session_settings(singleton,enabled) values(true,false) on conflict do nothing;
create table if not exists private.app_session_activity(
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 last_activity_at timestamptz not null,
 expired_at timestamptz
);
revoke all on private.app_session_activity,private.app_session_settings from public,anon,authenticated;
-- Existing sessions receive one rollout baseline; no history is fabricated after rollout.
insert into private.app_session_activity(session_id,user_id,last_activity_at)
select id,user_id,clock_timestamp() from auth.sessions on conflict do nothing;

create or replace function public.check_app_session(p_touch boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid; created timestamptz; activity private.app_session_activity%rowtype; current_time_at timestamptz:=clock_timestamp();
begin
 if uid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end;
 if sid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 select created_at into created from auth.sessions where id=sid and user_id=uid;
 if not found then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 insert into private.app_session_activity(session_id,user_id,last_activity_at) values(sid,uid,least(created,clock_timestamp())) on conflict do nothing;
 select * into activity from private.app_session_activity where session_id=sid and user_id=uid for update;
 -- Read the clock after the lock: a concurrent touch may have advanced last_activity_at.
 current_time_at:=clock_timestamp();
 if not found or activity.expired_at is not null or activity.last_activity_at>current_time_at or current_time_at-activity.last_activity_at>=interval '2 hours' then
  update private.app_session_activity set expired_at=coalesce(expired_at,current_time_at) where session_id=sid and user_id=uid;
  return jsonb_build_object('ok',false,'code','SESSION_EXPIRED');
 end if;
 if p_touch then
  update private.app_session_activity set last_activity_at=current_time_at where session_id=sid;
  activity.last_activity_at:=current_time_at;
 end if;
 return jsonb_build_object('ok',true,'expires_at',activity.last_activity_at+interval '2 hours');
end;$$;
revoke all on function public.check_app_session(boolean) from public,anon;
grant execute on function public.check_app_session(boolean) to authenticated;

create or replace function public.app_session_is_valid()
returns boolean language sql stable security definer set search_path='' as $$
 select case when not (select enabled from private.app_session_settings where singleton) then true else exists(
 select 1 from private.app_session_activity a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id
 where a.user_id=auth.uid() and a.session_id=(auth.jwt()->>'session_id')::uuid and a.expired_at is null
 and a.last_activity_at<=statement_timestamp() and a.last_activity_at>statement_timestamp()-interval '2 hours'
 ) end;
$$;
revoke all on function public.app_session_is_valid() from public,anon;
grant execute on function public.app_session_is_valid() to authenticated;

create or replace function public.app_session_pre_request()
returns void language plpgsql security definer set search_path='' as $$
declare checked jsonb;
begin
 if auth.jwt()->>'role' <> 'authenticated' or coalesce(auth.jwt()->>'role','')='' then return;end if;
 if not (select enabled from private.app_session_settings where singleton) then return;end if;
 -- Read-only requests cannot initialize/touch session state.
 if current_setting('transaction_read_only')::boolean then
  if not public.app_session_is_valid() then raise exception 'APP_SESSION_EXPIRED' using errcode='42501';end if;
  return;
 end if;
 checked:=public.check_app_session(false);
 if not coalesce((checked->>'ok')::boolean,false) then raise exception 'APP_SESSION_EXPIRED' using errcode='42501';end if;
end;$$;
revoke all on function public.app_session_pre_request() from public,anon;
grant execute on function public.app_session_pre_request() to authenticated,service_role,anon;

-- Restrictive policies also cover Storage/Realtime, where the Data API hook is not used.
do $$ declare target record; existing_hook text;begin
 for target in select n.nspname as schema_name,c.relname as table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and c.relrowsecurity and (n.nspname='public' or (n.nspname='storage' and c.relname='objects')) loop
  execute format('drop policy if exists velora_active_session on %I.%I',target.schema_name,target.table_name);
  execute format('create policy velora_active_session on %I.%I as restrictive for all to authenticated using ((select public.app_session_is_valid())) with check ((select public.app_session_is_valid()))',target.schema_name,target.table_name);
 end loop;
 select substring(setting from length('pgrst.db_pre_request=')+1) into existing_hook from pg_roles r,unnest(r.rolconfig) as setting where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%';
 if existing_hook is not null and existing_hook<>'' and existing_hook<>'public.app_session_pre_request' then raise exception 'Existing API hook must be integrated before session rollout';end if;
 if exists(select 1 from pg_roles where rolname='authenticator') then execute 'alter role authenticator set pgrst.db_pre_request = ''public.app_session_pre_request''';end if;
end;$$;
notify pgrst,'reload config';
notify pgrst,'reload schema';


-- Local epoch enforcement complements GoTrue global logout without mutating Auth.
begin;
create table private.master_account_session_revocations(
 user_id uuid primary key references auth.users(id) on delete cascade,
 revoked_before timestamptz not null,requested_at timestamptz not null default clock_timestamp()
);
alter table private.master_account_session_revocations enable row level security;
revoke all on private.master_account_session_revocations from public,anon,authenticated,service_role;
-- Preserve the public function OID: existing RLS policies already reference it.
do $$declare d text;begin
 d:=pg_get_functiondef('public.app_session_is_valid()'::regprocedure);
 if strpos(d,'private.app_session_activity')=0 or strpos(d,'private.app_session_settings')=0 then raise exception 'PASSWORD_SESSION_KERNEL_DRIFT';end if;
 d:=replace(d,'CREATE OR REPLACE FUNCTION public.app_session_is_valid()','CREATE OR REPLACE FUNCTION private.master_password_native_session_is_valid()');
 if strpos(d,'FUNCTION private.master_password_native_session_is_valid()')=0 then raise exception 'PASSWORD_SESSION_KERNEL_REWRITE_FAILED';end if;
 execute d;
end;$$;
revoke all on function private.master_password_native_session_is_valid() from public,anon,authenticated,service_role;
create or replace function public.app_session_is_valid() returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(private.master_password_native_session_is_valid(),false)
 and exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  left join private.master_account_session_revocations r on r.user_id=u.id
  where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid()
  and (s.not_after is null or s.not_after>clock_timestamp())
  and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
  and (r.revoked_before is null or s.created_at>r.revoked_before));
$$;
create function public.master_revoke_account_sessions(p_expected_user_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare n timestamptz;begin
 if current_setting('role',true) is distinct from 'authenticated' or auth.uid() is distinct from p_expected_user_id or not public.app_session_is_valid() then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_expected_user_id::text||':session-revocation',0));
 if not public.app_session_is_valid() then return false;end if;
 n:=clock_timestamp();
 insert into private.master_account_session_revocations(user_id,revoked_before,requested_at) values(p_expected_user_id,n,n)
 on conflict(user_id) do update set revoked_before=greatest(private.master_account_session_revocations.revoked_before,excluded.revoked_before),requested_at=excluded.requested_at;
 -- Native Meta authorities also read activity directly. Invalidate every old
 -- session there, including sessions that had no activity record yet.
 insert into private.app_session_activity(session_id,user_id,last_activity_at,expired_at)
 select s.id,s.user_id,least(s.created_at,n),n from auth.sessions s where s.user_id=p_expected_user_id and s.created_at<=n
 on conflict(session_id) do update set expired_at=coalesce(private.app_session_activity.expired_at,excluded.expired_at);
 return true;
end;$$;
revoke all on function public.master_revoke_account_sessions(uuid) from public,anon,authenticated,service_role;
grant execute on function public.master_revoke_account_sessions(uuid) to authenticated;
-- Keep this OID too: direct identity, billing and Meta RPCs use check_app_session.
do $$declare d text;anchor text;begin
 d:=pg_get_functiondef('public.check_app_session(boolean)'::regprocedure);
 if strpos(d,'private.app_session_activity')=0 then raise exception 'PASSWORD_CHECK_SESSION_KERNEL_DRIFT';end if;
 -- Pre-request read gates must not hold one activity lock while a global
 -- revocation waits on another device. Real human touches retain their lock.
 anchor:='select * into activity from private.app_session_activity where session_id=sid and user_id=uid for update;';
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'PASSWORD_CHECK_ACTIVITY_LOCK_DRIFT';end if;
 d:=replace(d,anchor,'if p_touch then '||anchor||' else select * into activity from private.app_session_activity where session_id=sid and user_id=uid;end if;');
 anchor:='update private.app_session_activity set expired_at=coalesce(expired_at,current_time_at) where session_id=sid and user_id=uid;';
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'PASSWORD_CHECK_ACTIVITY_EXPIRY_DRIFT';end if;
 d:=replace(d,anchor,'update private.app_session_activity set expired_at=coalesce(expired_at,current_time_at) where session_id=sid and user_id=uid and last_activity_at=activity.last_activity_at and expired_at is not distinct from activity.expired_at; if not found then return jsonb_build_object(''ok'',false,''code'',''MASTER_IDLE_ACTIVITY_ADVANCED'');end if;');
 d:=replace(d,'CREATE OR REPLACE FUNCTION public.check_app_session','CREATE OR REPLACE FUNCTION private.master_password_native_check_app_session');execute d;
end;$$;
revoke all on function private.master_password_native_check_app_session(boolean) from public,anon,authenticated,service_role;
create or replace function public.check_app_session(p_touch boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;begin
 -- Check epoch/native expiry before the old kernel can create or touch activity.
 if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  left join private.master_account_session_revocations x on x.user_id=u.id
  where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid()
  and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp())
  and (x.revoked_before is null or s.created_at>x.revoked_before)) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 r:=private.master_password_native_check_app_session(p_touch);
 if r->>'code'='MASTER_IDLE_ACTIVITY_ADVANCED' then r:=private.master_password_native_check_app_session(p_touch);end if;
 if r->>'code'='MASTER_IDLE_ACTIVITY_ADVANCED' then return jsonb_build_object('ok',false,'code','SESSION_EXPIRED');end if;
 if coalesce((r->>'ok')::boolean,false) and not public.app_session_is_valid() then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 return r;
end;$$;
commit;

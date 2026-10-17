-- Minimal identity native-session boundary (hosted-compat only).
-- Extracted from 20261014033009 lines 14-22 + 27-28 + 31-35 only.
-- Omit phone helper / enrollment / change / attestation / apply / admin restoration.
-- Runs AFTER 33007 password wrappers and BEFORE broker 080000.
-- Preserves public.app_session_is_valid / check_app_session OIDs.
-- Does not reset boundary rows or delete sessions; table starts empty.
-- Function bodies below must stay byte-identical to 33009 for C5 capability contract hashes.

create schema if not exists private;

create table if not exists private.master_identity_session_boundaries(user_id uuid primary key references auth.users(id),survivor_session_id uuid not null,revoked_before timestamptz not null);
alter table private.master_identity_session_boundaries enable row level security;
revoke all on private.master_identity_session_boundaries from public,anon,authenticated,service_role;
alter table private.master_identity_session_boundaries owner to postgres;

create or replace function private.master_identity_session_current(uid uuid,sid uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s where s.id=sid and s.user_id=uid
  and not exists(select 1 from private.master_account_session_revocations r where r.user_id=uid and s.created_at<=r.revoked_before)
  and not exists(select 1 from private.master_identity_session_boundaries b where b.user_id=uid and s.id<>b.survivor_session_id and s.created_at<=b.revoked_before));
$$;
alter function private.master_identity_session_current(uuid,uuid) owner to postgres;
revoke all on function private.master_identity_session_current(uuid,uuid) from public,anon,authenticated,service_role;

-- Snapshot public password-layer bodies to private.master_identity_pre_* (33009:27-28; omit phone).
do $$declare d text;begin
 if to_regprocedure('public.app_session_is_valid()') is null or to_regprocedure('public.check_app_session(boolean)') is null then
  raise exception 'RELEASE_IDENTITY_BOUNDARY: public app/check missing after 33007';
 end if;
 if to_regprocedure('private.master_password_native_session_is_valid()') is null
    or to_regprocedure('private.master_password_native_check_app_session(boolean)') is null then
  raise exception 'RELEASE_IDENTITY_BOUNDARY: password native wrappers missing after 33007';
 end if;
 d:=pg_get_functiondef('public.app_session_is_valid()'::regprocedure);execute replace(d,'FUNCTION public.app_session_is_valid','FUNCTION private.master_identity_pre_session_is_valid');
 d:=pg_get_functiondef('public.check_app_session(boolean)'::regprocedure);execute replace(d,'FUNCTION public.check_app_session','FUNCTION private.master_identity_pre_check_app_session');
end;$$;
alter function private.master_identity_pre_session_is_valid() owner to postgres;
alter function private.master_identity_pre_check_app_session(boolean) owner to postgres;
revoke all on function private.master_identity_pre_session_is_valid() from public,anon,authenticated,service_role;
revoke all on function private.master_identity_pre_check_app_session(boolean) from public,anon,authenticated,service_role;

-- Exact public wrappers (33009:31-35). Idle/expiry/revocation remain via pre_* snapshots.
create or replace function public.app_session_is_valid() returns boolean language sql volatile security definer set search_path='' as $$select private.master_identity_pre_session_is_valid() and exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid() and private.master_identity_session_current(user_id,id))$$;
create or replace function public.check_app_session(p_touch boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid() and private.master_identity_session_current(user_id,id)) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 return private.master_identity_pre_check_app_session(p_touch);
end;$$;
alter function public.app_session_is_valid() owner to postgres;
alter function public.check_app_session(boolean) owner to postgres;
revoke all on function public.app_session_is_valid() from public,anon,authenticated,service_role;
grant execute on function public.app_session_is_valid() to authenticated;
revoke all on function public.check_app_session(boolean) from public,anon,authenticated,service_role;
grant execute on function public.check_app_session(boolean) to authenticated;

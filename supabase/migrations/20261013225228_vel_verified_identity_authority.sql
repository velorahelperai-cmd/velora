-- Verified identity is database authority; user-editable JWT metadata is not.
begin;
create or replace function public.app_identity_is_verified()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=auth.uid()
   and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null));
$$;
revoke all on function public.app_identity_is_verified() from public,anon;
grant execute on function public.app_identity_is_verified() to authenticated;

-- Keep own profile access for account recovery. Business data, including Storage
-- and Realtime access, requires verification in addition to existing tenant RLS.
do $$ declare target record; begin
 for target in select n.nspname schema_name,c.relname table_name from pg_class c
 join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and c.relrowsecurity
 and ((n.nspname='public' and c.relname<>'profiles') or (n.nspname='storage' and c.relname='objects')) loop
  execute format('create policy velora_verified_identity on %I.%I as restrictive for all to authenticated using ((select public.app_identity_is_verified())) with check ((select public.app_identity_is_verified()))',target.schema_name,target.table_name);
 end loop;
end; $$;

-- SECURITY DEFINER owner creation/update bypasses RLS. Check identity in the
-- actual function body as well as the Data API hook, retaining its ACL and body.
do $$ declare signature text; definition text; insertion integer; begin
 foreach signature in array array[
  'private.upsert_owner_company(text,text,text,text,text,text,text,text,text)',
  'public.upsert_owner_company(text,text,text,text,text,text,text,text,text)',
  'public.upsert_selected_owner_company(uuid,text,text,text,text,text,text,text,text,text)'
 ] loop
  if to_regprocedure(signature) is null then raise exception 'IDENTITY_OWNER_RPC_MISSING: %',signature; end if;
  definition:=pg_get_functiondef(to_regprocedure(signature));
  insertion:=strpos(definition,E'begin\r\n');
  if insertion=0 then insertion:=strpos(definition,E'begin\n'); end if;
  if insertion=0 then raise exception 'IDENTITY_OWNER_RPC_BODY_UNSUPPORTED: %',signature; end if;
  definition:=overlay(definition placing E'begin\n  if not public.app_identity_is_verified() then raise exception ''APP_IDENTITY_UNVERIFIED'' using errcode=''42501''; end if;' from insertion for 5);
  execute definition;
 end loop;
end; $$;

-- Covers exposed SECURITY DEFINER RPCs that otherwise bypass table RLS.
-- These paths come from PostgREST, never from browser financial/auth metadata.
create or replace function public.app_session_pre_request()
returns void language plpgsql security definer set search_path='' as $$
declare checked jsonb; request_path text:=coalesce(current_setting('request.path',true),'');
begin
 if auth.jwt()->>'role' <> 'authenticated' or coalesce(auth.jwt()->>'role','')='' then return; end if;
 if request_path not in ('/profiles','/rpc/check_app_session','/rpc/app_session_is_valid')
    and not public.app_identity_is_verified() then
  raise exception 'APP_IDENTITY_UNVERIFIED' using errcode='42501';
 end if;
 if not (select enabled from private.app_session_settings where singleton) then return; end if;
 if current_setting('transaction_read_only')::boolean then
  if not public.app_session_is_valid() then raise exception 'APP_SESSION_EXPIRED' using errcode='42501'; end if;
  return;
 end if;
 checked:=public.check_app_session(false);
 if not coalesce((checked->>'ok')::boolean,false) then raise exception 'APP_SESSION_EXPIRED' using errcode='42501'; end if;
end; $$;
revoke all on function public.app_session_pre_request() from public,anon;
grant execute on function public.app_session_pre_request() to authenticated,service_role,anon;

do $$ declare existing_hook text; begin
 if exists (
  select 1 from pg_db_role_setting s
  cross join lateral unnest(s.setconfig) setting
  where s.setrole=(select oid from pg_roles where rolname='authenticator')
    and s.setdatabase in (0,(select oid from pg_database where datname=current_database()))
    and setting like 'pgrst.db_pre_request=%'
    and substring(setting from length('pgrst.db_pre_request=')+1) not in ('','public.app_session_pre_request')
 ) then raise exception 'Existing API hook must be integrated before identity rollout'; end if;
 select substring(setting from length('pgrst.db_pre_request=')+1) into existing_hook
 from pg_roles r,unnest(r.rolconfig) setting where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%';
 if existing_hook is not null and existing_hook<>'' and existing_hook<>'public.app_session_pre_request' then
  raise exception 'Existing API hook must be integrated before identity rollout';
 end if;
 if exists(select 1 from pg_roles where rolname='authenticator') then
  execute 'alter role authenticator set pgrst.db_pre_request = ''public.app_session_pre_request''';
 end if;
end; $$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;

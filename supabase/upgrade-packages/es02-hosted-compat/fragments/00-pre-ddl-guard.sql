-- Critical pre-DDL guard (mirrored in standalone preflight.sql).
-- Pins are full pg_get_functiondef MD5 (CRLF-normalized), NOT prosrc.
-- Hosted PhaseB prosrc pins (informational only): app b42c28f54d05778fcc994156c6ce4086;
-- check f69c473d94466a93d1d793bbd447478e — never compared here.
-- Requires expand targets absent. Final installed footprint → deterministic reject (no re-expand).

do $$
declare
  app_oid oid := to_regprocedure('public.app_session_is_valid()');
  check_oid oid := to_regprocedure('public.check_app_session(boolean)');
  app_md5 text;
  check_md5 text;
  expand_absent boolean;
  final_present boolean;
begin
  if current_user is distinct from 'postgres' and current_user is distinct from 'supabase_admin' then
    raise exception 'RELEASE_PREFLIGHT: installer must be postgres/supabase_admin';
  end if;

  final_present :=
    to_regclass('public.vel_broker_sessions') is not null
    and to_regprocedure('public.es02_create_account_order(uuid,uuid,text,jsonb,boolean)') is not null
    and to_regprocedure('public.es02_settle_account_order_synthetic(jsonb)') is not null;

  if final_present then
    raise exception 'RELEASE_PREFLIGHT: final footprint already installed — refuse re-expand (run postflight.sql only; old hosted kernel pins do not apply)';
  end if;

  expand_absent :=
    to_regclass('public.vel_broker_sessions') is null
    and to_regprocedure('public.es02_create_account_order(uuid,uuid,text,jsonb,boolean)') is null;

  if not expand_absent then
    raise exception 'RELEASE_PREFLIGHT: partial/incompatible expand footprint — refuse (no silent repair)';
  end if;

  if app_oid is null then
    raise exception 'RELEASE_PREFLIGHT: public.app_session_is_valid() missing';
  end if;
  if check_oid is null then
    raise exception 'RELEASE_PREFLIGHT: public.check_app_session(boolean) missing';
  end if;

  app_md5 := md5(replace(pg_get_functiondef(app_oid), chr(13), ''));
  check_md5 := md5(replace(pg_get_functiondef(check_oid), chr(13), ''));

  if app_md5 is distinct from '5f3313dbaee67b8366fef2b55150d067' then
    raise exception 'RELEASE_PREFLIGHT: public.app_session_is_valid() full-definition md5 drift (expected hosted PhaseB kernel)';
  end if;
  if check_md5 is distinct from '7d7b359732de20ea37d383b579a45d38' then
    raise exception 'RELEASE_PREFLIGHT: public.check_app_session(boolean) full-definition md5 drift (expected hosted PhaseB kernel)';
  end if;

  if pg_get_userbyid((select proowner from pg_proc where oid = app_oid)) is distinct from 'postgres'
     or not (select prosecdef from pg_proc where oid = app_oid)
     or not exists (
       select 1 from pg_proc p
       where p.oid = app_oid and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
     )
     or has_function_privilege('anon', app_oid, 'EXECUTE')
     or not has_function_privilege('authenticated', app_oid, 'EXECUTE')
     or not has_function_privilege('service_role', app_oid, 'EXECUTE') then
    raise exception 'RELEASE_PREFLIGHT: public.app_session_is_valid() owner/definer/search_path/grants drift';
  end if;

  if pg_get_userbyid((select proowner from pg_proc where oid = check_oid)) is distinct from 'postgres'
     or not (select prosecdef from pg_proc where oid = check_oid)
     or not exists (
       select 1 from pg_proc p
       where p.oid = check_oid and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
     )
     or has_function_privilege('anon', check_oid, 'EXECUTE')
     or not has_function_privilege('authenticated', check_oid, 'EXECUTE')
     or not has_function_privilege('service_role', check_oid, 'EXECUTE') then
    raise exception 'RELEASE_PREFLIGHT: public.check_app_session(boolean) owner/definer/search_path/grants drift';
  end if;

  if to_regclass('public.companies') is null
     or to_regclass('public.company_members') is null
     or to_regclass('public.company_branches') is null
     or to_regclass('public.billing_subscriptions') is null then
    raise exception 'RELEASE_PREFLIGHT: required tenancy/billing relations missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_subscriptions' and column_name = 'environment'
  ) then
    raise exception 'RELEASE_PREFLIGHT: billing_subscriptions.environment missing';
  end if;

  if to_regprocedure('private.enterprise_new_company()') is not null
     or exists (
       select 1 from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'companies' and t.tgname = 'enterprise_primary_branch'
     ) then
    raise exception 'RELEASE_PREFLIGHT: unexpected enterprise primary machinery present — not this PhaseB profile';
  end if;
end;
$$;

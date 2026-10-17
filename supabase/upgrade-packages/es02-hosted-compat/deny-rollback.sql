-- Deny-rollback overlay for es02-hosted-compat.
-- Revokes affected runtime entrypoints. Preserves data, guards, expiry, revocation, tips.
-- NEVER restores native-only old auth bodies or clears session/broker state.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_user is distinct from 'postgres' and current_user is distinct from 'supabase_admin' then
    raise exception 'RELEASE_DENY_ROLLBACK: installer must be postgres/supabase_admin';
  end if;
end;
$$;

-- ES02 mutating customer entrypoints
do $$
begin
  if to_regprocedure('public.es02_create_account_order(uuid,uuid,text,jsonb,boolean)') is not null then
    execute 'revoke all on function public.es02_create_account_order(uuid,uuid,text,jsonb,boolean) from public, anon, authenticated, service_role';
  end if;
  if to_regprocedure('public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)') is not null then
    execute 'revoke all on function public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb) from public, anon, authenticated, service_role';
  end if;
  if to_regprocedure('public.es02_settle_account_order_synthetic(jsonb)') is not null then
    execute 'revoke all on function public.es02_settle_account_order_synthetic(jsonb) from public, anon, authenticated, service_role';
  end if;
  if to_regprocedure('public.es02_read_owned_purchase(uuid)') is not null then
    execute 'revoke all on function public.es02_read_owned_purchase(uuid) from public, anon, authenticated, service_role';
  end if;
end;
$$;

-- Recovery REVIEW entrypoints (keep tip guards / data; revoke execute only)
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.master_open_identity_recovery_review(uuid,text,uuid)',
    'public.master_open_identity_recovery_review(uuid,text,uuid,uuid,uuid,uuid)',
    'public.master_read_identity_recovery_reviews()',
    'public.master_read_identity_recovery_reviews(uuid,uuid,uuid)'
  ]
  loop
    if to_regprocedure(sig) is not null then
      execute format('revoke all on function %s from public, anon, authenticated, service_role', sig);
    end if;
  end loop;
end;
$$;

-- Broker public admit/resolve surfaces (if present) — revoke runtime execute; keep tables/guards
do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'vel_broker_%'
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated, service_role',
      r.nspname, r.proname, r.args
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;

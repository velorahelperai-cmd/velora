-- READ ONLY postflight for es02-hosted-compat.
-- Assert owners, RLS, signatures, required unique key, synthetic deny grants.
-- Do not call has_function_privilege('public', …) — PUBLIC is not a pg_roles row.
-- anon/auth/service checks already include PUBLIC grants; also assert ACL grantee=0.

begin read only;
set local statement_timeout = '60s';
set local search_path = '';

do $$
declare
  synth oid := to_regprocedure('public.es02_settle_account_order_synthetic(jsonb)');
  create_fn oid := to_regprocedure('public.es02_create_account_order(uuid,uuid,text,jsonb,boolean)');
  provision oid := to_regprocedure('public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)');
  public_exec boolean;
begin
  if create_fn is null or provision is null or synth is null then
    raise exception 'RELEASE_POSTFLIGHT: required ES02 RPCs missing';
  end if;
  if to_regclass('public.vel_broker_sessions') is null
     or to_regclass('public.vel_broker_browser_lineages') is null then
    raise exception 'RELEASE_POSTFLIGHT: broker tables missing';
  end if;
  if to_regclass('private.es02_account_orders') is null then
    raise exception 'RELEASE_POSTFLIGHT: private.es02_account_orders missing';
  end if;
  if to_regprocedure('private.es02_has_exact_client_op_unique()') is null
     or not private.es02_has_exact_client_op_unique() then
    raise exception 'RELEASE_POSTFLIGHT: exact unique(account_id,client_op_id) missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'company_branches' and column_name = 'city'
  ) then
    raise exception 'RELEASE_POSTFLIGHT: company_branches.city missing';
  end if;

  select exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = synth
      and a.grantee = 0
      and a.privilege_type = 'EXECUTE'
  ) into public_exec;

  if public_exec
     or has_function_privilege('anon', synth, 'EXECUTE')
     or has_function_privilege('authenticated', synth, 'EXECUTE')
     or has_function_privilege('service_role', synth, 'EXECUTE') then
    raise exception 'RELEASE_POSTFLIGHT: synthetic settle must be denied to PUBLIC/anon/authenticated/service_role';
  end if;

  if not has_function_privilege('authenticated', create_fn, 'EXECUTE')
     or has_function_privilege('anon', create_fn, 'EXECUTE')
     or has_function_privilege('service_role', create_fn, 'EXECUTE') then
    raise exception 'RELEASE_POSTFLIGHT: create order grants incorrect';
  end if;
  if pg_get_function_result(create_fn) is distinct from 'jsonb'
     or not (select prosecdef from pg_proc where oid = create_fn)
     or pg_get_userbyid((select proowner from pg_proc where oid = create_fn)) is distinct from 'postgres' then
    raise exception 'RELEASE_POSTFLIGHT: create order authority/signature incorrect';
  end if;
  if to_regclass('private.master_identity_recovery_policy') is null then
    raise exception 'RELEASE_POSTFLIGHT: recovery policy table missing';
  end if;
  if exists (
    select 1 from private.master_identity_recovery_policy
    where singleton and enabled
  ) then
    raise exception 'RELEASE_POSTFLIGHT: recovery policy must remain UNCONFIGURED (enabled=false)';
  end if;

  -- Probe RPC is public.vel_broker_capability_probe() (EXECUTE: service_role only).
  if to_regprocedure('private.vel_broker_capability_contract_matches()') is null
     or not private.vel_broker_capability_contract_matches() then
    raise exception 'RELEASE_POSTFLIGHT: private.vel_broker_capability_contract_matches() is not true';
  end if;
  if to_regprocedure('public.vel_broker_capability_probe()') is null then
    raise exception 'RELEASE_POSTFLIGHT: public.vel_broker_capability_probe() missing';
  end if;
  set local role service_role;
  perform set_config(
    'es02.capability_probe_ok',
    coalesce((public.vel_broker_capability_probe()->>'ok')::boolean, false)::text,
    true
  );
  reset role;
  if current_setting('es02.capability_probe_ok', true) is distinct from 'true' then
    raise exception 'RELEASE_POSTFLIGHT: public.vel_broker_capability_probe() is not ok';
  end if;
end;
$$;

select jsonb_build_object(
  'package', 'es02-hosted-compat',
  'mode', 'postflight_readonly',
  'ok', true,
  'synthetic_denied', (
    not has_function_privilege(
      'anon',
      to_regprocedure('public.es02_settle_account_order_synthetic(jsonb)'),
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      to_regprocedure('public.es02_settle_account_order_synthetic(jsonb)'),
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      to_regprocedure('public.es02_settle_account_order_synthetic(jsonb)'),
      'EXECUTE'
    )
    and not exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = to_regprocedure('public.es02_settle_account_order_synthetic(jsonb)')
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    )
  ),
  'exact_client_op_unique', private.es02_has_exact_client_op_unique(),
  'broker_rls', (
    select bool_and(c.relrowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('vel_broker_sessions', 'vel_broker_browser_lineages')
  ),
  'es02_private_rls', (
    select bool_and(c.relrowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname like 'es02_%'
  ),
  'recovery_policy_enabled', (
    select enabled from private.master_identity_recovery_policy where singleton
  ),
  'capability_contract_matches', private.vel_broker_capability_contract_matches(),
  'capability_probe_ok', current_setting('es02.capability_probe_ok', true) = 'true'
) as postflight;

commit;

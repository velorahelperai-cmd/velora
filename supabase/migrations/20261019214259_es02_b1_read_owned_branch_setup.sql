-- Filename: 20261019214259_es02_b1_read_owned_branch_setup.sql
-- B1 read-only: one owned paid branch. No readiness mutation, clock change,
-- provisioning, channel binding, or reconciler. Historical migrations stay untouched.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regrole('postgres') is null then
    raise exception 'ES02_B1_TRUSTED_OWNER_UNAVAILABLE';
  end if;
  if to_regprocedure('private.es02_require_active_actor(uuid)') is null
     or to_regprocedure('private.es02_authority_footprint_ok()') is null
     or to_regprocedure('private.es02_order_catalog_consistent(private.es02_account_orders)') is null
     or to_regprocedure('private.es02_catalog_slot(text,text,text)') is null
     or to_regclass('private.es02_branch_slot_rights') is null
     or to_regclass('private.es02_activation_foundation') is null
     or to_regclass('private.es02_account_provisioning') is null
     or to_regclass('public.company_branches') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.company_members') is null then
    raise exception 'ES02_B1_READ_BASELINE_MISSING';
  end if;
end;
$guard$;

create or replace function public.es02_read_owned_branch_setup(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  company public.companies%rowtype;
  branch public.company_branches%rowtype;
  rights_count integer;
  rights private.es02_branch_slot_rights%rowtype;
  ord private.es02_account_orders%rowtype;
  foundation_group uuid;
  foundation_account uuid;
  foundation_order uuid;
  payment_at timestamptz;
  clock_state text;
  catalog jsonb;
  stored jsonb;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if private.es02_authority_footprint_ok() is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'FOOTPRINT_MISSING');
  end if;
  if not exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = actor
      and m.role = 'owner'
      and m.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into company from public.companies where id = p_company_id;
  if company.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;
  -- Paid provisioning stores setup. active remains readable. suspended and any other value are denied.
  if (company.status is distinct from 'setup' and company.status is distinct from 'active')
     or nullif(to_jsonb(company)->>'archived_at', '') is not null
     or nullif(to_jsonb(company)->>'setup_file_destruction_at', '') is not null then
    return jsonb_build_object('ok', false, 'code', 'SUSPENDED');
  end if;

  select * into branch
  from public.company_branches
  where company_id = p_company_id and id = p_branch_id;
  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;
  if branch.status is distinct from 'setup' and branch.status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'SUSPENDED');
  end if;

  select count(*) into rights_count
  from private.es02_branch_slot_rights r
  where r.company_id = p_company_id and r.branch_id = p_branch_id;
  if rights_count > 1 then
    return jsonb_build_object('ok', false, 'code', 'AMBIGUOUS');
  end if;
  if rights_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'NOT_PROVISIONED');
  end if;
  select * into rights
  from private.es02_branch_slot_rights r
  where r.company_id = p_company_id and r.branch_id = p_branch_id;

  select * into ord from private.es02_account_orders where id = rights.order_id;
  if ord.id is null or ord.account_id is distinct from actor then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if ord.provisioned_company_id is distinct from p_company_id
     or ord.original_order_group_id is null then
    return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
  end if;
  if ord.status in ('open', 'collection_pending', 'failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'UNPAID');
  end if;
  if ord.status is distinct from 'provisioned' or ord.provisioned_company_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_PROVISIONED');
  end if;
  if not exists (
    select 1 from private.es02_account_provisioning p
    where p.order_id = ord.id
      and p.account_id = actor
      and p.company_id = p_company_id
      and p.state = 'completed'
  ) then
    return jsonb_build_object('ok', false, 'code', 'NOT_PROVISIONED');
  end if;
  if private.es02_order_catalog_consistent(ord) is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
  end if;

  select a.order_group_id, a.account_id, a.order_id, a.payment_confirmed_at, a.clock_state
    into foundation_group, foundation_account, foundation_order, payment_at, clock_state
  from private.es02_activation_foundation a
  where a.company_id = p_company_id and a.order_id = ord.id;
  if foundation_group is null
     or foundation_group is distinct from ord.original_order_group_id
     or foundation_account is distinct from actor
     or foundation_order is distinct from ord.id
     or payment_at is null
     or clock_state not in ('waiting_readiness', 'active', 'ended') then
    return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
  end if;

  -- Installed order resolver rejects more than 32 branch slots, so indexes are 0..31.
  if rights.term is distinct from ord.term
     or rights.persona not in ('level_1', 'level_2', 'level_3')
     or rights.package not in ('basic', 'premium')
     or rights.term not in ('monthly', 'yearly')
     or rights.slot_index < 0
     or rights.slot_index >= 32 then
    return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
  end if;
  if (rights.package = 'basic' and (rights.channels <> 1 or rights.employees <> 2))
     or (rights.package = 'premium' and (rights.channels <> 2 or rights.employees <> 4)) then
    return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
  end if;
  catalog := private.es02_catalog_slot(rights.persona, rights.package, rights.term);
  if catalog is null
     or (catalog->>'persona') is distinct from rights.persona
     or (catalog->>'package') is distinct from rights.package
     or (catalog->>'term') is distinct from rights.term
     or (catalog->>'amount_baisa')::integer is distinct from rights.amount_baisa
     or (catalog->>'replies_per_month')::integer is distinct from rights.replies_per_month
     or (catalog->>'employees')::integer is distinct from rights.employees
     or (catalog->>'channels')::integer is distinct from rights.channels then
    return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
  end if;
  if ord.slots is null
     or jsonb_typeof(ord.slots) is distinct from 'array'
     or rights.slot_index >= jsonb_array_length(ord.slots) then
    return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
  end if;
  stored := ord.slots -> rights.slot_index;
  if stored is null
     or jsonb_typeof(stored) is distinct from 'object'
     or (stored->>'slotIndex')::integer is distinct from rights.slot_index
     or (stored->>'persona') is distinct from rights.persona
     or (stored->>'package') is distinct from rights.package
     or (stored->>'amountBaisa')::integer is distinct from rights.amount_baisa
     or (stored->>'repliesPerMonth')::integer is distinct from rights.replies_per_month
     or (stored->>'employees')::integer is distinct from rights.employees
     or (stored->>'channels')::integer is distinct from rights.channels then
    return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'SELECTION_REQUIRED',
    'data', jsonb_build_object(
      'companyId', company.id,
      'branchId', branch.id,
      'branchLabel', branch.name,
      'orderGroupId', ord.original_order_group_id,
      'slotIndex', rights.slot_index,
      'persona', rights.persona,
      'package', rights.package,
      'term', rights.term,
      'maxChannels', rights.channels,
      'employeesExcludingOwner', rights.employees,
      'clockState', clock_state,
      'asOf', clock_timestamp()
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

alter function public.es02_read_owned_branch_setup(uuid, uuid, uuid) owner to postgres;

revoke all on function public.es02_read_owned_branch_setup(uuid, uuid, uuid) from public;
revoke all on function public.es02_read_owned_branch_setup(uuid, uuid, uuid) from anon;
revoke all on function public.es02_read_owned_branch_setup(uuid, uuid, uuid) from authenticated;
revoke all on function public.es02_read_owned_branch_setup(uuid, uuid, uuid) from service_role;
grant execute on function public.es02_read_owned_branch_setup(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

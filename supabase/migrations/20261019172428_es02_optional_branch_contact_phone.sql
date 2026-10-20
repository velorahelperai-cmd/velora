-- ES02 optional branch contact: additive, no financial primitive or privilege changes.
-- Approved isolated-local apply only; production publication is a separate operation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$
begin
  if to_regclass('public.company_branches') is null
     or to_regprocedure('public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)') is null then
    raise exception 'ES02_BRANCH_CONTACT_BASELINE_MISSING';
  end if;
  if exists(select 1 from pg_attribute where attrelid='public.company_branches'::regclass and attname='contact_phone' and not attisdropped) then
    if not exists(select 1 from pg_attribute where attrelid='public.company_branches'::regclass and attname='contact_phone' and atttypid='text'::regtype and not attnotnull and not atthasdef) then
      raise exception 'ES02_BRANCH_CONTACT_COLUMN_CONFLICT';
    end if;
  else
    alter table public.company_branches add column contact_phone text;
  end if;
  if exists(select 1 from pg_constraint where conrelid='public.company_branches'::regclass and conname='company_branches_contact_phone_e164') then
    if not exists(select 1 from pg_constraint where conrelid='public.company_branches'::regclass and conname='company_branches_contact_phone_e164' and contype='c' and pg_get_constraintdef(oid) like '%contact_phone IS NULL%' and pg_get_constraintdef(oid) like '%[1-9][0-9]{6,14}%') then
      raise exception 'ES02_BRANCH_CONTACT_CONSTRAINT_CONFLICT';
    end if;
  else
    alter table public.company_branches add constraint company_branches_contact_phone_e164
      check(contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{6,14}$');
  end if;
end;
$guard$;
-- CREATE OR REPLACE retains the existing owner and exact function ACL.
CREATE OR REPLACE FUNCTION public.es02_provision_owned_purchase(p_expected_account_id uuid, p_order_id uuid, p_idempotency_key uuid, p_business jsonb, p_branches jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid;
  o private.es02_account_orders;
  prior private.es02_account_provisioning;
  created public.companies;
  primary_branch public.company_branches;
  branch jsonb;
  slot jsonb;
  idx integer;
  branch_count integer;
  offer jsonb;
  paid_at timestamptz;
  deadline timestamptz;
  new_branch_id uuid;
  env text;
begin
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if p_order_id is null or p_idempotency_key is null
     or p_business is null or p_branches is null
     or jsonb_typeof(p_branches) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if coalesce(btrim(p_business->>'name'), '') = ''
     or coalesce(btrim(p_business->>'type'), '') = ''
     or coalesce(btrim(p_business->>'country'), '') = ''
     or coalesce(btrim(p_business->>'city'), '') = ''
     or coalesce(btrim(p_business->>'phone'), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  branch_count := jsonb_array_length(p_branches);
  if branch_count < 1 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  -- Validate EVERY branch before any write.
  for idx in 0..branch_count-1 loop
    branch := p_branches->idx;
    if coalesce(btrim(branch->>'name'), '') = ''
       or coalesce(btrim(branch->>'city'), '') = '' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
    -- Every optional branch contact is canonical before any write.
    if branch ? 'contact_phone' and jsonb_typeof(branch->'contact_phone') not in ('string', 'null') then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
    if nullif(btrim(branch->>'contact_phone'), '') is not null
       and btrim(branch->>'contact_phone') !~ '^\+[1-9][0-9]{6,14}$' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
  end loop;

  if to_regclass('public.billing_subscriptions') is null then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_subscriptions' and column_name = 'environment'
  ) then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':es02-provision', 0));
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select * into o from private.es02_account_orders where id = p_order_id for update;
  if o.id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if o.account_id is distinct from actor then
    return jsonb_build_object('ok', false, 'code', 'FOREIGN_OWNER');
  end if;
  if not private.es02_order_catalog_consistent(o) then
    return jsonb_build_object('ok', false, 'code', 'RECONCILIATION_REQUIRED');
  end if;
  if o.status = 'provisioned' and o.provisioned_company_id is not null then
    return jsonb_build_object(
      'ok', true, 'action', 'reuse',
      'data', jsonb_build_object(
        'companyId', o.provisioned_company_id,
        'orderId', o.id,
        'orderGroupId', o.original_order_group_id
      )
    );
  end if;

  select * into prior from private.es02_account_provisioning where order_id = o.id for update;
  if prior.order_id is not null and prior.state = 'completed' and prior.company_id is not null then
    return jsonb_build_object(
      'ok', true, 'action', 'reuse',
      'data', jsonb_build_object(
        'companyId', prior.company_id,
        'orderId', o.id,
        'orderGroupId', o.original_order_group_id
      )
    );
  end if;
  -- C1 partial / stuck provisioning: preserve records; fail closed (no force-complete/delete).
  if o.status = 'provisioning'
     or (prior.order_id is not null and prior.state = 'pending') then
    return jsonb_build_object('ok', false, 'code', 'RECONCILIATION_REQUIRED');
  end if;
  if o.status is distinct from 'settled' then
    return jsonb_build_object('ok', false, 'code', 'NOT_SETTLED');
  end if;
  if branch_count is distinct from o.branch_slots then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  offer := (private.es02_order_view(o))->'offer';
  if offer is null or (offer->>'branchSlots')::integer is distinct from branch_count then
    return jsonb_build_object('ok', false, 'code', 'OFFER_TAMPER');
  end if;
  env := o.environment;
  if env is distinct from 'test' and env is distinct from 'live' then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
  end if;

  -- All validation done; writes below must succeed as one transaction (function call = one tx).
  update private.es02_account_orders
  set status = 'provisioning', updated_at = clock_timestamp()
  where id = o.id;

  insert into private.es02_account_provisioning(order_id, account_id, state, idempotency_key)
  values (o.id, actor, 'pending', p_idempotency_key);

  insert into public.companies(
    display_name, business_type, country, reply_language, city, hours,
    contact_phone, contact_email, created_by, status
  ) values (
    btrim(p_business->>'name'), btrim(p_business->>'type'), btrim(p_business->>'country'),
    coalesce(nullif(p_business->>'replyLanguage', ''), 'both'),
    btrim(p_business->>'city'), coalesce(nullif(p_business->>'hours', ''), ''),
    btrim(p_business->>'phone'), coalesce(nullif(p_business->>'email', ''), ''),
    actor, 'setup'
  ) returning * into created;

  insert into public.company_members(company_id, user_id, role, status, member_name)
  values (created.id, actor, 'owner', 'active', created.display_name);

  select * into primary_branch from public.company_branches
  where company_id = created.id and is_primary = true
  for update;
  if primary_branch.id is null then
    raise exception 'ES02_PRIMARY_BRANCH_MISSING' using errcode = 'P0001';
  end if;

  branch := p_branches->0;
  slot := offer->'slots'->0;
  update public.company_branches set
    name = btrim(branch->>'name'),
    city = btrim(branch->>'city'),
    contact_phone = nullif(btrim(branch->>'contact_phone'), ''),
    status = 'setup'
  where id = primary_branch.id;

  insert into private.es02_branch_slot_rights(
    order_id, company_id, branch_id, slot_index, persona, package, term,
    amount_baisa, replies_per_month, employees, channels, branch_city
  ) values (
    o.id, created.id, primary_branch.id, 0,
    slot->>'persona', slot->>'package', o.term,
    (slot->>'amountBaisa')::integer, (slot->>'repliesPerMonth')::integer,
    (slot->>'employees')::integer, (slot->>'channels')::integer,
    btrim(branch->>'city')
  );

  idx := 1;
  while idx < branch_count loop
    branch := p_branches->idx;
    slot := offer->'slots'->idx;
    insert into public.company_branches(company_id, name, city, is_primary, status, contact_phone)
    values (created.id, btrim(branch->>'name'), btrim(branch->>'city'), false, 'setup', nullif(btrim(branch->>'contact_phone'), ''))
    returning id into new_branch_id;
    insert into private.es02_branch_slot_rights(
      order_id, company_id, branch_id, slot_index, persona, package, term,
      amount_baisa, replies_per_month, employees, channels, branch_city
    ) values (
      o.id, created.id, new_branch_id, idx,
      slot->>'persona', slot->>'package', o.term,
      (slot->>'amountBaisa')::integer, (slot->>'repliesPerMonth')::integer,
      (slot->>'employees')::integer, (slot->>'channels')::integer,
      btrim(branch->>'city')
    );
    idx := idx + 1;
  end loop;

  paid_at := coalesce(o.settled_at, clock_timestamp());
  deadline := paid_at + interval '7 days';

  insert into private.es02_activation_foundation(
    company_id, order_id, order_group_id, account_id,
    payment_confirmed_at, entitlement_created_at, activation_deadline_at,
    bonus_days, renewal_grace_days, term_unit, clock_state
  ) values (
    created.id, o.id, o.original_order_group_id, actor,
    paid_at, clock_timestamp(), deadline, 7, 3,
    case when o.term = 'yearly' then 'year' else 'month' end,
    'waiting_readiness'
  );

  insert into private.es02_credit_balances(company_id, order_group_id, kind, granted, remaining, ordinary_expiry)
  values (created.id, o.original_order_group_id, 'base', o.replies_per_month, o.replies_per_month, null);

  -- Required existing ledger bind: order environment, no default live, no catch-ignore.
  insert into public.billing_subscriptions(company_id, environment, status, paid_through)
  values (created.id, env, 'awaiting_payment', null)
  on conflict (company_id, environment) where environment in ('test', 'live')
  do nothing;

  if not exists (
    select 1 from public.billing_subscriptions
    where company_id = created.id and environment = env
  ) then
    raise exception 'ES02_LEDGER_BIND_FAILED' using errcode = 'P0001';
  end if;

  update private.es02_account_orders set
    status = 'provisioned', provisioned_company_id = created.id, updated_at = clock_timestamp()
  where id = o.id;
  update private.es02_account_provisioning set
    state = 'completed', company_id = created.id, completed_at = clock_timestamp()
  where order_id = o.id;

  return jsonb_build_object(
    'ok', true, 'action', 'provisioned',
    'data', jsonb_build_object(
      'companyId', created.id,
      'orderId', o.id,
      'orderGroupId', o.original_order_group_id
    )
  );
exception
  when unique_violation then
    select * into o from private.es02_account_orders where id = p_order_id;
    if o.provisioned_company_id is not null
       and exists (
         select 1 from public.company_members m
         where m.company_id = o.provisioned_company_id
           and m.user_id = auth.uid() and m.role = 'owner' and m.status = 'active'
       ) then
      return jsonb_build_object(
        'ok', true, 'action', 'reuse',
        'data', jsonb_build_object(
          'companyId', o.provisioned_company_id,
          'orderId', o.id,
          'orderGroupId', o.original_order_group_id
        )
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'RECONCILIATION_REQUIRED');
  when others then
    if sqlerrm = 'ES02_PRIMARY_BRANCH_MISSING' or sqlerrm = 'ES02_LEDGER_BIND_FAILED' then
      return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
    end if;
    -- EXCEPTION aborts this block's writes (subtransaction), so INVALID path after writes rolls back.
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$function$;

commit;

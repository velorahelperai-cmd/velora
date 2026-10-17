-- ES02-C2: atomic provision, required ledger bind, immutable stored snapshot,
-- required broker footprint (no native-only downgrade), restore idempotency unique.
-- Does not edit 20261017120000 / 20261017130000 predecessors.
-- Deny-safe rollback: revoke EXECUTE on replaced public.es02_* ; keep constraints.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Restore essential idempotency unique if drifted away (no data deletion).
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and t.relname = 'es02_account_orders'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ~* 'account_id'
      and pg_get_constraintdef(c.oid) ~* 'client_op_id'
  ) and not exists (
    select 1 from pg_indexes
    where schemaname = 'private'
      and tablename = 'es02_account_orders'
      and indexdef ~* 'UNIQUE'
      and indexdef ~* 'account_id'
      and indexdef ~* 'client_op_id'
  ) then
    alter table private.es02_account_orders
      add constraint es02_account_orders_account_id_client_op_id_key
      unique (account_id, client_op_id);
  end if;
end;
$$;

create or replace function private.es02_authority_footprint_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.vel_broker_sessions') is null
     or to_regclass('public.vel_broker_browser_lineages') is null then
    return false;
  end if;
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and t.relname = 'es02_account_orders'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ~* 'account_id'
      and pg_get_constraintdef(c.oid) ~* 'client_op_id'
  ) and not exists (
    select 1 from pg_indexes
    where schemaname = 'private'
      and tablename = 'es02_account_orders'
      and indexdef ~* 'UNIQUE'
      and indexdef ~* 'account_id'
      and indexdef ~* 'client_op_id'
  ) then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function private.es02_authority_footprint_ok() from public, anon, authenticated;

-- Required broker tip — never downgrade to native-only when registry absent.
create or replace function private.es02_require_active_actor(p_expected_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  sid uuid;
  native auth.sessions%rowtype;
  tip_id uuid;
  tip_lineage uuid;
  tip_native uuid;
  tip_status text;
  root_registry uuid;
  root_state text;
  root_valid timestamptz;
begin
  if not private.es02_authority_footprint_ok() then
    return null;
  end if;
  if actor is null or p_expected_account_id is distinct from actor then
    return null;
  end if;
  if coalesce(auth.jwt()->>'role', '') is distinct from 'authenticated' then
    return null;
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = actor and u.email_confirmed_at is not null
  ) then
    return null;
  end if;
  begin
    sid := (auth.jwt()->>'session_id')::uuid;
  exception when others then
    return null;
  end;
  if sid is null then return null; end if;

  select * into native from auth.sessions
  where id = sid and user_id = actor
  for share;
  if native.id is null then return null; end if;
  if native.not_after is not null and native.not_after <= clock_timestamp() then
    return null;
  end if;
  if public.app_session_is_valid() is distinct from true then
    return null;
  end if;

  execute $q$
    select id, browser_lineage_id, native_session_id, status
    from public.vel_broker_sessions
    where native_session_id = $1 and user_id = $2 and status = 'active'
    order by last_seen_at desc nulls last
    limit 1
  $q$ into tip_id, tip_lineage, tip_native, tip_status using sid, actor;
  if tip_id is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tip_lineage::text, 0));
  execute $q$
    select current_registry_id, state, valid_until
    from public.vel_broker_browser_lineages
    where id = $1 for update
  $q$ into root_registry, root_state, root_valid using tip_lineage;
  if root_registry is null or root_state is distinct from 'active' then
    return null;
  end if;
  if root_valid is not null and root_valid <= clock_timestamp() then
    return null;
  end if;
  if root_registry is distinct from tip_id then
    return null;
  end if;
  execute $q$
    select native_session_id, status from public.vel_broker_sessions where id = $1 for share
  $q$ into tip_native, tip_status using tip_id;
  if tip_status is distinct from 'active' or tip_native is distinct from sid then
    return null;
  end if;

  return actor;
end;
$$;

revoke all on function private.es02_require_active_actor(uuid) from public, anon, authenticated;

-- Selection-only projection from stored slots (persona/package), for catalog recompute compare.
create or replace function private.es02_slot_selection(p_slots jsonb, p_persona text, p_package text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_slots is not null and jsonb_typeof(p_slots) = 'array' and jsonb_array_length(p_slots) > 0 then (
      select jsonb_agg(jsonb_build_object('persona', s->>'persona', 'package', s->>'package') order by coalesce((s->>'slotIndex')::int, 0))
      from jsonb_array_elements(p_slots) s
    )
    else jsonb_build_array(jsonb_build_object('persona', p_persona, 'package', p_package))
  end;
$$;

revoke all on function private.es02_slot_selection(jsonb,text,text) from public, anon, authenticated;

-- Stored financial snapshot must match catalog for the persisted selection; no laundering.
create or replace function private.es02_order_catalog_consistent(o private.es02_account_orders)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  expected jsonb;
  sel jsonb;
  exp_slot jsonb;
  stored_slot jsonb;
  i integer;
begin
  sel := private.es02_slot_selection(o.slots, o.persona, o.package);
  expected := private.es02_resolve_slots(o.term, sel);
  if expected is null then return false; end if;
  if (expected->>'amountBaisa')::integer is distinct from o.amount_baisa then return false; end if;
  if (expected->>'branchSlots')::integer is distinct from o.branch_slots then return false; end if;
  if (expected->>'repliesPerMonth')::integer is distinct from o.replies_per_month then return false; end if;
  if o.slots is not null and jsonb_typeof(o.slots) = 'array' and jsonb_array_length(o.slots) > 0 then
    for i in 0..jsonb_array_length(o.slots)-1 loop
      stored_slot := o.slots->i;
      exp_slot := expected->'slots'->i;
      if exp_slot is null then return false; end if;
      if (stored_slot->>'persona') is distinct from (exp_slot->>'persona')
         or (stored_slot->>'package') is distinct from (exp_slot->>'package')
         or (stored_slot->>'amountBaisa')::integer is distinct from (exp_slot->>'amountBaisa')::integer then
        return false;
      end if;
    end loop;
  end if;
  return true;
end;
$$;

revoke all on function private.es02_order_catalog_consistent(private.es02_account_orders)
  from public, anon, authenticated;

-- Immutable view: emit STORED amounts/slots; never replace with current catalog total.
create or replace function private.es02_order_view(o private.es02_account_orders)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  stored_slots jsonb;
  sel jsonb;
  canonical jsonb;
begin
  sel := private.es02_slot_selection(o.slots, o.persona, o.package);
  canonical := private.es02_resolve_slots(o.term, sel);
  if o.slots is not null and jsonb_typeof(o.slots) = 'array' and jsonb_array_length(o.slots) > 0 then
    stored_slots := o.slots;
  elsif canonical is not null then
    -- Fresh rows without slots jsonb: materialize canonical slot map but keep stored header amounts.
    stored_slots := canonical->'slots';
  else
    stored_slots := '[]'::jsonb;
  end if;
  return jsonb_build_object(
    'orderId', o.id,
    'accountId', o.account_id,
    'status', o.status,
    'offer', jsonb_build_object(
      'catalogRevision', o.catalog_revision,
      'term', o.term,
      'slots', stored_slots,
      'branchSlots', o.branch_slots,
      'amountBaisa', o.amount_baisa,
      'currency', o.currency,
      'purpose', o.purpose,
      'productCode', o.product_code,
      'repliesPerMonth', o.replies_per_month,
      'employees', o.employees,
      'channels', o.channels,
      'persona', o.persona,
      'package', o.package
    ),
    'specialReference', o.special_reference,
    'paymentAttemptId', o.payment_attempt_id,
    'environment', o.environment,
    'settledAt', o.settled_at,
    'provisionedCompanyId', o.provisioned_company_id,
    'originalOrderGroupId', o.original_order_group_id
  );
end;
$$;

revoke all on function private.es02_order_view(private.es02_account_orders) from public, anon, authenticated;

create or replace function public.es02_create_account_order(
  p_expected_account_id uuid,
  p_client_op_id uuid,
  p_term text,
  p_slots jsonb,
  p_consent_accepted boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  offer jsonb;
  prior private.es02_account_orders;
  created private.es02_account_orders;
  fp text;
  special text;
  primary_slot jsonb;
begin
  if not private.es02_authority_footprint_ok() then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if p_client_op_id is null or p_consent_accepted is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  offer := private.es02_resolve_slots(p_term, p_slots);
  if offer is null then
    return jsonb_build_object('ok', false, 'code', 'OFFER_TAMPER');
  end if;
  primary_slot := offer->'slots'->0;
  fp := concat_ws('|',
    offer->>'catalogRevision', offer->>'term', offer->>'branchSlots',
    offer->>'amountBaisa', 'OMR', offer->>'purpose', offer->>'productCode',
    offer->>'slots'
  );

  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':es02-order', 0));
  if not private.es02_authority_footprint_ok() then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select * into prior
  from private.es02_account_orders
  where account_id = actor and client_op_id = p_client_op_id
  for update;

  if prior.id is not null then
    if prior.offer_fingerprint is distinct from fp
       or not private.es02_order_catalog_consistent(prior) then
      return jsonb_build_object('ok', false, 'code', 'OFFER_TAMPER');
    end if;
    return jsonb_build_object('ok', true, 'action', 'reuse', 'data', private.es02_order_view(prior));
  end if;

  if exists (
    select 1 from private.es02_account_orders
    where account_id = actor
      and purpose = 'initial_subscription'
      and status in ('open','collection_pending')
      and offer_fingerprint is distinct from fp
  ) then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  select * into prior from private.es02_account_orders
  where account_id = actor
    and purpose = 'initial_subscription'
    and status in ('open','collection_pending','settled','provisioning')
    and offer_fingerprint = fp
  order by created_at desc
  limit 1
  for update;
  if prior.id is not null then
    if not private.es02_order_catalog_consistent(prior) then
      return jsonb_build_object('ok', false, 'code', 'RECONCILIATION_REQUIRED');
    end if;
    return jsonb_build_object('ok', true, 'action', 'reuse', 'data', private.es02_order_view(prior));
  end if;

  special := 'ES02-' || replace(gen_random_uuid()::text, '-', '');
  insert into private.es02_account_orders (
    account_id, status, purpose, product_code, catalog_revision,
    persona, package, term, amount_baisa, currency,
    replies_per_month, employees, channels, branch_slots,
    offer_fingerprint, special_reference, client_op_id,
    capture_generation, environment, slots
  ) values (
    actor, 'open', 'initial_subscription', 'velora_subscription', '2026-10-14',
    primary_slot->>'persona', primary_slot->>'package', p_term,
    (offer->>'amountBaisa')::integer, 'OMR',
    (offer->>'repliesPerMonth')::integer, (offer->>'employees')::integer,
    (offer->>'channels')::integer, (offer->>'branchSlots')::integer,
    fp, special, p_client_op_id, 0, 'test', offer->'slots'
  ) returning * into created;

  return jsonb_build_object('ok', true, 'action', 'insert', 'data', private.es02_order_view(created));
end;
$$;

revoke all on function public.es02_create_account_order(uuid,uuid,text,jsonb,boolean)
  from public, anon;
grant execute on function public.es02_create_account_order(uuid,uuid,text,jsonb,boolean)
  to authenticated;

create or replace function public.es02_read_owned_purchase(p_expected_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  o private.es02_account_orders;
begin
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  select * into o from private.es02_account_orders
  where account_id = actor
    and purpose = 'initial_subscription'
    and status in ('settled','provisioning','provisioned')
  order by case status when 'settled' then 0 when 'provisioning' then 1 else 2 end, created_at desc
  limit 1;
  if o.id is null then
    return jsonb_build_object('ok', true, 'data', null);
  end if;
  if not private.es02_order_catalog_consistent(o) then
    return jsonb_build_object('ok', false, 'code', 'RECONCILIATION_REQUIRED');
  end if;
  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'accountId', o.account_id,
      'orderId', o.id,
      'status', case when o.status = 'provisioned' then 'provisioned' else 'settled_unprovisioned' end,
      'specialReference', o.special_reference,
      'companyId', o.provisioned_company_id,
      'offer', (private.es02_order_view(o))->'offer'
    )
  );
end;
$$;

revoke all on function public.es02_read_owned_purchase(uuid) from public, anon;
grant execute on function public.es02_read_owned_purchase(uuid) to authenticated;

-- Synthetic settle: also require stored amount agreement (no underpaid launder).
create or replace function public.es02_settle_account_order_synthetic(p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o private.es02_account_orders;
  marker text;
  txn text;
  amt integer;
  prior_event private.es02_account_settlement_events;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if coalesce(current_setting('velora.es02_fixture', true), '') is distinct from 'on' then
    return jsonb_build_object('ok', false, 'code', 'SYNTHETIC_DISABLED');
  end if;

  marker := p_evidence->>'evidence_marker';
  if marker is distinct from 'VEL_ES02_SYNTHETIC_LOCAL_ONLY'
     or (p_evidence->'authenticity'->>'source') is distinct from 'es02_synthetic_local'
     or (p_evidence->'authenticity'->>'method') is distinct from 'synthetic_local_only'
     or (p_evidence->>'currency') is distinct from 'OMR'
     or (p_evidence->>'event_status') is distinct from 'success' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  begin amt := (p_evidence->>'amount_baisa')::integer; exception when others then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end;
  txn := p_evidence->>'provider_transaction_id';
  if txn is null or length(txn) < 4 or amt is null or amt < 1 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select * into o from private.es02_account_orders
  where id = (p_evidence->>'order_id')::uuid for update;
  if o.id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if o.account_id::text is distinct from (p_evidence->>'account_id')
     or o.payment_attempt_id::text is distinct from (p_evidence->>'payment_attempt_id')
     or o.special_reference is distinct from (p_evidence->>'special_reference')
     or o.amount_baisa is distinct from amt then
    return jsonb_build_object('ok', false, 'code', 'FOREIGN_OWNER');
  end if;
  if o.environment is distinct from 'test' then
    return jsonb_build_object('ok', false, 'code', 'SYNTHETIC_DISABLED');
  end if;
  if not private.es02_order_catalog_consistent(o) then
    return jsonb_build_object('ok', false, 'code', 'RECONCILIATION_REQUIRED');
  end if;

  select * into prior_event from private.es02_account_settlement_events
  where order_id = o.id and provider_transaction_id = txn;
  if prior_event.id is not null and prior_event.outcome = 'applied' then
    return jsonb_build_object('ok', true, 'action', 'duplicate', 'data', private.es02_order_view(o));
  end if;
  if o.status in ('settled','provisioning','provisioned') then
    insert into private.es02_account_settlement_events(
      order_id, account_id, evidence_marker, provider_transaction_id,
      amount_baisa, currency, outcome, detail_code
    ) values (o.id, o.account_id, marker, txn, amt, 'OMR', 'duplicate', 'already_settled')
    on conflict (order_id, provider_transaction_id) do nothing;
    return jsonb_build_object('ok', true, 'action', 'duplicate', 'data', private.es02_order_view(o));
  end if;
  if o.status not in ('open','collection_pending') then
    return jsonb_build_object('ok', false, 'code', 'NOT_SETTLED');
  end if;

  update private.es02_account_orders set
    status = 'settled', settled_at = clock_timestamp(),
    settlement_authority = 'synthetic_local', provider_transaction_id = txn,
    updated_at = clock_timestamp()
  where id = o.id returning * into o;

  insert into private.es02_account_settlement_events(
    order_id, account_id, evidence_marker, provider_transaction_id,
    amount_baisa, currency, outcome, detail_code
  ) values (o.id, o.account_id, marker, txn, amt, 'OMR', 'applied', null);

  return jsonb_build_object('ok', true, 'action', 'settled', 'data', private.es02_order_view(o));
end;
$$;

revoke all on function public.es02_settle_account_order_synthetic(jsonb)
  from public, anon, authenticated;
grant execute on function public.es02_settle_account_order_synthetic(jsonb) to service_role;

-- Atomic provision: validate ALL branches before writes; required ledger bind; no catch-ignore.
create or replace function public.es02_provision_owned_purchase(
  p_expected_account_id uuid,
  p_order_id uuid,
  p_idempotency_key uuid,
  p_business jsonb,
  p_branches jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    insert into public.company_branches(company_id, name, city, is_primary, status)
    values (created.id, btrim(branch->>'name'), btrim(branch->>'city'), false, 'setup')
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
$$;

revoke all on function public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)
  from public, anon;
grant execute on function public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)
  to authenticated;

-- Final footprint assertion for this migration apply (unique restored; broker may exist from WP01A).
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and t.relname = 'es02_account_orders'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ~* 'account_id'
      and pg_get_constraintdef(c.oid) ~* 'client_op_id'
  ) and not exists (
    select 1 from pg_indexes
    where schemaname = 'private'
      and tablename = 'es02_account_orders'
      and indexdef ~* 'UNIQUE'
      and indexdef ~* 'account_id'
      and indexdef ~* 'client_op_id'
  ) then
    raise exception 'ES02_C2_FOOTPRINT: unique(account_id,client_op_id) missing after restore';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;

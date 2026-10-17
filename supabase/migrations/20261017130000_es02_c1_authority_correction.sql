-- ES02-C1 authority correction (forward additive).
-- Catalog-validated per-branch slots; native/session tip fence; fixture-only synthetic;
-- primary-branch reuse under enterprise_primary_branch; readiness fail-closed; no paid-day loss.
-- Deny-safe rollback: revoke EXECUTE on public.es02_* / leave tables; never restore caller-priced create.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Branch city on current enterprise schema (no smart_* resurrection).
alter table public.company_branches
  add column if not exists city text not null default '';

alter table private.es02_account_orders
  add column if not exists slots jsonb not null default '[]'::jsonb;

create table if not exists private.es02_branch_slot_rights (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.es02_account_orders(id),
  company_id uuid not null references public.companies(id),
  branch_id uuid not null,
  slot_index integer not null check (slot_index >= 0),
  persona text not null check (persona in ('level_1','level_2','level_3')),
  package text not null check (package in ('basic','premium')),
  term text not null check (term in ('monthly','yearly')),
  amount_baisa integer not null check (amount_baisa > 0),
  replies_per_month integer not null check (replies_per_month > 0),
  employees integer not null check (employees > 0),
  channels integer not null check (channels > 0),
  branch_city text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  unique (order_id, slot_index),
  unique (company_id, branch_id),
  foreign key (company_id, branch_id) references public.company_branches(company_id, id)
);

alter table private.es02_branch_slot_rights enable row level security;
revoke all on table private.es02_branch_slot_rights from public, anon, authenticated;
grant all on table private.es02_branch_slot_rights to service_role;

-- Remove unused advertised synthetic gate (C3).
drop function if exists public.es02_set_synthetic_gate(boolean);
drop table if exists private.es02_gates;

-- Approved commercial BASE matrix (revision 2026-10-14). Caller amounts never trusted.
create or replace function private.es02_catalog_slot(
  p_persona text,
  p_package text,
  p_term text
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  monthly integer;
  replies integer;
  employees integer;
  channels integer;
  amount integer;
begin
  if p_persona = 'level_1' and p_package = 'basic' then
    monthly := 45000; replies := 1000; employees := 2; channels := 1;
  elsif p_persona = 'level_1' and p_package = 'premium' then
    monthly := 90000; replies := 3000; employees := 4; channels := 2;
  elsif p_persona = 'level_2' and p_package = 'basic' then
    monthly := 65000; replies := 2000; employees := 2; channels := 1;
  elsif p_persona = 'level_2' and p_package = 'premium' then
    monthly := 120000; replies := 6000; employees := 4; channels := 2;
  elsif p_persona = 'level_3' and p_package = 'basic' then
    monthly := 75000; replies := 3000; employees := 2; channels := 1;
  elsif p_persona = 'level_3' and p_package = 'premium' then
    monthly := 150000; replies := 10000; employees := 4; channels := 2;
  else
    return null;
  end if;
  if p_term = 'monthly' then amount := monthly;
  elsif p_term = 'yearly' then amount := (monthly * 12 * 80) / 100;
  else return null;
  end if;
  return jsonb_build_object(
    'persona', p_persona,
    'package', p_package,
    'term', p_term,
    'amount_baisa', amount,
    'replies_per_month', replies,
    'employees', employees,
    'channels', channels
  );
end;
$$;

revoke all on function private.es02_catalog_slot(text,text,text) from public, anon, authenticated;

create or replace function private.es02_resolve_slots(p_term text, p_slots jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  elem jsonb;
  slot jsonb;
  out_slots jsonb := '[]'::jsonb;
  total integer := 0;
  replies integer := 0;
  employees integer := 0;
  channels integer := 0;
  idx integer := 0;
begin
  if p_term not in ('monthly','yearly') or p_slots is null or jsonb_typeof(p_slots) is distinct from 'array'
     or jsonb_array_length(p_slots) < 1 or jsonb_array_length(p_slots) > 32 then
    return null;
  end if;
  for elem in select value from jsonb_array_elements(p_slots) as t(value)
  loop
    slot := private.es02_catalog_slot(elem->>'persona', elem->>'package', p_term);
    if slot is null then return null; end if;
    total := total + (slot->>'amount_baisa')::integer;
    replies := replies + (slot->>'replies_per_month')::integer;
    employees := employees + (slot->>'employees')::integer;
    channels := channels + (slot->>'channels')::integer;
    out_slots := out_slots || jsonb_build_array(jsonb_build_object(
      'slotIndex', idx,
      'persona', slot->>'persona',
      'package', slot->>'package',
      'amountBaisa', (slot->>'amount_baisa')::integer,
      'repliesPerMonth', (slot->>'replies_per_month')::integer,
      'employees', (slot->>'employees')::integer,
      'channels', (slot->>'channels')::integer
    ));
    idx := idx + 1;
  end loop;
  return jsonb_build_object(
    'catalogRevision', '2026-10-14',
    'term', p_term,
    'slots', out_slots,
    'branchSlots', idx,
    'amountBaisa', total,
    'currency', 'OMR',
    'purpose', 'initial_subscription',
    'productCode', 'velora_subscription',
    'repliesPerMonth', replies,
    'employees', employees,
    'channels', channels,
    'persona', out_slots->0->>'persona',
    'package', out_slots->0->>'package'
  );
end;
$$;

revoke all on function private.es02_resolve_slots(text,jsonb) from public, anon, authenticated;

-- Native expiry + optional broker tip root fence (ES01 contract reuse).
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
  tip_user uuid;
  root_registry uuid;
  root_state text;
  root_valid timestamptz;
begin
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

  -- When broker registry is present, tip must match JWT native sid (root lock).
  if to_regclass('public.vel_broker_sessions') is not null
     and to_regclass('public.vel_broker_browser_lineages') is not null then
    execute $q$
      select id, browser_lineage_id, native_session_id, status, user_id
      from public.vel_broker_sessions
      where native_session_id = $1 and user_id = $2 and status = 'active'
      order by last_seen_at desc nulls last
      limit 1
    $q$ into tip_id, tip_lineage, tip_native, tip_status, tip_user using sid, actor;
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
  end if;

  return actor;
end;
$$;

revoke all on function private.es02_require_active_actor(uuid) from public, anon, authenticated;

create or replace function private.es02_order_view(o private.es02_account_orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'orderId', o.id,
    'accountId', o.account_id,
    'status', o.status,
    'offer', case
      when o.slots is not null and jsonb_array_length(o.slots) > 0 then
        private.es02_resolve_slots(o.term, (
          select jsonb_agg(jsonb_build_object('persona', s->>'persona', 'package', s->>'package') order by (s->>'slotIndex')::int)
          from jsonb_array_elements(o.slots) s
        ))
      else private.es02_resolve_slots(o.term, jsonb_build_array(jsonb_build_object('persona', o.persona, 'package', o.package)))
    end,
    'specialReference', o.special_reference,
    'paymentAttemptId', o.payment_attempt_id,
    'environment', o.environment,
    'settledAt', o.settled_at,
    'provisionedCompanyId', o.provisioned_company_id,
    'originalOrderGroupId', o.original_order_group_id
  );
$$;

revoke all on function private.es02_order_view(private.es02_account_orders) from public, anon, authenticated;

drop function if exists public.es02_create_account_order(
  uuid,uuid,bigint,text,text,text,text,integer,integer,integer,integer,integer,boolean
);

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
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select * into prior
  from private.es02_account_orders
  where account_id = actor and client_op_id = p_client_op_id
  for update;

  if prior.id is not null then
    if prior.offer_fingerprint is distinct from fp then
      return jsonb_build_object('ok', false, 'code', 'OFFER_TAMPER');
    end if;
    return jsonb_build_object('ok', true, 'action', 'reuse', 'data', private.es02_order_view(prior));
  end if;

  -- Do not silently reuse a different open offer when selection changes.
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

-- Fixture-only synthetic settle: requires velora.es02_fixture=on (owned harness).
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

create or replace function public.es02_settle_account_order_paymob_hmac(p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  return jsonb_build_object('ok', false, 'code', 'PAYMOB_EXTERNAL_DEFERRED');
end;
$$;

revoke all on function public.es02_settle_account_order_paymob_hmac(jsonb)
  from public, anon, authenticated;
grant execute on function public.es02_settle_account_order_paymob_hmac(jsonb) to service_role;

-- Provision: reuse enterprise primary branch; bind slot rights; once-only under lock.
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
  idx integer := 0;
  branch_count integer;
  offer jsonb;
  paid_at timestamptz;
  deadline timestamptz;
  new_branch_id uuid;
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
  if o.status is distinct from 'settled' and o.status is distinct from 'provisioning' then
    return jsonb_build_object('ok', false, 'code', 'NOT_SETTLED');
  end if;
  if branch_count is distinct from o.branch_slots then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  offer := (private.es02_order_view(o))->'offer';
  if offer is null or (offer->>'branchSlots')::integer is distinct from branch_count then
    return jsonb_build_object('ok', false, 'code', 'OFFER_TAMPER');
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

  update private.es02_account_orders
  set status = 'provisioning', updated_at = clock_timestamp()
  where id = o.id;

  if prior.order_id is null then
    insert into private.es02_account_provisioning(order_id, account_id, state, idempotency_key)
    values (o.id, actor, 'pending', p_idempotency_key);
  end if;

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

  -- enterprise_primary_branch already inserted primary; update it (do not insert a second primary).
  select * into primary_branch from public.company_branches
  where company_id = created.id and is_primary = true
  for update;
  if primary_branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
  end if;

  branch := p_branches->0;
  slot := offer->'slots'->0;
  if coalesce(btrim(branch->>'name'), '') = '' or coalesce(btrim(branch->>'city'), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
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
    if coalesce(btrim(branch->>'name'), '') = '' or coalesce(btrim(branch->>'city'), '') = '' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
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

  -- Bind company into existing subscription ledger (awaiting readiness/paid_through).
  if to_regclass('public.billing_subscriptions') is not null then
    begin
      insert into public.billing_subscriptions(company_id, status, paid_through)
      values (created.id, 'awaiting_payment', null)
      on conflict (company_id) do nothing;
    exception when others then
      null; -- ledger shape variance must not undo slot rights / activation foundation above
    end;
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
    if o.provisioned_company_id is not null then
      return jsonb_build_object(
        'ok', true, 'action', 'reuse',
        'data', jsonb_build_object(
          'companyId', o.provisioned_company_id,
          'orderId', o.id,
          'orderGroupId', o.original_order_group_id
        )
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

revoke all on function public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)
  from public, anon;
grant execute on function public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)
  to authenticated;

drop function if exists public.es02_reconcile_activation_readiness(uuid,uuid,boolean,boolean);

-- Readiness from server/native facts only — never owner booleans. No paid-day backdate.
create or replace function public.es02_reconcile_activation_readiness(
  p_expected_account_id uuid,
  p_company_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  a private.es02_activation_foundation;
  o private.es02_account_orders;
  channel_ready boolean := false;
  ai_ready boolean := false;
  started timestamptz;
  through timestamptz;
begin
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if not exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = actor
      and m.role = 'owner' and m.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into a from private.es02_activation_foundation
  where company_id = p_company_id for update;
  if a.company_id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
  end if;
  select * into o from private.es02_account_orders where id = a.order_id;

  -- Verified operational facts only (fail-closed when ports absent/unready).
  if to_regclass('public.whatsapp_company_links') is not null then
    begin
      execute $q$select exists(
        select 1 from public.whatsapp_company_links
        where company_id = $1 and coalesce(status,'') in ('active','connected','ready')
      )$q$ into channel_ready using p_company_id;
    exception when others then channel_ready := false;
    end;
  end if;
  if not channel_ready and to_regclass('public.instagram_company_links') is not null then
    begin
      execute $q$select exists(
        select 1 from public.instagram_company_links
        where company_id = $1 and coalesce(status,'') in ('active','connected','ready')
      )$q$ into channel_ready using p_company_id;
    exception when others then channel_ready := false;
    end;
  end if;
  if to_regprocedure('private.master_activation_ready(uuid,uuid)') is not null then
    begin
      execute 'select private.master_activation_ready($1,$2)' into ai_ready using p_company_id, a.order_id;
    exception when others then ai_ready := false;
    end;
  end if;

  update private.es02_activation_foundation set
    first_channel_ready = channel_ready,
    actual_ai_ready = ai_ready,
    updated_at = clock_timestamp()
  where company_id = p_company_id
  returning * into a;

  if a.clock_state = 'waiting_readiness' and channel_ready and ai_ready then
    -- Start at readiness observation — never backdate to activation deadline (no paid-day loss).
    started := clock_timestamp();
    through := case
      when o.term = 'yearly' then started + interval '1 year' + interval '7 days'
      else started + interval '1 month' + interval '7 days'
    end;
    update private.es02_activation_foundation set
      clock_state = 'active',
      operational_ready = true,
      subscription_started_at = started,
      paid_through_at = through,
      updated_at = clock_timestamp()
    where company_id = p_company_id
    returning * into a;
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'companyId', a.company_id,
      'orderGroupId', a.order_group_id,
      'paymentConfirmedAt', a.payment_confirmed_at,
      'entitlementCreatedAt', a.entitlement_created_at,
      'activationDeadlineAt', a.activation_deadline_at,
      'bonusDays', a.bonus_days,
      'renewalGraceDays', a.renewal_grace_days,
      'termUnit', a.term_unit,
      'termCount', 1,
      'clockState', a.clock_state,
      'firstChannelReady', a.first_channel_ready,
      'actualAiReady', a.actual_ai_ready,
      'operationalReady', a.operational_ready,
      'subscriptionStartedAt', a.subscription_started_at,
      'paidThroughAt', a.paid_through_at
    )
  );
end;
$$;

revoke all on function public.es02_reconcile_activation_readiness(uuid,uuid) from public, anon;
grant execute on function public.es02_reconcile_activation_readiness(uuid,uuid) to authenticated;

create or replace function public.es02_read_activation_foundation(
  p_expected_account_id uuid,
  p_company_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  a private.es02_activation_foundation;
begin
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if not exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = actor
      and m.role = 'owner' and m.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  select * into a from private.es02_activation_foundation where company_id = p_company_id;
  if a.company_id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
  end if;
  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'companyId', a.company_id,
      'orderGroupId', a.order_group_id,
      'paymentConfirmedAt', a.payment_confirmed_at,
      'entitlementCreatedAt', a.entitlement_created_at,
      'activationDeadlineAt', a.activation_deadline_at,
      'bonusDays', a.bonus_days,
      'renewalGraceDays', a.renewal_grace_days,
      'termUnit', a.term_unit,
      'termCount', 1,
      'clockState', a.clock_state,
      'firstChannelReady', a.first_channel_ready,
      'actualAiReady', a.actual_ai_ready,
      'operationalReady', a.operational_ready,
      'subscriptionStartedAt', a.subscription_started_at,
      'paidThroughAt', a.paid_through_at
    )
  );
end;
$$;

revoke all on function public.es02_read_activation_foundation(uuid,uuid) from public, anon;
grant execute on function public.es02_read_activation_foundation(uuid,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

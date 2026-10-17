-- ES02 account-bound purchase authority (WP02/WP03/WP07A foundation).
-- ONE SQL/ledger writer for account orders → settlement → once-only provisioning → activation foundation.
-- Stable auth.uid() owns orders; email/browser hints never authorize.
-- PAYMOB_EXTERNAL_VERIFICATION: Deferred. Synthetic settle is service_role + gate + test env only.
-- Pre/post: additive tables/RPCs; deny-safe rollback = revoke EXECUTE + leave tables (no unpaid grant restore).
-- search_path='' on all definer functions. No Production apply by Cursor.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create schema if not exists private;

create table if not exists private.es02_gates (
  name text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
insert into private.es02_gates(name, enabled) values ('synthetic_local', false)
  on conflict (name) do nothing;

revoke all on table private.es02_gates from public, anon, authenticated;
grant select, update on table private.es02_gates to service_role;

create table if not exists private.es02_account_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id),
  status text not null check (status in (
    'open','collection_pending','settled','provisioning','provisioned','failed','cancelled'
  )),
  purpose text not null check (purpose = 'initial_subscription'),
  product_code text not null check (product_code = 'velora_subscription'),
  catalog_revision text not null,
  persona text not null check (persona in ('level_1','level_2','level_3')),
  package text not null check (package in ('basic','premium')),
  term text not null check (term in ('monthly','yearly')),
  amount_baisa integer not null check (amount_baisa > 0),
  currency text not null check (currency = 'OMR'),
  replies_per_month integer not null check (replies_per_month > 0),
  employees integer not null check (employees > 0),
  channels integer not null check (channels > 0),
  branch_slots integer not null check (branch_slots > 0),
  offer_fingerprint text not null,
  special_reference text not null unique,
  payment_attempt_id uuid not null unique default gen_random_uuid(),
  client_op_id uuid not null,
  capture_generation bigint not null check (capture_generation >= 0),
  consent_accepted_at timestamptz not null default clock_timestamp(),
  environment text not null check (environment in ('test','live')),
  original_order_group_id uuid not null default gen_random_uuid(),
  settled_at timestamptz,
  settlement_authority text check (
    settlement_authority is null
    or settlement_authority in ('synthetic_local','paymob_hmac')
  ),
  provider_transaction_id text,
  provisioned_company_id uuid references public.companies(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (account_id, client_op_id)
);

create index if not exists es02_account_orders_account_status
  on private.es02_account_orders(account_id, status);

create table if not exists private.es02_account_settlement_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.es02_account_orders(id),
  account_id uuid not null references auth.users(id),
  evidence_marker text not null,
  provider_transaction_id text not null,
  amount_baisa integer not null,
  currency text not null check (currency = 'OMR'),
  outcome text not null check (outcome in ('applied','duplicate','rejected')),
  detail_code text,
  created_at timestamptz not null default clock_timestamp(),
  unique (order_id, provider_transaction_id)
);

create table if not exists private.es02_account_provisioning (
  order_id uuid primary key references private.es02_account_orders(id),
  account_id uuid not null references auth.users(id),
  company_id uuid references public.companies(id),
  state text not null check (state in ('pending','completed')),
  idempotency_key uuid not null unique,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists private.es02_activation_foundation (
  company_id uuid primary key references public.companies(id),
  order_id uuid not null unique references private.es02_account_orders(id),
  order_group_id uuid not null,
  account_id uuid not null references auth.users(id),
  payment_confirmed_at timestamptz not null,
  entitlement_created_at timestamptz not null,
  activation_deadline_at timestamptz not null,
  bonus_days integer not null check (bonus_days = 7),
  renewal_grace_days integer not null check (renewal_grace_days = 3),
  term_unit text not null check (term_unit in ('month','year')),
  clock_state text not null check (clock_state in ('waiting_readiness','active','ended')),
  first_channel_ready boolean not null default false,
  actual_ai_ready boolean not null default false,
  operational_ready boolean not null default false,
  subscription_started_at timestamptz,
  paid_through_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists private.es02_credit_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  order_group_id uuid not null,
  kind text not null check (kind in ('base','purchased')),
  granted integer not null check (granted >= 0),
  remaining integer not null check (remaining >= 0),
  ordinary_expiry timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, order_group_id, kind)
);

alter table private.es02_account_orders enable row level security;
alter table private.es02_account_settlement_events enable row level security;
alter table private.es02_account_provisioning enable row level security;
alter table private.es02_activation_foundation enable row level security;
alter table private.es02_credit_balances enable row level security;

revoke all on table private.es02_account_orders from public, anon, authenticated;
revoke all on table private.es02_account_settlement_events from public, anon, authenticated;
revoke all on table private.es02_account_provisioning from public, anon, authenticated;
revoke all on table private.es02_activation_foundation from public, anon, authenticated;
revoke all on table private.es02_credit_balances from public, anon, authenticated;
grant all on table private.es02_account_orders to service_role;
grant all on table private.es02_account_settlement_events to service_role;
grant all on table private.es02_account_provisioning to service_role;
grant all on table private.es02_activation_foundation to service_role;
grant all on table private.es02_credit_balances to service_role;

create or replace function private.es02_offer_fingerprint(
  p_catalog_revision text,
  p_persona text,
  p_package text,
  p_term text,
  p_amount_baisa integer,
  p_replies integer,
  p_employees integer,
  p_channels integer,
  p_branch_slots integer
) returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws('|',
    p_catalog_revision, p_persona, p_package, p_term,
    p_amount_baisa::text, 'OMR', p_replies::text, p_employees::text,
    p_channels::text, p_branch_slots::text, 'initial_subscription', 'velora_subscription'
  );
$$;

revoke all on function private.es02_offer_fingerprint(text,text,text,text,integer,integer,integer,integer,integer)
  from public, anon, authenticated;

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
    'offer', jsonb_build_object(
      'catalogRevision', o.catalog_revision,
      'persona', o.persona,
      'package', o.package,
      'term', o.term,
      'amountBaisa', o.amount_baisa,
      'currency', o.currency,
      'repliesPerMonth', o.replies_per_month,
      'employees', o.employees,
      'channels', o.channels,
      'branchSlots', o.branch_slots,
      'purpose', o.purpose,
      'productCode', o.product_code
    ),
    'specialReference', o.special_reference,
    'paymentAttemptId', o.payment_attempt_id,
    'environment', o.environment,
    'settledAt', o.settled_at,
    'provisionedCompanyId', o.provisioned_company_id,
    'originalOrderGroupId', o.original_order_group_id
  );
$$;

revoke all on function private.es02_order_view(private.es02_account_orders) from public, anon, authenticated;

-- Create or reuse open account-bound order (authenticated JWT account).
create or replace function public.es02_create_account_order(
  p_expected_account_id uuid,
  p_client_op_id uuid,
  p_capture_generation bigint,
  p_catalog_revision text,
  p_persona text,
  p_package text,
  p_term text,
  p_amount_baisa integer,
  p_replies_per_month integer,
  p_employees integer,
  p_channels integer,
  p_branch_slots integer,
  p_consent_accepted boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  prior private.es02_account_orders;
  created private.es02_account_orders;
  fp text;
  special text;
begin
  if actor is null or p_expected_account_id is distinct from actor then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = actor and u.email_confirmed_at is not null
  ) then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if p_client_op_id is null
     or p_capture_generation is null or p_capture_generation < 0
     or p_consent_accepted is distinct from true
     or p_catalog_revision is null
     or p_persona not in ('level_1','level_2','level_3')
     or p_package not in ('basic','premium')
     or p_term not in ('monthly','yearly')
     or p_amount_baisa is null or p_amount_baisa < 1
     or p_replies_per_month is null or p_replies_per_month < 1
     or p_employees is null or p_employees < 1
     or p_channels is null or p_channels < 1
     or p_branch_slots is null or p_branch_slots < 1
     or p_branch_slots is distinct from p_channels then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  fp := private.es02_offer_fingerprint(
    p_catalog_revision, p_persona, p_package, p_term,
    p_amount_baisa, p_replies_per_month, p_employees, p_channels, p_branch_slots
  );

  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':es02-order', 0));

  select * into prior
  from private.es02_account_orders
  where account_id = actor and client_op_id = p_client_op_id
  for update;

  if prior.id is not null then
    if prior.offer_fingerprint is distinct from fp
       or prior.capture_generation is distinct from p_capture_generation then
      return jsonb_build_object('ok', false, 'code', 'STALE_CAPTURE');
    end if;
    return jsonb_build_object(
      'ok', true,
      'action', 'reuse',
      'data', private.es02_order_view(prior)
    );
  end if;

  -- One open/collection initial order per account at a time.
  if exists (
    select 1 from private.es02_account_orders
    where account_id = actor
      and purpose = 'initial_subscription'
      and status in ('open','collection_pending','settled','provisioning')
  ) then
    select * into prior from private.es02_account_orders
    where account_id = actor
      and purpose = 'initial_subscription'
      and status in ('open','collection_pending','settled','provisioning')
    order by created_at desc
    limit 1;
    return jsonb_build_object(
      'ok', true,
      'action', 'reuse',
      'data', private.es02_order_view(prior)
    );
  end if;

  special := 'ES02-' || replace(gen_random_uuid()::text, '-', '');

  insert into private.es02_account_orders (
    account_id, status, purpose, product_code, catalog_revision,
    persona, package, term, amount_baisa, currency,
    replies_per_month, employees, channels, branch_slots,
    offer_fingerprint, special_reference, client_op_id,
    capture_generation, environment
  ) values (
    actor, 'open', 'initial_subscription', 'velora_subscription', p_catalog_revision,
    p_persona, p_package, p_term, p_amount_baisa, 'OMR',
    p_replies_per_month, p_employees, p_channels, p_branch_slots,
    fp, special, p_client_op_id, p_capture_generation, 'test'
  ) returning * into created;

  return jsonb_build_object(
    'ok', true,
    'action', 'insert',
    'data', private.es02_order_view(created)
  );
end;
$$;

revoke all on function public.es02_create_account_order(
  uuid,uuid,bigint,text,text,text,text,integer,integer,integer,integer,integer,boolean
) from public, anon;
grant execute on function public.es02_create_account_order(
  uuid,uuid,bigint,text,text,text,text,integer,integer,integer,integer,integer,boolean
) to authenticated;

create or replace function public.es02_read_owned_purchase(
  p_expected_account_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  o private.es02_account_orders;
begin
  if actor is null or p_expected_account_id is distinct from actor then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  select * into o from private.es02_account_orders
  where account_id = actor
    and purpose = 'initial_subscription'
    and status in ('settled','provisioning','provisioned')
  order by
    case status when 'settled' then 0 when 'provisioning' then 1 else 2 end,
    created_at desc
  limit 1;
  if o.id is null then
    return jsonb_build_object('ok', true, 'data', null);
  end if;
  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'accountId', o.account_id,
      'orderId', o.id,
      'status', case
        when o.status = 'provisioned' then 'provisioned'
        else 'settled_unprovisioned'
      end,
      'specialReference', o.special_reference,
      'companyId', o.provisioned_company_id,
      'offer', jsonb_build_object(
        'catalogRevision', o.catalog_revision,
        'persona', o.persona,
        'package', o.package,
        'term', o.term,
        'amountBaisa', o.amount_baisa,
        'currency', o.currency,
        'repliesPerMonth', o.replies_per_month,
        'employees', o.employees,
        'channels', o.channels,
        'branchSlots', o.branch_slots,
        'purpose', o.purpose,
        'productCode', o.product_code
      )
    )
  );
end;
$$;

revoke all on function public.es02_read_owned_purchase(uuid) from public, anon;
grant execute on function public.es02_read_owned_purchase(uuid) to authenticated;

-- Synthetic local settlement — service_role only; gate + test environment required.
create or replace function public.es02_settle_account_order_synthetic(
  p_evidence jsonb
) returns jsonb
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
  -- Dual fence with Node: service_role only + test-environment orders.
  -- Authenticated never granted. Production Node must not call this RPC.
  -- Optional gate may be forced off for extra local lockout (default false unused here).
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  marker := p_evidence->>'evidence_marker';
  if marker is distinct from 'VEL_ES02_SYNTHETIC_LOCAL_ONLY'
     or (p_evidence->'authenticity'->>'source') is distinct from 'es02_synthetic_local'
     or (p_evidence->'authenticity'->>'method') is distinct from 'synthetic_local_only'
     or (p_evidence->>'currency') is distinct from 'OMR'
     or (p_evidence->>'event_status') is distinct from 'success' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  begin
    amt := (p_evidence->>'amount_baisa')::integer;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end;
  txn := p_evidence->>'provider_transaction_id';
  if txn is null or length(txn) < 4 or amt is null or amt < 1 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select * into o from private.es02_account_orders
  where id = (p_evidence->>'order_id')::uuid
  for update;
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
    return jsonb_build_object(
      'ok', true,
      'action', 'duplicate',
      'data', private.es02_order_view(o)
    );
  end if;

  if o.status in ('settled','provisioning','provisioned') then
    insert into private.es02_account_settlement_events(
      order_id, account_id, evidence_marker, provider_transaction_id,
      amount_baisa, currency, outcome, detail_code
    ) values (
      o.id, o.account_id, marker, txn, amt, 'OMR', 'duplicate', 'already_settled'
    ) on conflict (order_id, provider_transaction_id) do nothing;
    return jsonb_build_object(
      'ok', true,
      'action', 'duplicate',
      'data', private.es02_order_view(o)
    );
  end if;

  if o.status not in ('open','collection_pending') then
    return jsonb_build_object('ok', false, 'code', 'NOT_SETTLED');
  end if;

  update private.es02_account_orders set
    status = 'settled',
    settled_at = clock_timestamp(),
    settlement_authority = 'synthetic_local',
    provider_transaction_id = txn,
    updated_at = clock_timestamp()
  where id = o.id
  returning * into o;

  insert into private.es02_account_settlement_events(
    order_id, account_id, evidence_marker, provider_transaction_id,
    amount_baisa, currency, outcome, detail_code
  ) values (
    o.id, o.account_id, marker, txn, amt, 'OMR', 'applied', null
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'settled',
    'data', private.es02_order_view(o)
  );
end;
$$;

revoke all on function public.es02_settle_account_order_synthetic(jsonb)
  from public, anon, authenticated;
grant execute on function public.es02_settle_account_order_synthetic(jsonb) to service_role;

-- Paymob HMAC settlement boundary — Deferred external verification; rejects until configured.
create or replace function public.es02_settle_account_order_paymob_hmac(
  p_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  -- External company/Sandbox/webhook verification is Deferred; do not grant paid rights here.
  return jsonb_build_object('ok', false, 'code', 'PAYMOB_EXTERNAL_DEFERRED');
end;
$$;

revoke all on function public.es02_settle_account_order_paymob_hmac(jsonb)
  from public, anon, authenticated;
grant execute on function public.es02_settle_account_order_paymob_hmac(jsonb) to service_role;

-- Once-only provisioning from owned settled purchase (business fields entered now, not prepayment).
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
  actor uuid := auth.uid();
  o private.es02_account_orders;
  prior private.es02_account_provisioning;
  created public.companies;
  branch jsonb;
  idx integer := 0;
  branch_count integer;
  deadline timestamptz;
  paid_at timestamptz;
begin
  if actor is null or p_expected_account_id is distinct from actor then
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

  select * into o from private.es02_account_orders
  where id = p_order_id
  for update;
  if o.id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if o.account_id is distinct from actor then
    return jsonb_build_object('ok', false, 'code', 'FOREIGN_OWNER');
  end if;
  if o.status = 'provisioned' and o.provisioned_company_id is not null then
    select * into prior from private.es02_account_provisioning where order_id = o.id;
    select * into created from public.companies where id = o.provisioned_company_id;
    return jsonb_build_object(
      'ok', true,
      'action', 'reuse',
      'data', jsonb_build_object(
        'companyId', created.id,
        'orderId', o.id,
        'orderGroupId', o.original_order_group_id
      )
    );
  end if;
  if o.status is distinct from 'settled' and o.status is distinct from 'provisioning' then
    return jsonb_build_object('ok', false, 'code', 'NOT_SETTLED');
  end if;
  if branch_count > o.branch_slots then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select * into prior from private.es02_account_provisioning
  where order_id = o.id
  for update;
  if prior.order_id is not null and prior.state = 'completed' and prior.company_id is not null then
    return jsonb_build_object(
      'ok', true,
      'action', 'reuse',
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
  elsif prior.idempotency_key is distinct from p_idempotency_key then
    -- Same order: accept only matching idempotency or reuse completed.
    null;
  end if;

  insert into public.companies(
    display_name, business_type, country, reply_language, city, hours,
    contact_phone, contact_email, created_by, status
  ) values (
    btrim(p_business->>'name'),
    btrim(p_business->>'type'),
    btrim(p_business->>'country'),
    coalesce(nullif(p_business->>'replyLanguage', ''), 'both'),
    btrim(p_business->>'city'),
    coalesce(nullif(p_business->>'hours', ''), ''),
    btrim(p_business->>'phone'),
    coalesce(nullif(p_business->>'email', ''), ''),
    actor,
    'setup'
  ) returning * into created;

  insert into public.company_members(company_id, user_id, role, status, member_name)
  values (created.id, actor, 'owner', 'active', created.display_name);

  for branch in select * from jsonb_array_elements(p_branches)
  loop
    if coalesce(btrim(branch->>'name'), '') = '' then
      raise exception 'INVALID_BRANCH' using errcode = '22023';
    end if;
    insert into public.company_branches(company_id, name, is_primary, status)
    values (
      created.id,
      btrim(branch->>'name'),
      idx = 0,
      'setup'
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
    paid_at, clock_timestamp(), deadline,
    7, 3,
    case when o.term = 'yearly' then 'year' else 'month' end,
    'waiting_readiness'
  );

  insert into private.es02_credit_balances(company_id, order_group_id, kind, granted, remaining, ordinary_expiry)
  values (created.id, o.original_order_group_id, 'base', o.replies_per_month, o.replies_per_month, null);

  update private.es02_account_orders set
    status = 'provisioned',
    provisioned_company_id = created.id,
    updated_at = clock_timestamp()
  where id = o.id;

  update private.es02_account_provisioning set
    state = 'completed',
    company_id = created.id,
    completed_at = clock_timestamp()
  where order_id = o.id;

  return jsonb_build_object(
    'ok', true,
    'action', 'provisioned',
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
        'ok', true,
        'action', 'reuse',
        'data', jsonb_build_object(
          'companyId', o.provisioned_company_id,
          'orderId', o.id,
          'orderGroupId', o.original_order_group_id
        )
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
  when others then
    if sqlerrm = 'INVALID_BRANCH' or sqlstate = '22023' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

revoke all on function public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)
  from public, anon;
grant execute on function public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)
  to authenticated;

create or replace function public.es02_read_activation_foundation(
  p_expected_account_id uuid,
  p_company_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  a private.es02_activation_foundation;
begin
  if actor is null or p_expected_account_id is distinct from actor then
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

-- Readiness reconcile: only BOTH first-channel AND actual AI start INITIAL clock (no fabrication).
create or replace function public.es02_reconcile_activation_readiness(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_first_channel_ready boolean,
  p_actual_ai_ready boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  a private.es02_activation_foundation;
  o private.es02_account_orders;
  started timestamptz;
  through timestamptz;
begin
  if actor is null or p_expected_account_id is distinct from actor then
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
  where company_id = p_company_id
  for update;
  if a.company_id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
  end if;
  select * into o from private.es02_account_orders where id = a.order_id;

  update private.es02_activation_foundation set
    first_channel_ready = coalesce(p_first_channel_ready, false),
    actual_ai_ready = coalesce(p_actual_ai_ready, false),
    updated_at = clock_timestamp()
  where company_id = p_company_id
  returning * into a;

  if a.clock_state = 'waiting_readiness'
     and a.first_channel_ready is true
     and a.actual_ai_ready is true then
    started := case
      when clock_timestamp() > a.activation_deadline_at then a.activation_deadline_at
      else clock_timestamp()
    end;
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

revoke all on function public.es02_reconcile_activation_readiness(uuid,uuid,boolean,boolean)
  from public, anon;
grant execute on function public.es02_reconcile_activation_readiness(uuid,uuid,boolean,boolean)
  to authenticated;

-- Test-only gate flipper: service_role only; never grant to authenticated.
create or replace function public.es02_set_synthetic_gate(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  update private.es02_gates
  set enabled = coalesce(p_enabled, false), updated_at = clock_timestamp()
  where name = 'synthetic_local';
  return jsonb_build_object('ok', true, 'enabled', coalesce(p_enabled, false));
end;
$$;

revoke all on function public.es02_set_synthetic_gate(boolean)
  from public, anon, authenticated;
grant execute on function public.es02_set_synthetic_gate(boolean) to service_role;

notify pgrst, 'reload schema';
commit;

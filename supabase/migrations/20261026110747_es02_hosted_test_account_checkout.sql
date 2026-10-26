-- REVIEW CANDIDATE ONLY. Not applied. Paymob Test account-first checkout.
-- No Live mode, no synthetic success, no changes to existing auth guards.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function private.es02_test_resolve_slots(p_term text,p_slots jsonb,p_revision text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare offer jsonb; slots jsonb := '[]'::jsonb; slot jsonb; extra integer := 0; delta integer;
begin
 if p_revision not in ('2026-10-14','2026-10-24') or p_revision is null then return null; end if;
 offer := private.es02_resolve_slots(p_term,p_slots);
 if offer is null or p_revision='2026-10-14' then return offer; end if;
 delta := case when p_term='yearly' then 144000 else 15000 end;
 for slot in select value from jsonb_array_elements(offer->'slots') loop
  if slot->>'persona'='level_3' and slot->>'package'='basic' then
   slot := jsonb_set(slot,'{amountBaisa}',to_jsonb((slot->>'amountBaisa')::integer+delta));
   extra := extra+delta;
  end if;
  slots := slots || jsonb_build_array(slot);
 end loop;
 if extra=0 then return null; end if;
 return offer || jsonb_build_object('catalogRevision',p_revision,'slots',slots,'amountBaisa',(offer->>'amountBaisa')::integer+extra);
end $$;

create or replace function private.es02_test_order_view(o private.es02_account_orders)
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
  canonical := private.es02_test_resolve_slots(o.term, sel, o.catalog_revision);
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

create or replace function private.es02_test_order_catalog_consistent(o private.es02_account_orders)
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
  expected := private.es02_test_resolve_slots(o.term, sel, o.catalog_revision);
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

create or replace function private.es02_create_test_account_order(
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
  if actor is null or not private.es02_authority_footprint_ok() then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if p_client_op_id is null or p_consent_accepted is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  offer := private.es02_test_resolve_slots(p_term, p_slots, case when p_slots @> '[{"persona":"level_3","package":"basic"}]'::jsonb then '2026-10-24' else '2026-10-14' end);
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
    if prior.catalog_revision is distinct from offer->>'catalogRevision' then
      return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');
    end if;
    if prior.offer_fingerprint is distinct from fp then
      return jsonb_build_object('ok', false, 'code', 'OFFER_TAMPER');
    end if;
    return jsonb_build_object('ok', true, 'action', 'reuse', 'data', private.es02_test_order_view(prior));
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
    return jsonb_build_object('ok', true, 'action', 'reuse', 'data', private.es02_test_order_view(prior));
  end if;

  special := 'ES02-' || replace(gen_random_uuid()::text, '-', '');
  insert into private.es02_account_orders (
    account_id, status, purpose, product_code, catalog_revision,
    persona, package, term, amount_baisa, currency,
    replies_per_month, employees, channels, branch_slots,
    offer_fingerprint, special_reference, client_op_id,
    capture_generation, environment, slots
  ) values (
    actor, 'open', 'initial_subscription', 'velora_subscription', offer->>'catalogRevision',
    primary_slot->>'persona', primary_slot->>'package', p_term,
    (offer->>'amountBaisa')::integer, 'OMR',
    (offer->>'repliesPerMonth')::integer, (offer->>'employees')::integer,
    (offer->>'channels')::integer, (offer->>'branchSlots')::integer,
    fp, special, p_client_op_id, 0, 'test', offer->'slots'
  ) returning * into created;

  return jsonb_build_object('ok', true, 'action', 'insert', 'data', private.es02_test_order_view(created));
end;
$$;

revoke all on function private.es02_test_resolve_slots(text,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function private.es02_test_order_view(private.es02_account_orders) from public,anon,authenticated,service_role;
revoke all on function private.es02_test_order_catalog_consistent(private.es02_account_orders) from public,anon,authenticated,service_role;
revoke all on function private.es02_create_test_account_order(uuid,uuid,text,jsonb,boolean) from public,anon,authenticated,service_role;

create table private.es02_test_checkout_accounts (
  account_id uuid primary key references auth.users(id),
  enabled boolean not null default false,
  integration_id integer not null check(integration_id>0),
  merchant_owner_id text not null check(merchant_owner_id ~ '^[1-9][0-9]*$'),
  units_per_omr integer not null check(units_per_omr between 1 and 1000000)
);
alter table private.es02_test_checkout_accounts enable row level security;
revoke all on table private.es02_test_checkout_accounts from public,anon,authenticated,service_role;

create table private.es02_test_checkouts (
  order_id uuid primary key references private.es02_account_orders(id),
  account_id uuid not null references auth.users(id),
  preparation jsonb not null check (jsonb_typeof(preparation) = 'object'),
  state text not null default 'prepared' check (state in ('prepared','claimed','ready','paid')),
  binding jsonb,
  claim_token uuid,
  provider_order_id text unique,
  provider_intention_id text unique,
  checkout_url text,
  provider_transaction_id text unique,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '24 hours',
  paid_at timestamptz
);
alter table private.es02_test_checkouts enable row level security;
revoke all on table private.es02_test_checkouts from public, anon, authenticated, service_role;

create function public.es02_begin_test_checkout(p_expected_account_id uuid, p_client_op_id uuid, p_term text, p_slots jsonb, p_preparation jsonb, p_consent_accepted boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; result jsonb; o private.es02_account_orders; c private.es02_test_checkouts;
begin
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null or not private.es02_authority_footprint_ok() then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
  if not exists(select 1 from private.es02_test_checkout_accounts where account_id=actor and enabled) then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  if p_consent_accepted is distinct from true or p_client_op_id is null
     or jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots) <> 1
     or jsonb_typeof(p_preparation) is distinct from 'object' or octet_length(p_preparation::text) > 65536
     or jsonb_typeof(p_preparation->'branches') is distinct from 'array'
     or jsonb_array_length(p_preparation->'branches') <> 1
     or coalesce(length(trim(p_preparation->>'name')),0) not between 1 and 120
     or coalesce(length(trim(p_preparation->>'type')),0) not between 1 and 120
     or coalesce(length(trim(p_preparation->>'city')),0) not between 1 and 120
     or coalesce(p_preparation->>'phone','') !~ '^\+[1-9][0-9]{6,14}$'
  then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
  -- Retain the native immutable catalog/order authority and its actor lock.
  result := private.es02_create_test_account_order(actor,p_client_op_id,p_term,p_slots,true);
  if result->>'ok' is distinct from 'true' then return result; end if;
  select * into strict o from private.es02_account_orders where id=(result->'data'->>'orderId')::uuid and account_id=actor for update;
  if o.environment <> 'test' then raise exception 'TEST_ORDER_REQUIRED'; end if;
  select * into c from private.es02_test_checkouts where order_id=o.id for update;
  if c.order_id is not null then
    if c.preparation is distinct from p_preparation then return jsonb_build_object('ok',false,'code','CONFLICT'); end if;
    return result;
  end if;
  if o.status <> 'open' then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED'); end if;
  insert into private.es02_test_checkouts(order_id,account_id,preparation) values(o.id,actor,p_preparation);
  return result;
end $$;

create function public.es02_claim_test_checkout(p_binding jsonb,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o private.es02_account_orders; c private.es02_test_checkouts; token uuid; units bigint;
begin
  if auth.role() is distinct from 'service_role' then return jsonb_build_object('kind','rejected','code','FORBIDDEN'); end if;
  select * into o from private.es02_account_orders where id=(p_binding->>'orderId')::uuid for update;
  if o.id is null or o.account_id::text is distinct from p_binding->>'accountId' or o.environment <> 'test'
     or not private.es02_test_order_catalog_consistent(o)
     or o.status not in ('open','collection_pending')
     or o.payment_attempt_id::text is distinct from p_binding->>'paymentAttemptId'
     or o.special_reference is distinct from p_binding->>'specialReference'
     or o.amount_baisa is distinct from (p_binding->>'amountBaisa')::bigint
     or p_binding->>'currency' is distinct from 'OMR' or p_binding->>'environment' is distinct from 'test'
     or coalesce(p_binding->>'providerAccountRef','') !~ '^[1-9][0-9]*$'
     or coalesce(p_binding->>'merchantOwnerId','') !~ '^[1-9][0-9]*$'
     or not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=o.account_id and (s.not_after is null or s.not_after>clock_timestamp()))
  then return jsonb_build_object('kind','rejected','code','FORBIDDEN'); end if;
  units := (p_binding->>'providerAmount')::bigint;
  if units is null or units <= 0 or coalesce(length(p_binding->>'offerFingerprint'),0)=0 then return jsonb_build_object('kind','rejected','code','INVALID_INPUT'); end if;
  if not exists(select 1 from private.es02_test_checkout_accounts a where a.account_id=o.account_id and a.enabled
    and a.integration_id::text=p_binding->>'providerAccountRef' and a.merchant_owner_id=p_binding->>'merchantOwnerId'
    and o.amount_baisa::bigint*a.units_per_omr=units*1000)
  then return jsonb_build_object('kind','rejected','code','FORBIDDEN'); end if;
  select * into c from private.es02_test_checkouts where order_id=o.id and account_id=o.account_id for update;
  if c.order_id is null then return jsonb_build_object('kind','rejected','code','FORBIDDEN'); end if;
  if c.binding is not null and c.binding is distinct from p_binding then return jsonb_build_object('kind','rejected','code','checkout_binding_mismatch'); end if;
  if c.state='ready' and c.expires_at>clock_timestamp() then
    return jsonb_build_object('kind','ready','saved',jsonb_build_object('binding',c.binding,'url',c.checkout_url,'providerOrderId',c.provider_order_id,'providerIntentionId',c.provider_intention_id,'claimToken',c.claim_token));
  end if;
  if c.state<>'prepared' or c.expires_at<=clock_timestamp() then return jsonb_build_object('kind','pending'); end if;
  token:=gen_random_uuid();
  update private.es02_test_checkouts set state='claimed',binding=p_binding,claim_token=token where order_id=o.id;
  update private.es02_account_orders set status='collection_pending',updated_at=clock_timestamp() where id=o.id;
  return jsonb_build_object('kind','claimed','token',token);
end $$;

create function public.es02_complete_test_checkout(p_saved jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare c private.es02_test_checkouts;
begin
  if auth.role() is distinct from 'service_role' then return false; end if;
  select * into c from private.es02_test_checkouts where order_id=(p_saved->'binding'->>'orderId')::uuid for update;
  if c.order_id is null or c.state<>'claimed' or c.binding is distinct from p_saved->'binding'
     or c.claim_token::text is distinct from p_saved->>'claimToken'
     or coalesce(p_saved->>'providerOrderId','') !~ '^[1-9][0-9]*$'
     or coalesce(p_saved->>'providerIntentionId','') !~ '^pi_test_'
     or coalesce(p_saved->>'url','') !~ '^https://om\.checkout\.paymob\.com/\?'
  then return false; end if;
  update private.es02_test_checkouts set state='ready',checkout_url=p_saved->>'url',provider_order_id=p_saved->>'providerOrderId',provider_intention_id=p_saved->>'providerIntentionId' where order_id=c.order_id;
  return true;
end $$;

create function public.es02_find_test_checkout(p_provider_order_id text,p_integration_id integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.es02_test_checkouts; o private.es02_account_orders;
begin
  if auth.role() is distinct from 'service_role' then return null; end if;
  select * into c from private.es02_test_checkouts where provider_order_id=p_provider_order_id and binding->>'providerAccountRef'=p_integration_id::text and binding->>'environment'='test';
  if c.order_id is null then return null; end if;
  select * into strict o from private.es02_account_orders where id=c.order_id and account_id=c.account_id;
  return jsonb_build_object('order',private.es02_test_order_view(o),'binding',c.binding,'providerOrderId',c.provider_order_id);
end $$;

create function public.es02_record_test_payment(p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.es02_test_checkouts; o private.es02_account_orders; txn text;
begin
  if auth.role() is distinct from 'service_role' then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  select * into o from private.es02_account_orders where id=(p_evidence->>'orderId')::uuid for update;
  select * into c from private.es02_test_checkouts where order_id=o.id for update;
  txn:=p_evidence->>'providerTransactionId';
  if o.id is null or c.order_id is null or c.state not in ('ready','paid')
     or o.environment<>'test' or p_evidence->>'environment' is distinct from 'test'
     or p_evidence->>'currency' is distinct from 'OMR'
     or o.account_id::text is distinct from p_evidence->>'accountId'
     or o.payment_attempt_id::text is distinct from p_evidence->>'paymentAttemptId'
     or c.provider_order_id is distinct from p_evidence->>'providerOrderId'
     or o.amount_baisa is distinct from (p_evidence->>'amountBaisa')::integer
     or coalesce(txn,'') !~ '^[1-9][0-9]*$'
     or not private.es02_test_order_catalog_consistent(o)
  then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  if c.state='paid' then
    if c.provider_transaction_id=txn then return jsonb_build_object('ok',true,'outcome','duplicate'); end if;
    return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');
  end if;
  if o.status not in ('open','collection_pending') or c.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED'); end if;
  insert into private.es02_account_settlement_events(order_id,account_id,evidence_marker,provider_transaction_id,amount_baisa,currency,outcome,detail_code)
  values(o.id,o.account_id,'paymob_hmac_verified_test',txn,o.amount_baisa,'OMR','applied','PAYMOB_TEST');
  update private.es02_account_orders set status='settled',settled_at=clock_timestamp(),updated_at=clock_timestamp() where id=o.id and environment='test';
  update private.es02_test_checkouts set state='paid',provider_transaction_id=txn,paid_at=clock_timestamp() where order_id=o.id;
  return jsonb_build_object('ok',true,'outcome','settled');
end $$;

create function public.es02_read_test_payment(p_expected_account_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; c private.es02_test_checkouts; o private.es02_account_orders;
begin
  actor:=private.es02_require_active_actor(p_expected_account_id);
  if actor is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
  select * into o from private.es02_account_orders where id=p_order_id and account_id=actor;
  select * into c from private.es02_test_checkouts where order_id=p_order_id and account_id=actor;
  if o.id is null or c.order_id is null then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('order',private.es02_test_order_view(o),'state',c.state,'paidAt',c.paid_at,'expiresAt',c.expires_at));
end $$;

revoke all on function public.es02_begin_test_checkout(uuid,uuid,text,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.es02_claim_test_checkout(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.es02_complete_test_checkout(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.es02_find_test_checkout(text,integer) from public,anon,authenticated,service_role;
revoke all on function public.es02_record_test_payment(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.es02_read_test_payment(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.es02_begin_test_checkout(uuid,uuid,text,jsonb,jsonb,boolean) to authenticated;
grant execute on function public.es02_read_test_payment(uuid,uuid) to authenticated;
grant execute on function public.es02_claim_test_checkout(jsonb,uuid) to service_role;
grant execute on function public.es02_complete_test_checkout(jsonb) to service_role;
grant execute on function public.es02_find_test_checkout(text,integer) to service_role;
grant execute on function public.es02_record_test_payment(jsonb) to service_role;

-- Existing provisioning keeps its actor/session/ownership/once-only checks.
-- Resolve recorded revisions so both legacy Dana75 and current Dana90 remain valid.
create or replace function private.es02_order_catalog_consistent(o private.es02_account_orders)
returns boolean language sql stable set search_path='' as $$
 select private.es02_test_order_catalog_consistent(o);
$$;

create function public.es02_finish_test_checkout(p_expected_account_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; c private.es02_test_checkouts; o private.es02_account_orders; branches jsonb;
begin
 actor:=private.es02_require_active_actor(p_expected_account_id);
 if actor is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if not exists(select 1 from private.es02_test_checkout_accounts where account_id=actor and enabled) then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text || ':es02-provision',0));
 -- Serialize with the existing provisioner before taking its order lock.
 select * into o from private.es02_account_orders where id=p_order_id and account_id=actor for update;
 select * into c from private.es02_test_checkouts where order_id=p_order_id and account_id=actor for update;
 if o.id is null or c.order_id is null or o.environment<>'test' then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 if c.state<>'paid' or c.paid_at is null or c.provider_transaction_id is null then return jsonb_build_object('ok',false,'code','NOT_SETTLED'); end if;
 select jsonb_agg(jsonb_build_object('name',b->>'name','city',b->>'city','contact_phone',b->>'contactPhone') order by ord)
 into branches from jsonb_array_elements(c.preparation->'branches') with ordinality as branch(b,ord);
 return public.es02_provision_owned_purchase(actor,o.id,o.id,c.preparation - 'branches',branches);
end $$;
revoke all on function public.es02_finish_test_checkout(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.es02_finish_test_checkout(uuid,uuid) to authenticated;
commit;

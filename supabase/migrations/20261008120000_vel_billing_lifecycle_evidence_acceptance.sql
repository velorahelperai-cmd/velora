-- Forward-only security acceptance correction. No historical migration changed.
-- Refund extent, parent linkage, service suspension and late-payment disposition
-- require owner approval / processor reconciliation. Evidence is retained; this
-- migration never revokes an entitlement or suspends a company automatically.

-- The historical default assigns a fresh two-hour deadline to old rows without
-- proving its source. No row is approved by this migration. Only a separately
-- authorized owner-policy workflow may approve a Live checkout before submission.
alter table public.billing_orders add column deadline_policy_approved boolean not null default false;
comment on column public.billing_orders.deadline_policy_approved is
 'Live first activation requires approved checkout deadline policy. Default false includes historical deadlines whose provenance is unknown. No approval API or policy is enabled by this migration.';

create table private.billing_lifecycle_reviews (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 order_id uuid not null,
 payment_attempt_id uuid not null,
 provider_event_id uuid not null unique references public.billing_provider_events(id) on delete restrict,
 provider text not null check (provider='paymob'),
 provider_account_ref text not null,
 provider_environment text not null check(provider_environment in ('test','live')),
 provider_transaction_id text not null,
 reason text not null check(reason in ('refund_extent_or_parent_unconfirmed','void_review','conflicting_lifecycle_review','late_payment_policy_unapproved','deadline_policy_unapproved')),
 status text not null default 'review_required' check(status='review_required'),
 detail jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(order_id,company_id) references public.billing_orders(id,company_id) on delete restrict,
 foreign key(payment_attempt_id,company_id) references public.billing_payment_attempts(id,company_id) on delete restrict
);
create index billing_lifecycle_reviews_order_scope_idx on private.billing_lifecycle_reviews
 (company_id,order_id,provider,provider_account_ref,provider_environment);
alter table private.billing_lifecycle_reviews enable row level security;
revoke all on private.billing_lifecycle_reviews from public,anon,authenticated,service_role;
comment on table private.billing_lifecycle_reviews is
 'Append-only review evidence. Not a refund/suspension policy. A signed flag alone does not prove refund extent or an unsigned parent transaction link.';

-- Require durable evidence from the actual HMAC-checked server reception. Never
-- reconstruct a success from just a transaction id or a caller-supplied status.
create function private.billing_acceptance_hmac_event(p_evidence jsonb)
returns public.billing_provider_events language plpgsql security definer set search_path='' as $$
declare e public.billing_provider_events%rowtype; o public.billing_orders%rowtype; a public.billing_payment_attempts%rowtype;
 r jsonb; k text; amount bigint; actual_amount bigint;
begin
 if jsonb_typeof(p_evidence) is distinct from 'object'
 or p_evidence->>'evidence_marker' is distinct from 'VEL_PAYMOB_SERVER_HMAC_VERIFIED'
 or p_evidence->'authenticity'->>'source' is distinct from 'server_adapter_attestation'
 or p_evidence->'authenticity'->'verified' is distinct from 'true'::jsonb
 or p_evidence->'authenticity'->>'method' is distinct from 'paymob_hmac_sha512'
 or p_evidence ? 'signature_verified'
 or p_evidence->>'provider' is distinct from 'paymob'
 or coalesce(p_evidence->>'currency_expected',p_evidence->>'currency') is distinct from 'OMR'
 or (p_evidence ? 'currency' and p_evidence->>'currency' is distinct from 'OMR')
 or (p_evidence ? 'currency_expected' and p_evidence->>'currency_expected' is distinct from 'OMR')
 or coalesce(p_evidence->>'provider_environment','') not in ('test','live') then return null; end if;
 select * into o from public.billing_orders where id=(p_evidence->>'order_id')::uuid
 and company_id=(p_evidence->>'company_id')::uuid;
 if not found then return null; end if;
 select * into a from public.billing_payment_attempts where id=(p_evidence->>'payment_attempt_id')::uuid
 and order_id=o.id and company_id=o.company_id;
 if not found then return null; end if;
 amount:=(p_evidence->>'amount_baisa')::bigint;
 if amount is distinct from o.amount_baisa or amount<=0 or o.currency<>'OMR'
 or o.provider is distinct from 'paymob' or o.provider_account_ref is distinct from p_evidence->>'provider_account_ref'
 or o.provider_environment is distinct from p_evidence->>'provider_environment'
 or o.special_reference is distinct from p_evidence->>'special_reference'
 or a.provider is distinct from o.provider or a.provider_account_ref is distinct from o.provider_account_ref
 or a.provider_environment is distinct from o.provider_environment
 or a.provider_order_id is null or o.provider_amount is null or o.provider_amount<=0
 or o.provider_amount>9007199254740991 or o.amount_baisa>9007199254740991
 or o.provider_amount_unit is distinct from 'paymob_amount' then return null; end if;
 select * into e from public.billing_provider_events
 where payment_attempt_id=a.id and company_id=o.company_id and provider=o.provider
 and provider_account_ref=o.provider_account_ref and provider_environment=o.provider_environment
 and provider_transaction_id=p_evidence->>'provider_transaction_id'
 and event_status=p_evidence->>'event_status'
 and observation_key=coalesce(nullif(p_evidence->>'observation_key',''),'default');
 if not found or e.amount_baisa_expected is distinct from o.amount_baisa or e.currency_expected is distinct from o.currency
 or (p_evidence ? 'provider_event_id' and e.id is distinct from (p_evidence->>'provider_event_id')::uuid) then return null; end if;
 r:=e.raw_summary;
 if jsonb_typeof(r) is distinct from 'object' or r->'hmac_verified' is distinct from 'true'::jsonb
 or r->>'provider_transaction_id' is distinct from e.provider_transaction_id
 or r->>'provider_order_id' is distinct from a.provider_order_id
 or r->>'currency' is distinct from o.currency
 or jsonb_typeof(r->'integration_id') is distinct from 'number'
 or r->>'integration_id' is distinct from o.provider_account_ref
 or coalesce(r->>'signed_owner','')!~'^[1-9][0-9]*$' then return null; end if;
 foreach k in array array['pending','success','error_occured','is_auth','is_capture','is_voided','is_refunded','has_parent_transaction','is_standalone_payment'] loop
  if jsonb_typeof(r->k) is distinct from 'boolean' then return null; end if;
 end loop;
 if jsonb_typeof(r->'amount_cents') is distinct from 'number' or coalesce(r->>'amount_cents','')!~'^[0-9]+$' then return null; end if;
 actual_amount:=(r->>'amount_cents')::bigint;
 if actual_amount<=0 or actual_amount>o.provider_amount then return null; end if;
 -- Underpayment never grants. A smaller signed lifecycle amount is review only;
 -- it cannot attest the total refunded amount of the original collection.
 if e.event_status='success' and actual_amount<>o.provider_amount then return null; end if;
 return e;
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end; $$;
revoke all on function private.billing_acceptance_hmac_event(jsonb) from public,anon,authenticated,service_role;

create function private.billing_record_lifecycle_review(p_event public.billing_provider_events,p_order_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 insert into private.billing_lifecycle_reviews(company_id,order_id,payment_attempt_id,provider_event_id,
 provider,provider_account_ref,provider_environment,provider_transaction_id,reason,detail)
 values(p_event.company_id,p_order_id,p_event.payment_attempt_id,p_event.id,p_event.provider,p_event.provider_account_ref,
 p_event.provider_environment,p_event.provider_transaction_id,p_reason,
 jsonb_build_object('signed_observation',p_event.raw_summary,'owner_policy','not_approved','automatic_entitlement_mutation',false))
 on conflict(provider_event_id) do nothing;
 select id into rid from private.billing_lifecycle_reviews where provider_event_id=p_event.id;
 return rid;
end; $$;
revoke all on function private.billing_record_lifecycle_review(public.billing_provider_events,uuid,text) from public,anon,authenticated,service_role;

-- Preserve the working atomic grant implementation and its lock family. Only
-- adjust its conflict target for the new partial environment index, then put an
-- evidence/lifecycle gate in front. The inner function is not an external API.
do $$ declare definition text; body_hash text; is_definer boolean; begin
 if to_regprocedure('private.billing_settle_payment_core_pre_acceptance(jsonb)') is null then
  select md5(replace(p.prosrc,chr(13),'')),p.prosecdef into body_hash,is_definer
  from pg_proc p where p.oid='private.billing_settle_payment_core(jsonb)'::regprocedure;
  -- Pinned to the reviewed 2931067 / 485d21e implementation. A name or an RPC
  -- count is not proof that an installed cloud function has the reviewed body.
  if body_hash is distinct from '36b575f3ce936da82077f14633d367f6' or is_definer is distinct from true then
   raise exception 'SETTLEMENT_CORE_VERSION_REQUIRES_REVIEW' using errcode='55000';
  end if;
  alter function private.billing_settle_payment_core(jsonb) rename to billing_settle_payment_core_pre_acceptance;
 end if;
 definition:=pg_get_functiondef('private.billing_settle_payment_core_pre_acceptance(jsonb)'::regprocedure);
 if position('on conflict (company_id, environment) do nothing' in definition)>0 then
  definition:=replace(definition,'on conflict (company_id, environment) do nothing',
   'on conflict (company_id, environment) where environment in (''test'',''live'') do nothing');
  execute definition;
 end if;
end; $$;
revoke all on function private.billing_settle_payment_core_pre_acceptance(jsonb) from public,anon,authenticated,service_role;

create or replace function private.billing_apply_reversal(p_company_id uuid,p_order_id uuid,p_attempt_id uuid,p_reversal_type text,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.billing_provider_events%rowtype; o public.billing_orders%rowtype; reason text; rid uuid;
begin
 e:=private.billing_acceptance_hmac_event(p_evidence);
 if e.id is null or e.company_id is distinct from p_company_id or e.payment_attempt_id is distinct from p_attempt_id
 or p_evidence->>'order_id' is distinct from p_order_id::text or p_reversal_type not in ('refunded','voided') then
  return jsonb_build_object('ok',false,'code','INVALID_REVERSAL_EVIDENCE');
 end if;
 if e.raw_summary->'pending' is distinct from 'false'::jsonb or e.raw_summary->'success' is distinct from 'true'::jsonb
 or e.raw_summary->'error_occured' is distinct from 'false'::jsonb
 or (p_reversal_type='refunded' and e.raw_summary->'is_refunded' is distinct from 'true'::jsonb)
 or (p_reversal_type='voided' and e.raw_summary->'is_voided' is distinct from 'true'::jsonb) then
  return jsonb_build_object('ok',false,'code','INVALID_REVERSAL_EVIDENCE');
 end if;
 -- Match the same canonical company -> subscription -> order -> attempt locks
 -- as settlement; leave historical grants and all newer purchases untouched.
 perform 1 from public.companies where id=p_company_id for update;
 perform 1 from public.billing_subscriptions where company_id=p_company_id and environment=e.provider_environment for update;
 select * into o from public.billing_orders where id=p_order_id and company_id=p_company_id for update;
 perform 1 from public.billing_payment_attempts where id=p_attempt_id and order_id=p_order_id and company_id=p_company_id for update;
 if not found then return jsonb_build_object('ok',false,'code','INVALID_REVERSAL_EVIDENCE'); end if;
 reason:=case when e.raw_summary->'is_refunded'='true'::jsonb and e.raw_summary->'is_voided'='true'::jsonb then 'conflicting_lifecycle_review'
 when p_reversal_type='refunded' then 'refund_extent_or_parent_unconfirmed' else 'void_review' end;
 rid:=private.billing_record_lifecycle_review(e,o.id,reason);
 return jsonb_build_object('ok',true,'outcome','lifecycle_review','review_id',rid,'order_id',o.id,
 'code',reason,'entitlement_changed',false);
end; $$;
revoke all on function private.billing_apply_reversal(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

create or replace function private.billing_settle_payment_core(p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.billing_provider_events%rowtype; o public.billing_orders%rowtype; rid uuid;
begin
 e:=private.billing_acceptance_hmac_event(p_evidence);
 if e.id is null or e.event_status is distinct from 'success'
 or e.raw_summary->'pending' is distinct from 'false'::jsonb or e.raw_summary->'success' is distinct from 'true'::jsonb
 or e.raw_summary->'error_occured' is distinct from 'false'::jsonb or e.raw_summary->'is_auth' is distinct from 'false'::jsonb
 or e.raw_summary->'is_capture' is distinct from 'false'::jsonb or e.raw_summary->'is_voided' is distinct from 'false'::jsonb
 or e.raw_summary->'is_refunded' is distinct from 'false'::jsonb or e.raw_summary->'has_parent_transaction' is distinct from 'false'::jsonb
 or e.raw_summary->'is_standalone_payment' is distinct from 'true'::jsonb then
  return jsonb_build_object('ok',false,'code','INVALID_STORED_EVIDENCE');
 end if;
 perform 1 from public.companies where id=e.company_id for update;
 perform 1 from public.billing_subscriptions where company_id=e.company_id and environment=e.provider_environment for update;
 select * into o from public.billing_orders where id=(p_evidence->>'order_id')::uuid and company_id=e.company_id for update;
 perform 1 from public.billing_payment_attempts where id=e.payment_attempt_id and order_id=o.id and company_id=e.company_id for update;
 if not found then return jsonb_build_object('ok',false,'code','INVALID_STORED_EVIDENCE'); end if;
 -- Durable receipt alone must block a stale success even if the reversal
 -- processor has not yet run (e.g. refund receipt and success worker racing).
 if o.status in ('refunded','voided','cancelled') or exists(
 select 1 from public.billing_entitlement_applications g where g.order_id=o.id and g.status='revoked') or exists(
 select 1 from private.billing_lifecycle_reviews r where r.order_id=o.id and r.company_id=e.company_id
 and r.provider=e.provider and r.provider_account_ref=e.provider_account_ref and r.provider_environment=e.provider_environment
 and r.reason in ('refund_extent_or_parent_unconfirmed','void_review','conflicting_lifecycle_review')) or exists(
 select 1 from public.billing_provider_events v where v.company_id=e.company_id and v.payment_attempt_id in
 (select a.id from public.billing_payment_attempts a where a.company_id=e.company_id and a.order_id=o.id)
 and v.provider=e.provider and v.provider_account_ref=e.provider_account_ref and v.provider_environment=e.provider_environment
 and v.raw_summary->'hmac_verified'='true'::jsonb and v.raw_summary->'pending'='false'::jsonb
 and v.raw_summary->'success'='true'::jsonb and v.raw_summary->'error_occured'='false'::jsonb
 and (v.raw_summary->'is_refunded'='true'::jsonb or v.raw_summary->'is_voided'='true'::jsonb)) then
  return jsonb_build_object('ok',true,'outcome','lifecycle_review','code','prior_lifecycle_requires_review','order_id',o.id);
 end if;
 if e.provider_environment='live' and not o.deadline_policy_approved
 and not exists(select 1 from public.billing_entitlement_applications g where g.order_id=o.id) then
  rid:=private.billing_record_lifecycle_review(e,o.id,'deadline_policy_unapproved');
  return jsonb_build_object('ok',true,'outcome','deadline_policy_review','code','deadline_policy_unapproved','review_id',rid,'order_id',o.id);
 end if;
 -- The existing two-hour deadline is not an approved disposal/suspension
 -- policy. Keep late collection evidence, deny automatic FIRST activation,
 -- and leave an already granted transaction replay idempotent after expiry.
 if o.expires_at<=clock_timestamp() and not exists(select 1 from public.billing_entitlement_applications g where g.order_id=o.id) then
  rid:=private.billing_record_lifecycle_review(e,o.id,'late_payment_policy_unapproved');
  return jsonb_build_object('ok',true,'outcome','late_payment_review','code','late_payment_policy_unapproved','review_id',rid,'order_id',o.id);
 end if;
 return private.billing_settle_payment_core_pre_acceptance(p_evidence||jsonb_build_object('currency_expected','OMR','evidence_kind','paymob_hmac_verified'));
end; $$;
revoke all on function private.billing_settle_payment_core(jsonb) from public,anon,authenticated,service_role;

create or replace function public.billing_settle_paymob_hmac_verified(p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.billing_provider_events%rowtype; jwt_role text;
begin
 jwt_role:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','');
 if jwt_role in ('anon','authenticated') or (jwt_role<>'service_role' and session_user not in ('postgres','supabase_admin')) then
  raise exception 'server-only billing settlement' using errcode='42501';
 end if;
 e:=private.billing_acceptance_hmac_event(p_evidence);
 if e.id is null then return jsonb_build_object('ok',false,'code','INVALID_STORED_EVIDENCE'); end if;
 if e.raw_summary->'is_refunded'='true'::jsonb then
  return private.billing_apply_reversal(e.company_id,(p_evidence->>'order_id')::uuid,e.payment_attempt_id,'refunded',p_evidence);
 elsif e.raw_summary->'is_voided'='true'::jsonb then
  return private.billing_apply_reversal(e.company_id,(p_evidence->>'order_id')::uuid,e.payment_attempt_id,'voided',p_evidence);
 end if;
 return private.billing_settle_payment_core(p_evidence);
end; $$;
revoke all on function public.billing_settle_paymob_hmac_verified(jsonb) from public,anon,authenticated;
grant execute on function public.billing_settle_paymob_hmac_verified(jsonb) to service_role;

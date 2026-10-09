-- Forward correction; 20261008080000 remains immutable. CLI generated this file
-- before the historical future-dated version; timestamp advanced for ordering.
-- Apply the complete historical+forward upgrade with application writers stopped
-- and one PostgreSQL transaction. No entitlement is derived from DEFAULT 'live'.
begin;

alter table public.billing_subscriptions drop constraint if exists billing_subscriptions_environment_check;
alter table public.billing_subscriptions add constraint billing_subscriptions_environment_check
 check (environment in ('test','live','quarantined'));
alter table public.billing_subscriptions alter column environment drop default;
drop index public.billing_subscriptions_company_env_uidx;
create unique index billing_subscriptions_company_env_uidx on public.billing_subscriptions(company_id,environment)
 where environment in ('test','live');
alter table public.billing_subscriptions drop constraint billing_subscriptions_status_check;
alter table public.billing_subscriptions add constraint billing_subscriptions_status_check
 check (status in ('unprovisioned','awaiting_payment','active','cancel_at_period_end','ended','past_due','suspended','review_required'));

-- This is classification audit, not a backup or a financial-history copy.
create table public.billing_subscription_upgrade_reviews (
 subscription_id uuid primary key references public.billing_subscriptions(id) on delete restrict,
 company_id uuid not null references public.companies(id) on delete restrict,
 original_environment text not null,
 original_status text not null,
 original_paid_through timestamptz,
 original_plan_version_id uuid,
 classification text not null check(classification in ('test','live','quarantined')),
 reason text not null,
 grant_ids uuid[] not null,
 classified_at timestamptz not null default clock_timestamp()
);
alter table public.billing_subscription_upgrade_reviews enable row level security;
revoke all on public.billing_subscription_upgrade_reviews from public,anon,authenticated;
grant select,insert on public.billing_subscription_upgrade_reviews to service_role;

-- Only server-recorded, internally bound, processor-verified complete collection
-- evidence may establish live entitlement. Synthetic evidence is test-only.
create view private.billing_verified_collection_history as
 select g.*,o.plan_version_id
 from public.billing_entitlement_applications g
 join public.billing_orders o on o.id=g.order_id and o.company_id=g.company_id
 join public.billing_plan_versions pv on pv.id=o.plan_version_id
 join public.billing_payment_attempts a on a.id=g.payment_attempt_id and a.order_id=o.id and a.company_id=g.company_id
 join public.billing_provider_events e on e.id=g.provider_event_id and e.payment_attempt_id=a.id and e.company_id=g.company_id
 join public.billing_settlement_outcomes x on x.entitlement_application_id=g.id and x.order_id=o.id
  and x.payment_attempt_id=a.id and x.company_id=g.company_id and x.provider_event_id=e.id
  and x.outcome='granted' and x.provider_transaction_id=g.provider_transaction_id
  and x.provider=g.provider and x.provider_account_ref=g.provider_account_ref and x.provider_environment=g.provider_environment
 where g.provider='paymob' and o.provider=g.provider and a.provider=g.provider and e.provider=g.provider
  and o.provider_account_ref=g.provider_account_ref and a.provider_account_ref=g.provider_account_ref and e.provider_account_ref=g.provider_account_ref
  and o.provider_environment=g.provider_environment and a.provider_environment=g.provider_environment and e.provider_environment=g.provider_environment
  and e.provider_transaction_id=g.provider_transaction_id and e.event_status='success'
  and e.amount_baisa_expected=o.amount_baisa and e.currency_expected=o.currency and o.currency='OMR'
  and o.amount_baisa=pv.amount_baisa and o.currency=pv.currency and o.period_days=pv.period_days
  and o.period_unit=pv.period_unit and o.period_count=pv.period_count
  and g.period_unit=o.period_unit and g.period_count=o.period_count
  and g.period_days=case when o.period_unit='day' then o.period_count else greatest(o.period_days,1) end
  and x.applied_paid_through=g.applied_paid_through
  and (
   (g.provider_environment='test' and x.authenticity_method='authorized_synthetic_test')
   or (x.authenticity_method='paymob_hmac_verified'
    -- The historical wrapper stamped authenticity_method unconditionally.
    -- Only persisted receiver/adapter attestation establishes provenance;
    -- never infer or backfill it from that label or a transaction timestamp.
    and x.evidence_marker='VEL_PAYMOB_SERVER_HMAC_VERIFIED'
    and e.raw_summary->'hmac_verified'='true'::jsonb
    and case when jsonb_typeof(e.raw_summary->'signed_owner')='string'
      and e.raw_summary->>'signed_owner' ~ '^[1-9][0-9]{0,15}$'
     then (e.raw_summary->>'signed_owner')::numeric between 1 and 9007199254740991
     else false end
    and jsonb_typeof(e.raw_summary->'integration_id')='number'
    and jsonb_typeof(e.raw_summary->'amount_cents')='number'
    and o.amount_baisa between 1 and 9007199254740991
    and o.provider_amount between 1 and 9007199254740991 and o.provider_amount_unit='paymob_amount'
    and e.raw_summary->>'provider_order_id'=a.provider_order_id
    and e.raw_summary->>'provider_transaction_id'=g.provider_transaction_id
    and e.raw_summary->'amount_cents'=to_jsonb(o.provider_amount)
    and e.raw_summary->>'currency'=o.currency
    and e.raw_summary->>'integration_id'=g.provider_account_ref
    and e.raw_summary->'pending'='false'::jsonb and e.raw_summary->'success'='true'::jsonb
    and e.raw_summary->'error_occured'='false'::jsonb
    and e.raw_summary->'is_auth'='false'::jsonb and e.raw_summary->'is_capture'='false'::jsonb
    and e.raw_summary->'is_refunded'='false'::jsonb and e.raw_summary->'is_voided'='false'::jsonb
    and e.raw_summary->'has_parent_transaction'='false'::jsonb and e.raw_summary->'is_standalone_payment'='true'::jsonb)
  );
revoke all on private.billing_verified_collection_history from public,anon,authenticated;
grant select on private.billing_verified_collection_history to service_role;

-- Historical receipt proof and current eligibility are distinct. A revoked
-- receipt remains proved financial history; it cannot itself authorize service.
create view private.billing_proven_entitlement_grants as
 select h.* from private.billing_verified_collection_history h
 join public.billing_orders o on o.id=h.order_id and o.company_id=h.company_id
 join public.billing_payment_attempts a on a.id=h.payment_attempt_id and a.company_id=h.company_id
 where h.status='active' and o.status='closed' and a.status='paid';
revoke all on private.billing_proven_entitlement_grants from public,anon,authenticated;
grant select on private.billing_proven_entitlement_grants to service_role;

-- Preserve every original subscription ID and every grant/order/event/outcome.
-- A mixed, unsupported, unmatched or colliding history is denied operational
-- service pending reviewed forward reconciliation. Never guess from a date.
do $$
declare s record; total_count bigint; proven_count bigint; env_count integer; grant_ids_value uuid[]; helper_damage boolean;
 target_env text; target_paid timestamptz; target_plan uuid; reason_value text;
begin
 for s in select * from public.billing_subscriptions order by company_id,id for update loop
  select count(*),coalesce(array_agg(id),array[]::uuid[]) into total_count,grant_ids_value
   from public.billing_entitlement_applications where subscription_id=s.id;
  select count(*),count(distinct provider_environment),min(provider_environment)
   into proven_count,env_count,target_env
   from private.billing_verified_collection_history where subscription_id=s.id;
  select max(applied_paid_through) filter(where not exists(select 1 from public.billing_provider_events r where r.company_id=g.company_id
    and r.provider=g.provider and r.provider_account_ref=g.provider_account_ref and r.provider_environment=g.provider_environment
    and r.provider_transaction_id=g.provider_transaction_id
    and (r.event_status in ('refunded','voided','cancelled') or r.raw_summary->'is_refunded'='true'::jsonb or r.raw_summary->'is_voided'='true'::jsonb)))
   into target_paid
   from private.billing_proven_entitlement_grants g where subscription_id=s.id;
  target_plan:=null;
  helper_damage:=false;
  if total_count>0 and proven_count=total_count and env_count=1 and target_paid is not null
   and not exists(select 1 from public.billing_subscriptions other where other.company_id=s.company_id
    and other.environment=target_env and other.id<>s.id) then
   reason_value:='complete_consistent_collection_evidence';
   select plan_version_id into target_plan from private.billing_proven_entitlement_grants
    where subscription_id=s.id and applied_paid_through=target_paid order by applied_at desc,id desc limit 1;
   -- The historical P1 helper suspended the entire subscription when reversing
   -- an older payment. Repair ONLY exact attributable damage: full old receipt
   -- proof, its explicit revocation/outcome, exact subscription mutation instant
   -- and a later independently proved active receipt. An outcome label alone is
   -- never HMAC proof, and manual/security/past-due suspension is never lifted.
   helper_damage:=coalesce(s.status='suspended' and s.paid_through<=s.updated_at
    and exists(select 1 from public.companies c where c.id=s.company_id and c.status<>'suspended')
    and exists(select 1 from private.billing_verified_collection_history old_receipt
     join public.billing_settlement_outcomes reversal on reversal.entitlement_application_id=old_receipt.id
      and reversal.company_id=old_receipt.company_id and reversal.order_id=old_receipt.order_id
      and reversal.payment_attempt_id=old_receipt.payment_attempt_id and reversal.provider=old_receipt.provider
      and reversal.provider_account_ref=old_receipt.provider_account_ref and reversal.provider_environment=old_receipt.provider_environment
     join private.billing_proven_entitlement_grants newer on newer.subscription_id=s.id
      and newer.company_id=s.company_id and newer.provider_environment=target_env
      and newer.applied_paid_through=target_paid and newer.applied_at>old_receipt.applied_at
     where old_receipt.subscription_id=s.id and old_receipt.provider_environment=target_env and old_receipt.status='revoked'
      and reversal.outcome in ('refunded','voided') and reversal.authenticity_method='signed_lifecycle_reversal'
      and reversal.detail->>'reversal_type'=reversal.outcome and reversal.applied_paid_through=s.updated_at),false);
   if helper_damage then reason_value:='complete_collection_evidence_prior_global_reversal_repaired';end if;
  else
   target_env:='quarantined';
   reason_value:=case when total_count=0 then 'no_collection_evidence'
    when proven_count<>total_count or target_paid is null then 'incomplete_or_reversed_collection_evidence'
    when env_count<>1 then 'mixed_test_live_history' else 'environment_binding_collision' end;
  end if;
  insert into public.billing_subscription_upgrade_reviews(subscription_id,company_id,original_environment,original_status,
   original_paid_through,original_plan_version_id,classification,reason,grant_ids)
   values(s.id,s.company_id,s.environment,s.status,s.paid_through,s.plan_version_id,target_env,reason_value,grant_ids_value);
  update public.billing_subscriptions set environment=target_env,
   status=case when target_env='quarantined' then 'review_required'
    when s.status='past_due' or (s.status='suspended' and not helper_damage) then s.status
    when target_paid<=clock_timestamp() then 'ended'
    when s.cancel_at_period_end then 'cancel_at_period_end' else 'active' end,
   paid_through=case when target_env='quarantined' then s.paid_through else target_paid end,
   plan_version_id=case when target_env='quarantined' then s.plan_version_id else target_plan end,
   updated_at=clock_timestamp() where id=s.id;
 end loop;
end;$$;

create or replace function public.billing_read_company_operational_entitlement(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.billing_subscriptions%rowtype; trusted boolean;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
  and current_setting('role',true) is distinct from 'service_role'
  and not private.billing_ui_company_owner(p_company_id) then
  return jsonb_build_object('ok',false,'code','forbidden');
 end if;
 select * into s from public.billing_subscriptions where company_id=p_company_id and environment='live';
 if not found then return jsonb_build_object('ok',true,'active',false,'environment','live','status','none',
  'paid_through',null,'plan_version_id',null,'cancel_at_period_end',false);end if;
 trusted:=exists(select 1 from private.billing_proven_entitlement_grants g where g.subscription_id=s.id
  and g.company_id=p_company_id and g.provider_environment='live' and g.applied_paid_through=s.paid_through
  and g.plan_version_id=s.plan_version_id);
 return jsonb_build_object('ok',true,'active',trusted and s.status in ('active','cancel_at_period_end')
  and s.paid_through>statement_timestamp()
  and exists(select 1 from public.companies c where c.id=p_company_id and c.status<>'suspended'),
  'environment','live','status',s.status,
  'paid_through',case when trusted then s.paid_through else null end,
  'plan_version_id',case when trusted then s.plan_version_id else null end,'cancel_at_period_end',s.cancel_at_period_end);
end;$$;
revoke all on function public.billing_read_company_operational_entitlement(uuid) from public,anon;
grant execute on function public.billing_read_company_operational_entitlement(uuid) to authenticated,service_role;

create or replace function public.billing_read_company_journey(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare subscription_data jsonb;
begin
 if not private.billing_ui_company_owner(p_company_id) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select jsonb_build_object('id',s.id,'company_id',s.company_id,'plan_version_id',s.plan_version_id,
  'status',s.status,'paid_through',case when g.id is not null then s.paid_through else null end,
  'cancel_at_period_end',s.cancel_at_period_end,
  'cap',case when g.id is not null and s.status in ('active','cancel_at_period_end') and s.paid_through>statement_timestamp()
   then v.limits->'automated_outbound_per_month' else null end) into subscription_data
 from public.billing_subscriptions s
 left join private.billing_proven_entitlement_grants g on g.subscription_id=s.id and g.company_id=p_company_id
  and g.provider_environment='live' and g.applied_paid_through=s.paid_through and g.plan_version_id=s.plan_version_id
 left join public.billing_plan_versions v on v.id=s.plan_version_id
 where s.company_id=p_company_id and s.environment='live';
 return jsonb_build_object('ok',true,'data',jsonb_build_object('subscription',subscription_data,
  'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'plan_version_id',o.plan_version_id,
   'amount_baisa',o.amount_baisa,'currency',o.currency,'purchase_purpose',o.purchase_purpose,'status',o.status,'created_at',o.created_at,
   'paid_through',g.applied_paid_through,'payment_state',case when g.id is not null then 'confirmed'
    when a.status='failed' then 'failed' when a.status='unresolved' then 'unresolved'
    when a.status='paid' then 'verifying' else 'awaiting_processing' end) order by o.created_at desc,o.id desc)
   from (select * from public.billing_orders where company_id=p_company_id and provider_environment='live'
    order by created_at desc,id desc limit 100) o
   left join lateral(select status from public.billing_payment_attempts where order_id=o.id and company_id=p_company_id
    order by created_at desc,id desc limit 1) a on true
   left join private.billing_proven_entitlement_grants g on g.order_id=o.id and g.company_id=p_company_id
    and g.provider_environment='live'),'[]'::jsonb)));
end;$$;
revoke all on function public.billing_read_company_journey(uuid) from public,anon;
grant execute on function public.billing_read_company_journey(uuid) to authenticated;

create or replace function public.billing_cancel_at_period_end(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.billing_subscriptions%rowtype;
begin
 if not private.billing_ui_company_owner(p_company_id) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 perform 1 from public.companies where id=p_company_id for update;
 select * into s from public.billing_subscriptions where company_id=p_company_id and environment='live' for update;
 if not found or s.status not in ('active','cancel_at_period_end') or s.paid_through<=clock_timestamp()
  or not exists(select 1 from private.billing_proven_entitlement_grants g where g.subscription_id=s.id
   and g.company_id=p_company_id and g.provider_environment='live' and g.applied_paid_through=s.paid_through) then
  return jsonb_build_object('ok',false,'code','no_active_subscription');end if;
 if not private.billing_ui_company_owner(p_company_id) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 update public.billing_subscriptions set cancel_at_period_end=true,status='cancel_at_period_end',updated_at=clock_timestamp() where id=s.id;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('cancel_at_period_end',true));
end;$$;
revoke all on function public.billing_cancel_at_period_end(uuid) from public,anon;
grant execute on function public.billing_cancel_at_period_end(uuid) to authenticated;
notify pgrst,'reload schema';
commit;

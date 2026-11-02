CREATE OR REPLACE FUNCTION private.es02_paid_branch_readiness(p_company uuid, p_branch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a private.es02_activation_foundation;o private.es02_account_orders;
 r private.es02_branch_slot_rights;sel private.es02_branch_channel_selections;
 binding jsonb; channel_binding jsonb; projection jsonb; ch text; hours bigint; lang text; knowledge text; persona text; sub public.billing_subscriptions;
begin
 select * into a from private.es02_activation_foundation where company_id=p_company;
 if a.company_id is null then return jsonb_build_object('ok',false,'code','ES02_SCOPE_REQUIRED');end if;
 select * into o from private.es02_account_orders where id=a.order_id;
 -- No browser return, synthetic fixture settlement or unverified provisioned
 -- flag can manufacture a LIVE operational entitlement.
 if o.id is null or o.provisioned_company_id is distinct from p_company or o.account_id is distinct from a.account_id
  or o.original_order_group_id is distinct from a.order_group_id or o.status is distinct from 'provisioned'
  or o.environment is distinct from 'live' or (o.settlement_authority is distinct from 'paymob_hmac' and not coalesce(private.es02_verified_live_catalog_order(o),false))
  or o.settled_at is null or nullif(btrim(o.provider_transaction_id),'') is null
  or not exists(select 1 from private.es02_account_settlement_events e where e.order_id=o.id and e.account_id=o.account_id
   and e.provider_transaction_id=o.provider_transaction_id and e.outcome='applied' and (e.amount_baisa=o.amount_baisa or (coalesce(private.es02_verified_live_catalog_order(o),false) and e.evidence_marker='thawani_api_verified_live' and e.amount_baisa=100)) and e.currency=o.currency)
  or not exists(select 1 from auth.users u where u.id=a.account_id and u.email_confirmed_at is not null and u.deleted_at is null)
 then return jsonb_build_object('ok',false,'code','VERIFIED_LIVE_ES02_PAYMENT_REQUIRED');end if;
 if a.clock_state='ended' or (a.clock_state='active' and (a.paid_through_at is null or a.paid_through_at<=clock_timestamp())) then
  return jsonb_build_object('ok',false,'code','SUBSCRIPTION_INACTIVE');end if;
 if not exists(select 1 from public.companies where id=p_company and status='active')
  or not exists(select 1 from public.company_branches where id=p_branch and company_id=p_company and status='active') then
  return jsonb_build_object('ok',false,'code','BRANCH_NOT_LAUNCHED');end if;
 binding:=private.es02_b3_current_binding(a.account_id,p_company,p_branch,'whatsapp');
 if binding->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false,'code','PAID_BINDING_CHANGED');end if;
 select * into r from private.es02_branch_slot_rights where company_id=p_company and branch_id=p_branch and order_id=a.order_id;
 select * into sel from private.es02_branch_channel_selections where company_id=p_company and branch_id=p_branch and account_id=a.account_id;
 if r.id is null or sel.id is null or not (sel.channels ? 'whatsapp') then return jsonb_build_object('ok',false,'code','CHANNEL_NOT_SELECTED');end if;
 -- Existing B3 projection verifies actual legacy authorization, expiry,
 -- coexistence proof and generation. Also recheck immutable paid pins.
 for ch in select jsonb_array_elements_text(sel.channels) loop
  channel_binding:=private.es02_b3_current_binding(a.account_id,p_company,p_branch,ch);
  projection:=private.es02_b3_project(a.account_id,p_company,p_branch,ch);
  if channel_binding->>'ok' is distinct from 'true' or projection->>'sourceStatus' is distinct from 'ready'
   or projection->'connection'->>'state' is distinct from 'connected' or projection->'connection'->>'verified' is distinct from 'true'
   or not exists(select 1 from private.es02_b3_connection_links l join private.es02_b3_connection_attempts t on t.id=l.attempt_id
    where l.company_id=p_company and l.branch_id=p_branch and l.channel=ch and l.status='active' and l.revoked_at is null and l.verified
    and t.status='bound' and private.es02_b3_pin_matches(t,channel_binding)) then
   return jsonb_build_object('ok',false,'code','CHANNEL_PROOF_CHANGED');end if;
 end loop;
 select revision into hours from private.es02_branch_hours where company_id=p_company and branch_id=p_branch;
 select reply_language into lang from private.es02_branch_reply_language_confirmations where company_id=p_company and branch_id=p_branch;
 knowledge:=private.es02_branch_knowledge_revision(p_company,p_branch);
 persona:=case r.persona when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end;
 if hours is null or hours<1 or lang is null or knowledge='no_knowledge'
  or not exists(select 1 from private.es02_branch_launch_confirmations where company_id=p_company and branch_id=p_branch and confirmed)
  or not exists(select 1 from private.es02_branch_assistant_trials t join public.ai_usage_ledger l on l.id=t.execution_id
   where t.company_id=p_company and t.branch_id=p_branch and t.origin='engine' and t.persona=persona
   and t.hours_revision=hours and t.language_code=lang and t.knowledge_revision=knowledge
   and l.company_id=p_company and l.usage_mode='setup_trial' and l.status='success') then
  return jsonb_build_object('ok',false,'code','CURRENT_BRANCH_READINESS_REQUIRED');end if;
 select * into sub from public.billing_subscriptions where company_id=p_company and environment='live';
 if sub.id is null or sub.plan_version_id is not null then
  return jsonb_build_object('ok',false,'code','SUBSCRIPTION_BINDING_REQUIRED');end if;
 if (a.clock_state='waiting_readiness' and (sub.status is distinct from 'awaiting_payment' or sub.paid_through is not null))
  or (a.clock_state='active' and (sub.status not in ('active','cancel_at_period_end') or sub.status is null
    or sub.paid_through is distinct from a.paid_through_at)) then
  return jsonb_build_object('ok',false,'code','SUBSCRIPTION_INACTIVE');end if;
 return jsonb_build_object('ok',true,'company_id',p_company,'branch_id',p_branch,'order_id',o.id,'order_group_id',a.order_group_id,
  'slot_index',r.slot_index,'paid_fingerprint',binding->>'paidFingerprint','persona',persona,'subscription_id',sub.id,
  'period_start',private.wa_worker_month());
exception when lock_not_available or deadlock_detected then
 return jsonb_build_object('ok',false,'code','AUTHORITY_BUSY');
end;$function$

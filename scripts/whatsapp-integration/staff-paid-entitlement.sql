-- TEST ONLY: isolated PostgreSQL, synthetic payment receipts and Meta evidence.
-- Run after fixtures.sql. No network/provider calls; roll back every fixture.
begin;

create function pg_temp.staff_paid_fixture(p_environment text default 'live',p_period interval default interval '1 day',
 p_proven boolean default true,p_reversed boolean default false) returns jsonb language plpgsql as $$
declare f jsonb:=test_fixture.company(false);sid uuid:=gen_random_uuid();oid uuid:=gen_random_uuid();
 aid uuid:=gen_random_uuid();eid uuid:=gen_random_uuid();gid uuid:=gen_random_uuid();iid uuid:=gen_random_uuid();
 deadline timestamptz:=clock_timestamp()+p_period;n text:=gen_random_uuid()::text;raw jsonb;
begin
 if p_environment is not null then
  insert into public.billing_subscriptions(id,company_id,plan_version_id,status,environment,paid_through)
  values(sid,(f->>'company')::uuid,(f->>'plan_version')::uuid,'active',p_environment,deadline);
  if p_proven then
   -- Complete immutable receipt identity, matching the established isolated AI fixtures.
   insert into public.billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,
    provider_account_ref,provider_environment,provider_amount,provider_amount_unit,special_reference,client_op_id,input_fingerprint,
    status,product_code,purchase_purpose,created_by,deadline_policy_approved)
   values(oid,(f->>'company')::uuid,(f->>'plan_version')::uuid,5000,'OMR',30,'day',30,
    '74002',p_environment,5000,'paymob_amount','staff-ref-'||n,'staff-op-'||n,'staff-fp-'||n,
    'closed','velora_ai_staff','initial',(f->>'user')::uuid,true);
   insert into public.billing_payment_attempts(id,order_id,company_id,status,provider_order_id)
   values(aid,oid,(f->>'company')::uuid,'paid','staff-order-'||n);
   raw:=jsonb_build_object('provider_transaction_id','staff-tx-'||n,'provider_order_id','staff-order-'||n,
    'hmac_verified',true,'event_status','success','amount_cents',5000,'currency','OMR','integration_id',74002,'signed_owner','84001'::text,
    'pending',false,'success',true,'error_occured',false,'is_auth',false,'is_capture',false,'is_voided',false,'is_refunded',false,
    'has_parent_transaction',false,'is_standalone_payment',true);
   insert into public.billing_provider_events(id,payment_attempt_id,company_id,provider_account_ref,provider_environment,
    provider_transaction_id,event_status,observation_key,amount_baisa_expected,currency_expected,raw_summary)
   values(eid,aid,(f->>'company')::uuid,'74002',p_environment,'staff-tx-'||n,'success','staff-observation',5000,'OMR',raw);
   insert into public.billing_entitlement_applications(id,company_id,order_id,subscription_id,payment_attempt_id,
    provider_account_ref,provider_environment,provider_transaction_id,provider_event_id,applied_paid_through,period_days,period_unit,period_count)
   values(gid,(f->>'company')::uuid,oid,sid,aid,'74002',p_environment,'staff-tx-'||n,eid,deadline,30,'day',30);
   insert into public.billing_settlement_outcomes(company_id,order_id,payment_attempt_id,provider_account_ref,provider_environment,
    provider_transaction_id,provider_event_id,entitlement_application_id,outcome,evidence_marker,authenticity_method,applied_paid_through)
   values((f->>'company')::uuid,oid,aid,'74002',p_environment,'staff-tx-'||n,eid,gid,'granted','VEL_PAYMOB_SERVER_HMAC_VERIFIED',
    case when p_environment='test' then 'authorized_synthetic_test' else 'paymob_hmac_verified' end,deadline);
   if p_reversed then update public.billing_entitlement_applications set status='revoked' where id=gid;end if;
  end if;
 end if;
 perform test_fixture.job(f); -- Signed exact WABA/phone evidence opens the actual service window.
 insert into public.whatsapp_send_intents(id,client_op_id,company_id,conversation_id,phone_number_id,recipient_wa_id,
  body,sender_kind,actor_user_id,link_id,link_generation)
 select iid,'staff-paid-'||n,c.company_id,c.id,c.phone_number_id,c.customer_wa_id,'Synthetic staff reply','staff',
  (f->>'user')::uuid,l.id,l.generation from public.whatsapp_conversations c join public.whatsapp_company_links l on l.company_id=c.company_id
 where c.id=(f->>'conversation')::uuid;
 return f||jsonb_build_object('intent',iid,'subscription',sid,'deadline',deadline,'grant',gid);
end;$$;

set local role service_role;
do $$ declare scenario text;f jsonb;r jsonb;before_state jsonb;begin
 foreach scenario in array array['unpaid','expired','test_only','quarantined','unproved_live','reversed'] loop
  f:=case scenario
   when 'unpaid' then pg_temp.staff_paid_fixture(null,interval '1 day',false)
   when 'expired' then pg_temp.staff_paid_fixture('live',interval '-1 hour')
   when 'test_only' then pg_temp.staff_paid_fixture('test')
   when 'quarantined' then pg_temp.staff_paid_fixture('quarantined',interval '1 day',false)
   when 'unproved_live' then pg_temp.staff_paid_fixture('live',interval '1 day',false)
   when 'reversed' then pg_temp.staff_paid_fixture('live',interval '1 day',true,true) end;
  select to_jsonb(i) into before_state from public.whatsapp_send_intents i where id=(f->>'intent')::uuid;
  r:=public.claim_whatsapp_send_attempt((f->>'intent')::uuid,(f->>'user')::uuid,90);
  if r->>'ok' is distinct from 'false' or r->>'code' is distinct from 'subscription_inactive'
   then raise exception '% staff dispatch not denied by paid entitlement (code: %)',scenario,r->>'code';end if;
  if r ? 'attempt_token' or r ? 'manual_paid_entitlement' or
   (select to_jsonb(i) from public.whatsapp_send_intents i where id=(f->>'intent')::uuid) is distinct from before_state
   or exists(select 1 from public.whatsapp_messages where company_id=(f->>'company')::uuid and direction='outbound')
   then raise exception '% denial changed intent/attempt/outbound evidence',scenario;end if;
 end loop;
end;$$;
select 'PASS|Staff unpaid expired Test-only quarantined unproved and reversed receipts deny dispatch without allocating an attempt';

do $$ declare f jsonb:=pg_temp.staff_paid_fixture();r jsonb;proof jsonb;begin
 update public.billing_plan_versions set status='retired' where id=(f->>'plan_version')::uuid;
 r:=public.claim_whatsapp_send_attempt((f->>'intent')::uuid,(f->>'user')::uuid,90);proof:=r->'manual_paid_entitlement';
 if r->>'ok' is distinct from 'true' or r->>'claimed' is distinct from 'true' or nullif(r->>'attempt_token','') is null
  or r->'intent'->>'outcome' is distinct from 'attempting' or proof->>'company_id' is distinct from f->>'company'
  or proof->>'environment' is distinct from 'live' or proof->>'plan_version_id' is distinct from f->>'plan_version'
  or (proof->>'paid_through')::timestamptz is distinct from (f->>'deadline')::timestamptz
  then raise exception 'valid proven Live claim omitted exact paid attestation';end if;
end;$$;
select 'PASS|Proven current Live receipt authorizes one staff claim with exact company plan and expiry including retired paid plans';

do $$ declare f jsonb:=pg_temp.staff_paid_fixture();other jsonb:=test_fixture.company(false);r jsonb;before_state jsonb;begin
 select to_jsonb(i) into before_state from public.whatsapp_send_intents i where id=(f->>'intent')::uuid;
 r:=public.claim_whatsapp_send_attempt((f->>'intent')::uuid,(other->>'user')::uuid,90);
 if r->>'code' is distinct from 'forbidden' then raise exception 'foreign tenant actor bypassed original capability guard';end if;
 r:=public.claim_whatsapp_send_attempt((f->>'intent')::uuid,null,90);
 if r->>'code' is distinct from 'invalid_input' then raise exception 'missing actor bypassed original claim guard';end if;
 if (select to_jsonb(i) from public.whatsapp_send_intents i where id=(f->>'intent')::uuid) is distinct from before_state
  then raise exception 'wrong actor changed attempt evidence';end if;
 update public.whatsapp_company_links set authorization_expires_at=clock_timestamp()-interval '1 second' where id=(f->>'link')::uuid;
 r:=public.claim_whatsapp_send_attempt((f->>'intent')::uuid,(f->>'user')::uuid,90);
 if r->>'ok' is distinct from 'false' then raise exception 'paid receipt bypassed current Meta authorization';end if;
end;$$;
select 'PASS|Paid proof preserves original foreign actor tenant missing actor and current Meta authorization fences';

do $$ declare outcome text;f jsonb;r jsonb;token uuid;before_state jsonb;begin
 foreach outcome in array array['accepted','unknown','rejected','attempting'] loop
  f:=pg_temp.staff_paid_fixture();r:=public.claim_whatsapp_send_attempt((f->>'intent')::uuid,(f->>'user')::uuid,90);
  token:=(r->>'attempt_token')::uuid;
  if outcome<>'attempting' then
   r:=public.finalize_whatsapp_send_attempt((f->>'intent')::uuid,token,outcome,
    case when outcome='accepted' then 'wamid.synthetic-staff-'||gen_random_uuid() else null end,
    case when outcome<>'accepted' then 'synthetic-staff-outcome' else null end,(f->>'user')::uuid);
   if r->>'ok' is distinct from 'true' then raise exception 'historical fixture finalization failed';end if;
  end if;
  update public.billing_subscriptions set paid_through=clock_timestamp()-interval '1 second' where id=(f->>'subscription')::uuid;
  select to_jsonb(i) into before_state from public.whatsapp_send_intents i where id=(f->>'intent')::uuid;
  r:=public.claim_whatsapp_send_attempt((f->>'intent')::uuid,(f->>'user')::uuid,90);
  if outcome='attempting' then
   if r->>'code' is distinct from 'in_progress' then raise exception 'expiry damaged in-progress claim';end if;
  elsif r->>'ok' is distinct from 'true' or r->>'claimed' is distinct from 'false' or r->'intent'->>'outcome' is distinct from outcome then
   raise exception 'expiry damaged historical % outcome',outcome;
  end if;
  if r ? 'manual_paid_entitlement' or r ? 'attempt_token' or
   (select to_jsonb(i) from public.whatsapp_send_intents i where id=(f->>'intent')::uuid) is distinct from before_state
   then raise exception 'historical % replay replaced dispatch evidence',outcome;end if;
 end loop;
end;$$;
select 'PASS|Subscription expiry preserves accepted unknown rejected and in-progress history without a new dispatch or attestation';

reset role;
do $$ declare pub regprocedure:='public.claim_whatsapp_send_attempt(uuid,uuid,integer)'::regprocedure;
 legacy regprocedure:='private.wa_claim_staff_pre_paid_entitlement(uuid,uuid,integer)'::regprocedure;begin
 if has_function_privilege('anon',pub,'execute') or has_function_privilege('authenticated',pub,'execute')
  or not has_function_privilege('service_role',pub,'execute') then raise exception 'invalid staff paid claim ACL';end if;
 if has_function_privilege('anon',legacy,'execute') or has_function_privilege('authenticated',legacy,'execute')
  or has_function_privilege('service_role',legacy,'execute') then raise exception 'paid claim private chain bypass is exposed';end if;
end;$$;
set local role anon;
do $$ begin
 begin perform public.claim_whatsapp_send_attempt(gen_random_uuid(),gen_random_uuid(),90);
  raise exception 'anonymous claimed staff dispatch';exception when insufficient_privilege then null;end;
end;$$;
set local role authenticated;
do $$ begin
 begin perform public.claim_whatsapp_send_attempt(gen_random_uuid(),gen_random_uuid(),90);
  raise exception 'authenticated directly claimed staff dispatch';exception when insufficient_privilege then null;end;
end;$$;
select 'PASS|Staff paid claim remains service-only and private pre-entitlement chain cannot be called directly';
rollback;

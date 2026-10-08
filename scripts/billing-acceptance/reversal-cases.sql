-- TEST ONLY: synthetic tenants, provider identifiers and amounts. Real isolated
-- PostgreSQL executes the actual Billing functions; no provider/cloud calls.
begin;
create temporary sequence lifecycle_fixture_ids start 910000;
create function pg_temp.lifecycle_payment(p_company uuid default null, p_env text default 'test', p_expired boolean default false)
returns jsonb language plpgsql as $$
declare c uuid:=coalesce(p_company,gen_random_uuid()); p uuid:=gen_random_uuid(); v uuid:=gen_random_uuid();
 o uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); n text:=nextval('pg_temp.lifecycle_fixture_ids')::text;
begin
 insert into public.companies(id,display_name,status) values(c,'Synthetic lifecycle tenant','active') on conflict do nothing;
 insert into public.billing_plans(id,code,name,status) values(p,'fixture-'||n,'Synthetic lifecycle plan','active');
 insert into public.billing_plan_versions(id,plan_id,version,amount_baisa,period_days,period_unit,period_count,status)
 values(v,p,1,1000,30,'day',30,'published');
 insert into public.billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,
 provider_account_ref,provider_environment,provider_amount,provider_amount_unit,special_reference,client_op_id,input_fingerprint,
 product_code,purchase_purpose,status,expires_at)
 values(o,c,v,1000,'OMR',30,'day',30,'901',p_env,12345,'paymob_amount','fixture-'||n,'fixture-'||n,'fixture-'||n,
 'velora_ai_staff','initial','submitted',clock_timestamp()+case when p_expired then interval '-1 minute' else interval '1 hour' end);
 insert into public.billing_payment_attempts(id,order_id,company_id,status,provider_order_id,attempt_seq)
 values(a,o,c,'provider_submitted',n,1);
 return jsonb_build_object('company_id',c,'order_id',o,'payment_attempt_id',a,'provider','paymob','provider_account_ref','901',
 'provider_environment',p_env,'provider_transaction_id',n||'1','special_reference','fixture-'||n,'amount_baisa',1000,'currency','OMR',
 'provider_order_id',n,'provider_amount',12345);
end; $$;

create function pg_temp.lifecycle_event(f jsonb, kind text default 'success') returns jsonb language plpgsql as $$
declare eid uuid:=gen_random_uuid(); st text:=case when kind='success' then 'success' else 'other' end; summary jsonb;
begin
 summary:=jsonb_build_object('provider_transaction_id',f->>'provider_transaction_id','provider_order_id',f->>'provider_order_id',
 'event_status',st,'hmac_verified',true,'amount_cents',(f->>'provider_amount')::bigint,'currency','OMR','integration_id',901,'signed_owner','900',
 'pending',false,'success',true,'error_occured',false,'is_auth',false,'is_capture',false,'is_voided',kind='voided',
 'is_refunded',kind='refunded','has_parent_transaction',false,'is_standalone_payment',true);
 insert into public.billing_provider_events(id,payment_attempt_id,provider,provider_account_ref,provider_environment,
 provider_transaction_id,event_status,observation_key,company_id,amount_baisa_expected,currency_expected,raw_summary)
 values(eid,(f->>'payment_attempt_id')::uuid,'paymob','901',f->>'provider_environment',f->>'provider_transaction_id',st,kind,
 (f->>'company_id')::uuid,1000,'OMR',summary);
 return f||jsonb_build_object('event_status',st,'observation_key',kind,'provider_event_id',eid,
 'evidence_marker','VEL_PAYMOB_SERVER_HMAC_VERIFIED','authenticity',jsonb_build_object('source','server_adapter_attestation',
 'verified',true,'method','paymob_hmac_sha512'));
end; $$;

do $$ declare f jsonb:=pg_temp.lifecycle_payment(); r jsonb; begin
 r:=private.billing_apply_reversal((f->>'company_id')::uuid,(f->>'order_id')::uuid,(f->>'payment_attempt_id')::uuid,'voided','{}');
 if coalesce((r->>'ok')::boolean,false) then raise exception 'unsigned reversal accepted'; end if;
 if (select status from public.billing_orders where id=(f->>'order_id')::uuid)<>'submitted' then raise exception 'unsigned reversal changed order'; end if;
end; $$;
select 'PASS|unsigned reversal rejected without mutation';

do $$ declare f jsonb:=pg_temp.lifecycle_event(pg_temp.lifecycle_payment()); r jsonb; begin
 r:=public.billing_settle_paymob_hmac_verified(f-'authenticity');
 if coalesce((r->>'ok')::boolean,false) then raise exception 'missing HMAC attestation accepted'; end if;
end; $$;
select 'PASS|missing HMAC attestation rejected';

do $$ declare f jsonb:=pg_temp.lifecycle_event(pg_temp.lifecycle_payment()); r jsonb; begin
 update public.billing_provider_events set raw_summary=raw_summary-'is_standalone_payment' where id=(f->>'provider_event_id')::uuid;
 r:=public.billing_settle_paymob_hmac_verified(f);
 if coalesce((r->>'ok')::boolean,false) then raise exception 'incomplete lifecycle evidence accepted'; end if;
end; $$;
select 'PASS|incomplete stored lifecycle evidence rejected';

do $$ declare f jsonb:=pg_temp.lifecycle_event(pg_temp.lifecycle_payment()); r jsonb; begin
 r:=public.billing_settle_paymob_hmac_verified(f);
 if r->>'outcome'<>'granted' then raise exception 'valid success not granted: %',r; end if;
 r:=public.billing_settle_paymob_hmac_verified(f);
 if r->>'outcome'<>'idempotent_replay' then raise exception 'repeat success not idempotent: %',r; end if;
 if (select count(*) from public.billing_entitlement_applications where order_id=(f->>'order_id')::uuid)<>1 then raise exception 'duplicate grant'; end if;
 update public.billing_entitlement_applications set status='revoked' where order_id=(f->>'order_id')::uuid;
 r:=public.billing_settle_paymob_hmac_verified(f);
 if r->>'outcome'<>'lifecycle_review' then raise exception 'already revoked grant replay reported active'; end if;
end; $$;
select 'PASS|complete success grants once and revoked replay cannot resurrect';

do $$ declare f jsonb:=pg_temp.lifecycle_payment(); e jsonb; r jsonb; begin
 e:=pg_temp.lifecycle_event(f,'refunded'); r:=public.billing_settle_paymob_hmac_verified(e);
 if r->>'outcome'<>'lifecycle_review' then raise exception 'refund not durably reviewed: %',r; end if;
 e:=pg_temp.lifecycle_event(f,'success'); r:=public.billing_settle_paymob_hmac_verified(e);
 if r->>'outcome'<>'lifecycle_review' then raise exception 'old success bypassed refund review: %',r; end if;
 if exists(select 1 from public.billing_entitlement_applications where order_id=(f->>'order_id')::uuid) then raise exception 'old refunded success granted'; end if;
end; $$;
select 'PASS|refund followed by old success cannot grant';

do $$ declare f jsonb:=pg_temp.lifecycle_event(pg_temp.lifecycle_payment(),'refunded'); r jsonb; begin
 r:=public.billing_settle_paymob_hmac_verified(f); r:=public.billing_settle_paymob_hmac_verified(f);
 if r->>'outcome'<>'lifecycle_review' then raise exception 'refund repeat lost review: %',r; end if;
 if (select count(*) from private.billing_lifecycle_reviews where provider_event_id=(f->>'provider_event_id')::uuid)<>1 then raise exception 'duplicate refund review'; end if;
end; $$;
select 'PASS|refund replay creates one durable review';

do $$ declare older jsonb:=pg_temp.lifecycle_payment(); newer jsonb; r jsonb; paid timestamptz; sid uuid; begin
 r:=public.billing_settle_paymob_hmac_verified(pg_temp.lifecycle_event(older));
 newer:=pg_temp.lifecycle_payment((older->>'company_id')::uuid);
 r:=public.billing_settle_paymob_hmac_verified(pg_temp.lifecycle_event(newer));
 select id,paid_through into sid,paid from public.billing_subscriptions where company_id=(older->>'company_id')::uuid and environment='test';
 r:=public.billing_settle_paymob_hmac_verified(pg_temp.lifecycle_event(older,'refunded'));
 if r->>'outcome'<>'lifecycle_review' then raise exception 'old refund not reviewed: %',r; end if;
 if (select status from public.billing_subscriptions where id=sid)<>'active' or (select paid_through from public.billing_subscriptions where id=sid) is distinct from paid then raise exception 'old refund damaged newer entitlement'; end if;
 if (select status from public.billing_entitlement_applications where order_id=(newer->>'order_id')::uuid)<>'active' then raise exception 'newer grant revoked'; end if;
 r:=public.billing_settle_paymob_hmac_verified(older||jsonb_build_object('event_status','success','observation_key','success',
 'evidence_marker','VEL_PAYMOB_SERVER_HMAC_VERIFIED','authenticity',jsonb_build_object('source','server_adapter_attestation','verified',true,'method','paymob_hmac_sha512')));
 if r->>'outcome'<>'lifecycle_review' then raise exception 'old success replay resurrected refunded purchase'; end if;
end; $$;
select 'PASS|old refund preserves newer valid purchase and blocks old replay';

do $$ declare f jsonb:=pg_temp.lifecycle_event(pg_temp.lifecycle_payment(),'voided'); r jsonb; begin
 r:=public.billing_settle_paymob_hmac_verified(f);
 if r->>'outcome'<>'lifecycle_review' then raise exception 'void was conflated with cancellation/refund: %',r; end if;
 if not exists(select 1 from private.billing_lifecycle_reviews where provider_event_id=(f->>'provider_event_id')::uuid and reason='void_review') then raise exception 'void review missing'; end if;
end; $$;
select 'PASS|void has distinct review evidence';

do $$ declare f jsonb:=pg_temp.lifecycle_event(pg_temp.lifecycle_payment(),'refunded'); r jsonb; begin
 update public.billing_provider_events set raw_summary=raw_summary||jsonb_build_object('has_parent_transaction',true,'is_standalone_payment',false,'amount_cents',100) where id=(f->>'provider_event_id')::uuid;
 r:=public.billing_settle_paymob_hmac_verified(f);
 if r->>'outcome'<>'lifecycle_review' then raise exception 'partial/parent refund lost evidence'; end if;
 if not exists(select 1 from private.billing_lifecycle_reviews where provider_event_id=(f->>'provider_event_id')::uuid and reason='refund_extent_or_parent_unconfirmed') then raise exception 'unverified parent/extent treated as full refund'; end if;
end; $$;
select 'PASS|partial or parent refund extent remains unconfirmed';

do $$ declare f jsonb:=pg_temp.lifecycle_event(pg_temp.lifecycle_payment(null,'test',true)); r jsonb; begin
 r:=public.billing_settle_paymob_hmac_verified(f);
 if r->>'outcome'<>'late_payment_review' then raise exception 'late payment auto-granted: %',r; end if;
 if exists(select 1 from public.billing_entitlement_applications where order_id=(f->>'order_id')::uuid) then raise exception 'late payment grant present'; end if;
 if not exists(select 1 from private.billing_lifecycle_reviews where provider_event_id=(f->>'provider_event_id')::uuid and reason='late_payment_policy_unapproved') then raise exception 'late financial evidence lost'; end if;
end; $$;
select 'PASS|late confirmation retained for owner review without grant';

do $$ declare f jsonb:=pg_temp.lifecycle_event(pg_temp.lifecycle_payment()); r jsonb; begin
 r:=private.billing_apply_reversal((f->>'company_id')::uuid,(f->>'order_id')::uuid,(f->>'payment_attempt_id')::uuid,'cancelled',f);
 if coalesce((r->>'ok')::boolean,false) then raise exception 'payment cancellation conflated with renewal cancellation'; end if;
 if exists(select 1 from private.billing_lifecycle_reviews where order_id=(f->>'order_id')::uuid) then raise exception 'unsigned cancellation altered payment state'; end if;
end; $$;
select 'PASS|payment cancellation never becomes subscription cancellation';

do $$ declare f jsonb:=pg_temp.lifecycle_event(pg_temp.lifecycle_payment(null,'live',false)); r jsonb; begin
 r:=public.billing_settle_paymob_hmac_verified(f);
 if r->>'outcome'<>'deadline_policy_review' then raise exception 'Live unapproved deadline auto-granted: %',r; end if;
 if exists(select 1 from public.billing_entitlement_applications where order_id=(f->>'order_id')::uuid) then raise exception 'unapproved Live grant exists'; end if;
 if not exists(select 1 from private.billing_lifecycle_reviews where provider_event_id=(f->>'provider_event_id')::uuid and reason='deadline_policy_unapproved') then raise exception 'Live deadline review evidence missing'; end if;
end; $$;
select 'PASS|Live first grant requires separately approved deadline policy';

do $$ begin
 if has_function_privilege('anon','public.billing_settle_paymob_hmac_verified(jsonb)','EXECUTE') or has_function_privilege('authenticated','public.billing_settle_paymob_hmac_verified(jsonb)','EXECUTE') then raise exception 'browser settlement privileges'; end if;
 if has_function_privilege('service_role','private.billing_apply_reversal(uuid,uuid,uuid,text,jsonb)','EXECUTE') or has_function_privilege('anon','private.billing_apply_reversal(uuid,uuid,uuid,text,jsonb)','EXECUTE') then raise exception 'unguarded reversal helper externally callable'; end if;
end; $$;
select 'PASS|server-only entry and inaccessible internal reversal helper';
rollback;

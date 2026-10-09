-- Synthetic existing-data fixture inserted before historical P1 migration.
-- No customer identifiers, provider calls, cloud SQL or production seeds.
insert into auth.users(id,email) values(md5('acceptance-upgrade-user')::uuid,'upgrade@test.invalid');
insert into public.billing_plans(id,code,name,status) values(md5('acceptance-upgrade-plan')::uuid,'upgrade_fixture','Upgrade fixture','active');
insert into public.billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status,limits)
 values(md5('acceptance-upgrade-version')::uuid,md5('acceptance-upgrade-plan')::uuid,1,5000,'OMR',30,'day',30,'published',
 '{"automated_outbound_per_month":100}'::jsonb);
do $$
declare scenario text; env text; sub_id uuid; company_id_value uuid; order_id_value uuid;
 attempt_id uuid; event_id uuid; grant_id uuid; tx text; raw jsonb; scope_env text;
begin
 foreach scenario in array array['test','live','unknown','incomplete','mixed','reversed','reversed_with_newer_live',
  'actual_reversed_with_newer_live','revoked_unverified_with_newer_live','snapshot_mismatch',
  'manual_suspended_live','past_due_live','security_suspended_actual_reversal','company_only_suspended_live',
  'unattested_live','missing_owner_live','unsupported_marker_live','malformed_owner_live'] loop
  company_id_value:=md5('acceptance-upgrade-company-'||scenario)::uuid;
  sub_id:=md5('acceptance-upgrade-sub-'||scenario)::uuid;
  insert into public.companies(id,display_name,status,created_by)
   values(company_id_value,'Upgrade '||scenario,'active',md5('acceptance-upgrade-user')::uuid);
  insert into public.billing_subscriptions(id,company_id,plan_version_id,status,paid_through)
   values(sub_id,company_id_value,md5('acceptance-upgrade-version')::uuid,'active',clock_timestamp()+interval '20 days');
  if scenario='unknown' then continue;end if;
  foreach env in array case when scenario='mixed' then array['test','live']
   when scenario in ('reversed_with_newer_live','actual_reversed_with_newer_live','revoked_unverified_with_newer_live','security_suspended_actual_reversal','manual_suspended_live') then array['live','live_new']
   when scenario='test' then array['test'] else array['live'] end loop
   scope_env:=case when env='live_new' then 'live' else env end;
   order_id_value:=md5('acceptance-upgrade-order-'||scenario||env)::uuid;
   attempt_id:=md5('acceptance-upgrade-attempt-'||scenario||env)::uuid;
   event_id:=md5('acceptance-upgrade-event-'||scenario||env)::uuid;
   grant_id:=md5('acceptance-upgrade-grant-'||scenario||env)::uuid;
   tx:='fixture-tx-'||scenario||env;
   insert into public.billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,
    provider_account_ref,provider_environment,provider_amount,provider_amount_unit,special_reference,client_op_id,input_fingerprint,
    status,product_code,purchase_purpose,created_by)
    values(order_id_value,company_id_value,md5('acceptance-upgrade-version')::uuid,5000,'OMR',30,'day',30,
     '71610',scope_env,5000,'paymob_amount','fixture-ref-'||scenario||env,'fixture-op-'||scenario||env,'fixture-fp-'||scenario||env,
     'closed','velora_ai_staff','initial',md5('acceptance-upgrade-user')::uuid);
   insert into public.billing_payment_attempts(id,order_id,company_id,status,provider_order_id)
    values(attempt_id,order_id_value,company_id_value,'paid','fixture-provider-order-'||scenario||env);
   -- Explicit synthetic receiver attestation; never inferred from an RPC label.
   raw:=jsonb_build_object('provider_transaction_id',tx,'provider_order_id','fixture-provider-order-'||scenario||env,
    'hmac_verified',true,'event_status','success','amount_cents',5000,'currency','OMR','integration_id',71610,'signed_owner','999'::text,
    'pending',false,'success',true,'error_occured',false,'is_auth',false,'is_capture',false,'is_refunded',false,
    'is_voided',false,'has_parent_transaction',false,'is_standalone_payment',true);
   if scenario='incomplete' or (scenario='revoked_unverified_with_newer_live' and env='live') then raw:='{}'::jsonb;end if;
   if scenario='unattested_live' then raw:=raw-'hmac_verified';end if;
   if scenario='missing_owner_live' then raw:=raw-'signed_owner';end if;
   if scenario='malformed_owner_live' then raw:=raw||'{"signed_owner":"not-an-owner"}'::jsonb;end if;
   insert into public.billing_provider_events(id,payment_attempt_id,provider_account_ref,provider_environment,provider_transaction_id,
    event_status,company_id,amount_baisa_expected,currency_expected,raw_summary)
    values(event_id,attempt_id,'71610',scope_env,tx,'success',company_id_value,5000,'OMR',raw);
   insert into public.billing_entitlement_applications(id,company_id,order_id,subscription_id,payment_attempt_id,provider_account_ref,
    provider_environment,provider_transaction_id,provider_event_id,applied_paid_through,period_days,period_unit,period_count,applied_at)
    values(grant_id,company_id_value,order_id_value,sub_id,attempt_id,'71610',scope_env,tx,event_id,
     clock_timestamp()+interval '20 days',30,'day',case when scenario='snapshot_mismatch' then 99 else 30 end,clock_timestamp());
   insert into public.billing_settlement_outcomes(company_id,order_id,payment_attempt_id,provider_account_ref,provider_environment,
    provider_transaction_id,provider_event_id,entitlement_application_id,outcome,evidence_marker,authenticity_method,applied_paid_through)
    select company_id_value,order_id_value,attempt_id,'71610',scope_env,tx,event_id,grant_id,'granted',
     case when scenario='unsupported_marker_live' then 'obs:unsupported-fixture' else 'VEL_PAYMOB_SERVER_HMAC_VERIFIED' end,
     'paymob_hmac_verified',applied_paid_through from public.billing_entitlement_applications where id=grant_id;
   if scenario='reversed' or (scenario='reversed_with_newer_live' and env='live') then
    insert into public.billing_provider_events(payment_attempt_id,provider_account_ref,provider_environment,provider_transaction_id,
     event_status,observation_key,company_id,amount_baisa_expected,currency_expected,raw_summary)
     values(attempt_id,'71610',scope_env,tx,'other','fixture-refund',company_id_value,5000,'OMR',raw||'{"is_refunded":true}'::jsonb);
   end if;
  end loop;
 end loop;
end;$$;

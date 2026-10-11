-- Synthetic historical-state construction only, in an owned disposable database.
-- Deadlines are inserted once; no immutable order is edited and no trigger is disabled.
create or replace function test_fixture.expired_live_collection(f jsonb,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid:=gen_random_uuid();a uuid:=gen_random_uuid();c uuid:=(f->>'company')::uuid;v uuid:=(f->>'version')::uuid;u uuid:=(f->>'actor')::uuid;begin
 perform set_config('velora.live_checkout_contract',f->>'contract',true);
 perform set_config('velora.live_checkout_session',f->>'session',true);
 insert into public.billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,provider_account_ref,provider_environment,
 special_reference,client_op_id,input_fingerprint,status,created_by,created_at,expires_at,product_code,purchase_purpose)
 values(o,c,v,45000,'OMR',30,'month',1,f->>'integration','live','synthetic-expired-'||o,'synthetic-expired-'||o,'synthetic-expired-'||o,
 case when p_mode='submitted_unpaid' then 'submitted' else 'locked' end,u,clock_timestamp()-interval '3 hours',clock_timestamp()-interval '1 hour','velora_ai_staff','initial');
 insert into private.billing_service_order_offers(order_id,plan_version_id,service_code,tier,capabilities,environment)
 select o,v,service_code,tier,capabilities,'live' from private.billing_service_offers where plan_version_id=v;
 insert into private.billing_live_order_bindings(order_id,contract_id,plan_version_id,allowance_cap,monthly_limit_baisa)
 values(o,(f->>'contract')::uuid,v,500,5000);
 insert into public.billing_payment_attempts(id,order_id,company_id,status,provider_order_id,provider,provider_account_ref,provider_environment)
 values(a,o,c,case when p_mode='submitted_unpaid' then 'provider_submitted' else 'unresolved' end,
 case when p_mode='submitted_unpaid' then '900001' else null end,'paymob',f->>'integration','live');
 insert into private.billing_live_checkouts(payment_attempt_id,order_id,company_id,status,checkout_url,provider_intention_id)
 values(a,o,c,case when p_mode='submitted_unpaid' then 'ready' else 'claiming' end,
 case when p_mode='submitted_unpaid' then 'https://om.checkout.paymob.com/?publicKey=om_pk_live_SYNTHETIC&clientSecret=synthetic_live_secret' else null end,
 case when p_mode='submitted_unpaid' then 'synthetic-live-intention' else null end);
 return jsonb_build_object('ok',true,'order_id',o,'payment_attempt_id',a);
end;$$;
revoke all on function test_fixture.expired_live_collection(jsonb,text) from public,anon,authenticated,service_role;

create or replace function test_fixture.expired_test_collection(f jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare o uuid:=gen_random_uuid();a uuid:=gen_random_uuid();c uuid:=(f->>'company')::uuid;v uuid:=(f->>'version')::uuid;begin
 insert into public.billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,provider_account_ref,provider_environment,
 special_reference,client_op_id,input_fingerprint,status,created_by,created_at,expires_at,product_code,purchase_purpose)
 values(o,c,v,45000,'OMR',30,'month',1,'71610','test','synthetic-test-expired-'||o,'synthetic-test-expired-'||o,'synthetic-test-expired-'||o,
 'locked',(f->>'actor')::uuid,clock_timestamp()-interval '3 hours',clock_timestamp()-interval '1 hour','velora_ai_staff','initial');
 insert into private.billing_service_order_offers(order_id,plan_version_id,service_code,tier,capabilities,environment)
 select o,v,service_code,tier,capabilities,'test' from private.billing_service_offers where plan_version_id=v;
 insert into public.billing_payment_attempts(id,order_id,company_id,status,provider,provider_account_ref,provider_environment)
 values(a,o,c,'unresolved','paymob','71610','test');
 return o;
end;$$;
revoke all on function test_fixture.expired_test_collection(jsonb) from public,anon,authenticated,service_role;

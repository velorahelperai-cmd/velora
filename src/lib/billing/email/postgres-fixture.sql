-- Synthetic dependency tables only; the two receipt-proof views are loaded from the actual source migration.
create role anon;create role authenticated;create role service_role;
create schema private;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
create table public.companies(id uuid primary key,display_name text,status text);
create table public.company_members(company_id uuid,user_id uuid,role text,status text);
create table public.billing_plan_versions(id uuid primary key,amount_baisa bigint,currency text,period_days integer,period_unit text,period_count integer);
create table public.billing_orders(id uuid primary key,company_id uuid,plan_version_id uuid,amount_baisa bigint,currency text,period_days integer,period_unit text,period_count integer,provider text,provider_account_ref text,provider_environment text,provider_amount bigint,provider_amount_unit text,status text,created_by uuid);
create table public.billing_subscriptions(id uuid primary key,company_id uuid,environment text,status text,paid_through timestamptz);
create table public.billing_payment_attempts(id uuid primary key,order_id uuid,company_id uuid,provider text,provider_account_ref text,provider_environment text,provider_order_id text,status text);
create table public.billing_provider_events(id uuid primary key,payment_attempt_id uuid,company_id uuid,provider text,provider_account_ref text,provider_environment text,provider_transaction_id text,event_status text,amount_baisa_expected bigint,currency_expected text,raw_summary jsonb);
create table public.billing_entitlement_applications(id uuid primary key,company_id uuid,order_id uuid,subscription_id uuid,payment_attempt_id uuid,provider text,provider_account_ref text,provider_environment text,provider_transaction_id text,provider_event_id uuid,previous_paid_through timestamptz,applied_paid_through timestamptz,period_days integer,applied_at timestamptz,period_unit text,period_count integer,status text);
create table public.billing_settlement_outcomes(id uuid primary key,company_id uuid,order_id uuid,payment_attempt_id uuid,provider text,provider_account_ref text,provider_environment text,provider_transaction_id text,provider_event_id uuid,entitlement_application_id uuid,outcome text,evidence_marker text,authenticity_method text,applied_paid_through timestamptz);
create table private.billing_service_order_offers(order_id uuid primary key,environment text,service_code text);
-- Clearly synthetic admin-session dependency; production reuses installed owner/session authority.
create function public.billing_admin_authorized_session() returns boolean language sql as $$select coalesce(current_setting('test.email_admin',true)='true',false)$$;
grant execute on function public.billing_admin_authorized_session() to authenticated;
create function public.email_fixture(p_base integer,p_env text default 'live',p_verified boolean default true) returns uuid language plpgsql as $$
declare company uuid;owner_id uuid;plan uuid;ord uuid;sub uuid;attempt uuid;event uuid;receipt uuid;outcome uuid;deadline timestamptz;begin
 company:=md5('company-'||p_base)::uuid;owner_id:=md5('owner-'||p_base)::uuid;plan:=md5('plan-'||p_base)::uuid;ord:=md5('order-'||p_base)::uuid;sub:=md5('sub-'||p_base)::uuid;attempt:=md5('attempt-'||p_base)::uuid;event:=md5('event-'||p_base)::uuid;receipt:=md5('receipt-'||p_base)::uuid;outcome:=md5('outcome-'||p_base)::uuid;deadline:=now()+interval '1 month';
 insert into auth.users values(owner_id,'synthetic'||p_base||'@example.test',case when p_verified then now() end,null,null);
 insert into companies values(company,'Synthetic Company','active');insert into company_members values(company,owner_id,'owner','active');
 insert into billing_plan_versions values(plan,45000,'OMR',30,'month',1);
 insert into billing_orders values(ord,company,plan,45000,'OMR',30,'month',1,'paymob','123',p_env,45000,'paymob_amount','closed',owner_id);
 insert into billing_subscriptions values(sub,company,p_env,'active',deadline);
 insert into billing_payment_attempts values(attempt,ord,company,'paymob','123',p_env,'provider-order','paid');
 insert into billing_provider_events values(event,attempt,company,'paymob','123',p_env,'txn-'||p_base,'success',45000,'OMR',jsonb_build_object('hmac_verified',true,'signed_owner','123','integration_id',123,'amount_cents',45000,'provider_order_id','provider-order','provider_transaction_id','txn-'||p_base,'currency','OMR','pending',false,'success',true,'error_occured',false,'is_auth',false,'is_capture',false,'is_refunded',false,'is_voided',false,'has_parent_transaction',false,'is_standalone_payment',true));
 insert into billing_entitlement_applications values(receipt,company,ord,sub,attempt,'paymob','123',p_env,'txn-'||p_base,event,null,deadline,30,now(),'month',1,'active');
 insert into private.billing_service_order_offers values(ord,p_env,'noura');
 insert into billing_settlement_outcomes values(outcome,company,ord,attempt,'paymob','123',p_env,'txn-'||p_base,event,receipt,'granted','VEL_PAYMOB_SERVER_HMAC_VERIFIED','paymob_hmac_verified',deadline);
 return receipt;
end; $$;

-- Labelled dependency projections in the existing guarded, networkless disposable
-- Postgres fixture. Native financial proof and provider evidence are independently
-- tested elsewhere; these rows never attest live payment/provider success.
alter table auth.users add column phone text,add column deleted_at timestamptz,add column banned_until timestamptz;
drop index company_members_one_active_owner_per_user;
create table public.billing_plan_versions(id uuid primary key);
create table public.billing_subscriptions(id uuid primary key,company_id uuid,environment text,status text,paid_through timestamptz,plan_version_id uuid,cancel_at_period_end boolean default false);
create table public.billing_orders(id uuid primary key,company_id uuid,created_by uuid,purchase_purpose text);
create table public.billing_provider_events(id uuid primary key,created_at timestamptz);
create table public.billing_entitlement_applications(id uuid primary key);
create table private.fixture_financial_receipts(id uuid primary key,company_id uuid,subscription_id uuid,order_id uuid,provider_event_id uuid,provider_environment text,applied_paid_through timestamptz,applied_at timestamptz,plan_version_id uuid);
create view private.billing_proven_entitlement_grants as select *,id as payment_attempt_id from private.fixture_financial_receipts;
create view private.billing_verified_collection_history as select * from private.fixture_financial_receipts;
create function private.billing_service_receipt_eligible(uuid) returns boolean language sql as $$select true$$;
create function private.billing_ui_company_owner(cid uuid) returns boolean language sql as $$select public.app_session_is_valid() and exists(select 1 from public.company_members where company_id=cid and user_id=auth.uid() and role='owner' and status='active')$$;
create table private.plan_channel_entitlements(plan_version_id uuid primary key,channel_count integer);
create table private.company_selected_channels(company_id uuid primary key,plan_version_id uuid,channels text[],revision bigint default 1);
create table public.whatsapp_company_links(id uuid primary key,company_id uuid,status text,authorization_status text,authorization_expires_at timestamptz,authorization_non_expiring boolean,inbound_tested_at timestamptz,outbound_tested_at timestamptz,keep_on_phone boolean default true,generation bigint default 1,provider_waba_id text default '100',provider_phone_number_id text default '200',authorization_verified_at timestamptz default clock_timestamp(),updated_at timestamptz);
-- Explicit offline provider dependency ports. Native proof producer must verify
-- their join; inserting an arbitrary outbound timestamp is never readiness.
create table public.whatsapp_send_intents(company_id uuid,conversation_id uuid,message_id uuid,wa_message_id text,link_id uuid,link_generation bigint,phone_number_id text,recipient_wa_id text,outcome text,sender_kind text,attempt_started_at timestamptz,body text);
create table public.whatsapp_messages(company_id uuid,conversation_id uuid,id uuid,wa_message_id text,sender text,direction text,body text,delivery_state text);
create table public.whatsapp_delivery_statuses(company_id uuid,message_id uuid,wa_message_id text,phone_number_id text,recipient_wa_id text,status text,occurred_at timestamptz,link_state text);
create table private.whatsapp_coexistence_connections(company_id uuid,link_id uuid,link_generation bigint,status text);
create function private.whatsapp_meta_asset_binding(text,text) returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('ok',true,'eligible',true,'company_id',company_id) from public.whatsapp_company_links where provider_waba_id=$1 and provider_phone_number_id=$2 and status='verified'$$;
create table private.instagram_company_links(id uuid primary key,company_id uuid,generation bigint,account_id text,status text,authorization_expires_at timestamptz,permissions text[]);
create table private.instagram_company_generations(company_id uuid,generation bigint,bound_account_id text);
create table private.instagram_messages(id uuid,company_id uuid,link_id uuid,generation bigint,account_id text,direction text,raw_body_sha256 text);
create table private.instagram_inbound_signatures(message_id uuid,raw_body_sha256 text,verified_at timestamptz);
create table private.instagram_send_intents(company_id uuid,link_id uuid,generation bigint,account_id text,state text,provider_mid text,accepted_at timestamptz);
create table public.whatsapp_inbound_jobs(id uuid,company_id uuid);
create table public.billing_payment_attempts(id uuid primary key,company_id uuid,order_id uuid);
create table public.billing_test_checkouts(payment_attempt_id uuid,company_id uuid,order_id uuid);
create table private.billing_live_merchant_contracts(id uuid);
create table private.billing_service_offers(plan_version_id uuid);
create table private.ai_plan_budget_policies(plan_version_id uuid);
create table private.billing_live_checkouts(payment_attempt_id uuid);
create function private.billing_lifecycle_deadline(t timestamptz,h integer) returns timestamptz language sql immutable set search_path='' as $$select(t at time zone 'UTC'+make_interval(hours=>h)) at time zone 'UTC'$$;
create table private.billing_expiry_episodes(id uuid default gen_random_uuid(),company_id uuid,subscription_id uuid,receipt_id uuid,expired_at timestamptz,purged_at timestamptz,last_checked_at timestamptz,cancelled_at timestamptz,disconnected_at timestamptz,
 disconnect_at timestamptz generated always as(private.billing_lifecycle_deadline(expired_at,720)) stored,delete_at timestamptz generated always as(private.billing_lifecycle_deadline(expired_at,1440)) stored,unique(company_id,expired_at));
create table private.billing_expiry_email_outbox(id uuid default gen_random_uuid(),episode_id uuid,state text,kind text,due_at timestamptz,unique(episode_id,kind));
create table private.fixture_settlement_calls(id integer);
create function public.billing_settle_paymob_hmac_verified(p_evidence jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 insert into private.fixture_settlement_calls values(1);
 return jsonb_build_object('ok',true,'outcome',coalesce(p_evidence->>'outcome','granted'),'entitlement_application_id',p_evidence->>'receipt_id');
end;$$;
insert into public.companies values('11111111-1111-4111-8111-111111111111','Local fixture','active');
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values('22222222-2222-4222-8222-222222222222','fixture@example.invalid',clock_timestamp(),'+96890000000',clock_timestamp());
insert into public.company_members(company_id,user_id,role) values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','owner');
insert into public.billing_plan_versions values('44444444-4444-4444-8444-444444444444');

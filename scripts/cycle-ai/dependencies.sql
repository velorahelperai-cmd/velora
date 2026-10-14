-- Synthetic external financial/activation/health dependencies only. Native
-- worker reservation, accepted receipt settlement and receipt guards below
-- are installed from their actual project source bodies in run-postgres.mjs.
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end;$$;
create schema private;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
grant usage on schema auth,public to authenticated,service_role;
create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
create table public.companies(id uuid primary key,status text,timezone text);
create table public.company_members(company_id uuid,user_id uuid,role text,status text);
create table public.billing_plans(id uuid primary key,code text);
create table public.billing_plan_versions(id uuid primary key,plan_id uuid,limits jsonb,status text,amount_baisa bigint,currency text);
create table public.billing_orders(id uuid primary key,company_id uuid,purchase_purpose text,amount_baisa bigint,currency text,plan_version_id uuid);
create table public.billing_subscriptions(id uuid primary key,company_id uuid,environment text,status text,plan_version_id uuid,paid_through timestamptz);
create table public.billing_entitlement_applications(id uuid primary key,company_id uuid,subscription_id uuid,order_id uuid,plan_version_id uuid,provider_environment text,previous_paid_through timestamptz,applied_paid_through timestamptz,applied_at timestamptz);
create view private.billing_proven_entitlement_grants as select * from public.billing_entitlement_applications;
create view private.billing_verified_collection_history as select * from public.billing_entitlement_applications;
create table private.billing_service_grants(entitlement_application_id uuid,order_id uuid,activated boolean);
create table private.billing_service_order_offers(order_id uuid,environment text,service_code text,tier text,capabilities text[],plan_version_id uuid);
create function private.billing_service_receipt_eligible(uuid) returns boolean language sql as $$select true$$;
create function public.app_session_is_valid() returns boolean language sql as $$select true$$;
create function private.billing_ui_company_owner(cid uuid) returns boolean language sql as $$select exists(select 1 from public.company_members where company_id=cid and user_id=auth.uid() and role='owner' and status='active')$$;
create table private.master_activation_policy(singleton boolean primary key,enabled boolean);
insert into private.master_activation_policy values(true,false);
create table private.master_subscription_activation(receipt_id uuid primary key,company_id uuid,subscription_id uuid,plan_version_id uuid,subscription_started_at timestamptz,expires_at timestamptz,receipt_paid_through timestamptz);
create function private.master_activation_receipt_current(rid uuid) returns boolean language sql as $$select exists(select 1 from private.master_subscription_activation a join public.billing_subscriptions s on s.id=a.subscription_id where a.receipt_id=rid and s.status in('active','cancel_at_period_end'))$$;
create function private.master_activation_can_operate(cid uuid) returns boolean language sql as $$select exists(select 1 from private.master_subscription_activation where company_id=cid and subscription_started_at<=clock_timestamp() and expires_at>clock_timestamp())$$;
create function private.master_activation_company_end(cid uuid) returns timestamptz language sql as $$select max(expires_at) from private.master_subscription_activation where company_id=cid$$;
create table private.company_selected_channels(company_id uuid primary key,plan_version_id uuid,channels text[]);
create table private.plan_channel_entitlements(plan_version_id uuid primary key,channel_count integer);
create table public.whatsapp_conversations(id uuid primary key,company_id uuid,status text,automation_allowed boolean,automation_generation bigint);
create table public.whatsapp_company_links(id uuid primary key,company_id uuid,status text,provider_phone_number_id text,generation integer);
create table public.whatsapp_messages(id uuid primary key,company_id uuid,conversation_id uuid,direction text,sender text,wa_message_id text,body text,delivery_state text,received_at timestamptz);
create table public.ai_usage_ledger(id uuid primary key,company_id uuid,worker_job_id uuid,status text,response_text text,source_citations jsonb,automation_generation bigint,usage_mode text,request_id text,model_id text,cost_baisa numeric,created_at timestamptz);
create table public.whatsapp_inbound_jobs(id uuid primary key,company_id uuid,message_id uuid,wa_message_id text,status text,claim_token uuid,claim_expires_at timestamptz,expected_automation_generation bigint,
 usage_status text,usage_period_start timestamptz,usage_subscription_id uuid,send_intent_id uuid,staged_ai_attempt_id uuid,staged_reply text,staged_citations jsonb,noura_entitlement_id uuid,noura_subscription_id uuid,noura_plan_version_id uuid,noura_paid_through timestamptz,noura_allowance_cap bigint,noura_allowance_period_start timestamptz,response_kind text,completed_at timestamptz,result_code text,updated_at timestamptz,created_at timestamptz);
create table public.whatsapp_send_intents(id uuid primary key,company_id uuid,conversation_id uuid,original_job_id uuid,sender_kind text,response_kind text,outcome text,body text,message_id uuid,wa_message_id text,
 expected_automation_generation bigint,acceptance_observed_wa_message_id text,acceptance_observed_at timestamptz,finalized_attempt_token uuid,attempt_token uuid,created_at timestamptz,updated_at timestamptz);
create function public.billing_read_company_operational_entitlement(cid uuid) returns jsonb language sql as $$select jsonb_build_object('ok',true,'active',status in('active','cancel_at_period_end') and private.master_activation_company_end(cid)>clock_timestamp(),'environment','live','plan_version_id',plan_version_id,'paid_through',private.master_activation_company_end(cid)) from public.billing_subscriptions where company_id=cid$$;
create function private.whatsapp_answer_profile(p_job uuid,p_claim uuid) returns jsonb language plpgsql as $$begin if not exists(select 1 from public.whatsapp_inbound_jobs where id=p_job and claim_token=p_claim and claim_expires_at>clock_timestamp()) then return jsonb_build_object('ok',false);end if;return jsonb_build_object('ok',true);end;$$;
create function public.billing_read_company_usage(uuid) returns jsonb language sql as $$select jsonb_build_object('ok',true,'data',jsonb_build_object('month_start','legacy'))$$;
create function private.wa_billing_pre_accepted_usage(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',false,'code','fixed_response_port')$$;

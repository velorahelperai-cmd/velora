-- Additive Live checkout only. No configuration seeds, activation or production application.
begin;
set local role postgres;
set local search_path='';
set local lock_timeout='2s';
set local statement_timeout='30s';
DO $live_guard$ BEGIN IF(SELECT md5(data::text) FROM(WITH fn AS(SELECT n.nspname||'.'||p.proname name,p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef definer,p.proconfig config,md5(replace(p.prosrc,chr(13),'')) body,
(SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.proname IN('billing_create_or_reuse_subscription_order','billing_resolve_or_create_payment_attempt','billing_snapshot_bound_service_order','billing_snapshot_bound_service_order_pre_live','billing_snapshot_service_order','billing_settle_paymob_hmac_verified','billing_settle_paymob_hmac_verified_pre_service','billing_acceptance_hmac_event','billing_settle_payment_core','billing_settle_payment_core_pre_acceptance','billing_financial_receipt_immutability','billing_service_receipt_eligible','billing_service_immutable','billing_apply_service_grant','billing_activate_service_grant','billing_create_test_checkout_order','billing_claim_test_checkout','billing_complete_test_checkout','billing_live_owner','billing_pin_live_provider_amount','billing_live_checkout_immutable','billing_create_live_checkout_order','billing_claim_live_checkout','billing_complete_live_checkout','billing_settle_live_paymob_hmac_verified','ai_budget_policy_immutable','ai_budget_account_binding')),
rel AS(SELECT c.oid,n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
(SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid) constraints,
(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid=c.oid) indexes,
(SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled::text,pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) triggers,
(SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl,
(SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,(SELECT jsonb_agg(CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x) END ORDER BY CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x) END) FROM unnest(p.polroles)x),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid) policies,
(SELECT jsonb_agg(jsonb_build_array(a.attname,coalesce(r.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) ORDER BY a.attname,coalesce(r.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl)x LEFT JOIN pg_roles r ON r.oid=x.grantee WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) column_acl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname IN('public.companies','public.company_members','public.billing_catalog_revision','public.billing_plans','public.billing_plan_versions','public.billing_orders','public.billing_payment_attempts','public.billing_provider_events','public.billing_entitlement_applications','public.billing_settlement_outcomes','private.app_session_activity','private.billing_service_offers','private.billing_service_order_offers','private.billing_service_grants','private.ai_plan_budget_policies','private.billing_live_merchant_contracts','private.billing_live_order_bindings','private.billing_live_checkouts')),
views AS(SELECT n.nspname||'.'||c.relname name,md5(replace(pg_get_viewdef(c.oid,true),chr(13),'')) definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname IN('billing_proven_entitlement_grants','billing_verified_collection_history'))
SELECT jsonb_build_object('fn',(SELECT jsonb_agg(to_jsonb(fn) ORDER BY signature) FROM fn),'rel',(SELECT jsonb_agg(to_jsonb(rel)-'oid' ORDER BY name) FROM rel),'views',(SELECT jsonb_agg(to_jsonb(views) ORDER BY name) FROM views)))q(data)) IS DISTINCT FROM '497dc926b6254cc0f58d5bd7b47eb740' THEN RAISE EXCEPTION 'LIVE_CHECKOUT_FOOTPRINT_DRIFT';END IF;END $live_guard$;

create table private.billing_live_merchant_contracts (
 id uuid primary key default gen_random_uuid(),
 integration_id bigint not null unique check(integration_id>0 and integration_id<=9007199254740991),
 merchant_owner_id text not null check(merchant_owner_id ~ '^[1-9][0-9]*$' and length(merchant_owner_id)<=16 and merchant_owner_id::numeric<=9007199254740991),
 currency text not null check(currency='OMR'),
 units_per_omr integer not null check(units_per_omr between 1 and 1000000),
 deadline_policy_approved boolean not null default false,
 verified_by uuid not null references auth.users(id) on delete restrict,
 verified_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create table private.billing_live_order_bindings (
 order_id uuid primary key references public.billing_orders(id) on delete restrict,
 contract_id uuid not null references private.billing_live_merchant_contracts(id) on delete restrict,
 plan_version_id uuid not null references private.ai_plan_budget_policies(plan_version_id) on delete restrict,
 allowance_cap bigint not null check(allowance_cap between 1 and 999999999),
 monthly_limit_baisa numeric not null check(monthly_limit_baisa>0 and monthly_limit_baisa<=100000000 and monthly_limit_baisa=trunc(monthly_limit_baisa)),
 created_at timestamptz not null default clock_timestamp()
);
create table private.billing_live_checkouts (
 payment_attempt_id uuid primary key references public.billing_payment_attempts(id) on delete restrict,
 order_id uuid not null references private.billing_live_order_bindings(order_id) on delete restrict,
 company_id uuid not null references public.companies(id) on delete restrict,
 status text not null default 'claiming' check(status in ('claiming','ready')),
 checkout_url text,
 provider_intention_id text,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.billing_live_merchant_contracts enable row level security;
alter table private.billing_live_order_bindings enable row level security;
alter table private.billing_live_checkouts enable row level security;
revoke all on private.billing_live_merchant_contracts,private.billing_live_order_bindings,private.billing_live_checkouts from public,anon,authenticated,service_role;
create trigger live_contract_immutable before update or delete on private.billing_live_merchant_contracts for each row execute function private.billing_service_immutable();
create trigger live_contract_no_truncate before truncate on private.billing_live_merchant_contracts for each statement execute function private.billing_service_immutable();
create trigger live_binding_immutable before update or delete on private.billing_live_order_bindings for each row execute function private.billing_service_immutable();
create trigger live_binding_no_truncate before truncate on private.billing_live_order_bindings for each statement execute function private.billing_service_immutable();

create function private.billing_live_owner(p_company uuid,p_actor uuid,p_session uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true) is distinct from 'service_role' or p_actor is null or p_session is null then return false;end if;
 perform 1 from auth.users where id=p_actor for share nowait;if not found then return false;end if;
 perform 1 from auth.sessions where id=p_session and user_id=p_actor for share nowait;if not found then return false;end if;
 perform 1 from private.app_session_activity where session_id=p_session and user_id=p_actor for update nowait;if not found then return false;end if;
 perform 1 from public.company_members where company_id=p_company and user_id=p_actor for share nowait;if not found then return false;end if;
 return exists(select 1 from auth.users where id=p_actor and (email_confirmed_at is not null or phone_confirmed_at is not null))
 and exists(select 1 from public.company_members where company_id=p_company and user_id=p_actor and role='owner' and status='active')
 and exists(select 1 from private.app_session_activity where session_id=p_session and user_id=p_actor and expired_at is null and last_activity_at<=clock_timestamp() and last_activity_at>clock_timestamp()-interval '2 hours');
 exception when lock_not_available then return false;
end;$$;

create function private.billing_pin_live_provider_amount() returns trigger
language plpgsql set search_path='' as $$
declare c private.billing_live_merchant_contracts%rowtype;amount numeric;begin
 if new.provider_environment<>'live' or nullif(current_setting('velora.live_checkout_contract',true),'') is null then return new;end if;
 select * into c from private.billing_live_merchant_contracts where id=current_setting('velora.live_checkout_contract')::uuid;
 if not found or not c.deadline_policy_approved or c.verified_at>clock_timestamp() or new.provider_account_ref<>c.integration_id::text or new.currency<>c.currency then raise exception 'LIVE_MERCHANT_CONTRACT_REQUIRED';end if;
 amount:=new.amount_baisa::numeric*c.units_per_omr/1000;
 if amount<=0 or amount<>trunc(amount) or amount>9007199254740991 then raise exception 'LIVE_PROVIDER_AMOUNT_NOT_EXACT';end if;
 new.provider_amount:=amount::bigint;new.provider_amount_unit:='paymob_amount';new.deadline_policy_approved:=true;
 return new;
end;$$;
create trigger billing_pin_live_provider_amount_trg before insert on public.billing_orders for each row execute function private.billing_pin_live_provider_amount();

-- Preserve the exact Basic/Test implementation; only the new authorized Live wrapper may use the new path.
alter function private.billing_snapshot_bound_service_order(uuid,uuid) rename to billing_snapshot_bound_service_order_pre_live;
create function private.billing_snapshot_bound_service_order(p_order_id uuid,p_actor_id uuid) returns void
language plpgsql set search_path='' as $$
declare o public.billing_orders%rowtype;result jsonb;begin
 select * into o from public.billing_orders where id=p_order_id;
 if o.provider_environment<>'live' or nullif(current_setting('velora.live_checkout_contract',true),'') is null then
  perform private.billing_snapshot_bound_service_order_pre_live(p_order_id,p_actor_id);return;
 end if;
 if not private.billing_live_owner(o.company_id,p_actor_id,nullif(current_setting('velora.live_checkout_session',true),'')::uuid) then raise exception 'LIVE_PURCHASE_ACTOR_FORBIDDEN';end if;
 if not exists(select 1 from private.billing_service_offers f join private.ai_plan_budget_policies b on b.plan_version_id=f.plan_version_id
 join public.billing_plan_versions v on v.id=f.plan_version_id where f.plan_version_id=o.plan_version_id and f.service_code='noura'
 and f.tier in ('basic','premium') and f.capabilities=array['noura.knowledge.read']::text[]
 and coalesce(v.limits->>'automated_outbound_per_month','') ~ '^[1-9][0-9]{0,8}$'
 and b.monthly_limit_baisa>0) then raise exception 'LIVE_SERVICE_BUDGET_QUOTA_REQUIRED';end if;
 result:=public.billing_snapshot_service_order(o.id);
 if result->>'ok' is distinct from 'true' then raise exception 'LIVE_SERVICE_SNAPSHOT_REJECTED';end if;
end;$$;

create function public.billing_create_live_checkout_order(p_company_id uuid,p_actor_id uuid,p_actor_session_id uuid,p_plan_version_id uuid,p_client_op_id text,p_expected_revision bigint,p_integration_id bigint,p_merchant_owner_id text,p_units_per_omr integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.billing_plan_versions%rowtype;c private.billing_live_merchant_contracts%rowtype;f private.billing_service_offers%rowtype;b private.ai_plan_budget_policies%rowtype;r bigint;result jsonb;o public.billing_orders%rowtype;fingerprint text;reference text;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_client_op_id is null or length(trim(p_client_op_id)) not between 1 and 128 or p_expected_revision is null then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform 1 from public.companies where id=p_company_id and status in ('setup','active') for update;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select revision into r from public.billing_catalog_revision where singleton for update;
 select * into v from public.billing_plan_versions where id=p_plan_version_id for share;
 perform 1 from public.billing_plans where id=v.plan_id and status='active' for share;
 if not found or v.amount_baisa<=0 or v.amount_baisa>9007199254740991 or v.status<>'published' or v.currency<>'OMR' or v.period_unit<>'month' or v.period_count<>1 then return jsonb_build_object('ok',false,'code','PLAN_NOT_PUBLISHED');end if;
 select * into c from private.billing_live_merchant_contracts where integration_id=p_integration_id and merchant_owner_id=p_merchant_owner_id and units_per_omr=p_units_per_omr and currency=v.currency and deadline_policy_approved and verified_at<=clock_timestamp() for share;
 select * into f from private.billing_service_offers where plan_version_id=v.id for share;
 select * into b from private.ai_plan_budget_policies where plan_version_id=v.id for share;
 if not private.billing_live_owner(p_company_id,p_actor_id,p_actor_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if r is distinct from p_expected_revision then return jsonb_build_object('ok',false,'code','CATALOG_REVISION_CONFLICT');end if;
 if c.id is null then return jsonb_build_object('ok',false,'code','LIVE_MERCHANT_NOT_CONFIGURED');end if;
 if f.plan_version_id is null or b.plan_version_id is null or f.service_code<>'noura' or f.tier not in ('basic','premium') or f.capabilities<>array['noura.knowledge.read']::text[]
 or coalesce(v.limits->>'automated_outbound_per_month','') !~ '^[1-9][0-9]{0,8}$' then return jsonb_build_object('ok',false,'code','LIVE_SERVICE_BUDGET_QUOTA_REQUIRED');end if;
 -- Re-read time/session after business locks. Financial fields never come from the browser.
 if c.verified_at>clock_timestamp() or not private.billing_live_owner(p_company_id,p_actor_id,p_actor_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 -- A claimed/provider-submitted collection remains financially unresolved even after expiry.
 -- The company lock above serializes creation with claim/completion/settlement.
 -- Never let the canonical expired-draft branch cancel it or allocate another collection.
 if exists(
  select 1 from public.billing_orders prior_order
  join public.billing_payment_attempts prior_attempt on prior_attempt.order_id=prior_order.id and prior_attempt.company_id=prior_order.company_id
  where prior_order.company_id=p_company_id and prior_order.product_code='velora_ai_staff' and prior_order.provider_environment='live'
  and (prior_attempt.status in ('unresolved','provider_submitted')
   or (prior_attempt.status not in ('paid','failed') and exists(
    select 1 from private.billing_live_checkouts pending where pending.payment_attempt_id=prior_attempt.id)))
  -- Only reuse the exact persisted, unexpired collection. No claim or intention is created here.
  and not coalesce((
   prior_order.client_op_id=trim(p_client_op_id) and prior_order.plan_version_id=v.id
   and prior_order.status='submitted' and prior_order.expires_at>clock_timestamp()
   and prior_order.provider_account_ref=c.integration_id::text
   and prior_attempt.provider_environment='live' and prior_attempt.provider_account_ref=c.integration_id::text
   and prior_attempt.status='provider_submitted' and prior_attempt.provider_order_id is not null
   and exists(select 1 from private.billing_live_checkouts ready
    where ready.payment_attempt_id=prior_attempt.id and ready.order_id=prior_order.id
    and ready.company_id=p_company_id and ready.status='ready')
  ),false)
 ) then return jsonb_build_object('ok',false,'code','LIVE_COLLECTION_REQUIRES_RECONCILIATION','block_new_collection',true);end if;
 fingerprint:=encode(sha256(convert_to(p_company_id::text||'|'||v.id::text||'|'||v.amount_baisa::text||'|'||v.currency||'|'||v.period_unit||'|'||v.period_count::text,'UTF8')),'hex');
 reference:='vel_live_'||gen_random_uuid()::text;
 perform set_config('velora.live_checkout_contract',c.id::text,true);perform set_config('velora.live_checkout_session',p_actor_session_id::text,true);
 result:=public.billing_create_or_reuse_subscription_order(p_company_id,'velora_ai_staff','initial',v.id,v.plan_id,trim(p_client_op_id),fingerprint,reference,v.amount_baisa,v.currency,v.period_days,v.period_unit,v.period_count,c.integration_id::text,'live',p_actor_id);
 perform set_config('velora.live_checkout_contract','',true);perform set_config('velora.live_checkout_session','',true);
 if result->>'ok' is distinct from 'true' then return result;end if;
 select * into o from public.billing_orders where id=(result->>'order_id')::uuid and company_id=p_company_id;
 if o.provider_environment<>'live' or o.provider_amount_unit is distinct from 'paymob_amount' or o.provider_amount is null or o.provider_amount::numeric<>o.amount_baisa::numeric*c.units_per_omr/1000 then raise exception 'LIVE_LEGACY_ORDER_REQUIRES_REVIEW';end if;
 if result->>'action' in ('reuse','reused') and not exists(select 1 from private.billing_live_order_bindings where order_id=o.id and contract_id=c.id) then raise exception 'LIVE_LEGACY_ORDER_REQUIRES_REVIEW';end if;
 insert into private.billing_live_order_bindings(order_id,contract_id,plan_version_id,allowance_cap,monthly_limit_baisa)
 values(o.id,c.id,v.id,(v.limits->>'automated_outbound_per_month')::bigint,b.monthly_limit_baisa) on conflict do nothing;
 return result||jsonb_build_object('locked',jsonb_build_object('amount_baisa',o.amount_baisa,'currency',o.currency,'provider_amount',o.provider_amount,'provider_amount_unit',o.provider_amount_unit,'provider_account_ref',o.provider_account_ref,'provider_environment',o.provider_environment,'plan_version_id',o.plan_version_id),'service',jsonb_build_object('service_code',f.service_code,'tier',f.tier,'allowance_cap',(v.limits->>'automated_outbound_per_month')::bigint,'monthly_limit_baisa',b.monthly_limit_baisa));
end;$$;

create function private.billing_live_checkout_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op<>'UPDATE' then raise exception 'LIVE_CHECKOUT_IMMUTABLE';end if;
 if row(new.payment_attempt_id,new.order_id,new.company_id,new.created_at) is distinct from row(old.payment_attempt_id,old.order_id,old.company_id,old.created_at)
 or old.status='ready' or new.status<>'ready' then raise exception 'LIVE_CHECKOUT_IMMUTABLE';end if;
 return new;
end;$$;
create trigger live_checkout_immutable before update or delete on private.billing_live_checkouts for each row execute function private.billing_live_checkout_immutable();
create trigger live_checkout_no_truncate before truncate on private.billing_live_checkouts for each statement execute function private.billing_live_checkout_immutable();

create function public.billing_claim_live_checkout(p_company_id uuid,p_order_id uuid,p_attempt_id uuid,p_actor_id uuid,p_actor_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_orders%rowtype;a public.billing_payment_attempts%rowtype;s private.billing_live_checkouts%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 perform 1 from public.companies where id=p_company_id and status in ('setup','active') for update;if not found then return jsonb_build_object('kind','rejected','code','FORBIDDEN');end if;
 select * into o from public.billing_orders where id=p_order_id and company_id=p_company_id for update;
 select * into a from public.billing_payment_attempts where id=p_attempt_id and order_id=p_order_id and company_id=p_company_id for update;
 if not private.billing_live_owner(p_company_id,p_actor_id,p_actor_session_id) then return jsonb_build_object('kind','rejected','code','FORBIDDEN');end if;
 if o.id is null or a.id is null or o.provider_environment<>'live' or a.provider_environment<>'live' or a.provider_account_ref<>o.provider_account_ref
 or o.status not in ('locked','submitted') or o.provider_amount_unit is distinct from 'paymob_amount' or o.provider_amount is null
 or o.expires_at is null or o.expires_at<=clock_timestamp()
 or not exists(select 1 from private.billing_live_order_bindings b join private.billing_live_merchant_contracts c on c.id=b.contract_id
 join private.billing_service_order_offers f on f.order_id=b.order_id
 where b.order_id=o.id and b.plan_version_id=o.plan_version_id and f.plan_version_id=o.plan_version_id and f.environment='live'
 and c.integration_id::text=o.provider_account_ref and c.currency=o.currency and c.deadline_policy_approved
 and o.provider_amount::numeric=o.amount_baisa::numeric*c.units_per_omr/1000)
 then return jsonb_build_object('kind','rejected','code','order_not_ready');end if;
 if a.status in ('paid','failed') then return jsonb_build_object('kind','pending');end if;
 select * into s from private.billing_live_checkouts where payment_attempt_id=a.id;
 if found then
  if s.status='ready' and a.status='provider_submitted' and a.provider_order_id is not null then return jsonb_build_object('kind','ready','url',s.checkout_url);end if;
  return jsonb_build_object('kind','pending');
 end if;
 if a.status<>'intent_created' or a.provider_order_id is not null then return jsonb_build_object('kind','pending');end if;
 insert into private.billing_live_checkouts(payment_attempt_id,order_id,company_id) values(a.id,o.id,o.company_id);
 update public.billing_payment_attempts set status='unresolved',updated_at=clock_timestamp() where id=a.id;
 return jsonb_build_object('kind','claimed');
end;$$;

create function public.billing_complete_live_checkout(p_company_id uuid,p_order_id uuid,p_attempt_id uuid,p_actor_id uuid,p_actor_session_id uuid,p_provider_order_id text,p_checkout_url text,p_intention_id text) returns boolean
language plpgsql security definer set search_path='' as $$
declare o public.billing_orders%rowtype;a public.billing_payment_attempts%rowtype;s private.billing_live_checkouts%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_provider_order_id is null or p_provider_order_id !~ '^[1-9][0-9]*$' or length(p_provider_order_id)>16 or p_provider_order_id::numeric>9007199254740991
 or p_checkout_url is null or length(p_checkout_url)>8192
 or p_checkout_url !~ '^https://om[.]checkout[.]paymob[.]com/[?]publicKey=([a-z]{2,3}_)?pk_live_[A-Za-z0-9_-]+&clientSecret=[A-Za-z0-9_%.-]+$'
 or position('_test_' in p_checkout_url)>0 or position('_test_' in coalesce(p_intention_id,''))>0 then return false;end if;
 perform 1 from public.companies where id=p_company_id and status in ('setup','active') for update;if not found then return false;end if;
 select * into o from public.billing_orders where id=p_order_id and company_id=p_company_id and provider_environment='live' for update;
 select * into a from public.billing_payment_attempts where id=p_attempt_id and order_id=p_order_id and company_id=p_company_id and provider_environment='live' for update;
 if not private.billing_live_owner(p_company_id,p_actor_id,p_actor_session_id) or o.id is null or a.id is null or o.expires_at<=clock_timestamp() then return false;end if;
 select * into s from private.billing_live_checkouts where payment_attempt_id=a.id and order_id=o.id and company_id=o.company_id for update;
 if s.payment_attempt_id is null then return false;end if;
 if s.status='ready' then return o.status='submitted' and a.status='provider_submitted' and a.provider_order_id=p_provider_order_id and s.checkout_url=p_checkout_url and s.provider_intention_id is not distinct from p_intention_id;end if;
 if o.status<>'locked' or a.status<>'unresolved' or a.provider_order_id is not null then return false;end if;
 update private.billing_live_checkouts set status='ready',checkout_url=p_checkout_url,provider_intention_id=p_intention_id where payment_attempt_id=a.id;
 update public.billing_payment_attempts set provider_order_id=p_provider_order_id,status='provider_submitted',updated_at=clock_timestamp() where id=a.id;
 update public.billing_orders set status='submitted' where id=o.id;
 return true;
end;$$;

-- Uses the pinned canonical HMAC/financial lifecycle implementation, not synthetic evidence or inquiry success.
create function public.billing_settle_live_paymob_hmac_verified(p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_orders%rowtype;a public.billing_payment_attempts%rowtype;c private.billing_live_merchant_contracts%rowtype;
 binding private.billing_live_order_bindings%rowtype;result jsonb;grant_result jsonb;application uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_evidence->>'provider_environment' is distinct from 'live' then return jsonb_build_object('ok',false,'code','LIVE_EVIDENCE_REQUIRED');end if;
 perform 1 from public.companies where id=(p_evidence->>'company_id')::uuid for update;
 select * into o from public.billing_orders where id=(p_evidence->>'order_id')::uuid and company_id=(p_evidence->>'company_id')::uuid for update;
 select * into a from public.billing_payment_attempts where id=(p_evidence->>'payment_attempt_id')::uuid and order_id=o.id and company_id=o.company_id for update;
 select * into binding from private.billing_live_order_bindings where order_id=o.id;
 if binding.order_id is null then
  -- Preserve historical Live processing through its exact prior guarded public wrapper.
  return public.billing_settle_paymob_hmac_verified(p_evidence);
 end if;
 select * into c from private.billing_live_merchant_contracts where id=binding.contract_id;
 if o.id is null or a.id is null or c.id is null or o.provider_environment<>'live' or a.provider_environment<>'live'
 or a.provider_account_ref<>c.integration_id::text or o.provider_account_ref<>c.integration_id::text or o.currency<>c.currency
 or binding.plan_version_id<>o.plan_version_id
 or not exists(select 1 from private.billing_service_order_offers f join private.ai_plan_budget_policies b on b.plan_version_id=f.plan_version_id
 where f.order_id=o.id and f.environment='live' and f.plan_version_id=o.plan_version_id and f.service_code='noura'
 and f.tier in ('basic','premium') and f.capabilities=array['noura.knowledge.read']::text[] and b.monthly_limit_baisa=binding.monthly_limit_baisa)
 then return jsonb_build_object('ok',false,'code','LIVE_BINDING_REQUIRED');end if;
 if not exists(select 1 from public.billing_provider_events e where e.payment_attempt_id=a.id and e.company_id=o.company_id
 and e.provider='paymob' and e.provider_environment='live' and e.provider_account_ref=o.provider_account_ref
 and e.provider_transaction_id=p_evidence->>'provider_transaction_id' and e.observation_key=p_evidence->>'observation_key'
 and e.raw_summary->>'signed_owner'=c.merchant_owner_id and e.raw_summary->>'integration_id'=c.integration_id::text
 and e.raw_summary->>'provider_order_id'=a.provider_order_id and e.raw_summary->'hmac_verified'='true'::jsonb)
 then return jsonb_build_object('ok',false,'code','LIVE_SIGNED_RECEIPT_REQUIRED');end if;
 result:=private.billing_settle_paymob_hmac_verified_pre_service(p_evidence);
 if result->>'ok' is distinct from 'true' or result->>'outcome' not in ('granted','idempotent_replay') then return result;end if;
 application:=(result->>'entitlement_application_id')::uuid;
 if not private.billing_service_receipt_eligible(application) then raise exception 'LIVE_RECEIPT_INELIGIBLE';end if;
 if result->>'outcome'='idempotent_replay' and not exists(select 1 from private.billing_service_grants where entitlement_application_id=application and order_id=o.id) then raise exception 'LIVE_GRANT_REPLAY_REQUIRES_REVIEW';end if;
 grant_result:=public.billing_apply_service_grant(application);
 if grant_result->>'ok' is distinct from 'true' then raise exception 'LIVE_SERVICE_GRANT_REJECTED';end if;
 -- Deliberately no billing_activate_service_grant: activation is a separate rollout.
 return result;
end;$$;

do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('billing_create_live_checkout_order','billing_claim_live_checkout','billing_complete_live_checkout','billing_settle_live_paymob_hmac_verified') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 execute format('grant execute on function %s to service_role',f);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in
 ('billing_live_owner','billing_pin_live_provider_amount','billing_live_checkout_immutable','billing_snapshot_bound_service_order','billing_snapshot_bound_service_order_pre_live') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end;$$;
notify pgrst,'reload schema';
DO $live_guard$ BEGIN IF(SELECT md5(data::text) FROM(WITH fn AS(SELECT n.nspname||'.'||p.proname name,p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef definer,p.proconfig config,md5(replace(p.prosrc,chr(13),'')) body,
(SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.proname IN('billing_create_or_reuse_subscription_order','billing_resolve_or_create_payment_attempt','billing_snapshot_bound_service_order','billing_snapshot_bound_service_order_pre_live','billing_snapshot_service_order','billing_settle_paymob_hmac_verified','billing_settle_paymob_hmac_verified_pre_service','billing_acceptance_hmac_event','billing_settle_payment_core','billing_settle_payment_core_pre_acceptance','billing_financial_receipt_immutability','billing_service_receipt_eligible','billing_service_immutable','billing_apply_service_grant','billing_activate_service_grant','billing_create_test_checkout_order','billing_claim_test_checkout','billing_complete_test_checkout','billing_live_owner','billing_pin_live_provider_amount','billing_live_checkout_immutable','billing_create_live_checkout_order','billing_claim_live_checkout','billing_complete_live_checkout','billing_settle_live_paymob_hmac_verified','ai_budget_policy_immutable','ai_budget_account_binding')),
rel AS(SELECT c.oid,n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
(SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid) constraints,
(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid=c.oid) indexes,
(SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled::text,pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) triggers,
(SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl,
(SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,(SELECT jsonb_agg(CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x) END ORDER BY CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x) END) FROM unnest(p.polroles)x),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid) policies,
(SELECT jsonb_agg(jsonb_build_array(a.attname,coalesce(r.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) ORDER BY a.attname,coalesce(r.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl)x LEFT JOIN pg_roles r ON r.oid=x.grantee WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) column_acl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname IN('public.companies','public.company_members','public.billing_catalog_revision','public.billing_plans','public.billing_plan_versions','public.billing_orders','public.billing_payment_attempts','public.billing_provider_events','public.billing_entitlement_applications','public.billing_settlement_outcomes','private.app_session_activity','private.billing_service_offers','private.billing_service_order_offers','private.billing_service_grants','private.ai_plan_budget_policies','private.billing_live_merchant_contracts','private.billing_live_order_bindings','private.billing_live_checkouts')),
views AS(SELECT n.nspname||'.'||c.relname name,md5(replace(pg_get_viewdef(c.oid,true),chr(13),'')) definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname IN('billing_proven_entitlement_grants','billing_verified_collection_history'))
SELECT jsonb_build_object('fn',(SELECT jsonb_agg(to_jsonb(fn) ORDER BY signature) FROM fn),'rel',(SELECT jsonb_agg(to_jsonb(rel)-'oid' ORDER BY name) FROM rel),'views',(SELECT jsonb_agg(to_jsonb(views) ORDER BY name) FROM views)))q(data)) IS DISTINCT FROM '15fe1d44b7029baaf8523f757e1601e5' THEN RAISE EXCEPTION 'LIVE_CHECKOUT_FOOTPRINT_DRIFT';END IF;END $live_guard$;
commit;

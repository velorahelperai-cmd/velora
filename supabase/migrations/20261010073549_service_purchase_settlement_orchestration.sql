-- LOCAL IMPLEMENTATION ONLY. Production installation requires separate approval.
-- Explicit Noura Basic opt-in; no catalog seed/publication, prices, activation,
-- historical repair, live checkout, quotas, or new financial ledger.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ declare dep record; actual_hash text; actual_definer boolean; actual_config text; expected_config text;
begin
 for dep in select * from (values
 ('public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)','b2dd6ee0bf464f924e4ec51b25f8fe14',true),
 ('public.billing_create_test_checkout_order(jsonb,integer)','0bb5e53842c1b8667300d0cd5a01b91b',true),
 ('public.billing_settle_paymob_hmac_verified(jsonb)','a1ce90ae693324f11db6d3026969bf47',true),
 ('private.billing_acceptance_hmac_event(jsonb)','8c51025169a2210a9ae4fafe945c81af',true),
 ('private.billing_settle_payment_core(jsonb)','523f74f51727f24d5a27e84166d13273',true),
 ('private.billing_settle_payment_core_pre_acceptance(jsonb)','ae4dd1a4195db97e91fa0e662ccdfff7',true),
 ('public.billing_snapshot_service_order(uuid)','7cb64387308163d827cb271b481737c1',true),
 ('public.billing_apply_service_grant(uuid)','a24ab750931095099b473aeb73513fba',true),
 ('private.billing_service_receipt_eligible(uuid)','b7d82e7e8fefc05c22f876f1ac00b7c2',false),
 ('private.billing_service_immutable()','17b4d16be72ea6e2e3e44401c7680fd2',false),
 ('private.billing_ui_owner()','73e9d20bcaa68da3488d536ba8720bed',true),
 ('private.billing_financial_receipt_immutability()','968854ccf1b251404062386ea9f2fe2f',false)
 ) as dependencies(signature,body_hash,is_definer) loop
  select md5(replace(prosrc,chr(13),'')),prosecdef,array_to_string(proconfig,',') into actual_hash,actual_definer,actual_config from pg_proc where oid=to_regprocedure(dep.signature);
  expected_config:=case when dep.signature in ('public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)','public.billing_create_test_checkout_order(jsonb,integer)','private.billing_settle_payment_core_pre_acceptance(jsonb)') then 'search_path=public, private, pg_temp' else 'search_path=""' end;
  if actual_hash is distinct from dep.body_hash or actual_definer is distinct from dep.is_definer
  or actual_config is distinct from expected_config then
   raise exception 'SERVICE_ORCHESTRATION_PREREQUISITE_MISMATCH: %',dep.signature using errcode='55000';
  end if;
 end loop;
 for dep in select * from (values
 ('public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'),
 ('public.billing_create_test_checkout_order(jsonb,integer)'),
 ('public.billing_settle_paymob_hmac_verified(jsonb)'),
 ('public.billing_snapshot_service_order(uuid)'),
 ('public.billing_apply_service_grant(uuid)')) as rpc(signature) loop
  if has_function_privilege('anon',to_regprocedure(dep.signature),'EXECUTE')
  or has_function_privilege('authenticated',to_regprocedure(dep.signature),'EXECUTE')
  or not has_function_privilege('service_role',to_regprocedure(dep.signature),'EXECUTE') then
   raise exception 'SERVICE_ORCHESTRATION_RPC_ACL_MISMATCH: %',dep.signature using errcode='55000';
  end if;
 end loop;
 for dep in select * from (values
 ('private.billing_verified_collection_history','cdda398ed1d2f6bf1b0a4db89fcced9f'),
 ('private.billing_proven_entitlement_grants','6c6d6a29a1dfae3e667948901044a7b1')) as views(view_name,definition_hash) loop
  if md5(replace(pg_get_viewdef(to_regclass(dep.view_name),true),chr(13),'')) is distinct from dep.definition_hash then
   raise exception 'SERVICE_ORCHESTRATION_RECEIPT_VIEW_MISMATCH: %',dep.view_name using errcode='55000';
  end if;
 end loop;
 if to_regclass('private.billing_proven_entitlement_grants') is null
 or to_regprocedure('public.check_app_session(boolean)') is null then
  raise exception 'SERVICE_ORCHESTRATION_DEPENDENCY_MISSING' using errcode='55000';
 end if;
 if (select count(*) from pg_trigger where tgfoid='private.billing_financial_receipt_immutability()'::regprocedure
 and not tgisinternal and tgenabled in ('O','A') and (tgrelid,tgname) in (
 ('public.billing_provider_events'::regclass,'billing_provider_receipt_immutability'),
 ('public.billing_entitlement_applications'::regclass,'billing_entitlement_receipt_immutability'),
 ('public.billing_settlement_outcomes'::regclass,'billing_settlement_receipt_immutability'),
 ('public.billing_provider_events'::regclass,'billing_provider_receipt_no_truncate'),
 ('public.billing_entitlement_applications'::regclass,'billing_entitlement_receipt_no_truncate'),
 ('public.billing_settlement_outcomes'::regclass,'billing_settlement_receipt_no_truncate')))<>6
 or (select count(*) from pg_trigger where tgfoid='private.billing_service_immutable()'::regprocedure
 and not tgisinternal and tgenabled in ('O','A') and (tgrelid,tgname) in (
 ('private.billing_service_offers'::regclass,'service_offer_immutable'),
 ('private.billing_service_order_offers'::regclass,'service_order_offer_immutable'),
 ('private.billing_service_grants'::regclass,'service_grant_immutable'),
 ('private.billing_service_offers'::regclass,'service_offer_no_truncate'),
 ('private.billing_service_order_offers'::regclass,'service_order_offer_no_truncate'),
 ('private.billing_service_grants'::regclass,'service_grant_no_truncate')))<>6 then
  raise exception 'SERVICE_ORCHESTRATION_IMMUTABLE_GUARD_MISSING' using errcode='55000';
 end if;
 if exists(select 1 from pg_class where oid in ('private.billing_service_offers'::regclass,'private.billing_service_order_offers'::regclass,'private.billing_service_grants'::regclass) and not relrowsecurity)
 or exists(select 1 from (values('anon'),('authenticated'),('service_role')) roles(name)
 cross join (values('private.billing_service_offers'),('private.billing_service_order_offers'),('private.billing_service_grants')) tables(name)
 where has_table_privilege(roles.name,tables.name,'SELECT,INSERT,UPDATE,DELETE')) then
  raise exception 'SERVICE_ORCHESTRATION_TABLE_BOUNDARY_MISMATCH' using errcode='55000';
 end if;
end; $$;

-- The owner opt-in accepts version/revision only. Claims, labels, targets and
-- browser-supplied service/tier/capabilities never define the contract.
create function private.billing_service_catalog_owner() returns boolean
language plpgsql security definer set search_path='' as $$ begin
 if current_setting('role',true)<>'authenticated' or auth.uid() is null
 or (public.check_app_session(false)->>'ok') is distinct from 'true'
 or not private.billing_ui_owner()
 or not exists(select 1 from auth.users where id=auth.uid() and (email_confirmed_at is not null or phone_confirmed_at is not null)) then return false;end if;
 return true;
end; $$;
revoke all on function private.billing_service_catalog_owner() from public,anon,authenticated,service_role;
create function public.billing_bind_noura_basic_draft(p_plan_version_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_revision bigint; v public.billing_plan_versions%rowtype; offer private.billing_service_offers%rowtype; code text;
begin
 if not private.billing_service_catalog_owner() then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if p_plan_version_id is null or p_expected_revision is null or p_expected_revision<1 then return jsonb_build_object('ok',false,'code','invalid_input');end if;
 select r.revision into v_revision from public.billing_catalog_revision r where singleton for update;
 if v_revision is distinct from p_expected_revision then return jsonb_build_object('ok',false,'code','conflict');end if;
 if not private.billing_service_catalog_owner() then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select * into v from public.billing_plan_versions where id=p_plan_version_id for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 if v.status<>'draft' or exists(select 1 from public.billing_orders where plan_version_id=v.id) then return jsonb_build_object('ok',false,'code','immutable');end if;
 select p.code into code from public.billing_plans p where id=v.plan_id;
 if code is distinct from 'noor_basic' or v.currency is distinct from 'OMR' or v.amount_baisa<=0
 or v.period_unit is distinct from 'month' or v.period_count is distinct from 1 then return jsonb_build_object('ok',false,'code','invalid_input');end if;
 select * into offer from private.billing_service_offers where plan_version_id=v.id;
 if found then
  if offer.service_code<>'noura' or offer.tier<>'basic' or offer.capabilities is distinct from array['noura.knowledge.read']::text[] then return jsonb_build_object('ok',false,'code','immutable');end if;
 else
  insert into private.billing_service_offers(plan_version_id,service_code,tier,capabilities) values(v.id,'noura','basic',array['noura.knowledge.read']);
  update public.billing_catalog_revision set revision=billing_catalog_revision.revision+1 where singleton returning billing_catalog_revision.revision into v_revision;
 end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('version_id',v.id,'revision',v_revision));
end; $$;
revoke all on function public.billing_bind_noura_basic_draft(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.billing_bind_noura_basic_draft(uuid,bigint) to authenticated;

-- Called visibly by the existing purchase function at both attempt boundaries.
-- Unbound versions retain the original billing behavior; no retroactive opt-in.
create function private.billing_snapshot_bound_service_order(p_order_id uuid,p_actor_id uuid) returns void
language plpgsql set search_path='' as $$
declare o public.billing_orders%rowtype; offer private.billing_service_offers%rowtype; result jsonb;
begin
 select * into o from public.billing_orders where id=p_order_id;
 select * into offer from private.billing_service_offers where plan_version_id=o.plan_version_id;
 if not found then return;end if;
 if current_setting('role',true)<>'service_role' then raise exception 'SERVICE_PURCHASE_SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if o.product_code is distinct from 'velora_ai_staff' or offer.service_code<>'noura' or offer.tier<>'basic'
 or offer.capabilities is distinct from array['noura.knowledge.read']::text[]
 or not exists(select 1 from public.billing_plan_versions v join public.billing_plans p on p.id=v.plan_id
 where v.id=o.plan_version_id and p.code='noor_basic' and v.currency='OMR' and v.period_unit='month' and v.period_count=1)
 then raise exception 'SERVICE_PURCHASE_UNSUPPORTED' using errcode='23514';end if;
 if not exists(select 1 from public.company_members m join auth.users u on u.id=m.user_id
 where m.company_id=o.company_id and m.user_id=p_actor_id and m.role='owner' and m.status='active'
 and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) then
  raise exception 'SERVICE_PURCHASE_ACTOR_FORBIDDEN' using errcode='42501';end if;
 if exists(select 1 from private.billing_service_order_offers s where s.order_id=o.id
 and (s.plan_version_id is distinct from offer.plan_version_id or s.service_code is distinct from offer.service_code
 or s.tier is distinct from offer.tier or s.capabilities is distinct from offer.capabilities or s.environment is distinct from o.provider_environment)) then
  raise exception 'SERVICE_PURCHASE_SNAPSHOT_MISMATCH' using errcode='23514';end if;
 result:=public.billing_snapshot_service_order(o.id);
 if result->>'ok' is distinct from 'true' then raise exception 'SERVICE_PURCHASE_SNAPSHOT_REJECTED: %',result->>'code' using errcode='23514';end if;
end; $$;
revoke all on function private.billing_snapshot_bound_service_order(uuid,uuid) from public,anon,authenticated,service_role;

-- Pinned forward correction of exactly two call sites, not a DML trigger and
-- not a forked copy of the financial purchase implementation.
do $$ declare definition text; signature regprocedure; anchor text; injected text;
begin
 signature:='public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'::regprocedure;
 definition:=replace(pg_get_functiondef(signature),chr(13),'');
 foreach anchor in array array[
 'v_resolve := private.billing_resolve_or_create_payment_attempt(v_open.id, p_company_id);',
 'v_resolve := private.billing_resolve_or_create_payment_attempt(v_order.id, p_company_id);'] loop
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'SERVICE_PURCHASE_CALL_SITE_MISMATCH' using errcode='55000';end if;
  injected:=case when anchor like '%v_open.id%' then E'perform private.billing_snapshot_bound_service_order(v_open.id, p_created_by);\n      ' else E'perform private.billing_snapshot_bound_service_order(v_order.id, p_created_by);\n  ' end;
  definition:=replace(definition,anchor,injected||anchor);
 end loop;
 execute definition;
end; $$;

-- Preserve the exact HMAC/lifecycle implementation as a private backing
-- function. All existing webhook, owner replay and durable worker callers keep
-- the same public RPC. Its original result is returned unchanged.
alter function public.billing_settle_paymob_hmac_verified(jsonb) set schema private;
alter function private.billing_settle_paymob_hmac_verified(jsonb) rename to billing_settle_paymob_hmac_verified_pre_service;
revoke all on function private.billing_settle_paymob_hmac_verified_pre_service(jsonb) from public,anon,authenticated,service_role;
create function public.billing_settle_paymob_hmac_verified(p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; grant_result jsonb; v_order uuid; v_application uuid; snap private.billing_service_order_offers%rowtype;
begin
 result:=private.billing_settle_paymob_hmac_verified_pre_service(p_evidence);
 if result->>'ok' is distinct from 'true' or result->>'outcome' not in ('granted','idempotent_replay') then return result;end if;
 v_order:=(result->>'order_id')::uuid;
 select * into snap from private.billing_service_order_offers where billing_service_order_offers.order_id=v_order;
 if not found then
  if exists(select 1 from private.billing_service_offers f join public.billing_orders o on o.plan_version_id=f.plan_version_id where o.id=v_order) then
   raise exception 'SERVICE_ORDER_SNAPSHOT_MISSING' using errcode='23514';end if;
  return result;
 end if;
 if snap.service_code<>'noura' or snap.tier<>'basic' or snap.capabilities is distinct from array['noura.knowledge.read']::text[]
 or not exists(select 1 from public.billing_plan_versions v join public.billing_plans p on p.id=v.plan_id where v.id=snap.plan_version_id and p.code='noor_basic') then
  raise exception 'SERVICE_SETTLEMENT_UNSUPPORTED' using errcode='23514';end if;
 v_application:=(result->>'entitlement_application_id')::uuid;
 if result->>'outcome'='idempotent_replay' and not exists(select 1 from private.billing_service_grants where entitlement_application_id=v_application and billing_service_grants.order_id=v_order) then
  raise exception 'SERVICE_GRANT_REPLAY_REQUIRES_REVIEW' using errcode='23514';end if;
 grant_result:=public.billing_apply_service_grant(v_application);
 if grant_result->>'ok' is distinct from 'true' then raise exception 'SERVICE_GRANT_REJECTED: %',grant_result->>'code' using errcode='23514';end if;
 return result;
end; $$;
revoke all on function public.billing_settle_paymob_hmac_verified(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.billing_settle_paymob_hmac_verified(jsonb) to service_role;
notify pgrst,'reload schema';
commit;

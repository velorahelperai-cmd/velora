-- Additive receipt projection only. LOCAL IMPLEMENTATION; production approval separate.
-- No historical offer/grant backfill and no existing billing mutation.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ begin
 if to_regclass('private.billing_proven_entitlement_grants') is null
 or to_regprocedure('public.check_app_session(boolean)') is null
 or to_regprocedure('public.has_company_capability(uuid,text)') is null then
  raise exception 'SERVICE_ENTITLEMENT_DEPENDENCIES_MISSING' using errcode='55000';
 end if;
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.billing_financial_receipt_immutability()')) is distinct from '968854ccf1b251404062386ea9f2fe2f' then
  raise exception 'SERVICE_IMMUTABLE_RECEIPT_PREREQUISITE_MISMATCH' using errcode='55000';
 end if;
 if (select count(*) from pg_trigger where tgfoid='private.billing_financial_receipt_immutability()'::regprocedure
 and not tgisinternal and tgenabled in ('O','A') and (tgrelid,tgname) in (
 ('public.billing_provider_events'::regclass,'billing_provider_receipt_immutability'),
 ('public.billing_entitlement_applications'::regclass,'billing_entitlement_receipt_immutability'),
 ('public.billing_settlement_outcomes'::regclass,'billing_settlement_receipt_immutability'),
 ('public.billing_provider_events'::regclass,'billing_provider_receipt_no_truncate'),
 ('public.billing_entitlement_applications'::regclass,'billing_entitlement_receipt_no_truncate'),
 ('public.billing_settlement_outcomes'::regclass,'billing_settlement_receipt_no_truncate')))<>6 then
  raise exception 'SERVICE_IMMUTABLE_RECEIPT_TRIGGERS_MISSING' using errcode='55000';
 end if;
end; $$;

-- Only implemented capability surfaces are authorizable. No catalog targets.
create function private.billing_service_rbac(p_service text,p_capability text) returns text
language sql immutable set search_path='' as $$
 select case when p_service='noura' and p_capability='noura.knowledge.read' then 'knowledge.read' end;
$$;
revoke all on function private.billing_service_rbac(text,text) from public,anon,authenticated,service_role;

create table private.billing_service_offers (
 plan_version_id uuid primary key references public.billing_plan_versions(id) on delete restrict,
 service_code text not null check(service_code='noura'),
 tier text not null check(tier in ('basic','premium')),
 capabilities text[] not null check(capabilities=array['noura.knowledge.read']::text[]),
 created_at timestamptz not null default clock_timestamp()
);
create table private.billing_service_order_offers (
 order_id uuid primary key references public.billing_orders(id) on delete restrict,
 plan_version_id uuid not null references private.billing_service_offers(plan_version_id) on delete restrict,
 service_code text not null check(service_code='noura'),
 tier text not null check(tier in ('basic','premium')),
 capabilities text[] not null check(capabilities=array['noura.knowledge.read']::text[]),
 environment text not null check(environment in ('test','live')),
 created_at timestamptz not null default clock_timestamp()
);
create table private.billing_service_grants (
 entitlement_application_id uuid primary key references public.billing_entitlement_applications(id) on delete restrict,
 order_id uuid not null unique references private.billing_service_order_offers(order_id) on delete restrict,
 activated boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.billing_service_offers enable row level security;
alter table private.billing_service_order_offers enable row level security;
alter table private.billing_service_grants enable row level security;
revoke all on private.billing_service_offers,private.billing_service_order_offers,private.billing_service_grants from public,anon,authenticated,service_role;

create function private.billing_service_immutable() returns trigger
language plpgsql set search_path='' as $$ begin
 if tg_table_name='billing_service_grants' and tg_op='UPDATE' then
  if row(new.entitlement_application_id,new.order_id,new.created_at) is not distinct from row(old.entitlement_application_id,old.order_id,old.created_at) then return new;end if;
 end if;
 raise exception 'SERVICE_EVIDENCE_IMMUTABLE' using errcode='23514';
end; $$;
revoke all on function private.billing_service_immutable() from public,anon,authenticated,service_role;
create trigger service_offer_immutable before update or delete on private.billing_service_offers for each row execute function private.billing_service_immutable();
create trigger service_order_offer_immutable before update or delete on private.billing_service_order_offers for each row execute function private.billing_service_immutable();
create trigger service_grant_immutable before update or delete on private.billing_service_grants for each row execute function private.billing_service_immutable();

create trigger service_offer_no_truncate before truncate on private.billing_service_offers for each statement execute function private.billing_service_immutable();
create trigger service_order_offer_no_truncate before truncate on private.billing_service_order_offers for each statement execute function private.billing_service_immutable();
create trigger service_grant_no_truncate before truncate on private.billing_service_grants for each statement execute function private.billing_service_immutable();

-- Server-owned draft offer definition, before publication and before any order.
-- Not wired to catalog UI or checkout in this slice. One explicit service per version.
create function public.billing_define_service_offer(p_plan_version_id uuid,p_service_code text,p_tier text,p_capabilities text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.billing_plan_versions%rowtype; existing private.billing_service_offers%rowtype;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_service_code is distinct from 'noura' or p_tier is null or p_tier not in ('basic','premium')
 or p_capabilities is distinct from array['noura.knowledge.read']::text[] then return jsonb_build_object('ok',false,'code','UNSUPPORTED_CAPABILITY');end if;
 select * into v from public.billing_plan_versions where id=p_plan_version_id for update;
 if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
 select * into existing from private.billing_service_offers where plan_version_id=v.id;
 if found then return jsonb_build_object('ok',existing.service_code=p_service_code and existing.tier=p_tier and existing.capabilities=p_capabilities,
 'code',case when existing.service_code=p_service_code and existing.tier=p_tier and existing.capabilities=p_capabilities then 'IDEMPOTENT_REPLAY' else 'IMMUTABLE' end);end if;
 if v.status<>'draft' or exists(select 1 from public.billing_orders where plan_version_id=v.id) then return jsonb_build_object('ok',false,'code','IMMUTABLE');end if;
 insert into private.billing_service_offers(plan_version_id,service_code,tier,capabilities) values(v.id,p_service_code,p_tier,p_capabilities);
 return jsonb_build_object('ok',true,'code','DEFINED');
end; $$;

-- Future purchase transaction must call this AFTER locked order creation and
-- BEFORE creating any provider attempt. Existing orders cannot gain an offer late.
create function public.billing_snapshot_service_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_orders%rowtype; offer private.billing_service_offers%rowtype; cid uuid;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select company_id into cid from public.billing_orders where id=p_order_id;
 if cid is null then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
 perform 1 from public.companies where id=cid for update;
 select * into o from public.billing_orders where id=p_order_id and company_id=cid for update;
 if exists(select 1 from private.billing_service_order_offers where order_id=o.id) then return jsonb_build_object('ok',true,'code','IDEMPOTENT_REPLAY');end if;
 select f.* into offer from private.billing_service_offers f join public.billing_plan_versions v on v.id=f.plan_version_id
 where f.plan_version_id=o.plan_version_id and v.status='published' for share of f,v;
 if not found then return jsonb_build_object('ok',false,'code','SERVICE_CONTRACT_MISSING');end if;
 if o.product_code is distinct from 'velora_ai_staff' then return jsonb_build_object('ok',false,'code','UNSUPPORTED_PRODUCT');end if;
 if o.status<>'locked' or o.created_at<offer.created_at
 or exists(select 1 from public.billing_payment_attempts where order_id=o.id)
 then return jsonb_build_object('ok',false,'code','ORDER_ALREADY_DISPATCHED');end if;
 insert into private.billing_service_order_offers(order_id,plan_version_id,service_code,tier,capabilities,environment)
 values(o.id,offer.plan_version_id,offer.service_code,offer.tier,offer.capabilities,o.provider_environment);
 return jsonb_build_object('ok',true,'code','SNAPSHOTTED');
end; $$;

-- Independently deny known lifecycle reversals, including events awaiting settlement.
create function private.billing_service_receipt_eligible(p_application_id uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from private.billing_proven_entitlement_grants g where g.id=p_application_id
 and not exists(select 1 from public.billing_provider_events r where r.company_id=g.company_id
 and r.provider=g.provider and r.provider_account_ref=g.provider_account_ref
 and r.provider_environment=g.provider_environment and r.provider_transaction_id=g.provider_transaction_id
 and (r.event_status in ('refunded','voided','cancelled') or r.raw_summary->'is_refunded'='true'::jsonb or r.raw_summary->'is_voided'='true'::jsonb)));
$$;
revoke all on function private.billing_service_receipt_eligible(uuid) from public,anon,authenticated,service_role;

-- Exact future settlement boundary: call AFTER the existing verified settlement
-- creates its proven application, IN THE SAME TRANSACTION. Never accept client
-- service, tier, capability, tenant, paid date or provider evidence here.
create function public.billing_apply_service_grant(p_entitlement_application_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g record; snap private.billing_service_order_offers%rowtype; cid uuid;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select company_id into cid from public.billing_entitlement_applications where id=p_entitlement_application_id;
 if cid is null then return jsonb_build_object('ok',false,'code','PAYMENT_UNPROVEN');end if;
 perform 1 from public.companies where id=cid for update;
 select * into g from private.billing_proven_entitlement_grants where id=p_entitlement_application_id and company_id=cid;
 if not found or not private.billing_service_receipt_eligible(p_entitlement_application_id) then return jsonb_build_object('ok',false,'code','PAYMENT_UNPROVEN');end if;
 select * into snap from private.billing_service_order_offers where order_id=g.order_id;
 if not found then return jsonb_build_object('ok',false,'code','SERVICE_CONTRACT_MISSING');end if;
 if snap.plan_version_id<>g.plan_version_id or snap.environment<>g.provider_environment then return jsonb_build_object('ok',false,'code','EVIDENCE_MISMATCH');end if;
 insert into private.billing_service_grants(entitlement_application_id,order_id) values(g.id,g.order_id) on conflict do nothing;
 return jsonb_build_object('ok',true,'code',case when found then 'GRANTED' else 'IDEMPOTENT_REPLAY' end);
end; $$;

-- Activation is separate and server-owned; minting a grant never activates it.
create function public.billing_activate_service_grant(p_entitlement_application_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_active is null then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select company_id into cid from public.billing_entitlement_applications where id=p_entitlement_application_id;
 if cid is null then return jsonb_build_object('ok',false,'code','PAYMENT_UNPROVEN');end if;
 perform 1 from public.companies where id=cid for update;
 if p_active and not exists(select 1 from private.billing_proven_entitlement_grants g
 join private.billing_service_grants sg on sg.entitlement_application_id=g.id
 join private.billing_service_order_offers so on so.order_id=sg.order_id and so.order_id=g.order_id
 join public.billing_subscriptions s on s.id=g.subscription_id and s.company_id=g.company_id and s.environment=g.provider_environment
 where g.id=p_entitlement_application_id and private.billing_service_receipt_eligible(g.id) and so.environment=g.provider_environment and so.plan_version_id=g.plan_version_id
 and g.applied_paid_through>clock_timestamp() and s.status in ('active','cancel_at_period_end')
 and s.paid_through=g.applied_paid_through and s.plan_version_id=g.plan_version_id
 and exists(select 1 from public.companies c where c.id=cid and c.status='active'))
 then return jsonb_build_object('ok',false,'code','SUBSCRIPTION_INACTIVE');end if;
 update private.billing_service_grants set activated=p_active where entitlement_application_id=p_entitlement_application_id;
 return jsonb_build_object('ok',found);
end; $$;

-- Session-only read; direct calls independently enforce identity, lease and RBAC.
-- Read-only pre-request/hook rollout settings are not authorization evidence.
create function public.billing_read_service_access(p_company_id uuid,p_capability text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); session_check jsonb; cap text; result jsonb;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 session_check:=public.check_app_session(false);
 if session_check->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not exists(select 1 from auth.users where id=actor and (email_confirmed_at is not null or phone_confirmed_at is not null))
 or not exists(select 1 from public.company_members where company_id=p_company_id and user_id=actor and status='active')
 or not exists(select 1 from public.companies where id=p_company_id and status='active')
 then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 cap:=private.billing_service_rbac('noura',p_capability);
 if cap is null then return jsonb_build_object('ok',false,'code','UNSUPPORTED_CAPABILITY');end if;
 if public.has_company_capability(p_company_id,cap) is distinct from true then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select jsonb_build_object('ok',true,'allowed',true,'company_id',p_company_id,'capability',p_capability,
 'service_code',so.service_code,'tier',so.tier,'environment','live','expires_at',g.applied_paid_through,'plan_version_id',so.plan_version_id)
 into result from private.billing_service_grants sg
 join private.billing_service_order_offers so on so.order_id=sg.order_id
 join private.billing_proven_entitlement_grants g on g.id=sg.entitlement_application_id and g.order_id=sg.order_id
 join public.billing_subscriptions s on s.id=g.subscription_id and s.company_id=g.company_id
 where g.company_id=p_company_id and g.provider_environment='live' and so.environment='live' and s.environment='live'
 and private.billing_service_receipt_eligible(g.id) and so.plan_version_id=g.plan_version_id and p_capability=any(so.capabilities) and sg.activated
 and g.applied_paid_through>clock_timestamp() and s.status in ('active','cancel_at_period_end')
 and s.paid_through=g.applied_paid_through and s.plan_version_id=g.plan_version_id
 order by g.applied_at desc,g.id limit 1;
 if result is not null then return result;end if;
 return jsonb_build_object('ok',false,'code','SERVICE_NOT_ACTIVE');
end; $$;
revoke all on function public.billing_define_service_offer(uuid,text,text,text[]),public.billing_snapshot_service_order(uuid),public.billing_apply_service_grant(uuid),public.billing_activate_service_grant(uuid,boolean),public.billing_read_service_access(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.billing_define_service_offer(uuid,text,text,text[]),public.billing_snapshot_service_order(uuid),public.billing_apply_service_grant(uuid),public.billing_activate_service_grant(uuid,boolean) to service_role;
grant execute on function public.billing_read_service_access(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;

-- Local reviewed Stage 2A only. No historical backfill/classification or service activation.
-- CLI scaffold 20261010121531; production application requires separate approval.
begin;
set local search_path='';set local lock_timeout='2s';set local statement_timeout='30s';
lock table public.billing_orders,public.billing_plan_versions,public.billing_subscriptions,
 public.billing_payment_attempts,public.billing_provider_events,
 public.billing_entitlement_applications,public.billing_settlement_outcomes in share row exclusive mode;
do $preflight$ declare actual jsonb;begin
 if current_user<>'postgres' then raise exception 'STAGE2A_INSTALLER_MISMATCH';end if;
 select jsonb_build_object('database_owner',(select pg_get_userbyid(datdba) from pg_database where datname=current_database()),'public_owner',(select pg_get_userbyid(nspowner) from pg_namespace where nspname='public'),'public_acl',(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname='public')) into actual;
 if actual is distinct from '{"public_acl":[{"role":"PUBLIC","grantable":false,"privilege":"USAGE"},{"role":"anon","grantable":false,"privilege":"USAGE"},{"role":"authenticated","grantable":false,"privilege":"USAGE"},{"role":"pg_database_owner","grantable":false,"privilege":"CREATE"},{"role":"pg_database_owner","grantable":false,"privilege":"USAGE"},{"role":"postgres","grantable":false,"privilege":"USAGE"},{"role":"service_role","grantable":false,"privilege":"USAGE"}],"public_owner":"pg_database_owner","database_owner":"postgres"}'::jsonb then raise exception 'STAGE2A_INSTALLER_NAMESPACE_MISMATCH';end if;


with targets as(select c.oid,n.nspname||'.'||c.relname name,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('billing_provider_events','billing_entitlement_applications','billing_settlement_outcomes','billing_orders','billing_payment_attempts','billing_subscriptions','billing_plan_versions')), t as(select name,pg_get_userbyid(relowner) owner,relrowsecurity rls,relforcerowsecurity force_rls,(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=targets.oid and a.attnum>0 and not a.attisdropped) columns,(select jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated) order by c.conname) from pg_constraint c where c.conrelid=targets.oid) constraints,(select jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'constraint_owned',exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)) order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=targets.oid) indexes,(select jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid),'function',tgfoid::regprocedure::text,'function_md5',(select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=tgfoid)) order by tgname) from pg_trigger where tgrelid=targets.oid and not tgisinternal) triggers,(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(relacl,acldefault('r',relowner))) a) acl,(select jsonb_agg(jsonb_build_object('column',a.attname,'role',case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,'privilege',g.privilege_type,'grantable',g.is_grantable) order by a.attname,g.grantee::regrole::text,g.privilege_type) from pg_attribute a cross join lateral aclexplode(a.attacl) g where a.attrelid=targets.oid) column_acl,(select jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'cmd',p.polcmd,'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by r::regrole::text) from unnest(p.polroles) r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by polname) from pg_policy p where p.polrelid=targets.oid) policies from targets),f as(select p.oid::regprocedure::text signature,pg_get_userbyid(proowner) owner,md5(replace(prosrc,chr(13),'')) body_md5,prosecdef,proconfig,provolatile,(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(proacl,acldefault('f',proowner))) a) acl from pg_proc p where p.oid in(to_regprocedure('private.billing_add_calendar_period(timestamp with time zone,text,integer)'),to_regprocedure('private.billing_compute_paid_through(timestamp with time zone,timestamp with time zone,text,integer)'),to_regprocedure('private.billing_confirm_payment_attempt_failed(uuid,uuid,jsonb)'),to_regprocedure('private.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'),to_regprocedure('private.billing_entitlement_applications_company_guard()'),to_regprocedure('private.billing_financial_receipt_immutability()'),to_regprocedure('private.billing_open_payment_attempt_after_confirmed_failed(uuid,uuid,uuid,text)'),to_regprocedure('private.billing_order_is_safe_uncirculated_draft(uuid)'),to_regprocedure('private.billing_orders_client_op_fingerprint_guard()'),to_regprocedure('private.billing_orders_immutability()'),to_regprocedure('private.billing_pin_test_provider_amount()'),to_regprocedure('private.billing_plan_versions_immutability()'),to_regprocedure('private.billing_reject_immutable_change(text)'),to_regprocedure('private.billing_resolve_or_create_payment_attempt(uuid,uuid)'),to_regprocedure('private.billing_set_payment_attempt_lifecycle_status(uuid,uuid,text)'),to_regprocedure('private.billing_settle_payment_core(jsonb)'),to_regprocedure('private.billing_subscription_within_paid_period(timestamp with time zone,timestamp with time zone)'),to_regprocedure('private.billing_ui_catalog_draft(text,public.billing_plan_versions)'),to_regprocedure('private.billing_ui_company_owner(uuid)'),to_regprocedure('private.billing_ui_owner()'),to_regprocedure('private.billing_ui_valid_draft(jsonb)'),to_regprocedure('public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'),to_regprocedure('public.billing_create_test_checkout_order(jsonb,integer)'),to_regprocedure('public.billing_settle_paymob_hmac_verified(jsonb)')))
select jsonb_build_object('tables',(select jsonb_object_agg(name,md5(to_jsonb(t)::text)) from t),'functions',(select jsonb_object_agg(signature,md5(to_jsonb(f)::text)) from f)) into actual;

if actual is distinct from '{"tables":{"public.billing_entitlement_applications":"1a476db28f46ca2e93d3765ae849f066","public.billing_orders":"70d3e4d84b3e7d8671c4c2f3a6b2bb78","public.billing_payment_attempts":"f1214f700eeb11d73aa859d942f79986","public.billing_plan_versions":"71ff6c5adb0f8c6eb8dc5284cca72889","public.billing_provider_events":"db57adee254d8829c2c1064ecf6a600e","public.billing_settlement_outcomes":"5ea35574ac79cbfeaeed1bc44110bbfe","public.billing_subscriptions":"85c678ec40d93b2202e9f96c72af5409"},"functions":{"private.billing_add_calendar_period(timestamp with time zone,text,integer)":"66d4e4895663fee70695bf036bd7aee4","private.billing_compute_paid_through(timestamp with time zone,timestamp with time zone,text,integer)":"7ddefbcd6f20d0b1ad990694403d7c7d","private.billing_confirm_payment_attempt_failed(uuid,uuid,jsonb)":"eedbf0555c4f3a2154624c8802ffce47","private.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)":"792d856752c258515c3df45398320a4b","private.billing_entitlement_applications_company_guard()":"ef18eae57dbf4b57f51af21bcd823fbb","private.billing_financial_receipt_immutability()":"3e33026363f68059e2d93fa75685ce6b","private.billing_open_payment_attempt_after_confirmed_failed(uuid,uuid,uuid,text)":"6e73ca11440ab7adba5d3333e3128a3f","private.billing_order_is_safe_uncirculated_draft(uuid)":"fdcaa9d2cc6c5b76613f99838f07551f","private.billing_orders_client_op_fingerprint_guard()":"23db6a8cc00b4688a056eaac3fa54699","private.billing_orders_immutability()":"cda6e1769a1d10e109684b470bc630aa","private.billing_pin_test_provider_amount()":"e1c780a635833481da02d7277c070ed7","private.billing_plan_versions_immutability()":"50fc18a8f4cdd041acdf86ef21a085a3","private.billing_reject_immutable_change(text)":"a94c504b971789e4ee4f1189d26edf08","private.billing_resolve_or_create_payment_attempt(uuid,uuid)":"5afabd6a44ad54a0556839920a38787a","private.billing_set_payment_attempt_lifecycle_status(uuid,uuid,text)":"034ca8e247dea83a43916cacfe187747","private.billing_settle_payment_core(jsonb)":"80c74f31f49d6cf79bd858ad1bdbca99","private.billing_subscription_within_paid_period(timestamp with time zone,timestamp with time zone)":"5a7fac2cadd4545a381620fe6a48799f","private.billing_ui_catalog_draft(text,public.billing_plan_versions)":"07da1ff7186cccd18b4710bd19c52b30","private.billing_ui_company_owner(uuid)":"dcbf653d652a5b765f6b554c38ab6136","private.billing_ui_owner()":"d9b4829f05cf0cde72cded6d220bd639","private.billing_ui_valid_draft(jsonb)":"c93cd0e1fbefa14a82a0e61e0073b2b0","public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)":"5d1a4aaa30f04ca37be9cfca79ccddef","public.billing_create_test_checkout_order(jsonb,integer)":"406e1af0ca0accd165f3e20003f06bdf","public.billing_settle_paymob_hmac_verified(jsonb)":"0916b755d435bd09245ef76f97e4d5bb"}}'::jsonb then raise exception 'STAGE2A_CATALOG_PREREQUISITE_MISMATCH';end if;

select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),'definition_md5',md5(replace(pg_get_viewdef(c.oid,true),chr(13),'')),'acl',(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a)) order by c.relname) into actual from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('billing_verified_collection_history','billing_proven_entitlement_grants');if actual is distinct from '[{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"}],"name":"private.billing_proven_entitlement_grants","owner":"postgres","definition_md5":"aa061659aa08afb861a76c830b339b41"},{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"}],"name":"private.billing_verified_collection_history","owner":"postgres","definition_md5":"329b440feaaaf7f2602b96651e932622"}]'::jsonb then raise exception 'STAGE2A_PROOF_VIEWS_MISMATCH';end if;

if to_regclass('private.billing_lifecycle_reviews') is not null or to_regprocedure('private.billing_settle_payment_core_pre_acceptance(jsonb)') is not null then raise exception 'STAGE2A_ALREADY_OR_PARTIALLY_INSTALLED';end if;
 -- Validate prospective arbiters BEFORE schema changes; no repair/delete is allowed.
 if exists(select 1 from public.billing_payment_attempts where num_nonnulls(provider,provider_account_ref,provider_environment) not in (0,3)) then raise exception 'STAGE2A_PARTIAL_LEGACY_SCOPE';end if;
 if exists(select 1 from public.billing_payment_attempts a join public.billing_orders o on o.id=a.order_id and o.company_id=a.company_id where num_nonnulls(a.provider,a.provider_account_ref,a.provider_environment)=3 and row(a.provider,a.provider_account_ref,a.provider_environment) is distinct from row(o.provider,o.provider_account_ref,o.provider_environment)) then raise exception 'STAGE2A_EXISTING_SCOPE_CONFLICT';end if;
 if exists(select 1 from public.billing_payment_attempts a join public.billing_payment_attempts u on u.provider_order_id=a.provider_order_id and u.id<>a.id join public.billing_orders o on o.id=u.order_id and o.company_id=u.company_id where num_nonnulls(a.provider,a.provider_account_ref,a.provider_environment)=3 and num_nonnulls(u.provider,u.provider_account_ref,u.provider_environment)=0 and o.provider=a.provider and o.provider_account_ref=a.provider_account_ref and o.provider_environment=a.provider_environment) then raise exception 'STAGE2A_BOUND_LEGACY_ID_AMBIGUOUS';end if;
 if exists(select 1 from public.billing_payment_attempts where provider_order_id is not null and num_nonnulls(provider,provider_account_ref,provider_environment)=3 group by provider,provider_account_ref,provider_environment,provider_order_id having count(*)>1) then raise exception 'STAGE2A_DUPLICATE_BOUND_PROVIDER_ORDER';end if;
end;$preflight$;
alter table public.billing_subscriptions add column environment text check(environment in ('test','live'));
alter table public.billing_subscriptions drop constraint billing_subscriptions_company_uidx;
create unique index billing_subscriptions_company_env_uidx on public.billing_subscriptions(company_id,environment) where environment in ('test','live');
alter table public.billing_orders add column expires_at timestamptz;
alter table public.billing_orders add column deadline_policy_approved boolean;
alter table public.billing_payment_attempts add constraint billing_attempt_complete_scope check(num_nonnulls(provider,provider_account_ref,provider_environment) in (0,3));
create unique index billing_payment_attempts_provider_order_uidx on public.billing_payment_attempts(provider,provider_account_ref,provider_environment,provider_order_id) where provider_order_id is not null and num_nonnulls(provider,provider_account_ref,provider_environment)=3;
create index billing_payment_attempts_unproven_provider_order_idx on public.billing_payment_attempts(provider_order_id) where provider_order_id is not null and num_nonnulls(provider,provider_account_ref,provider_environment)=0;
alter table public.billing_provider_events drop constraint billing_provider_events_event_status_check;
alter table public.billing_provider_events add constraint billing_provider_events_event_status_check check(event_status in ('pending','success','failed','refunded','voided','cancelled','other'));

create or replace function private.billing_payment_attempts_sync_order_scope()
returns trigger language plpgsql set search_path='' as $$
declare ord public.billing_orders%rowtype;
begin
 select * into ord from public.billing_orders where id=new.order_id and company_id=new.company_id;
 if not found then raise exception 'ATTEMPT_ORDER_SCOPE_MISSING' using errcode='23503';end if;
 if ord.expires_at is null then raise exception 'ATTEMPT_LEGACY_ORDER_UNPROVEN' using errcode='23514';end if;
 if (new.provider is not null and new.provider is distinct from ord.provider)
  or (new.provider_account_ref is not null and new.provider_account_ref is distinct from ord.provider_account_ref)
  or (new.provider_environment is not null and new.provider_environment is distinct from ord.provider_environment)
 then raise exception 'ATTEMPT_PROVIDER_SCOPE_MISMATCH' using errcode='23514';end if;
 new.provider:=ord.provider;new.provider_account_ref:=ord.provider_account_ref;new.provider_environment:=ord.provider_environment;
 -- INSERT (including ON CONFLICT) must refuse the same unknown legacy IDs as first binding by UPDATE.
 if new.provider_order_id is not null and exists(
  select 1 from public.billing_payment_attempts u join public.billing_orders o on o.id=u.order_id and o.company_id=u.company_id
  where u.id<>new.id and u.provider_order_id=new.provider_order_id and num_nonnulls(u.provider,u.provider_account_ref,u.provider_environment)=0
   and o.provider=new.provider and o.provider_account_ref=new.provider_account_ref and o.provider_environment=new.provider_environment
 ) then raise exception 'LEGACY_PROVIDER_ORDER_SCOPE_AMBIGUOUS' using errcode='23514';end if;
 return new;
end;$$;
revoke all on function private.billing_payment_attempts_sync_order_scope() from public,anon,authenticated,service_role;
create trigger billing_payment_attempts_sync_scope_trg before insert on public.billing_payment_attempts for each row execute function private.billing_payment_attempts_sync_order_scope();
create function private.billing_payment_attempts_binding_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.company_id is distinct from old.company_id or new.order_id is distinct from old.order_id
  or new.provider is distinct from old.provider or new.provider_account_ref is distinct from old.provider_account_ref
  or new.provider_environment is distinct from old.provider_environment
  or (old.provider_order_id is not null and new.provider_order_id is distinct from old.provider_order_id)
  or (old.provider_intention_id is not null and new.provider_intention_id is distinct from old.provider_intention_id)
  or (num_nonnulls(old.provider,old.provider_account_ref,old.provider_environment)=0
   and (new.provider_order_id is distinct from old.provider_order_id or new.provider_intention_id is distinct from old.provider_intention_id)) then
  raise exception 'ATTEMPT_SCOPE_IMMUTABLE_OR_LEGACY_UNPROVEN' using errcode='23514';
 end if;
 if old.provider_order_id is null and new.provider_order_id is not null and exists(
  select 1 from public.billing_payment_attempts u join public.billing_orders o on o.id=u.order_id and o.company_id=u.company_id
  where u.id<>new.id and u.provider_order_id=new.provider_order_id and num_nonnulls(u.provider,u.provider_account_ref,u.provider_environment)=0
   and o.provider=new.provider and o.provider_account_ref=new.provider_account_ref and o.provider_environment=new.provider_environment
 ) then raise exception 'LEGACY_PROVIDER_ORDER_SCOPE_AMBIGUOUS' using errcode='23514';end if;
 return new;
end;$$;
revoke all on function private.billing_payment_attempts_binding_guard() from public,anon,authenticated,service_role;
create trigger billing_payment_attempts_binding_guard_trg before update on public.billing_payment_attempts for each row execute function private.billing_payment_attempts_binding_guard();

create or replace function private.billing_provider_event_binding_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare a public.billing_payment_attempts%rowtype;o public.billing_orders%rowtype;
begin
 -- Privileged only to acquire the parent-company lock. Do not grant company
 -- UPDATE to the application service role. Browser roles cannot insert events.
 if current_setting('role',true) not in ('service_role','none') then
  raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';
 end if;
 select * into a from public.billing_payment_attempts where id=new.payment_attempt_id;
 select * into o from public.billing_orders where id=a.order_id;
 if a.id is null or o.id is null or new.company_id is distinct from a.company_id or a.company_id is distinct from o.company_id
  or new.provider is distinct from o.provider or new.provider_account_ref is distinct from o.provider_account_ref
  or new.provider_environment is distinct from o.provider_environment
  or new.amount_baisa_expected is distinct from o.amount_baisa or new.currency_expected is distinct from o.currency
 then raise exception 'EVENT_PROVIDER_SCOPE_MISMATCH' using errcode='23514';end if;
 -- Serialize receipt insertion with settlement/reversal: company first, then
 -- subscription, order, attempt. No unsigned callback field selects a tenant.
 perform 1 from public.companies where id=o.company_id for update;
 perform 1 from public.billing_subscriptions where company_id=o.company_id and environment=o.provider_environment for update;
 perform 1 from public.billing_orders where id=o.id and company_id=o.company_id for update;
 perform 1 from public.billing_payment_attempts where id=a.id and company_id=o.company_id for update;
 return new;
end;$$;
revoke all on function private.billing_provider_event_binding_guard() from public,anon,authenticated,service_role;
create trigger billing_provider_event_binding_guard before insert on public.billing_provider_events for each row execute function private.billing_provider_event_binding_guard();

create function private.billing_order_deadline_identity_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.expires_at is distinct from old.expires_at or new.product_code is distinct from old.product_code
  or new.purchase_purpose is distinct from old.purchase_purpose then
  raise exception 'LOCKED_ORDER_IDENTITY_IMMUTABLE' using errcode='23514';
 end if;
 -- This field is added by the next forward migration. No automatic approval
 -- exists; approval cannot be changed after a provider attempt is bound.
 if new.deadline_policy_approved is distinct from old.deadline_policy_approved
  and (old.expires_at is null or old.status<>'locked' or exists(select 1 from public.billing_payment_attempts
   where order_id=old.id and (provider_order_id is not null or status in ('provider_submitted','unresolved','paid')))) then
  raise exception 'DEADLINE_APPROVAL_ALREADY_BOUND' using errcode='23514';
 end if;
 return new;
end;$$;
revoke all on function private.billing_order_deadline_identity_guard() from public,anon,authenticated,service_role;
create trigger billing_order_deadline_identity_guard before update on public.billing_orders for each row execute function private.billing_order_deadline_identity_guard();

create or replace function public.billing_create_or_reuse_subscription_order(
  p_company_id uuid,
  p_product_code text,
  p_purchase_purpose text,
  p_plan_version_id uuid,
  p_requested_plan_id uuid,
  p_client_op_id text,
  p_input_fingerprint text,
  p_special_reference text,
  p_amount_baisa bigint,
  p_currency text,
  p_period_days integer,
  p_period_unit text,
  p_period_count integer,
  p_provider_account_ref text,
  p_provider_environment text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_open public.billing_orders%rowtype;
  v_sub public.billing_subscriptions%rowtype;
  v_pv record;
  v_paid_through timestamptz;
  v_resolve jsonb;
  v_order public.billing_orders%rowtype;
  v_attempt_status text;
  v_constraint text;
begin
  -- Validate basic inputs
  if p_company_id is null or p_plan_version_id is null or p_created_by is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'detail', 'Missing required identifiers');
  end if;

  if p_provider_environment not in ('test', 'live') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'detail', 'Invalid provider environment');
  end if;

  if p_purchase_purpose not in ('initial', 'renew') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'detail', 'Invalid purchase purpose');
  end if;

  -- Verify active company lock
  perform 1 from public.companies where id = p_company_id and status <> 'suspended' for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'COMPANY_NOT_FOUND_OR_SUSPENDED');
  end if;

  -- D3: Atomically verify plan and version publication status and lock catalog row
  select pv.*, p.status as plan_status, p.code as plan_code
  into v_pv
  from public.billing_plan_versions pv
  join public.billing_plans p on p.id = pv.plan_id
  where pv.id = p_plan_version_id
  for share;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PLAN_VERSION_NOT_FOUND');
  end if;

  if v_pv.status is distinct from 'published' or v_pv.plan_status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'PLAN_NOT_PUBLISHED');
  end if;

  if p_requested_plan_id is not null and v_pv.plan_id is distinct from p_requested_plan_id then
    return jsonb_build_object('ok', false, 'code', 'PLAN_ID_MISMATCH');
  end if;

  -- Validate financial snapshot against locked catalog version
  if p_amount_baisa is distinct from v_pv.amount_baisa
     or p_currency is distinct from v_pv.currency
     or p_period_days is distinct from v_pv.period_days
     or p_period_unit is distinct from v_pv.period_unit
     or p_period_count is distinct from v_pv.period_count then
    return jsonb_build_object('ok', false, 'code', 'FINANCIAL_SNAPSHOT_MISMATCH');
  end if;

  -- D2: Environment-isolated subscription inspection
  select * into v_sub
  from public.billing_subscriptions
  where company_id = p_company_id and environment = p_provider_environment
  for update;

  v_paid_through := v_sub.paid_through;

  if p_purchase_purpose = 'initial' then
    if v_sub.status = 'active' and v_paid_through is not null and v_paid_through > v_now then
      return jsonb_build_object(
        'ok', false,
        'code', 'INITIAL_PURCHASE_ALREADY_ACTIVE',
        'block_new_collection', true,
        'manage_subscription_hint', true
      );
    end if;
  elsif p_purchase_purpose = 'renew' then
    if v_sub.status not in ('active', 'suspended') or v_paid_through is null then
      return jsonb_build_object('ok', false, 'code', 'RENEW_WITHOUT_PRIOR_SUBSCRIPTION');
    end if;
  end if;

  -- Check existing open order for this company / product / environment
  select * into v_open
  from public.billing_orders o
  where o.company_id = p_company_id
    and o.product_code = p_product_code
    and o.provider_environment = p_provider_environment
    and o.status in ('locked', 'submitted')
  order by o.created_at desc
  limit 1
  for update;

  if found then
    if v_open.expires_at is null then return jsonb_build_object('ok',false,'code','LEGACY_ORDER_REQUIRES_REVIEW');end if;
    if v_open.provider_account_ref is distinct from p_provider_account_ref then return jsonb_build_object('ok',false,'code','CONTENT_MISMATCH');end if;
    -- D3: Check checkout session expiration on existing open order
    if v_open.expires_at is not null and v_open.expires_at < v_now and v_open.status = 'locked' then
      update public.billing_orders
      set status = 'cancelled'
      where id = v_open.id;
      -- Proceed to create a fresh order below
    else
      if v_open.plan_version_id is distinct from p_plan_version_id
         or v_open.amount_baisa is distinct from p_amount_baisa
         or v_open.currency is distinct from p_currency
         or v_open.purchase_purpose is distinct from p_purchase_purpose then
        return jsonb_build_object(
          'ok', false,
          'code', 'CONTENT_MISMATCH',
          'order_id', v_open.id
        );
      end if;

      v_resolve := private.billing_resolve_or_create_payment_attempt(v_open.id, p_company_id);
      if coalesce((v_resolve ->> 'ok')::boolean, false) is not true then
        return jsonb_build_object('ok', false, 'code', 'attempt_resolve_failed', 'detail', v_resolve);
      end if;

      select a.status into v_attempt_status
      from public.billing_payment_attempts a
      where a.id = (v_resolve ->> 'payment_attempt_id')::uuid;

      return jsonb_build_object(
        'ok', true,
        'action', 'reuse',
        'order_id', v_open.id,
        'special_reference', v_open.special_reference,
        'payment_attempt_id', v_resolve ->> 'payment_attempt_id',
        'plan_version_id', v_open.plan_version_id,
        'block_new_collection', v_attempt_status in ('provider_submitted', 'unresolved'),
        'purchase_purpose', p_purchase_purpose
      );
    end if;
  end if;

  -- Create fresh locked order with explicit 2-hour checkout expiration
  insert into public.billing_orders (
    company_id,
    plan_version_id,
    product_code,
    purchase_purpose,
    amount_baisa,
    currency,
    period_days,
    period_unit,
    period_count,
    provider,
    provider_account_ref,
    provider_environment,
    provider_amount,
    provider_amount_unit,
    special_reference,
    client_op_id,
    input_fingerprint,
    status,
    expires_at,
    created_by
  ) values (
    p_company_id,
    p_plan_version_id,
    p_product_code,
    p_purchase_purpose,
    v_pv.amount_baisa,
    v_pv.currency,
    v_pv.period_days,
    p_period_unit,
    p_period_count,
    'paymob',
    p_provider_account_ref,
    p_provider_environment,
    null,
    null,
    p_special_reference,
    btrim(p_client_op_id),
    btrim(p_input_fingerprint),
    'locked',
    v_now + interval '2 hours',
    p_created_by
  )
  returning * into v_order;

  v_resolve := private.billing_resolve_or_create_payment_attempt(v_order.id, p_company_id);
  if coalesce((v_resolve ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'attempt_create_failed', 'detail', v_resolve);
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'created',
    'order_id', v_order.id,
    'special_reference', v_order.special_reference,
    'payment_attempt_id', v_resolve ->> 'payment_attempt_id',
    'plan_version_id', v_order.plan_version_id,
    'block_new_collection', false,
    'purchase_purpose', p_purchase_purpose
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_constraint := lower(coalesce(v_constraint, ''));
    if v_constraint like '%client_op%' then
      return jsonb_build_object('ok', false, 'code', 'CLIENT_OP_ID_REUSED');
    end if;
    if v_constraint like '%special_ref%' then
      return jsonb_build_object('ok', false, 'code', 'SPECIAL_REFERENCE_COLLISION');
    end if;
    return jsonb_build_object('ok', false, 'code', 'UNIQUE_VIOLATION', 'constraint', v_constraint);
end;
$$;
revoke all on function public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid) from public,anon,authenticated;
grant execute on function public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid) to service_role;

create or replace function private.billing_settle_payment_core_pre_acceptance(
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_company_id uuid;
  v_order_id uuid;
  v_attempt_id uuid;
  v_provider text;
  v_account text;
  v_env text;
  v_txn text;
  v_special text;
  v_currency text;
  v_event_status text;
  v_obs_key text;
  v_amount bigint;
  v_evidence_kind text;

  v_sub public.billing_subscriptions%rowtype;
  v_order public.billing_orders%rowtype;
  v_attempt public.billing_payment_attempts%rowtype;
  v_pv public.billing_plan_versions%rowtype;

  v_existing_outcome public.billing_settlement_outcomes%rowtype;
  v_existing_grant public.billing_entitlement_applications%rowtype;
  v_active_until timestamptz;
  v_applied_paid_through timestamptz;
  v_event_id uuid;
  v_grant_id uuid;
  v_outcome_id uuid;
begin
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'billing_settle_payment_core: evidence payload must be an object'
      using errcode = '22023';
  end if;

  v_company_id := (p_evidence ->> 'company_id')::uuid;
  v_order_id := (p_evidence ->> 'order_id')::uuid;
  v_attempt_id := (p_evidence ->> 'payment_attempt_id')::uuid;
  v_provider := nullif(btrim(p_evidence ->> 'provider'), '');
  v_account := nullif(btrim(p_evidence ->> 'provider_account_ref'), '');
  v_env := nullif(btrim(p_evidence ->> 'provider_environment'), '');
  v_txn := nullif(btrim(p_evidence ->> 'provider_transaction_id'), '');
  v_special := nullif(btrim(p_evidence ->> 'special_reference'), '');
  v_currency := nullif(btrim(p_evidence ->> 'currency_expected'), '');
  v_event_status := nullif(btrim(p_evidence ->> 'event_status'), '');
  v_obs_key := coalesce(nullif(btrim(p_evidence ->> 'observation_key'), ''), 'default');
  v_evidence_kind := coalesce(nullif(btrim(p_evidence ->> 'evidence_kind'), ''), 'unknown');

  begin
    v_amount := (p_evidence ->> 'amount_baisa')::bigint;
  exception when others then
    raise exception 'billing_settle_payment_core: amount invalid'
      using errcode = '22023';
  end;

  if v_company_id is null or v_order_id is null or v_attempt_id is null
     or v_provider is null or v_account is null or v_env is null
     or v_txn is null or v_special is null or v_currency is null
     or v_event_status is null or v_amount is null then
    raise exception 'billing_settle_payment_core: evidence incomplete'
      using errcode = '22023';
  end if;

  -- Validate environment
  if v_env not in ('test', 'live') then
    raise exception 'billing_settle_payment_core: invalid environment %', v_env
      using errcode = '22023';
  end if;

  -- D1: In live environment, synthetic evidence is strictly rejected
  if v_env = 'live' and v_evidence_kind = 'authorized_synthetic_test' then
    raise exception 'billing_settle_payment_core: synthetic evidence rejected in live environment'
      using errcode = '22023';
  end if;

  if v_provider is distinct from 'paymob'
     or v_currency is distinct from 'OMR'
     or v_event_status is distinct from 'success'
     or v_amount <= 0 then
    raise exception 'billing_settle_payment_core: evidence conflicting or negative amount'
      using errcode = '22023';
  end if;

  -- Canonical lock family: company -> subscription -> order -> attempt
  perform 1 from public.companies c where c.id = v_company_id for update;
  if not found then
    raise exception 'billing_settle_payment_core: company not found'
      using errcode = '22023';
  end if;

  -- D2: Environment-isolated subscription lock
  insert into public.billing_subscriptions (company_id, environment, status)
  values (v_company_id, v_env, 'awaiting_payment')
  on conflict (company_id, environment) where environment in ('test','live') do nothing;

  select * into v_sub
  from public.billing_subscriptions
  where company_id = v_company_id and environment = v_env
  for update;

  if not found then
    raise exception 'billing_settle_payment_core: subscription ensure failed'
      using errcode = '22023';
  end if;

  select * into v_order
  from public.billing_orders
  where id = v_order_id
  for update;

  if not found then
    raise exception 'billing_settle_payment_core: order not found'
      using errcode = '22023';
  end if;

  select * into v_attempt
  from public.billing_payment_attempts
  where id = v_attempt_id
  for update;

  if not found then
    raise exception 'billing_settle_payment_core: payment_attempt not found'
      using errcode = '22023';
  end if;

  -- Validate tenant and environment consistency
  if v_order.company_id is distinct from v_company_id
     or v_attempt.company_id is distinct from v_company_id
     or v_attempt.order_id is distinct from v_order_id
     or v_order.provider is distinct from v_provider
     or v_order.provider_account_ref is distinct from v_account
     or v_order.provider_environment is distinct from v_env
     or v_order.currency is distinct from v_currency
     or v_order.amount_baisa is distinct from v_amount
     or v_order.special_reference is distinct from v_special then
    raise exception 'billing_settle_payment_core: evidence conflicting with locked order'
      using errcode = '22023';
  end if;

  if v_order.status not in ('locked', 'submitted', 'closed') then
    raise exception 'billing_settle_payment_core: order status % not settleable', v_order.status
      using errcode = '22023';
  end if;

  -- Check existing outcome for this exact provider transaction
  select * into v_existing_outcome
  from public.billing_settlement_outcomes o
  where o.provider = v_provider
    and o.provider_account_ref = v_account
    and o.provider_environment = v_env
    and o.provider_transaction_id = v_txn
    and o.outcome in ('granted', 'idempotent_replay', 'duplicate_collection_review')
  for update;

  if found then
    if v_existing_outcome.order_id is distinct from v_order_id
       or v_existing_outcome.company_id is distinct from v_company_id
       or v_existing_outcome.provider_account_ref is distinct from v_account
       or v_existing_outcome.provider_environment is distinct from v_env then
      raise exception 'billing_settle_payment_core: provider transaction binding conflict'
        using errcode = '22023';
    end if;

    update public.billing_settlement_outcomes
    set detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('replayed_at', v_now)
    where id = v_existing_outcome.id;

    return jsonb_build_object(
      'ok', true,
      'outcome', case
        when v_existing_outcome.outcome = 'granted' then 'idempotent_replay'
        else v_existing_outcome.outcome
      end,
      'settlement_outcome_id', v_existing_outcome.id,
      'entitlement_application_id', v_existing_outcome.entitlement_application_id,
      'order_id', v_existing_outcome.order_id,
      'applied_paid_through', v_existing_outcome.applied_paid_through,
      'previous_paid_through', v_existing_outcome.previous_paid_through,
      'evidence_kind', v_evidence_kind
    );
  end if;

  -- Ensure provider event is recorded
  insert into public.billing_provider_events (
    payment_attempt_id,
    provider,
    provider_account_ref,
    provider_environment,
    provider_transaction_id,
    event_status,
    observation_key,
    company_id,
    amount_baisa_expected,
    currency_expected,
    raw_summary
  ) values (
    v_attempt_id,
    v_provider,
    v_account,
    v_env,
    v_txn,
    'success',
    v_obs_key,
    v_company_id,
    v_amount,
    v_currency,
    p_evidence
  )
  on conflict (provider, provider_account_ref, provider_environment, provider_transaction_id, event_status, observation_key)
  do nothing;

  select id into v_event_id
  from public.billing_provider_events
  where provider = v_provider
    and provider_account_ref = v_account
    and provider_environment = v_env
    and provider_transaction_id = v_txn
    and event_status = 'success'
    and observation_key = v_obs_key
  limit 1;

  -- Check if order already has a grant applied (prevents double grant per order)
  select * into v_existing_grant
  from public.billing_entitlement_applications g
  where g.order_id = v_order_id
  for update;

  if found then
    insert into public.billing_settlement_outcomes (
      company_id, order_id, payment_attempt_id,
      provider, provider_account_ref, provider_environment, provider_transaction_id,
      provider_event_id, entitlement_application_id, outcome,
      evidence_marker, authenticity_method,
      previous_paid_through, applied_paid_through, detail
    ) values (
      v_company_id, v_order_id, v_attempt_id,
      v_provider, v_account, v_env, v_txn,
      v_event_id, v_existing_grant.id, 'duplicate_collection_review',
      coalesce(nullif(btrim(p_evidence ->> 'evidence_marker'), ''), 'obs:' || v_obs_key),
      v_evidence_kind,
      v_sub.paid_through, v_sub.paid_through,
      jsonb_build_object('reason', 'order_already_has_grant', 'observed_at', v_now, 'evidence_kind', v_evidence_kind)
    )
    returning id into v_outcome_id;

    return jsonb_build_object(
      'ok', true,
      'outcome', 'duplicate_collection_review',
      'settlement_outcome_id', v_outcome_id,
      'entitlement_application_id', v_existing_grant.id,
      'order_id', v_order_id,
      'applied_paid_through', v_sub.paid_through,
      'previous_paid_through', v_sub.paid_through,
      'evidence_kind', v_evidence_kind
    );
  end if;

  -- Read plan version period for calendar arithmetic
  select * into v_pv
  from public.billing_plan_versions
  where id = v_order.plan_version_id;

  if not found then
    raise exception 'billing_settle_payment_core: plan_version not found'
      using errcode = '22023';
  end if;

  -- Calculate calendar renewal arithmetic
  v_active_until := v_sub.paid_through;
  v_applied_paid_through := private.billing_add_calendar_period(
    greatest(coalesce(v_active_until, v_now), v_now),
    v_pv.period_unit,
    v_pv.period_count
  );

  -- Apply entitlement grant
  insert into public.billing_entitlement_applications (
    company_id,
    order_id,
    subscription_id,
    payment_attempt_id,
    provider,
    provider_account_ref,
    provider_environment,
    provider_transaction_id,
    provider_event_id,
    previous_paid_through,
    applied_paid_through,
    period_days,
    period_unit,
    period_count,
    status
  ) values (
    v_company_id,
    v_order_id,
    v_sub.id,
    v_attempt_id,
    v_provider,
    v_account,
    v_env,
    v_txn,
    v_event_id,
    v_active_until,
    v_applied_paid_through,
    case when v_order.period_unit = 'day' then v_order.period_count else greatest(v_order.period_days, 1) end,
    v_order.period_unit,
    v_order.period_count,
    'active'
  )
  returning id into v_grant_id;

  -- Update D2 environment-scoped subscription
  update public.billing_subscriptions
  set status = 'active',
      plan_version_id = v_order.plan_version_id,
      paid_through = v_applied_paid_through,
      cancel_at_period_end = false,
      updated_at = v_now
  where company_id = v_company_id and environment = v_env;

  -- Transition attempt and order to final paid status
  update public.billing_payment_attempts
  set status = 'paid',
      updated_at = v_now
  where id = v_attempt_id;

  update public.billing_orders
  set status = 'closed'
  where id = v_order_id;

  -- Record successful settlement outcome
  insert into public.billing_settlement_outcomes (
    company_id, order_id, payment_attempt_id,
    provider, provider_account_ref, provider_environment, provider_transaction_id,
    provider_event_id, entitlement_application_id, outcome,
    evidence_marker, authenticity_method,
    previous_paid_through, applied_paid_through, detail
  ) values (
    v_company_id, v_order_id, v_attempt_id,
    v_provider, v_account, v_env, v_txn,
    v_event_id, v_grant_id, 'granted',
    coalesce(nullif(btrim(p_evidence ->> 'evidence_marker'), ''), 'obs:' || v_obs_key),
    v_evidence_kind,
    v_active_until, v_applied_paid_through,
    jsonb_build_object('settled_at', v_now, 'evidence_kind', v_evidence_kind)
  )
  returning id into v_outcome_id;

  return jsonb_build_object(
    'ok', true,
    'outcome', 'granted',
    'settlement_outcome_id', v_outcome_id,
    'entitlement_application_id', v_grant_id,
    'order_id', v_order_id,
    'applied_paid_through', v_applied_paid_through,
    'previous_paid_through', v_active_until,
    'evidence_kind', v_evidence_kind
  );
end;
$$;
revoke all on function private.billing_settle_payment_core_pre_acceptance(jsonb) from public,anon,authenticated,service_role;
create table private.billing_lifecycle_reviews (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 order_id uuid not null,
 payment_attempt_id uuid not null,
 provider_event_id uuid not null unique references public.billing_provider_events(id) on delete restrict,
 provider text not null check (provider='paymob'),
 provider_account_ref text not null,
 provider_environment text not null check(provider_environment in ('test','live')),
 provider_transaction_id text not null,
 reason text not null check(reason in ('refund_extent_or_parent_unconfirmed','void_review','conflicting_lifecycle_review','late_payment_policy_unapproved','deadline_policy_unapproved')),
 status text not null default 'review_required' check(status='review_required'),
 detail jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(order_id,company_id) references public.billing_orders(id,company_id) on delete restrict,
 foreign key(payment_attempt_id,company_id) references public.billing_payment_attempts(id,company_id) on delete restrict
);
create index billing_lifecycle_reviews_order_scope_idx on private.billing_lifecycle_reviews
 (company_id,order_id,provider,provider_account_ref,provider_environment);
alter table private.billing_lifecycle_reviews enable row level security;
revoke all on private.billing_lifecycle_reviews from public,anon,authenticated,service_role;
comment on table private.billing_lifecycle_reviews is
 'Append-only review evidence. Not a refund/suspension policy. A signed flag alone does not prove refund extent or an unsigned parent transaction link.';


create function private.billing_acceptance_hmac_event(p_evidence jsonb)
returns public.billing_provider_events language plpgsql security definer set search_path='' as $$
declare e public.billing_provider_events%rowtype; o public.billing_orders%rowtype; a public.billing_payment_attempts%rowtype;
 r jsonb; k text; amount bigint; actual_amount bigint;
begin
 if jsonb_typeof(p_evidence) is distinct from 'object'
 or p_evidence->>'evidence_marker' is distinct from 'VEL_PAYMOB_SERVER_HMAC_VERIFIED'
 or p_evidence->'authenticity'->>'source' is distinct from 'server_adapter_attestation'
 or p_evidence->'authenticity'->'verified' is distinct from 'true'::jsonb
 or p_evidence->'authenticity'->>'method' is distinct from 'paymob_hmac_sha512'
 or p_evidence ? 'signature_verified'
 or p_evidence->>'provider' is distinct from 'paymob'
 or coalesce(p_evidence->>'currency_expected',p_evidence->>'currency') is distinct from 'OMR'
 or (p_evidence ? 'currency' and p_evidence->>'currency' is distinct from 'OMR')
 or (p_evidence ? 'currency_expected' and p_evidence->>'currency_expected' is distinct from 'OMR')
 or coalesce(p_evidence->>'provider_environment','') not in ('test','live') then return null; end if;
 select * into o from public.billing_orders where id=(p_evidence->>'order_id')::uuid
 and company_id=(p_evidence->>'company_id')::uuid;
 if not found then return null; end if;
 select * into a from public.billing_payment_attempts where id=(p_evidence->>'payment_attempt_id')::uuid
 and order_id=o.id and company_id=o.company_id;
 if not found then return null; end if;
 amount:=(p_evidence->>'amount_baisa')::bigint;
 if amount is distinct from o.amount_baisa or amount<=0 or o.currency<>'OMR'
 or o.provider is distinct from 'paymob' or o.provider_account_ref is distinct from p_evidence->>'provider_account_ref'
 or o.provider_environment is distinct from p_evidence->>'provider_environment'
 or o.special_reference is distinct from p_evidence->>'special_reference'
 or a.provider is distinct from o.provider or a.provider_account_ref is distinct from o.provider_account_ref
 or a.provider_environment is distinct from o.provider_environment
 or a.provider_order_id is null or o.provider_amount is null or o.provider_amount<=0
 or o.provider_amount>9007199254740991 or o.amount_baisa>9007199254740991
 or o.provider_amount_unit is distinct from 'paymob_amount' then return null; end if;
 select * into e from public.billing_provider_events
 where payment_attempt_id=a.id and company_id=o.company_id and provider=o.provider
 and provider_account_ref=o.provider_account_ref and provider_environment=o.provider_environment
 and provider_transaction_id=p_evidence->>'provider_transaction_id'
 and event_status=p_evidence->>'event_status'
 and observation_key=coalesce(nullif(p_evidence->>'observation_key',''),'default');
 if not found or e.amount_baisa_expected is distinct from o.amount_baisa or e.currency_expected is distinct from o.currency
 or (p_evidence ? 'provider_event_id' and e.id is distinct from (p_evidence->>'provider_event_id')::uuid) then return null; end if;
 r:=e.raw_summary;
 if jsonb_typeof(r) is distinct from 'object' or r->'hmac_verified' is distinct from 'true'::jsonb
 or r->>'provider_transaction_id' is distinct from e.provider_transaction_id
 or r->>'provider_order_id' is distinct from a.provider_order_id
 or r->>'currency' is distinct from o.currency
 or jsonb_typeof(r->'integration_id') is distinct from 'number'
 or r->>'integration_id' is distinct from o.provider_account_ref
 or coalesce(r->>'signed_owner','')!~'^[1-9][0-9]*$' then return null; end if;
 foreach k in array array['pending','success','error_occured','is_auth','is_capture','is_voided','is_refunded','has_parent_transaction','is_standalone_payment'] loop
  if jsonb_typeof(r->k) is distinct from 'boolean' then return null; end if;
 end loop;
 if jsonb_typeof(r->'amount_cents') is distinct from 'number' or coalesce(r->>'amount_cents','')!~'^[0-9]+$' then return null; end if;
 actual_amount:=(r->>'amount_cents')::bigint;
 if actual_amount<=0 or actual_amount>o.provider_amount then return null; end if;
 -- Underpayment never grants. A smaller signed lifecycle amount is review only;
 -- it cannot attest the total refunded amount of the original collection.
 if e.event_status='success' and actual_amount<>o.provider_amount then return null; end if;
 return e;
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end; $$;
revoke all on function private.billing_acceptance_hmac_event(jsonb) from public,anon,authenticated,service_role;
create function private.billing_record_lifecycle_review(p_event public.billing_provider_events,p_order_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 insert into private.billing_lifecycle_reviews(company_id,order_id,payment_attempt_id,provider_event_id,
 provider,provider_account_ref,provider_environment,provider_transaction_id,reason,detail)
 values(p_event.company_id,p_order_id,p_event.payment_attempt_id,p_event.id,p_event.provider,p_event.provider_account_ref,
 p_event.provider_environment,p_event.provider_transaction_id,p_reason,
 jsonb_build_object('signed_observation',p_event.raw_summary,'owner_policy','not_approved','automatic_entitlement_mutation',false))
 on conflict(provider_event_id) do nothing;
 select id into rid from private.billing_lifecycle_reviews where provider_event_id=p_event.id;
 return rid;
end; $$;
revoke all on function private.billing_record_lifecycle_review(public.billing_provider_events,uuid,text) from public,anon,authenticated,service_role;
create or replace function private.billing_apply_reversal(p_company_id uuid,p_order_id uuid,p_attempt_id uuid,p_reversal_type text,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.billing_provider_events%rowtype; o public.billing_orders%rowtype; reason text; rid uuid;
begin
 e:=private.billing_acceptance_hmac_event(p_evidence);
 if e.id is null or e.company_id is distinct from p_company_id or e.payment_attempt_id is distinct from p_attempt_id
 or p_evidence->>'order_id' is distinct from p_order_id::text or p_reversal_type not in ('refunded','voided') then
  return jsonb_build_object('ok',false,'code','INVALID_REVERSAL_EVIDENCE');
 end if;
 if e.raw_summary->'pending' is distinct from 'false'::jsonb or e.raw_summary->'success' is distinct from 'true'::jsonb
 or e.raw_summary->'error_occured' is distinct from 'false'::jsonb
 or (p_reversal_type='refunded' and e.raw_summary->'is_refunded' is distinct from 'true'::jsonb)
 or (p_reversal_type='voided' and e.raw_summary->'is_voided' is distinct from 'true'::jsonb) then
  return jsonb_build_object('ok',false,'code','INVALID_REVERSAL_EVIDENCE');
 end if;
 -- Match the same canonical company -> subscription -> order -> attempt locks
 -- as settlement; leave historical grants and all newer purchases untouched.
 perform 1 from public.companies where id=p_company_id for update;
 perform 1 from public.billing_subscriptions where company_id=p_company_id and environment=e.provider_environment for update;
 select * into o from public.billing_orders where id=p_order_id and company_id=p_company_id for update;
 perform 1 from public.billing_payment_attempts where id=p_attempt_id and order_id=p_order_id and company_id=p_company_id for update;
 if not found then return jsonb_build_object('ok',false,'code','INVALID_REVERSAL_EVIDENCE'); end if;
 reason:=case when e.raw_summary->'is_refunded'='true'::jsonb and e.raw_summary->'is_voided'='true'::jsonb then 'conflicting_lifecycle_review'
 when p_reversal_type='refunded' then 'refund_extent_or_parent_unconfirmed' else 'void_review' end;
 rid:=private.billing_record_lifecycle_review(e,o.id,reason);
 return jsonb_build_object('ok',true,'outcome','lifecycle_review','review_id',rid,'order_id',o.id,
 'code',reason,'entitlement_changed',false);
end; $$;
revoke all on function private.billing_apply_reversal(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create or replace function private.billing_settle_payment_core(p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.billing_provider_events%rowtype; o public.billing_orders%rowtype; rid uuid;result jsonb;
begin
 e:=private.billing_acceptance_hmac_event(p_evidence);
 if e.id is null or e.event_status is distinct from 'success'
 or e.raw_summary->'pending' is distinct from 'false'::jsonb or e.raw_summary->'success' is distinct from 'true'::jsonb
 or e.raw_summary->'error_occured' is distinct from 'false'::jsonb or e.raw_summary->'is_auth' is distinct from 'false'::jsonb
 or e.raw_summary->'is_capture' is distinct from 'false'::jsonb or e.raw_summary->'is_voided' is distinct from 'false'::jsonb
 or e.raw_summary->'is_refunded' is distinct from 'false'::jsonb or e.raw_summary->'has_parent_transaction' is distinct from 'false'::jsonb
 or e.raw_summary->'is_standalone_payment' is distinct from 'true'::jsonb then
  return jsonb_build_object('ok',false,'code','INVALID_STORED_EVIDENCE');
 end if;
 perform 1 from public.companies where id=e.company_id for update;
 perform 1 from public.billing_subscriptions where company_id=e.company_id and environment=e.provider_environment for update;
 select * into o from public.billing_orders where id=(p_evidence->>'order_id')::uuid and company_id=e.company_id for update;
 perform 1 from public.billing_payment_attempts where id=e.payment_attempt_id and order_id=o.id and company_id=e.company_id for update;
 if not found then return jsonb_build_object('ok',false,'code','INVALID_STORED_EVIDENCE'); end if;
 -- Durable receipt alone must block a stale success even if the reversal
 -- processor has not yet run (e.g. refund receipt and success worker racing).
 if o.status in ('refunded','voided','cancelled') or exists(
 select 1 from public.billing_entitlement_applications g where g.order_id=o.id and g.status='revoked') or exists(
 select 1 from private.billing_lifecycle_reviews r where r.order_id=o.id and r.company_id=e.company_id
 and r.provider=e.provider and r.provider_account_ref=e.provider_account_ref and r.provider_environment=e.provider_environment
 and r.reason in ('refund_extent_or_parent_unconfirmed','void_review','conflicting_lifecycle_review')) or exists(
 select 1 from public.billing_provider_events v where v.company_id=e.company_id and v.payment_attempt_id in
 (select a.id from public.billing_payment_attempts a where a.company_id=e.company_id and a.order_id=o.id)
 and v.provider=e.provider and v.provider_account_ref=e.provider_account_ref and v.provider_environment=e.provider_environment
 and v.raw_summary->'hmac_verified'='true'::jsonb and v.raw_summary->'pending'='false'::jsonb
 and v.raw_summary->'success'='true'::jsonb and v.raw_summary->'error_occured'='false'::jsonb
 and (v.raw_summary->'is_refunded'='true'::jsonb or v.raw_summary->'is_voided'='true'::jsonb)) then
  return jsonb_build_object('ok',true,'outcome','lifecycle_review','code','prior_lifecycle_requires_review','order_id',o.id);
 end if;
 if e.provider_environment='live' and o.deadline_policy_approved is not true
 and not exists(select 1 from public.billing_entitlement_applications g where g.order_id=o.id) then
  rid:=private.billing_record_lifecycle_review(e,o.id,'deadline_policy_unapproved');
  return jsonb_build_object('ok',true,'outcome','deadline_policy_review','code','deadline_policy_unapproved','review_id',rid,'order_id',o.id);
 end if;
 -- The existing two-hour deadline is not an approved disposal/suspension
 -- policy. Keep late collection evidence, deny automatic FIRST activation,
 -- and leave an already granted transaction replay idempotent after expiry.
 if (o.expires_at is null or o.expires_at<=clock_timestamp()) and not exists(select 1 from public.billing_entitlement_applications g where g.order_id=o.id) then
  rid:=private.billing_record_lifecycle_review(e,o.id,'late_payment_policy_unapproved');
  return jsonb_build_object('ok',true,'outcome','late_payment_review','code','late_payment_policy_unapproved','review_id',rid,'order_id',o.id);
 end if;
 result:=private.billing_settle_payment_core_pre_acceptance(p_evidence||jsonb_build_object('currency_expected','OMR','evidence_kind','paymob_hmac_verified'));
 if result->>'outcome'='granted' and not exists(select 1 from private.billing_proven_entitlement_grants g where g.id=(result->>'entitlement_application_id')::uuid) then
  raise exception 'NEW_RECEIPT_PROOF_INCOMPLETE' using errcode='23514';
 end if;
 return result;
end; $$;
revoke all on function private.billing_settle_payment_core(jsonb) from public,anon,authenticated,service_role;
create or replace function public.billing_settle_paymob_hmac_verified(p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.billing_provider_events%rowtype; jwt_role text;
begin
 jwt_role:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','');
 if jwt_role in ('anon','authenticated') or (jwt_role<>'service_role' and session_user not in ('postgres','supabase_admin')) then
  raise exception 'server-only billing settlement' using errcode='42501';
 end if;
 e:=private.billing_acceptance_hmac_event(p_evidence);
 if e.id is null then return jsonb_build_object('ok',false,'code','INVALID_STORED_EVIDENCE'); end if;
 if e.raw_summary->'is_refunded'='true'::jsonb then
  return private.billing_apply_reversal(e.company_id,(p_evidence->>'order_id')::uuid,e.payment_attempt_id,'refunded',p_evidence);
 elsif e.raw_summary->'is_voided'='true'::jsonb then
  return private.billing_apply_reversal(e.company_id,(p_evidence->>'order_id')::uuid,e.payment_attempt_id,'voided',p_evidence);
 end if;
 return private.billing_settle_payment_core(p_evidence);
end; $$;
revoke all on function public.billing_settle_paymob_hmac_verified(jsonb) from public,anon,authenticated;
grant execute on function public.billing_settle_paymob_hmac_verified(jsonb) to service_role;

create or replace function public.billing_read_company_operational_entitlement(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.billing_subscriptions%rowtype; trusted boolean;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
  and current_setting('role',true) is distinct from 'service_role'
  and not private.billing_ui_company_owner(p_company_id) then
  return jsonb_build_object('ok',false,'code','forbidden');
 end if;
 select * into s from public.billing_subscriptions where company_id=p_company_id and environment='live';
 if not found then return jsonb_build_object('ok',true,'active',false,'environment','live','status','none',
  'paid_through',null,'plan_version_id',null,'cancel_at_period_end',false);end if;
 trusted:=exists(select 1 from private.billing_proven_entitlement_grants g where g.subscription_id=s.id
  and g.company_id=p_company_id and g.provider_environment='live' and g.applied_paid_through=s.paid_through
  and g.plan_version_id=s.plan_version_id);
 return jsonb_build_object('ok',true,'active',trusted and s.status in ('active','cancel_at_period_end')
  and s.paid_through>statement_timestamp()
  and exists(select 1 from public.companies c where c.id=p_company_id and c.status<>'suspended'),
  'environment','live','status',s.status,
  'paid_through',case when trusted then s.paid_through else null end,
  'plan_version_id',case when trusted then s.plan_version_id else null end,'cancel_at_period_end',s.cancel_at_period_end);
end;$$;
revoke all on function public.billing_read_company_operational_entitlement(uuid) from public,anon;
grant execute on function public.billing_read_company_operational_entitlement(uuid) to authenticated,service_role;
commit;

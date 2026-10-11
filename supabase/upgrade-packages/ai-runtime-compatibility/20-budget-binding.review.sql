-- Plan budget policies are explicit immutable configuration, never commercial defaults.
begin;
set local role postgres;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local search_path='';
-- Policy/column permission preflight; fail closed on widening or drift.
DO $ai_policy_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH targets AS (SELECT c.oid,n.nspname||'.'||c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))), policies AS (SELECT t.name,p.polname,p.polcmd,p.polpermissive,(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END) FROM unnest(p.polroles) r) roles,pg_get_expr(p.polqual,p.polrelid) using_expression,pg_get_expr(p.polwithcheck,p.polrelid) check_expression FROM targets t JOIN pg_policy p ON p.polrelid=t.oid), column_acl AS (SELECT t.name,a.attname,coalesce(r.rolname,'PUBLIC') grantee,x.privilege_type,x.is_grantable FROM targets t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN LATERAL aclexplode(a.attacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee) SELECT jsonb_build_object('policies',(SELECT jsonb_agg(to_jsonb(policies) ORDER BY name,polname) FROM policies),'column_acl',(SELECT jsonb_agg(to_jsonb(column_acl) ORDER BY name,attname,grantee,privilege_type,is_grantable) FROM column_acl))) q(data)) IS DISTINCT FROM '66e21932eaa60c5e4f0e6417694f8c6c' THEN RAISE EXCEPTION 'AI_COMPAT_POLICY_PREFLIGHT_DRIFT';END IF;END $ai_policy_guard$;
-- Exact structural preflight; no data or credentials included.
DO $ai_compat_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH fn AS (SELECT p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef definer,p.proconfig config,md5(replace(p.prosrc,chr(13),'')) body_md5,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private') AND p.proname IN ('ai_reserve_attempt','ai_start_attempt','ai_settle_attempt','ai_reconcile_attempt','ai_admin_snapshot','wa_worker_lock','wa_worker_month','whatsapp_job_service_window','whatsapp_service_window','billing_service_catalog_owner','billing_service_receipt_eligible','billing_financial_receipt_immutability','billing_service_immutable','billing_read_company_operational_entitlement','claim_whatsapp_inbound_job','ai_admin_snapshot','ai_answer_profile_binding_guard','ai_budget_account_binding','ai_budget_period','ai_budget_policy_immutable','ai_lock_authorized_whatsapp_job','ai_reconcile_attempt','ai_reserve_attempt','ai_reserve_whatsapp_attempt','ai_reserve_whatsapp_capacity_cost_attempt','ai_reserve_whatsapp_profile_attempt','ai_settle_admin','ai_settle_admin_attempt','ai_settle_attempt','ai_settle_whatsapp_attempt','ai_start_attempt','ai_start_whatsapp_attempt','ai_usage_ledger_guard_binding','ai_validate_cost','ai_validated_usage','ai_whatsapp_citations_current','billing_bind_ai_budget_draft','billing_load_worker_frame','claim_whatsapp_inbound_job','wa_noura_authority','wa_noura_binding_immutable','wa_worker_citations','whatsapp_answer_profile','whatsapp_attempt_profile_current','whatsapp_citations_include_current_instructions','whatsapp_claim_assistant_job_send','whatsapp_claim_inbound_batch','whatsapp_heartbeat_inbound_job','whatsapp_read_answer_profile','whatsapp_repair_accepted_jobs','whatsapp_reserve_job_usage','whatsapp_retrieve_approved_knowledge','whatsapp_retry_inbound_job','whatsapp_stage_job_reply')
), rel AS (
 SELECT n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
 (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
 (SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid) constraints,
 (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid=c.oid) indexes,
 (SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled::text,pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) triggers,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))
)
SELECT jsonb_build_object('functions',(SELECT jsonb_agg(to_jsonb(fn) ORDER BY signature) FROM fn),'relations',(SELECT jsonb_agg(to_jsonb(rel) ORDER BY name) FROM rel))) q(data)) IS DISTINCT FROM '69675d2900be23e06a1735da88e17e20' THEN RAISE EXCEPTION 'AI_COMPAT_PREFLIGHT_DRIFT';END IF;END $ai_compat_guard$;


create function private.ai_budget_period(p_at timestamptz) returns date
language sql immutable set search_path='' as $$
 select date_trunc('month',p_at at time zone 'Asia/Muscat')::date;
$$;
revoke all on function private.ai_budget_period(timestamptz) from public,anon,authenticated,service_role;

create table private.ai_plan_budget_policies (
 plan_version_id uuid primary key references public.billing_plan_versions(id) on delete restrict,
 monthly_limit_baisa numeric(18,6) not null check(monthly_limit_baisa>0 and monthly_limit_baisa<=100000000 and monthly_limit_baisa=trunc(monthly_limit_baisa)),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.ai_plan_budget_policies enable row level security;
revoke all on private.ai_plan_budget_policies from public,anon,authenticated,service_role;
create function private.ai_budget_policy_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'AI_BUDGET_POLICY_IMMUTABLE' using errcode='23514';end;$$;
revoke all on function private.ai_budget_policy_immutable() from public,anon,authenticated,service_role;
create trigger ai_budget_policy_immutable before update or delete on private.ai_plan_budget_policies for each row execute function private.ai_budget_policy_immutable();
create trigger ai_budget_policy_no_truncate before truncate on private.ai_plan_budget_policies for each statement execute function private.ai_budget_policy_immutable();

alter table public.ai_budget_accounts
 add column subscription_id uuid references public.billing_subscriptions(id) on delete restrict,
 add column plan_version_id uuid references public.billing_plan_versions(id) on delete restrict;
-- Existing unbound historical accounts retain their identity and data. They cannot authorize new customer work.
alter table public.ai_budget_accounts add constraint ai_budget_version_binding check (
 (scope='admin_test' and subscription_id is null and plan_version_id is null)
 or (scope='company_live' and ((subscription_id is null and plan_version_id is null) or (subscription_id is not null and plan_version_id is not null))));
drop index public.ai_budget_company_unique;
create unique index ai_budget_company_legacy_unique on public.ai_budget_accounts(company_id,period_start) where scope='company_live' and subscription_id is null;
create unique index ai_budget_company_version_unique on public.ai_budget_accounts(company_id,period_start,subscription_id,plan_version_id) where scope='company_live' and subscription_id is not null;

create function private.ai_budget_account_binding() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='UPDATE' and row(new.id,new.scope,new.company_id,new.period_start,new.subscription_id,new.plan_version_id,new.limit_baisa,new.created_at)
 is distinct from row(old.id,old.scope,old.company_id,old.period_start,old.subscription_id,old.plan_version_id,old.limit_baisa,old.created_at)
 and (old.scope='company_live' or new.scope='company_live') then raise exception 'AI_BUDGET_BINDING_IMMUTABLE' using errcode='23514';end if;
 if TG_OP='INSERT' and new.scope='company_live' then
  if not exists(select 1 from public.billing_subscriptions s join private.ai_plan_budget_policies p on p.plan_version_id=s.plan_version_id
    where s.id=new.subscription_id and s.company_id=new.company_id and s.plan_version_id=new.plan_version_id and s.environment='live'
    and new.limit_baisa=p.monthly_limit_baisa and new.period_start=private.ai_budget_period(clock_timestamp()))
  then raise exception 'AI_BUDGET_BINDING_REQUIRED' using errcode='23514';end if;
 end if;
 return new;
end;$$;
revoke all on function private.ai_budget_account_binding() from public,anon,authenticated,service_role;
create trigger ai_budget_account_binding before insert or update on public.ai_budget_accounts for each row execute function private.ai_budget_account_binding();

-- This new authenticated configuration capability requires explicit access review before production application.
create function public.billing_bind_ai_budget_draft(p_plan_version_id uuid,p_monthly_limit_baisa numeric,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.billing_plan_versions%rowtype;r bigint;existing numeric;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select revision into r from public.billing_catalog_revision where singleton for update;
 select * into v from public.billing_plan_versions where id=p_plan_version_id for update;
 -- Owner/session predicates and time are checked after catalog and version waits.
 if not private.billing_service_catalog_owner() then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if r is distinct from p_expected_revision then return jsonb_build_object('ok',false,'code','conflict');end if;
 if v.id is null then return jsonb_build_object('ok',false,'code','not_found');end if;
 if v.status<>'draft' or exists(select 1 from public.billing_orders where plan_version_id=v.id) then return jsonb_build_object('ok',false,'code','immutable');end if;
 if p_monthly_limit_baisa is null or p_monthly_limit_baisa<=0 or p_monthly_limit_baisa>100000000 or p_monthly_limit_baisa<>trunc(p_monthly_limit_baisa)
 then return jsonb_build_object('ok',false,'code','invalid_input');end if;
 select monthly_limit_baisa into existing from private.ai_plan_budget_policies where plan_version_id=v.id;
 if found then
  if existing is distinct from p_monthly_limit_baisa then return jsonb_build_object('ok',false,'code','immutable');end if;
 else
  insert into private.ai_plan_budget_policies(plan_version_id,monthly_limit_baisa,created_by) values(v.id,p_monthly_limit_baisa,auth.uid());
  update public.billing_catalog_revision set revision=revision+1 where singleton returning revision into r;
 end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('revision',r,'version_id',v.id,'monthly_limit_baisa',p_monthly_limit_baisa));
end;$$;
revoke all on function public.billing_bind_ai_budget_draft(uuid,numeric,bigint) from public,anon,authenticated,service_role;
grant execute on function public.billing_bind_ai_budget_draft(uuid,numeric,bigint) to authenticated;
notify pgrst,'reload schema';

-- Policy/column permission postflight; fail closed on widening or drift.
DO $ai_policy_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH targets AS (SELECT c.oid,n.nspname||'.'||c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))), policies AS (SELECT t.name,p.polname,p.polcmd,p.polpermissive,(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END) FROM unnest(p.polroles) r) roles,pg_get_expr(p.polqual,p.polrelid) using_expression,pg_get_expr(p.polwithcheck,p.polrelid) check_expression FROM targets t JOIN pg_policy p ON p.polrelid=t.oid), column_acl AS (SELECT t.name,a.attname,coalesce(r.rolname,'PUBLIC') grantee,x.privilege_type,x.is_grantable FROM targets t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN LATERAL aclexplode(a.attacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee) SELECT jsonb_build_object('policies',(SELECT jsonb_agg(to_jsonb(policies) ORDER BY name,polname) FROM policies),'column_acl',(SELECT jsonb_agg(to_jsonb(column_acl) ORDER BY name,attname,grantee,privilege_type,is_grantable) FROM column_acl))) q(data)) IS DISTINCT FROM '66e21932eaa60c5e4f0e6417694f8c6c' THEN RAISE EXCEPTION 'AI_COMPAT_POLICY_POSTFLIGHT_DRIFT';END IF;END $ai_policy_guard$;
-- Exact structural postflight; no data or credentials included.
DO $ai_compat_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH fn AS (SELECT p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef definer,p.proconfig config,md5(replace(p.prosrc,chr(13),'')) body_md5,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private') AND p.proname IN ('ai_reserve_attempt','ai_start_attempt','ai_settle_attempt','ai_reconcile_attempt','ai_admin_snapshot','wa_worker_lock','wa_worker_month','whatsapp_job_service_window','whatsapp_service_window','billing_service_catalog_owner','billing_service_receipt_eligible','billing_financial_receipt_immutability','billing_service_immutable','billing_read_company_operational_entitlement','claim_whatsapp_inbound_job','ai_admin_snapshot','ai_answer_profile_binding_guard','ai_budget_account_binding','ai_budget_period','ai_budget_policy_immutable','ai_lock_authorized_whatsapp_job','ai_reconcile_attempt','ai_reserve_attempt','ai_reserve_whatsapp_attempt','ai_reserve_whatsapp_capacity_cost_attempt','ai_reserve_whatsapp_profile_attempt','ai_settle_admin','ai_settle_admin_attempt','ai_settle_attempt','ai_settle_whatsapp_attempt','ai_start_attempt','ai_start_whatsapp_attempt','ai_usage_ledger_guard_binding','ai_validate_cost','ai_validated_usage','ai_whatsapp_citations_current','billing_bind_ai_budget_draft','billing_load_worker_frame','claim_whatsapp_inbound_job','wa_noura_authority','wa_noura_binding_immutable','wa_worker_citations','whatsapp_answer_profile','whatsapp_attempt_profile_current','whatsapp_citations_include_current_instructions','whatsapp_claim_assistant_job_send','whatsapp_claim_inbound_batch','whatsapp_heartbeat_inbound_job','whatsapp_read_answer_profile','whatsapp_repair_accepted_jobs','whatsapp_reserve_job_usage','whatsapp_retrieve_approved_knowledge','whatsapp_retry_inbound_job','whatsapp_stage_job_reply')
), rel AS (
 SELECT n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
 (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
 (SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid) constraints,
 (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid=c.oid) indexes,
 (SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled::text,pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) triggers,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))
)
SELECT jsonb_build_object('functions',(SELECT jsonb_agg(to_jsonb(fn) ORDER BY signature) FROM fn),'relations',(SELECT jsonb_agg(to_jsonb(rel) ORDER BY name) FROM rel))) q(data)) IS DISTINCT FROM 'cba20e245166738454e29d65e5d82ce1' THEN RAISE EXCEPTION 'AI_COMPAT_POSTFLIGHT_DRIFT';END IF;END $ai_compat_guard$;
commit;

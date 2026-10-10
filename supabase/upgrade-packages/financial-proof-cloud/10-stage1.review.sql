-- Approved local correction: reject unknown status transitions with IS NOT TRUE.
-- Production application remains separately unauthorized.
-- Local review package only. Not a canonical migration or deployment bundle.
-- Generated from CLI scaffold 20261010112445; catalog metadata only, no row export.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local search_path='';
lock table public.billing_orders,public.billing_plan_versions,public.billing_subscriptions,
 public.billing_payment_attempts,public.billing_provider_events,
 public.billing_entitlement_applications,public.billing_settlement_outcomes in share row exclusive mode;
do $preflight$
declare actual jsonb;
begin
 if current_user<>'postgres' then raise exception 'STAGE1_INSTALLER_MISMATCH';end if;
 if not exists(select 1 from pg_namespace where nspname='private' and pg_get_userbyid(nspowner)='postgres')
  or (select jsonb_object_agg(role,privileges) from (
   select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end role,
   jsonb_agg(a.privilege_type order by a.privilege_type) privileges
   from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
   where n.nspname='private' group by a.grantee
  ) acl) is distinct from '{"postgres":["CREATE","USAGE"],"service_role":["USAGE"]}'::jsonb
  or exists(select 1 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname='private' and a.is_grantable) then
  raise exception 'STAGE1_PRIVATE_SCHEMA_PREREQUISITE_MISMATCH';
 end if;

 if to_regclass('private.billing_verified_collection_history') is not null
  or to_regclass('private.billing_proven_entitlement_grants') is not null
  or to_regprocedure('private.billing_financial_receipt_immutability()') is not null then
  raise exception 'STAGE1_ALREADY_OR_PARTIALLY_INSTALLED';
 end if;
with targets as(select c.oid,n.nspname||'.'||c.relname name,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('billing_provider_events','billing_entitlement_applications','billing_settlement_outcomes','billing_orders','billing_payment_attempts','billing_subscriptions','billing_plan_versions')), t as(select name,pg_get_userbyid(relowner) owner,relrowsecurity rls,relforcerowsecurity force_rls,(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=targets.oid and a.attnum>0 and not a.attisdropped) columns,(select jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated) order by c.conname) from pg_constraint c where c.conrelid=targets.oid) constraints,(select jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'constraint_owned',exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)) order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=targets.oid) indexes,(select jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid),'function',tgfoid::regprocedure::text,'function_md5',(select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=tgfoid)) order by tgname) from pg_trigger where tgrelid=targets.oid and not tgisinternal) triggers,(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(relacl,acldefault('r',relowner))) a) acl,(select jsonb_agg(jsonb_build_object('column',a.attname,'role',case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,'privilege',g.privilege_type,'grantable',g.is_grantable) order by a.attname,g.grantee::regrole::text,g.privilege_type) from pg_attribute a cross join lateral aclexplode(a.attacl) g where a.attrelid=targets.oid) column_acl,(select jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'cmd',p.polcmd,'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by r::regrole::text) from unnest(p.polroles) r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by polname) from pg_policy p where p.polrelid=targets.oid) policies from targets),f as(select p.oid::regprocedure::text signature,pg_get_userbyid(proowner) owner,md5(replace(prosrc,chr(13),'')) body_md5,prosecdef,proconfig,provolatile,(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(proacl,acldefault('f',proowner))) a) acl from pg_proc p where p.oid in(to_regprocedure('private.billing_orders_immutability()'),to_regprocedure('public.billing_settle_paymob_hmac_verified(jsonb)'),to_regprocedure('public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'),to_regprocedure('private.billing_settle_payment_core(jsonb)'))) select jsonb_build_object('tables',(select jsonb_object_agg(name,md5(to_jsonb(t)::text)) from t),'functions',(select jsonb_object_agg(signature,md5(to_jsonb(f)::text)) from f)) into actual;
 if actual is distinct from '{"tables":{"public.billing_orders":"70d3e4d84b3e7d8671c4c2f3a6b2bb78","public.billing_plan_versions":"71ff6c5adb0f8c6eb8dc5284cca72889","public.billing_subscriptions":"85c678ec40d93b2202e9f96c72af5409","public.billing_provider_events":"2c4a763387def28dff57b4801095e8ce","public.billing_payment_attempts":"c6b0404ac1187511d8053f70e430f330","public.billing_settlement_outcomes":"eb7d67fa08547d09d39fdd0745c840cd","public.billing_entitlement_applications":"825332e2aae335dfda092b4d14c126e4"},"functions":{"private.billing_orders_immutability()":"cda6e1769a1d10e109684b470bc630aa","private.billing_settle_payment_core(jsonb)":"80c74f31f49d6cf79bd858ad1bdbca99","public.billing_settle_paymob_hmac_verified(jsonb)":"0916b755d435bd09245ef76f97e4d5bb","public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)":"5d1a4aaa30f04ca37be9cfca79ccddef"}}'::jsonb then raise exception 'STAGE1_CATALOG_PREREQUISITE_MISMATCH';end if;
end;$preflight$;
alter table public.billing_payment_attempts add column provider text;
alter table public.billing_payment_attempts add column provider_account_ref text;
alter table public.billing_payment_attempts add column provider_environment text;
alter table public.billing_entitlement_applications add column status text;
create view private.billing_verified_collection_history as
 select g.*,o.plan_version_id
 from public.billing_entitlement_applications g
 join public.billing_orders o on o.id=g.order_id and o.company_id=g.company_id
 join public.billing_plan_versions pv on pv.id=o.plan_version_id
 join public.billing_payment_attempts a on a.id=g.payment_attempt_id and a.order_id=o.id and a.company_id=g.company_id
 join public.billing_provider_events e on e.id=g.provider_event_id and e.payment_attempt_id=a.id and e.company_id=g.company_id
 join public.billing_settlement_outcomes x on x.entitlement_application_id=g.id and x.order_id=o.id
  and x.payment_attempt_id=a.id and x.company_id=g.company_id and x.provider_event_id=e.id
  and x.outcome='granted' and x.provider_transaction_id=g.provider_transaction_id
  and x.provider=g.provider and x.provider_account_ref=g.provider_account_ref and x.provider_environment=g.provider_environment
 where g.provider='paymob' and o.provider=g.provider and a.provider=g.provider and e.provider=g.provider
  and o.provider_account_ref=g.provider_account_ref and a.provider_account_ref=g.provider_account_ref and e.provider_account_ref=g.provider_account_ref
  and o.provider_environment=g.provider_environment and a.provider_environment=g.provider_environment and e.provider_environment=g.provider_environment
  and e.provider_transaction_id=g.provider_transaction_id and e.event_status='success'
  and e.amount_baisa_expected=o.amount_baisa and e.currency_expected=o.currency and o.currency='OMR'
  and o.amount_baisa=pv.amount_baisa and o.currency=pv.currency and o.period_days=pv.period_days
  and o.period_unit=pv.period_unit and o.period_count=pv.period_count
  and g.period_unit=o.period_unit and g.period_count=o.period_count
  and g.period_days=case when o.period_unit='day' then o.period_count else greatest(o.period_days,1) end
  and x.applied_paid_through=g.applied_paid_through
  and (
   (g.provider_environment='test' and x.authenticity_method='authorized_synthetic_test')
   or (x.authenticity_method='paymob_hmac_verified'
    -- The historical wrapper stamped authenticity_method unconditionally.
    -- Only persisted receiver/adapter attestation establishes provenance;
    -- never infer or backfill it from that label or a transaction timestamp.
    and x.evidence_marker='VEL_PAYMOB_SERVER_HMAC_VERIFIED'
    and e.raw_summary->'hmac_verified'='true'::jsonb
    and case when jsonb_typeof(e.raw_summary->'signed_owner')='string'
      and e.raw_summary->>'signed_owner' ~ '^[1-9][0-9]{0,15}$'
     then (e.raw_summary->>'signed_owner')::numeric between 1 and 9007199254740991
     else false end
    and jsonb_typeof(e.raw_summary->'integration_id')='number'
    and jsonb_typeof(e.raw_summary->'amount_cents')='number'
    and o.amount_baisa between 1 and 9007199254740991
    and o.provider_amount between 1 and 9007199254740991 and o.provider_amount_unit='paymob_amount'
    and e.raw_summary->>'provider_order_id'=a.provider_order_id
    and e.raw_summary->>'provider_transaction_id'=g.provider_transaction_id
    and e.raw_summary->'amount_cents'=to_jsonb(o.provider_amount)
    and e.raw_summary->>'currency'=o.currency
    and e.raw_summary->>'integration_id'=g.provider_account_ref
    and e.raw_summary->'pending'='false'::jsonb and e.raw_summary->'success'='true'::jsonb
    and e.raw_summary->'error_occured'='false'::jsonb
    and e.raw_summary->'is_auth'='false'::jsonb and e.raw_summary->'is_capture'='false'::jsonb
    and e.raw_summary->'is_refunded'='false'::jsonb and e.raw_summary->'is_voided'='false'::jsonb
    and e.raw_summary->'has_parent_transaction'='false'::jsonb and e.raw_summary->'is_standalone_payment'='true'::jsonb)
  );
revoke all on private.billing_verified_collection_history from public,anon,authenticated,service_role;


-- Historical receipt proof and current eligibility are distinct. A revoked
-- receipt remains proved financial history; it cannot itself authorize service.
create view private.billing_proven_entitlement_grants as
 select h.* from private.billing_verified_collection_history h
 join public.billing_orders o on o.id=h.order_id and o.company_id=h.company_id
 join public.billing_payment_attempts a on a.id=h.payment_attempt_id and a.company_id=h.company_id
 where h.status='active' and o.status='closed' and a.status='paid';
revoke all on private.billing_proven_entitlement_grants from public,anon,authenticated,service_role;


create function private.billing_financial_receipt_immutability()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op in ('DELETE','TRUNCATE') then
  raise exception 'BILLING_FINANCIAL_RECEIPT_APPEND_ONLY: % cannot be removed',tg_table_name
   using errcode='23514';
 end if;
 if tg_table_name='billing_provider_events' then
  if to_jsonb(new) is distinct from to_jsonb(old) then
   raise exception 'BILLING_PROVIDER_RECEIPT_IMMUTABLE' using errcode='23514';
  end if;
 elsif tg_table_name='billing_entitlement_applications' then
  if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status')
   or (new.status is distinct from old.status and (old.status='active' and new.status='revoked') is not true) then
   raise exception 'BILLING_ENTITLEMENT_RECEIPT_IMMUTABLE' using errcode='23514';
  end if;
 elsif tg_table_name='billing_settlement_outcomes' then
  if (to_jsonb(new)-'detail') is distinct from (to_jsonb(old)-'detail') then
   raise exception 'BILLING_SETTLEMENT_RECEIPT_IMMUTABLE' using errcode='23514';
  end if;
 else
  raise exception 'BILLING_FINANCIAL_RECEIPT_TABLE_UNEXPECTED' using errcode='23514';
 end if;
 return new;
end; $$;
revoke all on function private.billing_financial_receipt_immutability() from public,anon,authenticated,service_role;

create trigger billing_provider_receipt_immutability before update or delete on public.billing_provider_events
 for each row execute function private.billing_financial_receipt_immutability();
create trigger billing_entitlement_receipt_immutability before update or delete on public.billing_entitlement_applications
 for each row execute function private.billing_financial_receipt_immutability();
create trigger billing_settlement_receipt_immutability before update or delete on public.billing_settlement_outcomes
 for each row execute function private.billing_financial_receipt_immutability();

-- TRUNCATE has no row triggers. Protect privileged maintenance mistakes as well
-- as the service-role grants inherited from the earlier UI adapter migration.
create trigger billing_provider_receipt_no_truncate before truncate on public.billing_provider_events
 for each statement execute function private.billing_financial_receipt_immutability();
create trigger billing_entitlement_receipt_no_truncate before truncate on public.billing_entitlement_applications
 for each statement execute function private.billing_financial_receipt_immutability();
create trigger billing_settlement_receipt_no_truncate before truncate on public.billing_settlement_outcomes
 for each statement execute function private.billing_financial_receipt_immutability();

do $writers$ declare actual jsonb;begin
with targets as(select c.oid,n.nspname||'.'||c.relname name,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('billing_provider_events','billing_entitlement_applications','billing_settlement_outcomes','billing_orders','billing_payment_attempts','billing_subscriptions','billing_plan_versions')), t as(select name,pg_get_userbyid(relowner) owner,relrowsecurity rls,relforcerowsecurity force_rls,(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=targets.oid and a.attnum>0 and not a.attisdropped) columns,(select jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated) order by c.conname) from pg_constraint c where c.conrelid=targets.oid) constraints,(select jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'constraint_owned',exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)) order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=targets.oid) indexes,(select jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid),'function',tgfoid::regprocedure::text,'function_md5',(select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=tgfoid)) order by tgname) from pg_trigger where tgrelid=targets.oid and not tgisinternal) triggers,(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(relacl,acldefault('r',relowner))) a) acl,(select jsonb_agg(jsonb_build_object('column',a.attname,'role',case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,'privilege',g.privilege_type,'grantable',g.is_grantable) order by a.attname,g.grantee::regrole::text,g.privilege_type) from pg_attribute a cross join lateral aclexplode(a.attacl) g where a.attrelid=targets.oid) column_acl,(select jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'cmd',p.polcmd,'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by r::regrole::text) from unnest(p.polroles) r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by polname) from pg_policy p where p.polrelid=targets.oid) policies from targets),f as(select p.oid::regprocedure::text signature,pg_get_userbyid(proowner) owner,md5(replace(prosrc,chr(13),'')) body_md5,prosecdef,proconfig,provolatile,(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(proacl,acldefault('f',proowner))) a) acl from pg_proc p where p.oid in(to_regprocedure('private.billing_orders_immutability()'),to_regprocedure('public.billing_settle_paymob_hmac_verified(jsonb)'),to_regprocedure('public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'),to_regprocedure('private.billing_settle_payment_core(jsonb)'))) select jsonb_object_agg(signature,md5(to_jsonb(f)::text)) into actual from f;
if actual is distinct from '{"private.billing_orders_immutability()":"cda6e1769a1d10e109684b470bc630aa","private.billing_settle_payment_core(jsonb)":"80c74f31f49d6cf79bd858ad1bdbca99","public.billing_settle_paymob_hmac_verified(jsonb)":"0916b755d435bd09245ef76f97e4d5bb","public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)":"5d1a4aaa30f04ca37be9cfca79ccddef"}'::jsonb then raise exception 'STAGE1_WRITER_CHANGED_DURING_INSTALL';end if;end;$writers$;
commit;

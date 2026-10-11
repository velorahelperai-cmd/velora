BEGIN READ ONLY;SET LOCAL search_path='';
WITH fn AS (
 SELECT p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef definer,p.proconfig config,md5(replace(p.prosrc,chr(13),'')) body_md5,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private') AND p.proname IN ('ai_reserve_attempt','ai_start_attempt','ai_settle_attempt','ai_reconcile_attempt','ai_admin_snapshot','wa_worker_lock','wa_worker_month','whatsapp_job_service_window','whatsapp_service_window','billing_service_catalog_owner','billing_service_receipt_eligible','billing_financial_receipt_immutability','billing_service_immutable','billing_read_company_operational_entitlement','claim_whatsapp_inbound_job')
), rel AS (
 SELECT n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
 (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
 (SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid) constraints,
 (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid=c.oid) indexes,
 (SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled::text,pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) triggers,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'))
)
SELECT jsonb_build_object('functions',(SELECT jsonb_agg(to_jsonb(fn) ORDER BY signature) FROM fn),'relations',(SELECT jsonb_agg(to_jsonb(rel) ORDER BY name) FROM rel));
COMMIT;

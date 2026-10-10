-- Local Stage2B compatibility review only; production approval is separate.
-- CLI scaffold 20261010132824. No historical grants, catalog seeds or automatic activation.
begin;
set local search_path='';set local lock_timeout='2s';set local statement_timeout='30s';
lock table public.billing_orders,public.billing_plan_versions,public.billing_subscriptions,
 public.billing_payment_attempts,public.billing_provider_events,
 public.billing_entitlement_applications,public.billing_settlement_outcomes in share row exclusive mode;
do $preflight$ declare actual jsonb;begin
 if current_user<>'postgres' then raise exception 'STAGE2B_INSTALLER_MISMATCH';end if;
 select jsonb_build_object('database_owner',(select pg_get_userbyid(datdba) from pg_database where datname=current_database()),'public_owner',(select pg_get_userbyid(nspowner) from pg_namespace where nspname='public'),'public_acl',(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname='public')) into actual;
 if actual is distinct from '{"public_acl":[{"role":"PUBLIC","grantable":false,"privilege":"USAGE"},{"role":"anon","grantable":false,"privilege":"USAGE"},{"role":"authenticated","grantable":false,"privilege":"USAGE"},{"role":"pg_database_owner","grantable":false,"privilege":"CREATE"},{"role":"pg_database_owner","grantable":false,"privilege":"USAGE"},{"role":"postgres","grantable":false,"privilege":"USAGE"},{"role":"service_role","grantable":false,"privilege":"USAGE"}],"public_owner":"pg_database_owner","database_owner":"postgres"}'::jsonb then raise exception 'STAGE2B_INSTALLER_NAMESPACE_MISMATCH';end if;


with targets as(select c.oid,n.nspname||'.'||c.relname name,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('billing_provider_events','billing_entitlement_applications','billing_settlement_outcomes','billing_orders','billing_payment_attempts','billing_subscriptions','billing_plan_versions')), t as(select name,pg_get_userbyid(relowner) owner,relrowsecurity rls,relforcerowsecurity force_rls,(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=targets.oid and a.attnum>0 and not a.attisdropped) columns,(select jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated) order by c.conname) from pg_constraint c where c.conrelid=targets.oid) constraints,(select jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'constraint_owned',exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)) order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=targets.oid) indexes,(select jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid),'function',tgfoid::regprocedure::text,'function_md5',(select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=tgfoid)) order by tgname) from pg_trigger where tgrelid=targets.oid and not tgisinternal) triggers,(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(relacl,acldefault('r',relowner))) a) acl,(select jsonb_agg(jsonb_build_object('column',a.attname,'role',case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,'privilege',g.privilege_type,'grantable',g.is_grantable) order by a.attname,g.grantee::regrole::text,g.privilege_type) from pg_attribute a cross join lateral aclexplode(a.attacl) g where a.attrelid=targets.oid) column_acl,(select jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'cmd',p.polcmd,'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by r::regrole::text) from unnest(p.polroles) r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by polname) from pg_policy p where p.polrelid=targets.oid) policies from targets),f as(select p.oid::regprocedure::text signature,pg_get_userbyid(proowner) owner,md5(replace(prosrc,chr(13),'')) body_md5,prosecdef,proconfig,provolatile,(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(proacl,acldefault('f',proowner))) a) acl from pg_proc p where p.oid in(to_regprocedure('auth.jwt()'),to_regprocedure('auth.uid()'),to_regprocedure('private.access_company_capabilities()'),to_regprocedure('private.billing_acceptance_hmac_event(jsonb)'),to_regprocedure('private.billing_add_calendar_period(timestamp with time zone,text,integer)'),to_regprocedure('private.billing_apply_reversal(uuid,uuid,uuid,text,jsonb)'),to_regprocedure('private.billing_compute_paid_through(timestamp with time zone,timestamp with time zone,text,integer)'),to_regprocedure('private.billing_confirm_payment_attempt_failed(uuid,uuid,jsonb)'),to_regprocedure('private.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'),to_regprocedure('private.billing_entitlement_applications_company_guard()'),to_regprocedure('private.billing_open_payment_attempt_after_confirmed_failed(uuid,uuid,uuid,text)'),to_regprocedure('private.billing_order_deadline_identity_guard()'),to_regprocedure('private.billing_order_is_safe_uncirculated_draft(uuid)'),to_regprocedure('private.billing_orders_client_op_fingerprint_guard()'),to_regprocedure('private.billing_orders_immutability()'),to_regprocedure('private.billing_payment_attempts_binding_guard()'),to_regprocedure('private.billing_payment_attempts_sync_order_scope()'),to_regprocedure('private.billing_pin_test_provider_amount()'),to_regprocedure('private.billing_plan_versions_immutability()'),to_regprocedure('private.billing_provider_event_binding_guard()'),to_regprocedure('private.billing_record_lifecycle_review(public.billing_provider_events,uuid,text)'),to_regprocedure('private.billing_reject_immutable_change(text)'),to_regprocedure('private.billing_resolve_or_create_payment_attempt(uuid,uuid)'),to_regprocedure('private.billing_set_payment_attempt_lifecycle_status(uuid,uuid,text)'),to_regprocedure('private.billing_settle_payment_core_pre_acceptance(jsonb)'),to_regprocedure('private.billing_settle_payment_core(jsonb)'),to_regprocedure('private.billing_subscription_within_paid_period(timestamp with time zone,timestamp with time zone)'),to_regprocedure('private.billing_ui_catalog_draft(text,public.billing_plan_versions)'),to_regprocedure('private.billing_ui_company_owner(uuid)'),to_regprocedure('private.billing_ui_owner()'),to_regprocedure('private.billing_ui_valid_draft(jsonb)'),to_regprocedure('private.manager_delegation_covers(uuid,uuid,text)'),to_regprocedure('private.user_has_company_capability(uuid,uuid,text)'),to_regprocedure('public.app_session_is_valid()'),to_regprocedure('public.billing_cancel_at_period_end(uuid)'),to_regprocedure('public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'),to_regprocedure('public.billing_create_test_checkout_order(jsonb,integer)'),to_regprocedure('public.billing_read_company_operational_entitlement(uuid)'),to_regprocedure('public.billing_settle_paymob_hmac_verified(jsonb)'),to_regprocedure('public.check_app_session(boolean)'),to_regprocedure('public.has_company_capability(uuid,text)'),to_regprocedure('public.is_platform_owner()')))
select jsonb_build_object('tables',(select jsonb_object_agg(name,md5(to_jsonb(t)::text)) from t),'functions',(select jsonb_object_agg(signature,md5(to_jsonb(f)::text)) from f)) into actual;

if actual is distinct from '{"tables":{"public.billing_entitlement_applications":"1a476db28f46ca2e93d3765ae849f066","public.billing_orders":"528b3c919ea2b5615f94676c41774251","public.billing_payment_attempts":"386d8c42494c6b808b862a78346e21da","public.billing_plan_versions":"71ff6c5adb0f8c6eb8dc5284cca72889","public.billing_provider_events":"17863938af09eaa6d3878d6b3b96222b","public.billing_settlement_outcomes":"5ea35574ac79cbfeaeed1bc44110bbfe","public.billing_subscriptions":"1adcb37f60e45160b62bae39a6257bc5"},"functions":{"auth.jwt()":"e6cc14ec849a5d992bab6b31b5bb0a46","auth.uid()":"72d4da798a92978f422816f3198019f0","private.access_company_capabilities()":"5c5573f8200259ef2f33acf2ed9aaa8f","private.billing_acceptance_hmac_event(jsonb)":"82b039389a7993346bd79ea04e9229ba","private.billing_add_calendar_period(timestamp with time zone,text,integer)":"66d4e4895663fee70695bf036bd7aee4","private.billing_apply_reversal(uuid,uuid,uuid,text,jsonb)":"f5bd03dd8ada10435fff1f3db21ffd2c","private.billing_compute_paid_through(timestamp with time zone,timestamp with time zone,text,integer)":"7ddefbcd6f20d0b1ad990694403d7c7d","private.billing_confirm_payment_attempt_failed(uuid,uuid,jsonb)":"eedbf0555c4f3a2154624c8802ffce47","private.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)":"792d856752c258515c3df45398320a4b","private.billing_entitlement_applications_company_guard()":"ef18eae57dbf4b57f51af21bcd823fbb","private.billing_open_payment_attempt_after_confirmed_failed(uuid,uuid,uuid,text)":"6e73ca11440ab7adba5d3333e3128a3f","private.billing_order_deadline_identity_guard()":"eb4f533775825a581e674f3f001a0e1b","private.billing_order_is_safe_uncirculated_draft(uuid)":"fdcaa9d2cc6c5b76613f99838f07551f","private.billing_orders_client_op_fingerprint_guard()":"23db6a8cc00b4688a056eaac3fa54699","private.billing_orders_immutability()":"cda6e1769a1d10e109684b470bc630aa","private.billing_payment_attempts_binding_guard()":"2f8b795998c65d7f2f2d405fd6b6d1da","private.billing_payment_attempts_sync_order_scope()":"13c32cfaa89614dc88e43f1957f59c90","private.billing_pin_test_provider_amount()":"e1c780a635833481da02d7277c070ed7","private.billing_plan_versions_immutability()":"50fc18a8f4cdd041acdf86ef21a085a3","private.billing_provider_event_binding_guard()":"8038460279672b0365326e46ad9e08d4","private.billing_record_lifecycle_review(public.billing_provider_events,uuid,text)":"218a7f985c9d5f40534e0fe20efa9a28","private.billing_reject_immutable_change(text)":"a94c504b971789e4ee4f1189d26edf08","private.billing_resolve_or_create_payment_attempt(uuid,uuid)":"5afabd6a44ad54a0556839920a38787a","private.billing_set_payment_attempt_lifecycle_status(uuid,uuid,text)":"034ca8e247dea83a43916cacfe187747","private.billing_settle_payment_core_pre_acceptance(jsonb)":"28fb54348043cb0134e2ea296f733c27","private.billing_settle_payment_core(jsonb)":"4326bf46079e72bb50fafbd5e5796ce8","private.billing_subscription_within_paid_period(timestamp with time zone,timestamp with time zone)":"5a7fac2cadd4545a381620fe6a48799f","private.billing_ui_catalog_draft(text,public.billing_plan_versions)":"07da1ff7186cccd18b4710bd19c52b30","private.billing_ui_company_owner(uuid)":"dcbf653d652a5b765f6b554c38ab6136","private.billing_ui_owner()":"d9b4829f05cf0cde72cded6d220bd639","private.billing_ui_valid_draft(jsonb)":"c93cd0e1fbefa14a82a0e61e0073b2b0","private.manager_delegation_covers(uuid,uuid,text)":"5521355aba02d36297c094173c76a11a","private.user_has_company_capability(uuid,uuid,text)":"8144fb80bbc5f90aa4723cc6ca85bd5c","public.app_session_is_valid()":"82af3ca35da352589b12a058e843daae","public.billing_cancel_at_period_end(uuid)":"9aa8d275ba19189c0b743b30950be301","public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)":"d0c35590fd1076e07d3950134e24c2bb","public.billing_create_test_checkout_order(jsonb,integer)":"406e1af0ca0accd165f3e20003f06bdf","public.billing_read_company_operational_entitlement(uuid)":"2cfa39b68d228609cb382be8d2007ebc","public.billing_settle_paymob_hmac_verified(jsonb)":"7876be5fb234a9ebeb28cab97680830e","public.check_app_session(boolean)":"e141e60dfad5ff946156568f5cbafb4a","public.has_company_capability(uuid,text)":"be537fd730b5e26de0a642938a32657d","public.is_platform_owner()":"35df3d4119add9c66bf7234a6473930f"}}'::jsonb then raise exception 'STAGE2B_CATALOG_PREREQUISITE_MISMATCH';end if;

select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),'definition_md5',md5(replace(pg_get_viewdef(c.oid,true),chr(13),'')),'acl',(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a)) order by c.relname) into actual from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('billing_verified_collection_history','billing_proven_entitlement_grants');if actual is distinct from '[{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"}],"name":"private.billing_proven_entitlement_grants","owner":"postgres","definition_md5":"aa061659aa08afb861a76c830b339b41"},{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"}],"name":"private.billing_verified_collection_history","owner":"postgres","definition_md5":"329b440feaaaf7f2602b96651e932622"}]'::jsonb then raise exception 'STAGE2B_PROOF_VIEWS_MISMATCH';end if;

SELECT jsonb_object_agg(name,to_jsonb(t)) INTO actual FROM (SELECT n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,(SELECT jsonb_object_agg(a.attname,jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid))) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND (n.nspname<>'auth' OR (c.relname='users' AND a.attname IN ('id','email','email_confirmed_at','phone_confirmed_at')) OR (c.relname='sessions' AND a.attname IN ('id','user_id','created_at')))) columns,(SELECT jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a) acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid IN (to_regclass('auth.sessions'),to_regclass('auth.users'),to_regclass('private.app_session_activity'),to_regclass('private.app_session_settings'),to_regclass('public.billing_catalog_revision'),to_regclass('public.billing_plans'),to_regclass('public.companies'),to_regclass('public.company_member_grants'),to_regclass('public.company_members'),to_regclass('public.platform_admin_scopes'),to_regclass('public.platform_admins'))) t;
if actual is distinct from '{"auth.users":{"acl":[{"role":"dashboard_user","grantable":false,"privilege":"DELETE"},{"role":"dashboard_user","grantable":false,"privilege":"INSERT"},{"role":"dashboard_user","grantable":false,"privilege":"MAINTAIN"},{"role":"dashboard_user","grantable":false,"privilege":"REFERENCES"},{"role":"dashboard_user","grantable":false,"privilege":"SELECT"},{"role":"dashboard_user","grantable":false,"privilege":"TRIGGER"},{"role":"dashboard_user","grantable":false,"privilege":"TRUNCATE"},{"role":"dashboard_user","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":true,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"supabase_auth_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_auth_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_auth_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_auth_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_auth_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_auth_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_auth_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_auth_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"auth.users","owner":"supabase_auth_admin","columns":{"id":{"type":"uuid","default":null,"notnull":true},"email":{"type":"character varying(255)","default":null,"notnull":false},"email_confirmed_at":{"type":"timestamp with time zone","default":null,"notnull":false},"phone_confirmed_at":{"type":"timestamp with time zone","default":null,"notnull":false}},"force_rls":false},"auth.sessions":{"acl":[{"role":"dashboard_user","grantable":false,"privilege":"DELETE"},{"role":"dashboard_user","grantable":false,"privilege":"INSERT"},{"role":"dashboard_user","grantable":false,"privilege":"MAINTAIN"},{"role":"dashboard_user","grantable":false,"privilege":"REFERENCES"},{"role":"dashboard_user","grantable":false,"privilege":"SELECT"},{"role":"dashboard_user","grantable":false,"privilege":"TRIGGER"},{"role":"dashboard_user","grantable":false,"privilege":"TRUNCATE"},{"role":"dashboard_user","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":true,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"supabase_auth_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_auth_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_auth_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_auth_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_auth_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_auth_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_auth_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_auth_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"auth.sessions","owner":"supabase_auth_admin","columns":{"id":{"type":"uuid","default":null,"notnull":true},"user_id":{"type":"uuid","default":null,"notnull":true},"created_at":{"type":"timestamp with time zone","default":null,"notnull":false}},"force_rls":false},"public.companies":{"acl":[{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"public.companies","owner":"postgres","columns":{"id":{"type":"uuid","default":"gen_random_uuid()","notnull":true},"city":{"type":"text","default":"''''::text","notnull":true},"hours":{"type":"text","default":"''''::text","notnull":true},"status":{"type":"text","default":"''setup''::text","notnull":true},"country":{"type":"text","default":"''OM''::text","notnull":true},"timezone":{"type":"text","default":null,"notnull":false},"created_at":{"type":"timestamp with time zone","default":"now()","notnull":true},"created_by":{"type":"uuid","default":null,"notnull":true},"updated_at":{"type":"timestamp with time zone","default":"now()","notnull":true},"display_name":{"type":"text","default":null,"notnull":true},"business_type":{"type":"text","default":"''restaurant''::text","notnull":true},"contact_email":{"type":"text","default":"''''::text","notnull":true},"contact_phone":{"type":"text","default":"''''::text","notnull":true},"reply_language":{"type":"text","default":"''both''::text","notnull":true}},"force_rls":false},"public.billing_plans":{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"public.billing_plans","owner":"postgres","columns":{"id":{"type":"uuid","default":"gen_random_uuid()","notnull":true},"code":{"type":"text","default":null,"notnull":true},"name":{"type":"text","default":null,"notnull":true},"status":{"type":"text","default":"''draft''::text","notnull":true},"created_at":{"type":"timestamp with time zone","default":"now()","notnull":true},"updated_at":{"type":"timestamp with time zone","default":"now()","notnull":true}},"force_rls":false},"public.company_members":{"acl":[{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"public.company_members","owner":"postgres","columns":{"role":{"type":"text","default":null,"notnull":true},"status":{"type":"text","default":"''active''::text","notnull":true},"user_id":{"type":"uuid","default":null,"notnull":true},"company_id":{"type":"uuid","default":null,"notnull":true},"created_at":{"type":"timestamp with time zone","default":"now()","notnull":true},"member_name":{"type":"text","default":"''''::text","notnull":true}},"force_rls":false},"public.platform_admins":{"acl":[{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"public.platform_admins","owner":"postgres","columns":{"note":{"type":"text","default":"''''::text","notnull":true},"role":{"type":"text","default":"''delegated''::text","notnull":true},"status":{"type":"text","default":"''active''::text","notnull":true},"user_id":{"type":"uuid","default":null,"notnull":true},"revision":{"type":"integer","default":"1","notnull":true},"granted_at":{"type":"timestamp with time zone","default":"now()","notnull":true},"granted_by":{"type":"uuid","default":null,"notnull":false},"updated_at":{"type":"timestamp with time zone","default":"now()","notnull":true}},"force_rls":false},"private.app_session_activity":{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"SELECT"}],"rls":false,"name":"private.app_session_activity","owner":"postgres","columns":{"user_id":{"type":"uuid","default":null,"notnull":true},"expired_at":{"type":"timestamp with time zone","default":null,"notnull":false},"session_id":{"type":"uuid","default":null,"notnull":true},"last_activity_at":{"type":"timestamp with time zone","default":null,"notnull":true}},"force_rls":false},"private.app_session_settings":{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":false,"name":"private.app_session_settings","owner":"postgres","columns":{"enabled":{"type":"boolean","default":"false","notnull":true},"singleton":{"type":"boolean","default":"true","notnull":true}},"force_rls":false},"public.company_member_grants":{"acl":[{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"public.company_member_grants","owner":"postgres","columns":{"status":{"type":"text","default":"''active''::text","notnull":true},"user_id":{"type":"uuid","default":null,"notnull":true},"revision":{"type":"integer","default":"1","notnull":true},"company_id":{"type":"uuid","default":null,"notnull":true},"updated_at":{"type":"timestamp with time zone","default":"now()","notnull":true},"updated_by":{"type":"uuid","default":null,"notnull":false},"capabilities":{"type":"text[]","default":"''{}''::text[]","notnull":true},"manager_user_id":{"type":"uuid","default":null,"notnull":false},"conversation_scope":{"type":"text","default":"''all_company''::text","notnull":true}},"force_rls":false},"public.platform_admin_scopes":{"acl":[{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"public.platform_admin_scopes","owner":"postgres","columns":{"revision":{"type":"integer","default":"1","notnull":true},"company_id":{"type":"uuid","default":null,"notnull":true},"updated_at":{"type":"timestamp with time zone","default":"now()","notnull":true},"updated_by":{"type":"uuid","default":null,"notnull":false},"admin_user_id":{"type":"uuid","default":null,"notnull":true},"usable_capabilities":{"type":"text[]","default":"''{}''::text[]","notnull":true},"delegable_capabilities":{"type":"text[]","default":"''{}''::text[]","notnull":true}},"force_rls":false},"public.billing_catalog_revision":{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"public.billing_catalog_revision","owner":"postgres","columns":{"revision":{"type":"bigint","default":"1","notnull":true},"singleton":{"type":"boolean","default":"true","notnull":true}},"force_rls":false}}'::jsonb then raise exception 'STAGE2B_SERVICE_RELATION_CONTRACT_MISMATCH';end if;
SELECT jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',(SELECT jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type) FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a)) INTO actual FROM pg_namespace n WHERE n.nspname='auth';
if actual is distinct from '{"acl":[{"role":"anon","grantable":false,"privilege":"USAGE"},{"role":"authenticated","grantable":false,"privilege":"USAGE"},{"role":"dashboard_user","grantable":false,"privilege":"CREATE"},{"role":"dashboard_user","grantable":false,"privilege":"USAGE"},{"role":"postgres","grantable":false,"privilege":"USAGE"},{"role":"service_role","grantable":false,"privilege":"USAGE"},{"role":"supabase_admin","grantable":false,"privilege":"CREATE"},{"role":"supabase_admin","grantable":false,"privilege":"USAGE"},{"role":"supabase_auth_admin","grantable":false,"privilege":"CREATE"},{"role":"supabase_auth_admin","grantable":false,"privilege":"USAGE"}],"name":"auth","owner":"supabase_admin"}'::jsonb then raise exception 'STAGE2B_AUTH_NAMESPACE_MISMATCH';end if;
if to_regclass('private.billing_service_offers') is not null or to_regclass('private.billing_service_order_offers') is not null or to_regclass('private.billing_service_grants') is not null or to_regprocedure('private.billing_settle_paymob_hmac_verified_pre_service(jsonb)') is not null then raise exception 'STAGE2B_ALREADY_OR_PARTIALLY_INSTALLED';end if;
end;$preflight$;
-- STAGE2B_SERVICE_CONTRACT_BEGIN
do $$ begin
 if to_regclass('private.billing_proven_entitlement_grants') is null
 or to_regprocedure('public.check_app_session(boolean)') is null
 or to_regprocedure('public.has_company_capability(uuid,text)') is null then
  raise exception 'SERVICE_ENTITLEMENT_DEPENDENCIES_MISSING' using errcode='55000';
 end if;
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.billing_financial_receipt_immutability()')) is distinct from '7b28f06702c177c5b65e3d9b23a7e1d4' then
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
-- STAGE2B_ORCHESTRATION_BEGIN
do $$ declare dep record; actual_hash text; actual_definer boolean; actual_config text; expected_config text;
begin
 for dep in select * from (values
 ('public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)','a70719d80e0058b08b820f7a1494798a',true),
 ('public.billing_create_test_checkout_order(jsonb,integer)','0bb5e53842c1b8667300d0cd5a01b91b',true),
 ('public.billing_settle_paymob_hmac_verified(jsonb)','a1ce90ae693324f11db6d3026969bf47',true),
 ('private.billing_acceptance_hmac_event(jsonb)','8c51025169a2210a9ae4fafe945c81af',true),
 ('private.billing_settle_payment_core(jsonb)','c0e12aeb434b8cf7955872d5edd53ef0',true),
 ('private.billing_settle_payment_core_pre_acceptance(jsonb)','ae4dd1a4195db97e91fa0e662ccdfff7',true),
 ('public.billing_snapshot_service_order(uuid)','7cb64387308163d827cb271b481737c1',true),
 ('public.billing_apply_service_grant(uuid)','a24ab750931095099b473aeb73513fba',true),
 ('private.billing_service_receipt_eligible(uuid)','b7d82e7e8fefc05c22f876f1ac00b7c2',false),
 ('private.billing_service_immutable()','17b4d16be72ea6e2e3e44401c7680fd2',false),
 ('private.billing_ui_owner()','73e9d20bcaa68da3488d536ba8720bed',true),
 ('private.billing_financial_receipt_immutability()','7b28f06702c177c5b65e3d9b23a7e1d4',false)
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
 ('private.billing_verified_collection_history','329b440feaaaf7f2602b96651e932622'),
 ('private.billing_proven_entitlement_grants','aa061659aa08afb861a76c830b339b41')) as views(view_name,definition_hash) loop
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
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); sid uuid;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then return false;end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return false;end;
 if sid is null then return false;end if;
 -- Call only AFTER catalog/version locks. Keep the complete authorization read
 -- set locked through commit; an unlocked repeat check leaves another TOCTOU.
 -- Session deletion locks session then cascades activity. NOWAIT avoids cycles
 -- with revocation/profile RPCs that may take these rows in another order.
 perform 1 from auth.users where id=actor for share nowait;
 if not found then return false;end if;
 perform 1 from auth.sessions where id=sid and user_id=actor for share nowait;
 if not found then return false;end if;
 perform 1 from private.app_session_activity where session_id=sid and user_id=actor for update nowait;
 if not found then return false;end if;
 perform 1 from public.platform_admins where user_id=actor for share nowait;
 if not found then return false;end if;
 -- Read time and predicates after every lock; retain the legacy session/owner
 -- checks even when rollout settings disable the pre-request hook.
 if (public.check_app_session(false)->>'ok') is distinct from 'true'
 or not private.billing_ui_owner()
 or not exists(select 1 from auth.users where id=actor and (email_confirmed_at is not null or phone_confirmed_at is not null))
 or not exists(select 1 from public.platform_admins where user_id=actor and role='owner' and status='active') then return false;end if;
 return true;
 exception when lock_not_available then return false;
end; $$;
revoke all on function private.billing_service_catalog_owner() from public,anon,authenticated,service_role;
create function public.billing_bind_noura_basic_draft(p_plan_version_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_revision bigint; v public.billing_plan_versions%rowtype; offer private.billing_service_offers%rowtype; code text;
begin
 -- Cheap nonlocking denial retains the original caller boundary without
 -- holding session activity across business-row waits. It is never authority
 -- to write: the locked guard below must pass again after both waits.
 if current_setting('role',true)<>'authenticated' or auth.uid() is null
 or not private.billing_ui_owner()
 or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
 join private.app_session_activity a on a.session_id=s.id and a.user_id=u.id
 where u.id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
 and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
 and a.expired_at is null and a.last_activity_at<=clock_timestamp()
 and a.last_activity_at>clock_timestamp()-interval '2 hours')
 then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if p_plan_version_id is null or p_expected_revision is null or p_expected_revision<1 then return jsonb_build_object('ok',false,'code','invalid_input');end if;
 select r.revision into v_revision from public.billing_catalog_revision r where singleton for update;
 if v_revision is distinct from p_expected_revision then return jsonb_build_object('ok',false,'code','conflict');end if;
 select * into v from public.billing_plan_versions where id=p_plan_version_id for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 if not private.billing_service_catalog_owner() then return jsonb_build_object('ok',false,'code','forbidden');end if;
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
do $postflight$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.billing_payment_attempts_sync_order_scope()'::regprocedure) is distinct from '56d96321d7e2ed74fbf27e707aed1ded'
 or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.billing_financial_receipt_immutability()'::regprocedure) is distinct from '7b28f06702c177c5b65e3d9b23a7e1d4'
 or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'::regprocedure) is distinct from '4963a4ebcf0f9dbde12a0db77467ff04'
 or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.billing_settle_paymob_hmac_verified_pre_service(jsonb)'::regprocedure) is distinct from 'a1ce90ae693324f11db6d3026969bf47'
 then raise exception 'STAGE2B_FORWARD_CONTRACT_MISMATCH';end if;
 if exists(select 1 from private.billing_service_offers) or exists(select 1 from private.billing_service_order_offers) or exists(select 1 from private.billing_service_grants) then raise exception 'STAGE2B_UNEXPECTED_SEED_OR_GRANT';end if;
end;$postflight$;
notify pgrst,'reload schema';
commit;

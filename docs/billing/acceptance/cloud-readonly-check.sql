-- Review-only catalog query. NO application data, writes, migration repair,
-- backup, or stored routine execution. Run only with explicit read authorization
-- for project vmpifljyozsbtssxhoxd. Not executed by this local acceptance run.
begin transaction read only;
select jsonb_build_object(
 'identity',jsonb_build_object('database',current_database(),'queried_as',current_user,
  'postgres_version',version(),'read_only',current_setting('transaction_read_only')),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('version',m.version,'name',m.name,
  'statement_digest',md5(coalesce((to_jsonb(m)->'statements')::text,''))) order by m.version),'[]')
  from supabase_migrations.schema_migrations m),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'signature',p.oid::regprocedure::text,
  'security_definer',p.prosecdef,'settings',p.proconfig,'owner',pg_get_userbyid(p.proowner),
  'body_digest',md5(replace(p.prosrc,chr(13),'')),'definition',pg_get_functiondef(p.oid),
  'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by n.nspname,p.proname),'[]')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
  and p.proname in ('billing_create_or_reuse_subscription_order','billing_settle_paymob_hmac_verified',
   'billing_settle_payment_core','billing_apply_reversal','billing_read_company_operational_entitlement',
   'billing_cancel_at_period_end','billing_read_company_journey','billing_complete_test_checkout',
   'billing_payment_attempts_binding_guard','billing_payment_attempts_sync_order_scope')),
 'columns',(select coalesce(jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,
  'nullable',is_nullable,'default',column_default) order by table_name,ordinal_position),'[]')
  from information_schema.columns where table_schema='public' and table_name in
   ('billing_subscriptions','billing_orders','billing_payment_attempts','billing_provider_events','billing_entitlement_applications','billing_settlement_outcomes')),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('table',t.relname,'name',c.conname,
  'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid,true)) order by t.relname,c.conname),'[]')
  from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
  where n.nspname='public' and t.relname in ('billing_subscriptions','billing_orders','billing_payment_attempts',
   'billing_provider_events','billing_entitlement_applications','billing_settlement_outcomes')),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef)
  order by tablename,indexname),'[]') from pg_indexes where schemaname='public' and tablename in
   ('billing_subscriptions','billing_orders','billing_payment_attempts','billing_provider_events','billing_entitlement_applications','billing_settlement_outcomes')),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by tablename,policyname),'[]') from pg_policies p
  where schemaname='public' and tablename in ('billing_subscriptions','billing_orders','billing_payment_attempts',
   'billing_provider_events','billing_entitlement_applications','billing_settlement_outcomes')),
 'privileges',(select coalesce(jsonb_agg(to_jsonb(g) order by table_name,grantee,privilege_type),'[]')
  from information_schema.role_table_grants g where table_schema='public' and table_name in
   ('billing_subscriptions','billing_orders','billing_payment_attempts','billing_provider_events','billing_entitlement_applications','billing_settlement_outcomes'))
);
commit;

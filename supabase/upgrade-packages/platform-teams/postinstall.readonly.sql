-- Prepared release verification only. Catalog metadata; no application/Auth rows.
begin read only;
set local search_path = '';
set local statement_timeout = '15s';
with team_functions as (
 select p.*, n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname like 'platform\_team\_%' escape '\'
), team_relations as (
 select c.*, n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where (n.nspname,c.relname) in (('public','platform_teams'),('public','platform_team_members'),('private','platform_team_operations'))
)
select jsonb_build_object(
 'observed_at',clock_timestamp(), 'database',current_database(),
 'server_version',current_setting('server_version'),
 'authenticated_private_usage',has_schema_privilege('authenticated','private','USAGE'),
 'functions',coalesce((select jsonb_agg(jsonb_build_object(
   'signature',p.oid::regprocedure::text,'schema',p.nspname,
   'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
   'configuration',p.proconfig,'volatility',p.provolatile,
   'body_md5',md5(replace(p.prosrc,chr(13),'')),
   'acl',p.proacl::text,
   'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
   'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
   'service_role_execute',has_function_privilege('service_role',p.oid,'EXECUTE')
 )order by p.nspname,p.proname,p.oid::regprocedure::text)from team_functions p),'[]'::jsonb),
 'relations',coalesce((select jsonb_agg(jsonb_build_object(
   'relation',c.oid::regclass::text,'owner',pg_get_userbyid(c.relowner),
   'rls',c.relrowsecurity,'acl',c.relacl::text,
   'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
   'authenticated_write',has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
   'anon_any',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
   'service_role_any',has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
   'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'acl',a.attacl::text)order by a.attnum)from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',pol.polname,'command',pol.polcmd,'roles',pol.polroles,'using',pg_get_expr(pol.polqual,pol.polrelid),'check',pg_get_expr(pol.polwithcheck,pol.polrelid))order by pol.polname),'[]'::jsonb)from pg_policy pol where pol.polrelid=c.oid),
   'constraints',(select jsonb_agg(jsonb_build_object('name',con.conname,'definition',pg_get_constraintdef(con.oid))order by con.conname)from pg_constraint con where con.conrelid=c.oid),
   'indexes',(select jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid)order by i.indexrelid::regclass::text)from pg_index i where i.indrelid=c.oid),
   'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)order by t.tgname),'[]'::jsonb)from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)
 )order by c.nspname,c.relname)from team_relations c),'[]'::jsonb),
 'dependencies',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body_md5',md5(replace(p.prosrc,chr(13),'')),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'configuration',p.proconfig)order by p.oid::regprocedure::text)from pg_proc p where p.oid in(to_regprocedure('public.is_platform_owner()'),to_regprocedure('public.app_session_is_valid()'),to_regprocedure('private.write_admin_audit(uuid,uuid,text,jsonb,jsonb)')))
)postinstall;
commit;

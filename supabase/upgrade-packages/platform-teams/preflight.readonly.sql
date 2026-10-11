-- Catalog only: no rows, JWTs, credentials, grants or schema changes.
begin read only;
with required_columns(relation,column_name,type_name,not_null) as(values
 ('auth.users','id','uuid',true),('auth.users','email_confirmed_at','timestamp with time zone',false),
 ('auth.users','phone_confirmed_at','timestamp with time zone',false),('auth.users','banned_until','timestamp with time zone',false),('auth.users','deleted_at','timestamp with time zone',false),
 ('auth.sessions','id','uuid',true),('auth.sessions','user_id','uuid',true),('auth.sessions','not_after','timestamp with time zone',false),
 ('private.app_session_activity','session_id','uuid',true),('private.app_session_activity','user_id','uuid',true),('private.app_session_activity','last_activity_at','timestamp with time zone',true),('private.app_session_activity','expired_at','timestamp with time zone',false),
 ('public.platform_admins','user_id','uuid',true),('public.platform_admins','role','text',true),('public.platform_admins','status','text',true),
 ('public.platform_admin_scopes','admin_user_id','uuid',true),('public.platform_admin_scopes','company_id','uuid',true),('public.platform_admin_scopes','usable_capabilities','text[]',true),
 ('public.profiles','user_id','uuid',true),('public.profiles','full_name','text',true),
 ('public.admin_audit_logs','actor_user_id','uuid',true),('public.admin_audit_logs','company_id','uuid',false),('public.admin_audit_logs','action','text',true),('public.admin_audit_logs','before_data','jsonb',false),('public.admin_audit_logs','after_data','jsonb',false)
),column_checks as(
 select r.*,coalesce(a.attname is not null and format_type(a.atttypid,a.atttypmod)=r.type_name and (not r.not_null or a.attnotnull),false) compatible
 from required_columns r left join pg_attribute a on a.attrelid=to_regclass(r.relation) and a.attname=r.column_name and a.attnum>0 and not a.attisdropped
),required_functions(signature,body_md5)as(values
 ('public.is_platform_owner()','d46584d9ac02072238753afd973d9de3'),
 ('public.app_session_is_valid()','b42c28f54d05778fcc994156c6ce4086'),
 ('private.write_admin_audit(uuid,uuid,text,jsonb,jsonb)','2f58d7407a5a169c0cb4d87a66661af4')
),function_checks as(
 select r.signature,r.body_md5,coalesce(p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and 'search_path=""'=any(p.proconfig) and md5(replace(p.prosrc,chr(13),''))=r.body_md5,false)compatible
 from required_functions r left join pg_proc p on p.oid=to_regprocedure(r.signature)
),new_relations(name)as(values('public.platform_teams'),('public.platform_team_members'),('private.platform_team_operations')),
new_functions(signature)as(values('public.platform_team_read_self()'),('public.platform_team_read_directory(uuid,uuid,integer,integer)'),('public.platform_team_read_directory(uuid,uuid,integer,integer,text)'),('public.platform_team_read_directory(uuid,uuid,integer,integer,text,jsonb)'),('public.platform_team_preview_transfer(jsonb)'),('public.platform_team_mutate(jsonb)'))
select jsonb_build_object(
 'observed_at',clock_timestamp(),'server_version',current_setting('server_version'),
 'columns_compatible',(select bool_and(compatible)from column_checks),
 'functions_compatible',(select bool_and(compatible)from function_checks),
 'required_public_rls',(select count(*)=4 and bool_and(relrowsecurity)from pg_class where oid in(to_regclass('public.platform_admins'),to_regclass('public.platform_admin_scopes'),to_regclass('public.profiles'),to_regclass('public.admin_audit_logs'))),
 'new_relations_absent',(select bool_and(to_regclass(name)is null)from new_relations),
 'new_rpcs_absent',(select bool_and(to_regprocedure(signature)is null)from new_functions),
 'authenticated_private_usage',has_schema_privilege('authenticated','private','USAGE'),
 'authenticated_owner_predicate_execute',has_function_privilege('authenticated','public.is_platform_owner()','EXECUTE'),
 'functions',(select jsonb_agg(to_jsonb(c))from function_checks c),
 'incompatible_columns',(select coalesce(jsonb_agg(to_jsonb(c)),'[]')from column_checks c where not compatible)
)preflight;
commit;

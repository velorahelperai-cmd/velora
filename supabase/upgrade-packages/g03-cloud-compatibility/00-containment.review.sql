-- REVIEW ONLY: target vmpifljyozsbtssxhoxd, published c36f2286. No live execution authorized.
begin;
set local role postgres;
set local search_path='';
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ declare fingerprint text; begin
 -- Catalog-only, data-free fingerprint. Run with search_path=''.
-- transition body/ACL intentionally excluded: separately pinned containment.
with targets as (
 select c.oid,c.relname,n.nspname,c.relowner,c.relrowsecurity,c.relforcerowsecurity from pg_class c
 join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in (
 ('public','companies'),('public','knowledge_sources'),('public','company_review_requests'),
 ('public','company_members'),('public','company_member_grants'),('public','platform_admins'),
 ('public','platform_admin_scopes'),('public','admin_audit_logs'),('private','app_session_activity'),
 ('private','app_session_settings'),('auth','users'),('auth','sessions'),('storage','objects'))
), funcs as (
 select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.oid in (select tgfoid from pg_trigger where tgrelid in(select oid from targets) and not tgisinternal)
 or (n.nspname in ('private','public') and (p.proname like '%knowledge%' or p.proname in
 ('require_active_owner','can_admin_company','actor_may_review_company','user_has_company_capability',
 'write_admin_audit','company_review_request_json','app_session_is_valid','check_app_session','transition_company_review')))
 or (n.nspname='auth' and p.proname in('uid','jwt'))
)
select encode(extensions.digest(convert_to(jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_object('schema',nspname,'name',relname,'owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'force',relforcerowsecurity) order by nspname,relname) from targets),
 'schemas',(select jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner)) order by nspname) from pg_namespace where nspname in('public','private','auth','storage','extensions')),
 'schema_acl',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by n.nspname,a.grantee::regrole::text,a.privilege_type) from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname in('public','private','auth','storage','extensions')),
 'default_acl',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'type',d.defaclobjtype,'role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by n.nspname,d.defaclobjtype,a.grantee::regrole::text,a.privilege_type) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace cross join lateral aclexplode(d.defaclacl) a where pg_get_userbyid(d.defaclrole)='postgres'),
 'columns',(select jsonb_agg(jsonb_build_object('table',t.nspname||'.'||t.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) order by t.nspname,t.relname,a.attnum) from targets t join pg_attribute a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=t.oid and d.adnum=a.attnum),
 'constraints',(select jsonb_agg(jsonb_build_object('table',t.nspname||'.'||t.relname,'name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated) order by t.nspname,t.relname,c.conname) from targets t join pg_constraint c on c.conrelid=t.oid),
 'policies',(select jsonb_agg(jsonb_build_object('table',t.nspname||'.'||t.relname,'name',p.polname,'permissive',p.polpermissive,'cmd',p.polcmd,'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(p.polroles) r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by t.nspname,t.relname,p.polname) from targets t join pg_policy p on p.polrelid=t.oid),
 'table_acl',(select jsonb_agg(jsonb_build_object('table',t.nspname||'.'||t.relname,'role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by t.nspname,t.relname,a.grantee::regrole::text,a.privilege_type) from targets t join pg_class c on c.oid=t.oid cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a),
 'column_acl',(select jsonb_agg(jsonb_build_object('table',t.nspname||'.'||t.relname,'column',c.attname,'role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by t.nspname,t.relname,c.attname,a.grantee::regrole::text,a.privilege_type) from targets t join pg_attribute c on c.attrelid=t.oid and c.attnum>0 and not c.attisdropped cross join lateral aclexplode(c.attacl) a),
 'triggers',(select jsonb_agg(jsonb_build_object('table',t.nspname||'.'||t.relname,'name',g.tgname,'enabled',g.tgenabled,'definition',pg_get_triggerdef(g.oid)) order by t.nspname,t.relname,g.tgname) from targets t join pg_trigger g on g.tgrelid=t.oid and not g.tgisinternal),
 'functions',(select jsonb_agg(jsonb_build_object('schema',f.nspname,'name',f.proname,'args',pg_get_function_identity_arguments(f.oid),'owner',pg_get_userbyid(f.proowner),'definer',f.prosecdef,'config',f.proconfig,'volatility',f.provolatile,'body',case when f.proname='transition_company_review' then null else md5(f.prosrc) end) order by f.nspname,f.proname,pg_get_function_identity_arguments(f.oid)) from funcs f),
 'function_acl',(select jsonb_agg(jsonb_build_object('schema',f.nspname,'name',f.proname,'args',pg_get_function_identity_arguments(f.oid),'role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by f.nspname,f.proname,pg_get_function_identity_arguments(f.oid),a.grantee::regrole::text,a.privilege_type) from funcs f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where f.proname<>'transition_company_review')
)::text,'UTF8'),'sha256'),'hex') into fingerprint;
 if fingerprint is distinct from 'cdb8ae52ae909fb63751029c782a2eabd967bf15f3cafd37e87cccfcad113952' then raise exception 'BASELINE_SECURITY_MISMATCH';end if;
 end $$;
do $$ begin if exists(select 1 from information_schema.columns where table_schema='public' and table_name='knowledge_sources' and column_name in ('usage_role','prepared_file_sha256','prepared_text_sha256','prepared_content_version')) or to_regclass('private.g03_company_inputs') is not null or to_regprocedure('public.g03_read_review_request(uuid)') is not null then raise exception 'ALREADY_UPGRADED_OR_PARTIAL_BASELINE';end if;
 if coalesce((select md5(prosrc) from pg_proc where oid=to_regprocedure('public.transition_company_review(text,uuid,integer,text,text,boolean,text)')),'') not in ('59ad4b24f323db4a7233f4661de0c7bc','03086efcb7e3cce72920575e21d2d99d') then raise exception 'LEGACY_WRITER_MISMATCH';end if;
 end $$;
create or replace function public.transition_company_review(p_action text,p_company_id uuid,p_expected_revision integer default null,p_number_ownership text default null,p_whatsapp_number text default null,p_readiness_confirmed boolean default null,p_owner_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_company_id is null or p_action is null or p_action not in ('submit','resubmit','approve','request_changes') then raise exception 'invalid_input' using errcode='22023';end if;
 if p_action in ('submit','resubmit') then perform private.require_active_owner(p_company_id);
 elsif auth.uid() is null or not private.actor_may_review_company(p_company_id) then raise exception 'forbidden' using errcode='42501';end if;
 return jsonb_build_object('ok',false,'code','UPGRADE_PENDING');
end; $$;
revoke all on function public.transition_company_review(text,uuid,integer,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.transition_company_review(text,uuid,integer,text,text,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;

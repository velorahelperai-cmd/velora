begin read only;
set local search_path='';
select jsonb_build_object(
 'functions',(
  select jsonb_agg(jsonb_build_object(
   'signature',p.oid::regprocedure::text,'hash',md5(replace(p.prosrc,chr(13),'')),
   'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,
   'acl',p.proacl::text,'result',pg_get_function_result(p.oid),
   'args',pg_get_function_arguments(p.oid),'language',l.lanname,'volatility',p.provolatile,
   'effective',jsonb_build_object('anon',has_function_privilege('anon',p.oid,'execute'),
    'authenticated',has_function_privilege('authenticated',p.oid,'execute'),
    'service_role',has_function_privilege('service_role',p.oid,'execute'))
  ) order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where (n.nspname in ('public','private') or (n.nspname='auth' and p.proname in ('uid','jwt','role'))) and p.prokind='f'
 ),
 'schemaHash',(
  select md5(string_agg(t::text,'|' order by t::text)) from (
   select jsonb_build_object(
    'table',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text,
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,
     'type',format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,'acl',a.attacl::text,
     'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
     from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
     where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select jsonb_agg(pg_get_constraintdef(x.oid,true) order by x.conname) from pg_constraint x where x.conrelid=c.oid),
    'indexes',(select jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),
     'valid',i.indisvalid,'ready',i.indisready) order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid=c.oid),
    'sequence',(select to_jsonb(s)-'seqrelid' from pg_sequence s where s.seqrelid=c.oid),
    'triggers',(select jsonb_agg(pg_get_triggerdef(g.oid,true)||':'||g.tgenabled::text order by g.tgname)
     from pg_trigger g where g.tgrelid=c.oid and not g.tgisinternal),
    'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'cmd',p.polcmd,
     'roles',p.polroles::text,'using',pg_get_expr(p.polqual,p.polrelid),
     'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid)
   ) t from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','private','auth') and c.relkind in ('r','p','v','m','S')
  ) z
 ),
 'triggers',(
  select jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'name',g.tgname,
   'enabled',g.tgenabled,'definition',pg_get_triggerdef(g.oid,true),'function',g.tgfoid::regprocedure::text)
   order by n.nspname,c.relname,g.tgname)
  from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not g.tgisinternal and n.nspname in ('public','private','auth')
 ),
 'roleHash',(
  select md5(string_agg(t::text,'|' order by t::text)) from (
   select jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,
    'bypass',rolbypassrls,'login',rolcanlogin,'createRole',rolcreaterole,
    'createDb',rolcreatedb,'replication',rolreplication,'configHash',md5(coalesce(rolconfig::text,'')),
    'memberships',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),
     'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option)
     order by roleid,grantor) from pg_auth_members where member=r.oid)) t from pg_roles r
  ) z
 ),
 'schemaAclHash',(
  select md5(string_agg(jsonb_build_object('schema',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text)::text,'|' order by nspname))
  from pg_namespace where nspname in ('public','private','auth')
 ),
 'securityHash',(
  select md5(string_agg(jsonb_build_object('relation',n.nspname||'.'||c.relname,
   'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
   'columnAcl',(select jsonb_agg(jsonb_build_object('column',a.attname,'acl',a.attacl::text) order by a.attnum)
    from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attacl is not null)
  )::text,'|' order by n.nspname,c.relname))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private','auth') and c.relkind in ('r','p','v','m','S')
   and n.nspname||'.'||c.relname not in (
    'private.es02_branch_knowledge_sources','private.es02_branch_website_pages',
    'private.es02_branch_reply_language_confirmations','private.es02_branch_assistant_trials',
    'private.es02_branch_launch_confirmations','private.es02_branch_trial_operations',
    'private.es02_reply_credit_holds','private.es02_operational_recipient_proofs','private.es02_initial_acceptance_receipts')
 ),
 'defaultHash',(
  select md5(coalesce(string_agg(pg_get_userbyid(defaclrole)||':'||coalesce(n.nspname,'')||':'||defaclobjtype::text||':'||defaclacl::text,
   '|' order by defaclrole,n.nspname,defaclobjtype),'')) from pg_default_acl a left join pg_namespace n on n.oid=a.defaclnamespace
 )
) as footprint;
commit;

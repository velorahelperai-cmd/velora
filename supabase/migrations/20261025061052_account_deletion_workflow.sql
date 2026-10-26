-- LOCAL CANDIDATE ONLY. Not applied to hosted Supabase by this task.
-- Unknown relations and protected dependencies fail closed; no audit/finance bypass.
begin;
set local role postgres;
create table private.ad_policy(singleton boolean primary key default true check(singleton),version integer not null default 2,preview_seconds integer not null default 300 check(preview_seconds between 30 and 900));
insert into private.ad_policy values(true,2,300);
create table private.ad_classification(target uuid primary key,is_test boolean not null,revision bigint not null default 1);
create table private.ad_events(id uuid primary key default gen_random_uuid(),actor uuid not null,target uuid not null,operation uuid,event text not null,at timestamptz not null default clock_timestamp(),details jsonb not null default '{}');
create table private.ad_operations(
 id uuid primary key default gen_random_uuid(),target uuid not null unique,actor uuid not null,request_id uuid not null unique,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,policy_version integer not null,
 fingerprint text not null,items jsonb not null,root_ids text[] not null,schema_hash text not null,expected_revisions jsonb not null default '{}',
 is_test boolean not null default false,fenced boolean not null default false,
 states jsonb not null default '{"STORAGE":"PENDING","DATABASE":"PENDING","AUTH":"PENDING","VERIFY":"PENDING"}',
 stage text,claim uuid,lease_until timestamptz,error_code text,completed_at timestamptz,
 check(stage is null or stage in('STORAGE','DATABASE','AUTH','VERIFY')));
create index ad_operations_roots on private.ad_operations using gin(root_ids);
create table private.ad_mutation_context(tx bigint primary key,operation uuid not null references private.ad_operations(id));
-- Single-transaction capability produced only by verified native source invalidation.
create table private.ad_epoch_context(tx bigint not null,operation uuid not null references private.ad_operations(id),company_id uuid not null,primary key(tx,operation,company_id));
do $$declare t text;begin foreach t in array array['ad_policy','ad_classification','ad_events','ad_operations','ad_mutation_context','ad_epoch_context'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
end loop;end$$;
create function private.ad_event_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'DELETION_RECEIPT_APPEND_ONLY' using errcode='23514';end$$;
create trigger ad_events_immutable before update or delete on private.ad_events for each row execute function private.ad_event_immutable();
create trigger ad_events_no_truncate before truncate on private.ad_events for each statement execute function private.ad_event_immutable();

create function private.ad_not_deleting(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from private.ad_operations where target=p_user and fenced);
$$;
revoke all on function private.ad_not_deleting(uuid) from public,anon;
grant execute on function private.ad_not_deleting(uuid) to authenticated;

-- Preserve existing OIDs, grants and native session semantics; add a tombstone gate.
do $wrap$declare body text;begin
 body:=pg_get_functiondef('public.app_session_is_valid()'::regprocedure);
 execute replace(body,'FUNCTION public.app_session_is_valid()', 'FUNCTION private.ad_native_session_valid()');
 if to_regprocedure('public.check_app_session(boolean)') is not null then
  body:=pg_get_functiondef('public.check_app_session(boolean)'::regprocedure);
  execute replace(body,'FUNCTION public.check_app_session(', 'FUNCTION private.ad_native_check_session(');
  execute $ddl$create or replace function public.check_app_session(p_touch boolean default false) returns jsonb language plpgsql security definer set search_path='' as $f$begin
   if not private.ad_not_deleting(auth.uid()) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
   return private.ad_native_check_session(p_touch);end$f$$ddl$;
 end if;
 if to_regprocedure('public.app_session_pre_request()') is not null then
  body:=pg_get_functiondef('public.app_session_pre_request()'::regprocedure);
  execute replace(body,'FUNCTION public.app_session_pre_request()', 'FUNCTION private.ad_native_pre_request()');
  execute $ddl$create or replace function public.app_session_pre_request() returns void language plpgsql security definer set search_path='' as $f$begin
   if auth.jwt()->>'role'='authenticated' and not private.ad_not_deleting(auth.uid()) then raise exception 'ACCOUNT_DELETING' using errcode='42501';end if;
   perform private.ad_native_pre_request();
  end$f$$ddl$;
 end if;
 if exists(select 1 from pg_roles where rolname='authenticator') and not exists(select 1 from pg_roles r cross join lateral unnest(r.rolconfig) setting where r.rolname='authenticator' and setting='pgrst.db_pre_request=public.app_session_pre_request') then raise exception 'AD_PRE_REQUEST_HOOK_UNVERIFIED';end if;
end$wrap$;
alter function private.ad_native_session_valid() owner to postgres;
revoke all on function private.ad_native_session_valid() from public,anon,authenticated,service_role;
alter function private.ad_native_check_session(boolean) owner to postgres;
revoke all on function private.ad_native_check_session(boolean) from public,anon,authenticated,service_role;
do $native_pre_request_acl$begin
 if to_regprocedure('private.ad_native_pre_request()') is not null then
  execute 'alter function private.ad_native_pre_request() owner to postgres';
  execute 'revoke all on function private.ad_native_pre_request() from public,anon,authenticated,service_role';
 end if;
end$native_pre_request_acl$;
create or replace function public.app_session_is_valid() returns boolean language sql volatile security definer set search_path='' as $$
 select private.ad_not_deleting(auth.uid()) and private.ad_native_session_valid();
$$;

-- The account-deletion session wrappers intentionally change two public function
-- bodies. Keep the Broker capability contract exact by pinning those wrappers
-- and checking the source-preserved native implementations behind them.
create function private.ad_broker_native_session_contract_matches() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from pg_catalog.pg_proc p where p.oid='private.ad_native_session_valid()'::regprocedure
  and md5(replace(p.prosrc,chr(13),''))='3e09485d3bf86bf3ab574ead6c78505d'
  and pg_catalog.pg_get_function_result(p.oid)='boolean'
  and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
  and p.proacl::text='{postgres=X/postgres}'
  and to_jsonb(p.proconfig)='["search_path=\"\""]'::jsonb
  and p.prosecdef is true and p.provolatile='v')
 and exists(select 1 from pg_catalog.pg_proc p where p.oid='private.ad_native_check_session(boolean)'::regprocedure
  and md5(replace(p.prosrc,chr(13),''))='312a1b266b86302ecd94c33adf1f50e1'
  and pg_catalog.pg_get_function_result(p.oid)='jsonb'
  and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
  and p.proacl::text='{postgres=X/postgres}'
  and to_jsonb(p.proconfig)='["search_path=\"\""]'::jsonb
  and p.prosecdef is true and p.provolatile='v')
 and exists(select 1 from pg_catalog.pg_proc p where p.oid='private.ad_native_pre_request()'::regprocedure
  and md5(replace(p.prosrc,chr(13),''))='c2046247a5357952e76bd814d7c9a5af'
  and pg_catalog.pg_get_function_result(p.oid)='void'
  and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
  and p.proacl::text='{postgres=X/postgres}'
  and to_jsonb(p.proconfig)='["search_path=\"\""]'::jsonb
  and p.prosecdef is true and p.provolatile='v')
 and exists(select 1 from pg_catalog.pg_proc p where p.oid='public.app_session_pre_request()'::regprocedure
  and md5(replace(p.prosrc,chr(13),''))='025aadc7decb77d4adb72496bf62b606'
  and pg_catalog.pg_get_function_result(p.oid)='void'
  and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
  and to_jsonb(p.proconfig)='["search_path=\"\""]'::jsonb
  and p.prosecdef is true and p.provolatile='v'
  and (select count(*) from pg_catalog.aclexplode(p.proacl))=4
  and (select string_agg(r.rolname,',' order by r.rolname) from pg_catalog.aclexplode(p.proacl) a join pg_catalog.pg_roles r on r.oid=a.grantee where a.privilege_type='EXECUTE' and not a.is_grantable)='anon,authenticated,postgres,service_role'
  and not exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=0 or a.privilege_type<>'EXECUTE' or a.is_grantable));
$$;
alter function private.ad_broker_native_session_contract_matches() owner to postgres;
revoke all on function private.ad_broker_native_session_contract_matches() from public,anon,authenticated,service_role;

do $broker_capability_extension$
declare definition text; app_body text; check_body text; old_app text:='"sig":"public.app_session_is_valid()","body":"3e09485d3bf86bf3ab574ead6c78505d"'; old_check text:='"sig":"public.check_app_session(boolean)","body":"312a1b266b86302ecd94c33adf1f50e1"';
begin
 if to_regprocedure('private.vel_broker_capability_contract_matches()') is null then
  if to_regprocedure('public.vel_broker_capability_probe()') is not null then raise exception 'AD_BROKER_CAPABILITY_CONTRACT_MISSING';end if;
  return;
 end if;
 select md5(replace(prosrc,chr(13),'')) into app_body from pg_catalog.pg_proc where oid='public.app_session_is_valid()'::regprocedure;
 select md5(replace(prosrc,chr(13),'')) into check_body from pg_catalog.pg_proc where oid='public.check_app_session(boolean)'::regprocedure;
 definition:=pg_catalog.pg_get_functiondef('private.vel_broker_capability_contract_matches()'::regprocedure);
 if position(old_app in definition)=0 or position(old_check in definition)=0 then raise exception 'AD_BROKER_CAPABILITY_CONTRACT_SOURCE_DRIFT';end if;
 definition:=replace(definition,old_app,'"sig":"public.app_session_is_valid()","body":"'||app_body||'"');
 definition:=replace(definition,old_check,'"sig":"public.check_app_session(boolean)","body":"'||check_body||'"');
 if position(' select not exists (' in definition)=0 then raise exception 'AD_BROKER_CAPABILITY_CONTRACT_SHAPE_DRIFT';end if;
 definition:=replace(definition,' select not exists (',' select private.ad_broker_native_session_contract_matches() and not exists (');
 execute definition;
end$broker_capability_extension$;

create function private.ad_authorize() returns uuid language plpgsql volatile security definer set search_path='' as $$
declare u uuid:=auth.uid();begin
 if u is null or not private.ad_not_deleting(u) or not public.app_session_is_valid()
 or not exists(select 1 from auth.sessions s where s.user_id=u and s.id::text=current_setting('request.jwt.claims',true)::jsonb->>'session_id' and (s.not_after is null or s.not_after>clock_timestamp()))
 or not exists(select 1 from public.platform_admins where user_id=u and role='owner' and status='active')
 or not exists(select 1 from auth.users where id=u and email_confirmed_at is not null)
 then raise exception 'FORBIDDEN' using errcode='42501';end if;return u;
end$$;

create function private.ad_assert_target(p_target uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if p_target='c7e6a5e5-8537-451d-b4e3-3c721f2b6eef'::uuid
 or exists(select 1 from public.platform_admins where user_id=p_target and role='owner')
 then raise exception 'PROTECTED_OWNER' using errcode='42501';end if;
end$$;

-- Coverage fingerprint includes tables/columns/FKs/policies/triggers. New schema requires review.
create function private.ad_schema_hash() returns text language sql stable security definer set search_path='' as $$
 select encode(sha256(convert_to(coalesce(string_agg(x,'|' order by x),''),'UTF8')),'hex') from (
 -- OIDs change during a legitimate dump/restore. Hash stable schema names and
 -- formatted types so restored operations can resume when the DDL is equal.
 select n.nspname||'.'||c.relname||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod) x from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped where n.nspname in('public','private','storage') and c.relkind in('r','p')
 union all select pg_get_constraintdef(oid)||':'||conrelid::regclass::text from pg_constraint where contype='f'
 union all select pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
  union all select 'trigger-function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex')
   from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where not t.tgisinternal
 union all select polname||':'||polrelid::regclass::text||':'||coalesce(pg_get_expr(polqual,polrelid),'') from pg_policy
 ) s;
$$;

-- Persist only stable IDs and hashes. Never payloads, sessions, OTPs, or credentials.
-- Exact allowlist is deliberately small. Newly encountered dependent tables block.
create function private.ad_manifest(p_target uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare ids text[]:=array[p_target::text]; shared_ids text[]:=array[]::text[]; exclusive_ids text[]:=array[]::text[];
 items jsonb:='[]'; rec record; r jsonb; key_value jsonb; pk text[]; category text; reason text; identity text; new_id text; previous integer; pass integer; hits integer:=0; table_hits integer; blocks boolean;
 allowed text[]:=array['public.profiles','public.account_prep_drafts','public.company_members','public.companies','public.company_branches','public.company_setup_drafts','public.knowledge_sources','private.app_session_activity','private.g03_company_inputs'];
begin
 perform private.ad_assert_target(p_target);
 ids:=ids||array(select id::text from auth.sessions where user_id=p_target);
 if to_regclass('auth.identities') is not null then
  for rec in execute 'select id::text id from auth.identities where user_id=$1' using p_target loop
   ids:=array_append(ids,rec.id);
   items:=items||jsonb_build_array(jsonb_build_object('identity','auth.identities:'||rec.id,'relation','auth.identities','key',jsonb_build_object('id',rec.id),'revision',rec.id,'category','delete','reason','MANAGED_AUTH_API'));
  end loop;
 end if;
 -- Unreviewed application FKs into managed Auth descendants/alternate keys cannot
 -- be hidden behind an Auth API cascade. They require a relation-policy review.
 for rec in select fk.oid,fk.conrelid::regclass::text child,pg_get_constraintdef(fk.oid) definition from pg_constraint fk join pg_class parent on parent.oid=fk.confrelid join pg_namespace pn on pn.oid=parent.relnamespace join pg_class child on child.oid=fk.conrelid join pg_namespace cn on cn.oid=child.relnamespace where fk.contype='f' and pn.nspname='auth' and cn.nspname not in('auth') and cn.nspname<>'pg_catalog' and (cn.nspname not in('public','private','storage') or parent.relname not in('users','sessions','identities') or cardinality(fk.confkey)<>1 or not exists(select 1 from pg_attribute a where a.attrelid=parent.oid and a.attnum=fk.confkey[1] and a.attname='id')) loop
  items:=items||jsonb_build_array(jsonb_build_object('identity','catalog.auth_fk:'||rec.oid::text,'relation',rec.child,'key',jsonb_build_object('constraint_oid',rec.oid),'revision',encode(sha256(convert_to(rec.definition,'UTF8')),'hex'),'category','blocker','reason','UNREVIEWED_AUTH_DEPENDENCY_SCHEMA'));
 end loop;
 for rec in select c.id,c.created_by,exists(select 1 from public.company_members m where m.company_id=c.id and m.user_id=p_target and m.role='owner') owns,
 exists(select 1 from public.company_members m where m.company_id=c.id and m.user_id<>p_target) other_members
 from public.companies c where c.created_by=p_target or exists(select 1 from public.company_members m where m.company_id=c.id and m.user_id=p_target)
 loop
  if rec.owns and not rec.other_members and rec.created_by=p_target then exclusive_ids:=array_append(exclusive_ids,rec.id::text);
  else shared_ids:=array_append(shared_ids,rec.id::text);end if;
 end loop;
 ids:=ids||exclusive_ids;
 ids:=ids||array(select o.id::text from storage.objects o where o.owner_id=p_target::text or to_jsonb(o)->>'owner'=p_target::text or split_part(o.name,'/',1)=any(exclusive_ids) or exists(select 1 from public.knowledge_sources k where k.storage_path=o.name and k.company_id::text=any(exclusive_ids)));
 ids:=ids||array(select o.name from storage.objects o where o.owner_id=p_target::text or to_jsonb(o)->>'owner'=p_target::text or split_part(o.name,'/',1)=any(exclusive_ids) or exists(select 1 from public.knowledge_sources k where k.storage_path=o.name and k.company_id::text=any(exclusive_ids)));
 for pass in 1..24 loop
 previous:=cardinality(ids);
 for rec in select n.nspname,c.relname,c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind='r' and c.relname not like 'ad\_%' escape '\' order by n.nspname,c.relname loop
  table_hits:=0;
  select array_agg(a.attname order by u.ord) into pk from pg_index ix cross join lateral unnest(ix.indkey) with ordinality u(num,ord) join pg_attribute a on a.attrelid=ix.indrelid and a.attnum=u.num where ix.indrelid=rec.oid and ix.indisprimary;
  -- UUID-valued scalars include logical links without FK. Opaque blobs are never copied.
  for r in execute format('select to_jsonb(t) from %I.%I t where exists(select 1 from jsonb_path_query(to_jsonb(t),%L) e(value) where e.value#>>''{}''=any($1)) limit 5001',rec.nspname,rec.relname,'$.** ? (@.type() == "string")') using ids||shared_ids loop
   table_hits:=table_hits+1;if table_hits>5000 then raise exception 'SCOPE_TOO_LARGE';end if;
   hits:=hits+1;if hits>50000 then raise exception 'SCOPE_TOO_LARGE';end if;
   select coalesce(jsonb_object_agg(e.key,e.value),'{}') into key_value from jsonb_each(r) e where e.key=any(pk);
   if pk is null or exists(select 1 from unnest(pk) k where k !~ '(^id$|_id$)' or coalesce(r->>k,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    key_value:=jsonb_build_object('unsupported_key',encode(sha256(convert_to(r::text,'UTF8')),'hex'));
   end if;
   identity:=rec.nspname||'.'||rec.relname||':'||key_value::text;
   if exists(select 1 from jsonb_array_elements(items) x where x->>'identity'=identity) then continue;end if;
   category:='blocker';reason:='UNCLASSIFIED_RELATION';
   if rec.nspname||'.'||rec.relname=any(allowed) and not(key_value?'unsupported_key') then category:='delete';reason:='EXCLUSIVE_ELIGIBLE';end if;
   if category='delete' then
    if rec.relname in('profiles','company_members','app_session_activity') and r->>'user_id' is distinct from p_target::text then category:='shared';reason:='OTHER_ACCOUNT';end if;
    if rec.relname='account_prep_drafts' and r->>'account_id' is distinct from p_target::text then category:='shared';reason:='OTHER_ACCOUNT';end if;
    if rec.relname in('company_branches','company_setup_drafts','knowledge_sources','g03_company_inputs') and not coalesce(r->>'company_id'=any(exclusive_ids),false) then category:='shared';reason:='EXCLUSIVE_OWNERSHIP_UNPROVEN';end if;
    if rec.relname='companies' and not coalesce(r->>'id'=any(exclusive_ids),false) then category:='shared';reason:='EXCLUSIVE_OWNERSHIP_UNPROVEN';end if;
    if category='delete' and exists(select 1 from jsonb_each_text(r) e where e.key in('user_id','account_id','actor_user_id','created_by','owner_id') and e.value is not null and e.value<>p_target::text) then category:='blocker';reason:='OTHER_ACCOUNT_DEPENDENCY';end if;
   end if;
   if rec.relname~* '(audit|ledger|billing|payment|invoice|dispute|legal|hold|receipt|entitlement)' or rec.nspname||'.'||rec.relname='private.g03_review_checks' then category:='protected';reason:='RETENTION_DEPENDENCY';end if;
   if rec.relname='platform_admins' then category:='blocker';reason:='PLATFORM_ROLE_REQUIRES_REVIEW';end if;
   if category in('delete','shared') and (r->>'company_id'=any(shared_ids) or (rec.relname='companies' and r->>'id'=any(shared_ids))) and rec.relname<>'company_members' then category:='shared';reason:='SHARED_BUSINESS';end if;
   if category='shared' and exists(select 1 from pg_constraint fk cross join lateral unnest(fk.conkey) k join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k where fk.contype='f' and fk.conrelid=rec.oid and fk.confrelid='auth.users'::regclass and r->>a.attname=p_target::text) then category:='blocker';reason:='SHARED_AUTH_DEPENDENCY_REQUIRES_REVIEW';end if;
   if category='shared' and exists(select 1 from pg_constraint fk cross join lateral unnest(fk.conkey) k join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k where fk.contype='f' and fk.conrelid=rec.oid and r->>a.attname=any(ids)) then category:='blocker';reason:='SHARED_DEPENDENCY_REQUIRES_REVIEW';end if;
   if rec.relname='company_members' and r->>'user_id'<>p_target::text then category:='shared';reason:='OTHER_MEMBER';end if;
   if rec.relname='companies' and r->>'id'=any(shared_ids) and r->>'created_by'=p_target::text then category:='blocker';reason:='SHARED_OWNERSHIP_TRANSFER_REQUIRED';end if;
   blocks:=category='blocker' or (category='protected' and (exists(select 1 from jsonb_path_query(r,'$.** ? (@.type() == "string")') e(value) where e.value#>>'{}'=any(ids))));
   items:=items||jsonb_build_array(jsonb_build_object('identity',identity,'relation',rec.nspname||'.'||rec.relname,'key',key_value,'revision',encode(sha256(convert_to(r::text,'UTF8')),'hex'),'category',category,'reason',reason,'blocks',blocks));
   if category='delete' then
    new_id:=r->>'id';if new_id is not null and not(new_id=any(ids)) then ids:=array_append(ids,new_id);end if;
   end if;
  end loop;
 end loop;
 exit when previous=cardinality(ids);
 if pass=24 then raise exception 'DEPENDENCY_DEPTH_UNRESOLVED';end if;
 end loop;
 -- Auth managed descendants: only managed API can delete these; no SQL DML here.
 items:=items||jsonb_build_array(jsonb_build_object('identity','auth.users:'||p_target::text,'relation','auth.users','key',jsonb_build_object('id',p_target),'revision',(select encode(sha256(convert_to(jsonb_build_object('id',id,'email',email,'confirmed',email_confirmed_at)::text,'UTF8')),'hex') from auth.users where id=p_target),'category','delete','reason','MANAGED_AUTH_API'));
 for rec in select id,user_id,encode(sha256(convert_to(jsonb_build_object('id',id,'not_after',to_jsonb(s)->'not_after','refreshed_at',to_jsonb(s)->'refreshed_at')::text,'UTF8')),'hex') revision from auth.sessions s where user_id=p_target loop
  items:=items||jsonb_build_array(jsonb_build_object('identity','auth.sessions:'||rec.id::text,'relation','auth.sessions','key',jsonb_build_object('id',rec.id),'revision',rec.revision,'category','delete','reason','MANAGED_AUTH_API'));
 end loop;
 for rec in select o.id,o.bucket_id,o.name,o.version,coalesce(nullif(o.owner_id,''),to_jsonb(o)->>'owner') object_owner from storage.objects o where o.owner_id=p_target::text or to_jsonb(o)->>'owner'=p_target::text or split_part(o.name,'/',1)=any(exclusive_ids) or exists(select 1 from public.knowledge_sources k where k.storage_path=o.name and k.company_id::text=any(exclusive_ids)) loop
  category:='blocker';reason:='STORAGE_OWNERSHIP_UNPROVEN';
  if exists(select 1 from public.knowledge_sources k where k.storage_path=rec.name and k.company_id::text=any(exclusive_ids))
   and not exists(select 1 from public.knowledge_sources k where k.storage_path=rec.name and not(k.company_id::text=any(exclusive_ids))) and rec.bucket_id='company-knowledge'
   then category:='delete';reason:='EXCLUSIVE_STORAGE_API';end if;
  if rec.version is null then category:='blocker';reason:='STORAGE_GENERATION_UNAVAILABLE';end if;
  if rec.object_owner is not null and rec.object_owner<>p_target::text then category:='blocker';reason:='OTHER_ACCOUNT_DEPENDENCY';end if;
  items:=items||jsonb_build_array(jsonb_build_object('identity','storage.objects:'||rec.id::text,'relation','storage.objects','key',jsonb_build_object('id',rec.id),'revision',rec.version,'bucket',rec.bucket_id,'path',rec.name,'category',category,'reason',reason));
 end loop;
 select coalesce(jsonb_agg(x order by x->>'identity'),'[]') into items from jsonb_array_elements(items) x;
 return jsonb_build_object('items',items,'roots',(select jsonb_agg(case when v~'^[0-9a-f-]{36}$|^[0-9]+$' then v else 'sha256:'||encode(sha256(convert_to(v,'UTF8')),'hex') end) from unnest(ids) v),'schema',private.ad_schema_hash());
end$$;

create function private.ad_receipt(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'target',target,'actor',actor,'createdAt',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expiresAt',to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'policyVersion',policy_version,'policyMode',case when is_test then 'TEST_CLEANUP' else 'CUSTOMER_ERASURE' end,'fingerprint',fingerprint,'items',(select jsonb_agg(i.value-'path'-'bucket') from jsonb_array_elements(items) i(value)),'isTest',is_test,'fenced',fenced,'states',states,'stage',stage,'leaseUntil',to_char(lease_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'error',error_code,'completedAt',to_char(completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'backupNotice','Active-data scope only; backup expiry and restore reconciliation are separate, unverified controls.') from private.ad_operations where id=p_id;
$$;

create function public.account_deletion_command(p_action text,p_input jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor_id uuid:=private.ad_authorize(); target_id uuid; op private.ad_operations; manifest jsonb; fp text; diff jsonb; pol private.ad_policy; next_stage text; token uuid; old_test boolean; root_id text;
begin
 if p_action='authorize' then return jsonb_build_object('actor',actor_id,'session',(current_setting('request.jwt.claims',true)::jsonb->>'session_id'));end if;
 if p_action in('preview','classify','lookup') then target_id:=(p_input->>'target')::uuid;
 else select target into target_id from private.ad_operations where id=(p_input->>'id')::uuid;end if;
 if target_id is null then raise exception 'NOT_FOUND';end if;
 if p_input?'target' and (p_input->>'target')::uuid<>target_id then raise exception 'CONFIRMATION_MISMATCH';end if;
 perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||target_id::text,0));
 perform private.ad_assert_target(target_id);
 select * into op from private.ad_operations where target=target_id for update;
 if op.id is not null and op.actor<>actor_id then raise exception 'OPERATION_ACTOR_MISMATCH';end if;
 if op.stage is not null and op.states->>op.stage='RUNNING' and op.lease_until<=clock_timestamp() then
  update private.ad_operations set states=jsonb_set(states,array[stage],'"UNKNOWN"'),error_code='WORKER_LEASE_EXPIRED',claim=null,lease_until=null where id=op.id returning * into op;
  insert into private.ad_events(actor,target,operation,event,details) values(actor_id,target_id,op.id,'LEASE_EXPIRED',jsonb_build_object('stage',op.stage));
 end if;
 if p_action='classify' then
  if op.fenced then raise exception 'ACCOUNT_DELETING';end if;
  select is_test into old_test from private.ad_classification where target=target_id;
  insert into private.ad_classification(target,is_test) values(target_id,(p_input->>'isTest')::boolean) on conflict(target) do update set is_test=excluded.is_test,revision=private.ad_classification.revision+1;
  insert into private.ad_events(actor,target,event,details) values(actor_id,target_id,'TEST_CLASSIFICATION',jsonb_build_object('before',old_test,'after',(p_input->>'isTest')::boolean));
  return jsonb_build_object('ok',true);
 end if;
 if p_action='lookup' then return private.ad_receipt(op.id);end if;
 if p_action='preview' then
  if op.id is not null then return private.ad_receipt(op.id);end if;
  if not exists(select 1 from auth.users where id=target_id) then raise exception 'NOT_FOUND';end if;
  select * into pol from private.ad_policy where singleton;
  manifest:=private.ad_manifest(target_id);
  fp:=encode(sha256(convert_to(jsonb_build_object('actor',actor_id,'target',target_id,'policy',to_jsonb(pol),'classification',(select to_jsonb(c) from private.ad_classification c where target=target_id),'manifest',manifest)::text,'UTF8')),'hex');
  insert into private.ad_operations(target,actor,request_id,expires_at,policy_version,fingerprint,items,root_ids,schema_hash,is_test)
  values(target_id,actor_id,coalesce((p_input->>'requestId')::uuid,gen_random_uuid()),clock_timestamp()+make_interval(secs=>pol.preview_seconds),pol.version,fp,manifest->'items',array(select jsonb_array_elements_text(manifest->'roots')),manifest->>'schema',coalesce((select is_test from private.ad_classification where target=target_id),false)) returning * into op;
  insert into private.ad_events(actor,target,operation,event) values(actor_id,target_id,op.id,'PREVIEW');
  return private.ad_receipt(op.id);
 end if;
 if op.id is null then raise exception 'NOT_FOUND';end if;
 if p_action='status' then return private.ad_receipt(op.id);end if;
 if p_action in('start','renew') then
  if op.fenced then return private.ad_receipt(op.id);end if;
  perform set_config('lock_timeout','3s',true);
  for root_id in select distinct v from unnest(op.root_ids) v where v~'^[0-9a-f-]{36}$' order by v loop
   perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||root_id,0));
  end loop;
  select * into pol from private.ad_policy where singleton;
  manifest:=private.ad_manifest(target_id);
  fp:=encode(sha256(convert_to(jsonb_build_object('actor',actor_id,'target',target_id,'policy',to_jsonb(pol),'classification',(select to_jsonb(c) from private.ad_classification c where target=target_id),'manifest',manifest)::text,'UTF8')),'hex');
  if fp<>op.fingerprint or p_action='renew' then
   select coalesce(jsonb_agg(jsonb_build_object('identity',coalesce(a.x->>'identity',b.x->>'identity'),'before',a.x,'after',b.x)),'[]') into diff from jsonb_array_elements(op.items) a(x) full join jsonb_array_elements(manifest->'items') b(x) on a.x->>'identity'=b.x->>'identity' where a.x is distinct from b.x;
   update private.ad_operations set items=manifest->'items',root_ids=array(select jsonb_array_elements_text(manifest->'roots')),schema_hash=manifest->>'schema',fingerprint=fp,policy_version=pol.version,is_test=coalesce((select is_test from private.ad_classification where target=target_id),false),expires_at=clock_timestamp()+make_interval(secs=>pol.preview_seconds) where id=op.id;
   return jsonb_build_object('code',case when fp<>op.fingerprint then 'SCOPE_CHANGED' else 'RENEWED' end,'diff',diff,'receipt',private.ad_receipt(op.id));
  end if;
  if op.expires_at<=clock_timestamp() then return jsonb_build_object('code','PREVIEW_EXPIRED');end if;
  if p_input->>'fingerprint' is distinct from op.fingerprint then raise exception 'CONFIRMATION_MISMATCH';end if;
  if exists(select 1 from jsonb_array_elements(op.items) x where x->>'category'='blocker' or x->>'blocks'='true') then raise exception 'PROTECTED_DEPENDENCY';end if;
  update private.ad_operations set fenced=true where id=op.id;
  insert into private.ad_events(actor,target,operation,event) values(actor_id,target_id,op.id,'CONFIRMED');
  return private.ad_receipt(op.id);
 end if;
 if p_action='claim' then
  if not op.fenced or op.completed_at is not null then return null;end if;
  if op.schema_hash<>private.ad_schema_hash() then raise exception 'SCHEMA_CHANGED_REVIEW_REQUIRED';end if;
  if op.lease_until>clock_timestamp() then return null;end if;
  select x into next_stage from unnest(array['STORAGE','DATABASE','AUTH','VERIFY']) with ordinality s(x,n) where op.states->>x<>'SUCCEEDED' order by n limit 1;
  token:=gen_random_uuid();
  update private.ad_operations set stage=next_stage,claim=token,lease_until=clock_timestamp()+interval '90 seconds',states=jsonb_set(states,array[next_stage],'"RUNNING"') where id=op.id;
  return jsonb_build_object('stage',next_stage,'state',case when op.states->>next_stage='RUNNING' then 'UNKNOWN' else op.states->>next_stage end,'claim',token,'target',target_id,'objects',(select coalesce(jsonb_agg(jsonb_build_object('bucket',x->>'bucket','path',x->>'path','version',x->>'revision')),'[]') from jsonb_array_elements(op.items) x where x->>'relation'='storage.objects' and x->>'category'='delete'));
 end if;
 raise exception 'INVALID_ACTION';
end$$;

-- Every existing application table gets an additive fence; existing guards stay enabled.
create function private.ad_source_invalidation_allowed(before_row jsonb,after_row jsonb,operation private.ad_operations) returns boolean language sql volatile security definer set search_path='' as $$
 select pg_trigger_depth()>1 and operation.stage='STORAGE' and operation.states->>'STORAGE'='RUNNING' and operation.lease_until>clock_timestamp()
 and after_row->>'content'='' and after_row->>'status'='failed' and after_row->>'failure_code'='extract_failed' and after_row->>'storage_path' is null
 and before_row-array['content','status','failure_code','storage_path','content_version','approved_for_answers','approved_version','approved_at','approved_by','updated_at','prepared_file_sha256','prepared_text_sha256','prepared_content_version'] = after_row-array['content','status','failure_code','storage_path','content_version','approved_for_answers','approved_version','approved_at','approved_by','updated_at','prepared_file_sha256','prepared_text_sha256','prepared_content_version']
 and exists(select 1 from jsonb_array_elements(operation.items) i where i->>'relation'='public.knowledge_sources' and i->>'category'='delete' and i->'key'->>'id'=before_row->>'id')
 and exists(select 1 from jsonb_array_elements(operation.items) i where i->>'relation'='storage.objects' and i->>'category'='delete' and i->>'bucket'='company-knowledge' and i->>'path'=before_row->>'storage_path' and not exists(select 1 from storage.objects o where o.id::text=i->'key'->>'id'));
$$;
-- Permit only the native epoch upsert, inside a leased destructive stage.
-- No client GUC, direct grant, blanket trigger exception or review-record mutation.
create function private.ad_g03_epoch_allowed(before_row jsonb,after_row jsonb,operation private.ad_operations) returns boolean language sql volatile security definer set search_path='' as $$
 select pg_trigger_depth()>1 and operation.lease_until>clock_timestamp()
 and after_row-array['company_id','input_epoch']='{}'::jsonb
 and case when before_row is null then after_row->>'input_epoch'='1'
   else before_row-array['company_id','input_epoch']='{}'::jsonb and before_row->>'company_id'=after_row->>'company_id' and (after_row->>'input_epoch')::bigint=(before_row->>'input_epoch')::bigint+1 end
 and exists(select 1 from jsonb_array_elements(operation.items) i where i->>'relation'='private.g03_company_inputs' and i->>'category'='delete' and i->'key'->>'company_id'=after_row->>'company_id')
 and ((operation.stage='DATABASE' and operation.states->>'DATABASE'='RUNNING' and exists(select 1 from private.ad_mutation_context c where c.tx=txid_current() and c.operation=operation.id))
 or (operation.stage='STORAGE' and operation.states->>'STORAGE'='RUNNING' and exists(select 1 from private.ad_epoch_context c where c.tx=txid_current() and c.operation=operation.id and c.company_id::text=after_row->>'company_id')));
$$;
create function private.ad_record_epoch_invalidation() returns trigger language plpgsql security definer set search_path='' as $$
declare operation private.ad_operations; identity text;begin
 for operation in select * from private.ad_operations a where a.fenced and a.stage='STORAGE' and a.root_ids @> array[to_jsonb(new)->>'company_id'] loop
  if private.ad_g03_epoch_allowed(to_jsonb(old),to_jsonb(new),operation) then
   select i->>'identity' into identity from jsonb_array_elements(operation.items) i where i->>'relation'='private.g03_company_inputs' and i->'key'->>'company_id'=to_jsonb(new)->>'company_id';
   update private.ad_operations set expected_revisions=jsonb_set(expected_revisions,array[identity],to_jsonb(encode(sha256(convert_to(to_jsonb(new)::text,'UTF8')),'hex'))) where id=operation.id;
   delete from private.ad_epoch_context c where c.tx=txid_current() and c.operation=operation.id and c.company_id::text=to_jsonb(new)->>'company_id';
  end if;
 end loop;return new;
end$$;
do $$begin if to_regclass('private.g03_company_inputs') is not null then
 execute 'create trigger ad_epoch_invalidation_checkpoint after update on private.g03_company_inputs for each row execute function private.ad_record_epoch_invalidation()';
end if;end$$;
create function private.ad_record_source_invalidation() returns trigger language plpgsql security definer set search_path='' as $$
declare operation private.ad_operations; identity text;begin
 for operation in select * from private.ad_operations a where a.fenced and a.stage='STORAGE' and a.root_ids @> array[to_jsonb(new)->>'id'] loop
  if private.ad_source_invalidation_allowed(to_jsonb(old),to_jsonb(new),operation) and coalesce((to_jsonb(new)->>'approved_for_answers')::boolean,false)=false then
   select i->>'identity' into identity from jsonb_array_elements(operation.items) i where i->>'relation'='public.knowledge_sources' and i->'key'->>'id'=to_jsonb(new)->>'id';
   update private.ad_operations set expected_revisions=jsonb_set(expected_revisions,array[identity],to_jsonb(encode(sha256(convert_to(to_jsonb(new)::text,'UTF8')),'hex'))) where id=operation.id;
   insert into private.ad_events(actor,target,operation,event,details) values(operation.actor,operation.target,operation.id,'STORAGE_INVALIDATION',jsonb_build_object('source_id',to_jsonb(new)->>'id'));
   if exists(select 1 from jsonb_array_elements(operation.items) i where i->>'relation'='private.g03_company_inputs' and i->>'category'='delete' and i->'key'->>'company_id'=to_jsonb(new)->>'company_id') then
    insert into private.ad_epoch_context values(txid_current(),operation.id,(to_jsonb(new)->>'company_id')::uuid) on conflict do nothing;
   end if;
  end if;
 end loop;return new;
end$$;
create trigger ad_source_invalidation_checkpoint after update on public.knowledge_sources for each row execute function private.ad_record_source_invalidation();
create function private.ad_write_fence() returns trigger language plpgsql security definer set search_path='' as $$
declare op private.ad_operations; doc jsonb; matched boolean; root_id text; refs text[];begin
 doc:=case when tg_op='DELETE' then to_jsonb(old) when tg_op='UPDATE' then to_jsonb(old)||jsonb_build_object('_new',to_jsonb(new)) else to_jsonb(new) end;
 -- A DB phase may delete ONLY its listed row identities, including cascades.
 -- This catches even an opaque/legacy FK not expressible by the discovery registry.
 if tg_op='DELETE' and exists(select 1 from private.ad_mutation_context where tx=txid_current()) then
  if exists(select 1 from private.ad_mutation_context ctx join private.ad_operations a on a.id=ctx.operation cross join lateral jsonb_array_elements(a.items) i where ctx.tx=txid_current() and i->>'relation'=tg_table_schema||'.'||tg_table_name and i->>'category'='delete' and doc @> (i->'key')) then return old;end if;
  raise exception 'PROTECTED_RELATION_REQUIRES_REVIEW' using errcode='23514';
 end if;
 -- Even a transaction predating preview creation participates in the cutover.
 -- Lock only UUIDs on its row; no global platform lock.
 for root_id in select distinct e.value from jsonb_each_text(case when tg_op='UPDATE' then to_jsonb(old) else doc end) e where e.value~'^[0-9a-f-]{36}$'
 union select e.value from jsonb_each_text(case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end) e where e.value~'^[0-9a-f-]{36}$' order by 1 loop
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||root_id,0));
 end loop;
 select array_agg(v#>>'{}') into refs from jsonb_path_query(doc,'$.** ? (@.type() == "string")') v;
 refs:=coalesce(refs,array[]::text[])||array(select m[1] from unnest(refs) v cross join lateral regexp_matches(v,'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})','g') m)||array(select 'sha256:'||encode(sha256(convert_to(v,'UTF8')),'hex') from unnest(refs) v);
 for op in select * from private.ad_operations a where a.target=auth.uid() or a.root_ids&&refs or a.target in(select s.user_id from auth.sessions s where s.id=any(array(select v::uuid from unnest(refs) v where v~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))) loop
  matched:=coalesce(auth.uid()=op.target,false) or op.root_ids&&refs or exists(select 1 from auth.sessions s where s.user_id=op.target and s.id::text=any(refs));
  if not matched then continue;end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||op.target::text,0));
  if not exists(select 1 from private.ad_operations where id=op.id and fenced) then continue;end if;
  if tg_op='UPDATE' and tg_table_schema='public' and tg_table_name='knowledge_sources' and private.ad_source_invalidation_allowed(to_jsonb(old),to_jsonb(new),op) then return new;end if;
  if tg_op in('INSERT','UPDATE') and tg_table_schema='private' and tg_table_name='g03_company_inputs' and private.ad_g03_epoch_allowed(case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),op) then return new;end if;
  if tg_op='DELETE' and tg_table_schema='storage' and op.stage='STORAGE' and op.states->>'STORAGE'='RUNNING' and op.lease_until>clock_timestamp()
   and exists(select 1 from jsonb_array_elements(op.items) x where x->>'relation'='storage.objects' and x->'key'->>'id'=to_jsonb(old)->>'id' and x->>'category'='delete' and x->>'revision'=to_jsonb(old)->>'version') then return old;end if;
  raise exception 'ACCOUNT_DELETING:%:%:stage=%:lease_valid=%',tg_table_schema||'.'||tg_table_name,tg_op,coalesce(op.stage,'NONE'),coalesce(op.lease_until>clock_timestamp(),false) using errcode='42501';
 end loop;
 return case when tg_op='DELETE' then old else new end;
end$$;
do $$declare r record;begin
 for r in select c.oid,n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','storage') and c.relkind='r' and c.relname not like 'ad\_%' escape '\' loop
  -- Native Storage owns its prefix/multipart housekeeping. Fence the actual object
  -- admission/replacement, not API-internal empty-prefix garbage collection.
  if r.nspname<>'storage' or r.relname='objects' then
   execute format('create trigger ad_account_write_fence before insert or update or delete on %I.%I for each row execute function private.ad_write_fence()',r.nspname,r.relname);
  end if;
  if r.nspname in('public','storage') then
   execute format('create policy ad_account_access_fence on %I.%I as restrictive for all to authenticated using(private.ad_not_deleting((select auth.uid()))) with check(private.ad_not_deleting((select auth.uid())))',r.nspname,r.relname);
  end if;
 end loop;
end$$;

-- Server-only phase mutator. It re-enters the existing native session gate with the
-- freshly authenticated caller's IDs; service credentials never reach the client.
create function public.account_deletion_worker(p_actor uuid,p_session uuid,p_id uuid,p_claim uuid,p_action text,p_outcome text default null,p_code text default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare op private.ad_operations; original_claims text:=current_setting('request.jwt.claims',true); x jsonb; cnt bigint; remaining integer; progress integer; relation_name text; predicate text; manifest jsonb; proof jsonb;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'session_id',p_session,'role','authenticated')::text,true);
 perform private.ad_authorize();
 select * into op from private.ad_operations where id=p_id for update;
 if op.id is null or op.actor<>p_actor then raise exception 'FORBIDDEN';end if;
 perform private.ad_assert_target(op.target);
 if not op.fenced or op.claim is distinct from p_claim or op.lease_until<=clock_timestamp() or op.states->>op.stage<>'RUNNING' then raise exception 'STALE_CLAIM';end if;
 if op.schema_hash<>private.ad_schema_hash() then raise exception 'SCHEMA_CHANGED_REVIEW_REQUIRED';end if;
 if p_action='permit' then
  if op.lease_until<clock_timestamp()+interval '25 seconds' then raise exception 'STALE_CLAIM';end if;
  return jsonb_build_object('ok',true);
 elsif p_action='inspect' then
  if op.stage='STORAGE' then
   for x in select value from jsonb_array_elements(op.items) where value->>'relation'='storage.objects' and value->>'category'='delete' loop
    if exists(select 1 from storage.objects o where o.bucket_id=x->>'bucket' and o.name=x->>'path' and not exists(select 1 from jsonb_array_elements(op.items) approved where approved->>'relation'='storage.objects' and approved->>'category'='delete' and approved->'key'->>'id'=o.id::text and approved->>'revision'=o.version)) then return jsonb_build_object('effect','CHANGED');end if;
   end loop;
  end if;
  cnt:=0;
  for x in select value from jsonb_array_elements(op.items) where value->>'category'='delete' and
   ((op.stage='STORAGE' and value->>'relation'='storage.objects') or (op.stage='DATABASE' and value->>'relation' not in('auth.users','auth.sessions','auth.identities','storage.objects'))) loop
   select string_agg(format('to_jsonb(t)->>%L=%L',key,value),' and ') into predicate from jsonb_each_text(x->'key');
   execute format('select count(*) from %s t where %s',x->>'relation',predicate) into remaining;cnt:=cnt+remaining;
  end loop;
  return jsonb_build_object('effect',case when cnt=0 then 'ABSENT' else 'PRESENT' end,'presentObjects',case when op.stage='STORAGE' then
   (select coalesce(jsonb_agg(jsonb_build_object('bucket',entry.item->>'bucket','path',entry.item->>'path','version',entry.item->>'revision')),'[]') from jsonb_array_elements(op.items) entry(item) join storage.objects so on so.id::text=entry.item->'key'->>'id' where entry.item->>'relation'='storage.objects' and entry.item->>'category'='delete') else '[]'::jsonb end);
 elsif p_action='database' then
  if op.stage<>'DATABASE' then raise exception 'WRONG_STAGE';end if;
  -- A new/unfenced dependency cannot silently extend the confirmed scope.
  manifest:=private.ad_manifest(op.target);
  if exists(select 1 from jsonb_array_elements(manifest->'items') m where m->>'relation' not in('auth.users','auth.sessions','auth.identities','storage.objects') and not exists(select 1 from jsonb_array_elements(op.items) i where i-'revision'=m-'revision' and m->>'revision'=coalesce(op.expected_revisions->>(i->>'identity'),i->>'revision'))) then raise exception 'SCOPE_CHANGED';end if;
  insert into private.ad_mutation_context values(txid_current(),op.id);
  remaining:=1;
  for pass in 1..32 loop
   progress:=0;remaining:=0;
   for x in select value from jsonb_array_elements(op.items) where value->>'category'='delete' and value->>'relation' not in('auth.users','auth.sessions','auth.identities','storage.objects','private.g03_company_inputs') loop
    relation_name:=x->>'relation';
    select string_agg(format('to_jsonb(t)->>%L=%L',key,value),' and ') into predicate from jsonb_each_text(x->'key');
    begin
     execute format('delete from %s t where %s',relation_name,predicate);get diagnostics cnt=row_count;progress:=progress+cnt;
    exception when foreign_key_violation then remaining:=remaining+1;
    end;
   end loop;
   exit when remaining=0;
   if progress=0 then raise exception 'PROTECTED_RELATION_REQUIRES_REVIEW';end if;
  end loop;
  if remaining<>0 then raise exception 'DEPENDENCY_DEPTH_UNRESOLVED';end if;
  -- Native member/knowledge deletion can bump this counter. Remove it last;
  -- normally the exclusive company's unchanged FK cascade already removed it.
  for x in select value from jsonb_array_elements(op.items) where value->>'category'='delete' and value->>'relation'='private.g03_company_inputs' loop
   execute 'delete from private.g03_company_inputs where company_id=$1' using (x->'key'->>'company_id')::uuid;
  end loop;
  delete from private.ad_mutation_context where tx=txid_current();
 elsif p_action='verify' then
  if op.stage<>'VERIFY' then raise exception 'WRONG_STAGE';end if;
  if exists(select 1 from auth.users where id=op.target) then return jsonb_build_object('absent',false);end if;
  for x in select value from jsonb_array_elements(op.items) where value->>'category'='delete' and value->>'relation'<>'auth.users' loop
   select string_agg(format('to_jsonb(t)->>%L=%L',key,value),' and ') into predicate from jsonb_each_text(x->'key');
   execute format('select count(*) from %s t where %s',x->>'relation',predicate) into cnt;
   if cnt<>0 then return jsonb_build_object('absent',false);end if;
  end loop;
  return jsonb_build_object('absent',true);
 elsif p_action='finish' then
  if p_outcome not in('SUCCEEDED','FAILED','UNKNOWN') or (p_code is not null and p_code not in('EFFECT_UNCONFIRMED','SCOPE_CHANGED','PROTECTED_RELATION_REQUIRES_REVIEW','PROVIDER_REJECTED')) then raise exception 'INVALID_OUTCOME';end if;
  if p_outcome='SUCCEEDED' then
   if op.stage='AUTH' then
    if exists(select 1 from auth.users where id=op.target) then raise exception 'EFFECT_NOT_VERIFIED';end if;
   else
    proof:=public.account_deletion_worker(p_actor,p_session,p_id,p_claim,case when op.stage='VERIFY' then 'verify' else 'inspect' end,null,null);
    if (op.stage='VERIFY' and proof->>'absent'<>'true') or (op.stage<>'VERIFY' and proof->>'effect'<>'ABSENT') then raise exception 'EFFECT_NOT_VERIFIED';end if;
   end if;
  end if;
  update private.ad_operations set states=jsonb_set(states,array[stage],to_jsonb(p_outcome)),error_code=p_code,lease_until=null,completed_at=case when stage='VERIFY' and p_outcome='SUCCEEDED' then clock_timestamp() else null end,
   items=case when stage='VERIFY' and p_outcome='SUCCEEDED' then (select jsonb_agg(clean.item-'path'-'bucket') from jsonb_array_elements(items) clean(item)) else items end where id=op.id;
  insert into private.ad_events(actor,target,operation,event,details) values(p_actor,op.target,op.id,'PHASE_RESULT',jsonb_build_object('stage',op.stage,'outcome',p_outcome,'code',p_code));
 else raise exception 'INVALID_WORKER_ACTION';end if;
 perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
 return jsonb_build_object('ok',true);
end$$;

-- No default PUBLIC EXECUTE, and no direct client table access.
do $$declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'ad\_%' escape '\' and p.proname<>'ad_not_deleting' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);end loop;
end$$;
revoke all on function public.account_deletion_command(text,jsonb) from public,anon,service_role;
grant execute on function public.account_deletion_command(text,jsonb) to authenticated;
revoke all on function public.account_deletion_worker(uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.account_deletion_worker(uuid,uuid,uuid,uuid,text,text,text) to service_role;
commit;

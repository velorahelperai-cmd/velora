-- Additive Smart authority on the installed native session/company baseline.
-- No Master activation, commercial seeds, provider calls, or historical edits.
begin;
set local lock_timeout='3s';
create table private.smart_profile_revisions (
 company_id uuid primary key references public.companies(id),
 revision bigint not null default 0 check(revision between 0 and 9007199254740991),
 updated_at timestamptz not null default clock_timestamp()
);
create table private.smart_save_attempts (
 actor_id uuid not null references auth.users(id),attempt_id uuid not null,
 company_id uuid not null references public.companies(id),kind text not null check(kind in ('profile','branches','business_create','branch_create','branch_rename')),
 payload_hash text not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,attempt_id)
);
alter table private.smart_profile_revisions enable row level security;
alter table private.smart_save_attempts enable row level security;
revoke all on private.smart_profile_revisions,private.smart_save_attempts from public,anon,authenticated,service_role;

create function private.smart_profile_payload(cid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',display_name,'type',business_type,'country',country,'city',city,
 'hours',hours,'contactPhone',contact_phone,'contactEmail',contact_email,'replyLanguage',reply_language)
 from public.companies where id=cid
$$;
create function private.smart_payload_hash(payload jsonb) returns text
language sql immutable set search_path='' as $$select encode(sha256(convert_to(payload::text,'UTF8')),'hex')$$;
create function private.smart_profile_receipt(cid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('ok',true,'data',jsonb_build_object('companyId',cid,
 'revision',coalesce((select revision from private.smart_profile_revisions where company_id=cid),0),
 'profileDigest',private.smart_payload_hash(private.smart_profile_payload(cid)),
 'profile',private.smart_profile_payload(cid),
 'companyVersion',(select to_jsonb(c)->'version' from public.companies c where id=cid),
 'updatedAt',(select to_jsonb(c)->'updated_at' from public.companies c where id=cid)))
$$;
create function public.read_smart_profile(p_company_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=private.smart_setup_authorize(p_company_id);
begin
 if uid is null or not private.smart_setup_owner(p_company_id,uid) or not exists(select 1 from public.companies c where c.id=p_company_id and nullif(to_jsonb(c)->>'archived_at','') is null and nullif(to_jsonb(c)->>'setup_file_destruction_at','') is null) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 return private.smart_profile_receipt(p_company_id);
end;$$;

create function public.save_smart_profile(p_expected_user_id uuid,p_company_id uuid,p_attempt_id uuid,
 p_expected_revision bigint,p_expected_profile_digest text,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=private.smart_setup_actor();prior private.smart_save_attempts%rowtype;
 input_hash text;current_profile jsonb;result jsonb;rev bigint;k text;
begin
 if uid is null or uid is distinct from p_expected_user_id or p_attempt_id is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 -- Company row is the serial fence shared with legacy manual profile writers.
 perform 1 from public.companies c where id=p_company_id and status<>'suspended' and nullif(to_jsonb(c)->>'archived_at','') is null and nullif(to_jsonb(c)->>'setup_file_destruction_at','') is null for update;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid and role='owner' and status='active' for share;
 if not found or private.smart_setup_authorize(p_company_id) is distinct from uid or not private.smart_setup_owner(p_company_id,uid)
 or not exists(select 1 from public.company_branches where company_id=p_company_id and is_primary and status='active')
 then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16000
 or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991
 or p_expected_profile_digest is null or p_expected_profile_digest !~ '^[a-f0-9]{64}$'
 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if (select count(*) from jsonb_object_keys(p_payload))<>8 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 foreach k in array array['name','type','country','city','hours','contactPhone','contactEmail','replyLanguage'] loop
  if jsonb_typeof(p_payload->k) is distinct from 'string' or (p_payload->>k)~'[[:cntrl:]]' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 end loop;
 if btrim(p_payload->>'name')='' or btrim(p_payload->>'type')='' or btrim(p_payload->>'country')='' or not private.valid_company_setup_payload(jsonb_build_object('business',p_payload,'setupStep',0)) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 input_hash:=private.smart_payload_hash(jsonb_build_object('companyId',p_company_id,'kind','profile','revision',p_expected_revision,'digest',p_expected_profile_digest,'payload',p_payload));
 -- Also serialize reuse of an actor's attempt across different companies/kinds.
 perform pg_advisory_xact_lock(hashtextextended('smart-attempt:'||uid::text||':'||p_attempt_id::text,0));
 select * into prior from private.smart_save_attempts where actor_id=uid and attempt_id=p_attempt_id;
 if found then
  if prior.company_id<>p_company_id or prior.kind<>'profile' or prior.payload_hash<>input_hash then return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');end if;
  perform private.smart_setup_commit(p_company_id,uid);return prior.receipt;
 end if;
 current_profile:=private.smart_profile_payload(p_company_id);
 select revision into rev from private.smart_profile_revisions where company_id=p_company_id;
 if coalesce(rev,0)<>p_expected_revision or private.smart_payload_hash(current_profile)<>p_expected_profile_digest then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if current_profile->>'country' is distinct from p_payload->>'country' then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');end if;
 if current_profile is distinct from p_payload then
  update public.companies set display_name=p_payload->>'name',business_type=p_payload->>'type',country=p_payload->>'country',city=p_payload->>'city',
  hours=p_payload->>'hours',contact_phone=p_payload->>'contactPhone',contact_email=p_payload->>'contactEmail',reply_language=p_payload->>'replyLanguage',updated_at=clock_timestamp() where id=p_company_id;
  insert into private.smart_profile_revisions(company_id,revision) values(p_company_id,p_expected_revision+1)
  on conflict(company_id) do update set revision=excluded.revision,updated_at=clock_timestamp();
 end if;
 perform private.smart_setup_commit(p_company_id,uid);
 result:=private.smart_profile_receipt(p_company_id);
 result:=jsonb_set(result,'{data}',result->'data'||jsonb_build_object('userId',uid,'attemptId',p_attempt_id));
 insert into private.smart_save_attempts(actor_id,attempt_id,company_id,kind,payload_hash,receipt) values(uid,p_attempt_id,p_company_id,'profile',input_hash,result);
 return result;
end;$$;

create function public.save_smart_branch_setup_v2(p_expected_user_id uuid,p_company_id uuid,p_attempt_id uuid,
 p_expected_primary_branch_id uuid,p_expected_revision integer,p_mode text,p_primary_name text,p_expected_primary_name text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=private.smart_setup_actor();prior private.smart_save_attempts%rowtype;input_hash text;result jsonb;rev integer;actual_name text;
begin
 if uid is null or uid is distinct from p_expected_user_id or p_attempt_id is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.companies c where id=p_company_id and status<>'suspended' and nullif(to_jsonb(c)->>'archived_at','') is null and nullif(to_jsonb(c)->>'setup_file_destruction_at','') is null for update;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid and role='owner' and status='active' for share;
 if not found or private.smart_setup_authorize(p_company_id) is distinct from uid or not private.smart_setup_owner(p_company_id,uid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select name into actual_name from public.company_branches where company_id=p_company_id and id=p_expected_primary_branch_id and is_primary and status='active' for update;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 or p_mode is null or p_mode not in ('single','multiple')
 or p_primary_name is null or char_length(btrim(p_primary_name)) not between 1 and 120 or p_primary_name~'[[:cntrl:]]'
 or p_expected_primary_name is null or char_length(btrim(p_expected_primary_name)) not between 1 and 120 or p_expected_primary_name~'[[:cntrl:]]' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 input_hash:=private.smart_payload_hash(jsonb_build_object('companyId',p_company_id,'kind','branches','branchId',p_expected_primary_branch_id,'revision',p_expected_revision,
 'mode',p_mode,'name',btrim(p_primary_name),'expectedName',p_expected_primary_name));
 perform pg_advisory_xact_lock(hashtextextended('smart-attempt:'||uid::text||':'||p_attempt_id::text,0));
 select * into prior from private.smart_save_attempts where actor_id=uid and attempt_id=p_attempt_id;
 if found then
  if prior.company_id<>p_company_id or prior.kind<>'branches' or prior.payload_hash<>input_hash then return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');end if;
  perform private.smart_setup_commit(p_company_id,uid);return prior.receipt;
 end if;
 select revision into rev from private.smart_branch_setup where company_id=p_company_id;
 if coalesce(rev,0)<>p_expected_revision or actual_name is distinct from p_expected_primary_name then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if p_mode='single' and (select count(*) from public.company_branches where company_id=p_company_id and status='active')>1 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 update public.company_branches set name=btrim(p_primary_name) where company_id=p_company_id and id=p_expected_primary_branch_id;
 insert into private.smart_branch_setup(company_id,mode,updated_by) values(p_company_id,p_mode,uid)
 on conflict(company_id) do update set mode=excluded.mode,revision=smart_branch_setup.revision+1,updated_at=clock_timestamp(),updated_by=uid;
 insert into private.smart_branch_audit(company_id,branch_id,actor_id,action,detail) values(p_company_id,p_expected_primary_branch_id,uid,'onboarding.branches.confirmed',jsonb_build_object('mode',p_mode,'attemptId',p_attempt_id));
 perform private.smart_setup_commit(p_company_id,uid);
 result:=private.smart_branch_setup_receipt(p_company_id);
 result:=jsonb_set(result,'{data}',result->'data'||jsonb_build_object('userId',uid,'attemptId',p_attempt_id));
 insert into private.smart_save_attempts(actor_id,attempt_id,company_id,kind,payload_hash,receipt) values(uid,p_attempt_id,p_company_id,'branches',input_hash,result);
 return result;
end;$$;
create function public.create_smart_business(p_expected_user_id uuid,p_attempt_id uuid,p_name text,p_type text,p_country text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=private.smart_setup_actor();prior private.smart_save_attempts%rowtype;input_hash text;created public.companies;result jsonb;
 master_installed boolean:=to_regprocedure('public.create_owner_company_attempt(uuid,uuid,jsonb)') is not null;
 master_allowed boolean;master_result jsonb;master_payload jsonb;
begin
 if uid is null or uid is distinct from p_expected_user_id or p_attempt_id is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_name is null or char_length(btrim(p_name)) not between 1 and 120 or p_name~'[[:cntrl:]]'
 or p_type is null or char_length(btrim(p_type)) not between 1 and 80 or p_type~'[[:cntrl:]]'
 or p_country is null or char_length(btrim(p_country)) not between 1 and 80 or p_country~'[[:cntrl:]]' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 -- Use the exact existing native per-user creation lock before membership checks.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 perform 1 from auth.users where id=uid for share;
 if master_installed then
  -- Compose the installed authority, including its first-business lock. The
  -- Smart endpoint must never become an alternate route around personal identity.
  if to_regprocedure('private.master_account_can_create_company(uuid)') is null then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text||':setup-draft',0));
  execute 'select private.master_account_can_create_company($1)' into master_allowed using uid;
  if master_allowed is distinct from true then return jsonb_build_object('ok',false,'code','PHONE_REQUIRED');end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('smart-attempt:'||uid::text||':'||p_attempt_id::text,0));
 input_hash:=private.smart_payload_hash(jsonb_build_object('kind','business_create','name',btrim(p_name),'type',btrim(p_type),'country',btrim(p_country)));
 select * into prior from private.smart_save_attempts where actor_id=uid and attempt_id=p_attempt_id;
 if found then
  if prior.kind<>'business_create' or prior.payload_hash<>input_hash then return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');end if;
  perform 1 from public.companies c where id=prior.company_id and status<>'suspended' and nullif(to_jsonb(c)->>'archived_at','') is null and nullif(to_jsonb(c)->>'setup_file_destruction_at','') is null for share;
  if not found or private.smart_setup_authorize(prior.company_id) is distinct from uid or not private.smart_setup_owner(prior.company_id,uid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  perform private.smart_setup_commit(prior.company_id,uid);return prior.receipt;
 end if;
 if private.smart_setup_actor() is distinct from uid or public.is_platform_admin()
 or exists(select 1 from public.company_members where user_id=uid and status='active') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if master_installed then
  master_payload:=jsonb_build_object('name',btrim(p_name),'type',btrim(p_type),'replyLanguage','both','country',btrim(p_country),'city','','hours','','contactPhone','','contactEmail','');
  execute 'select public.create_owner_company_attempt($1,$2,$3)' into master_result using uid,p_attempt_id,master_payload;
  if master_result->>'ok' is distinct from 'true' then return master_result;end if;
  select * into created from jsonb_populate_record(null::public.companies,master_result->'data');
 else
  created:=public.upsert_owner_company(btrim(p_name),btrim(p_type),'both',btrim(p_country),'','','','','');
 end if;
 -- A concurrent authority installation cannot commit a legacy-policy creation.
 if master_installed is distinct from (to_regprocedure('public.create_owner_company_attempt(uuid,uuid,jsonb)') is not null) then raise exception 'AUTHORITY_CHANGED' using errcode='42501';end if;
 if not private.smart_setup_owner(created.id,uid) then raise exception 'AUTHORITY_CHANGED' using errcode='42501';end if;
 perform private.smart_setup_commit(created.id,uid);
 result:=jsonb_build_object('ok',true,'data',jsonb_build_object('userId',uid,'companyId',created.id,'attemptId',p_attempt_id,'company',to_jsonb(created)));
 insert into private.smart_save_attempts(actor_id,attempt_id,company_id,kind,payload_hash,receipt) values(uid,p_attempt_id,created.id,'business_create',input_hash,result);
 return result;
end;$$;

create function public.create_smart_branch(p_expected_user_id uuid,p_company_id uuid,p_attempt_id uuid,p_name text,p_timezone text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=private.smart_setup_actor();prior private.smart_save_attempts%rowtype;input_hash text;native_result jsonb;result jsonb;
begin
 if uid is null or uid is distinct from p_expected_user_id or p_attempt_id is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.companies c where id=p_company_id and status<>'suspended' and nullif(to_jsonb(c)->>'archived_at','') is null and nullif(to_jsonb(c)->>'setup_file_destruction_at','') is null for update;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid and role='owner' and status='active' for share;
 if not found or private.smart_setup_authorize(p_company_id) is distinct from uid or not private.smart_setup_owner(p_company_id,uid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_name is null or char_length(btrim(p_name)) not between 1 and 120 or p_name~'[[:cntrl:]]' or not exists(select 1 from pg_timezone_names where name=p_timezone) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 input_hash:=private.smart_payload_hash(jsonb_build_object('kind','branch_create','companyId',p_company_id,'name',btrim(p_name),'timezone',p_timezone));
 perform pg_advisory_xact_lock(hashtextextended('smart-attempt:'||uid::text||':'||p_attempt_id::text,0));
 select * into prior from private.smart_save_attempts where actor_id=uid and attempt_id=p_attempt_id;
 if found then
  if prior.company_id<>p_company_id or prior.kind<>'branch_create' or prior.payload_hash<>input_hash then return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');end if;
  if not exists(select 1 from public.company_branches where company_id=p_company_id and id=(prior.receipt->'data'->>'branchId')::uuid and status in ('setup','active')) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  perform private.smart_setup_commit(p_company_id,uid);return prior.receipt;
 end if;
 insert into public.company_branches(company_id,name,timezone) values(p_company_id,btrim(p_name),p_timezone) returning jsonb_build_object('ok',true,'branchId',id) into native_result;
 insert into private.smart_branch_audit(company_id,branch_id,actor_id,action,detail) values(p_company_id,(native_result->>'branchId')::uuid,uid,'branch.created',jsonb_build_object('attemptId',p_attempt_id));
 if native_result->>'ok' is distinct from 'true' then return native_result;end if;
 perform private.smart_setup_commit(p_company_id,uid);
 result:=jsonb_build_object('ok',true,'data',jsonb_build_object('userId',uid,'companyId',p_company_id,'attemptId',p_attempt_id,'branchId',native_result->'branchId'));
 insert into private.smart_save_attempts(actor_id,attempt_id,company_id,kind,payload_hash,receipt) values(uid,p_attempt_id,p_company_id,'branch_create',input_hash,result);
 return result;
end;$$;

create function public.rename_smart_branch(p_expected_user_id uuid,p_company_id uuid,p_branch_id uuid,p_attempt_id uuid,p_expected_name text,p_name text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=private.smart_setup_actor();prior private.smart_save_attempts%rowtype;input_hash text;actual_name text;result jsonb;
begin
 if uid is null or uid is distinct from p_expected_user_id or p_attempt_id is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.companies c where id=p_company_id and status<>'suspended' and nullif(to_jsonb(c)->>'archived_at','') is null and nullif(to_jsonb(c)->>'setup_file_destruction_at','') is null for update;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid and role='owner' and status='active' for share;
 if not found or private.smart_setup_authorize(p_company_id) is distinct from uid or not private.smart_setup_owner(p_company_id,uid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select name into actual_name from public.company_branches where company_id=p_company_id and id=p_branch_id and status in ('setup','active') for update;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_name is null or char_length(btrim(p_name)) not between 1 and 120 or p_name~'[[:cntrl:]]' or p_expected_name is null then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 input_hash:=private.smart_payload_hash(jsonb_build_object('kind','branch_rename','companyId',p_company_id,'branchId',p_branch_id,'expectedName',p_expected_name,'name',btrim(p_name)));
 perform pg_advisory_xact_lock(hashtextextended('smart-attempt:'||uid::text||':'||p_attempt_id::text,0));
 select * into prior from private.smart_save_attempts where actor_id=uid and attempt_id=p_attempt_id;
 if found then
  if prior.company_id<>p_company_id or prior.kind<>'branch_rename' or prior.payload_hash<>input_hash then return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');end if;
  perform private.smart_setup_commit(p_company_id,uid);return prior.receipt;
 end if;
 if actual_name is distinct from p_expected_name then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 update public.company_branches set name=btrim(p_name) where company_id=p_company_id and id=p_branch_id;
 insert into private.smart_branch_audit(company_id,branch_id,actor_id,action,detail) values(p_company_id,p_branch_id,uid,'branch.renamed',jsonb_build_object('attemptId',p_attempt_id));
 perform private.smart_setup_commit(p_company_id,uid);
 result:=jsonb_build_object('ok',true,'data',jsonb_build_object('userId',uid,'companyId',p_company_id,'attemptId',p_attempt_id,'branchId',p_branch_id,'name',btrim(p_name)));
 insert into private.smart_save_attempts(actor_id,attempt_id,company_id,kind,payload_hash,receipt) values(uid,p_attempt_id,p_company_id,'branch_rename',input_hash,result);
 return result;
end;$$;
revoke all on function public.create_smart_business(uuid,uuid,text,text,text),public.create_smart_branch(uuid,uuid,uuid,text,text),public.rename_smart_branch(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_smart_business(uuid,uuid,text,text,text),public.create_smart_branch(uuid,uuid,uuid,text,text),public.rename_smart_branch(uuid,uuid,uuid,uuid,text,text) to authenticated;
revoke all on function private.smart_profile_payload(uuid),private.smart_payload_hash(jsonb),private.smart_profile_receipt(uuid),
 public.read_smart_profile(uuid),public.save_smart_profile(uuid,uuid,uuid,bigint,text,jsonb),public.save_smart_branch_setup_v2(uuid,uuid,uuid,uuid,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.read_smart_profile(uuid),public.save_smart_profile(uuid,uuid,uuid,bigint,text,jsonb),public.save_smart_branch_setup_v2(uuid,uuid,uuid,uuid,integer,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;

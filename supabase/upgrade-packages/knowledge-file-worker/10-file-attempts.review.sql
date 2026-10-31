-- REVIEW CANDIDATE ONLY. NOT APPLIED, NOT NATIVE-TESTED, NOT RELEASE READY.
-- Kept outside supabase/migrations. Remove this unconditional stop only in a
-- separately approved isolated acceptance copy, then seek production approval.
begin;
do $$ begin raise exception 'REVIEW_ONLY_NOT_APPROVED_FOR_EXECUTION';end $$;
set local search_path='';
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.g03_publish_prepared_file(uuid,uuid,uuid,uuid,integer,text,text,text,bigint,uuid,timestamp with time zone)')) is distinct from '5e0dccd905f383e1b4ba541cff94b0bf'
 or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.g03_lock_actor(uuid,text,uuid)')) is distinct from '6a7e552989ce5f3e980d11ca320c4683'
 then raise exception 'REVIEW_BASELINE_MISMATCH';end if;
 if to_regclass('private.es02_branch_knowledge_sources') is null then raise exception 'BRANCH_BINDING_BASELINE_REQUIRED';end if;
 if to_regclass('private.g03_file_attempts') is not null then raise exception 'PARTIAL_OR_ALREADY_INSTALLED';end if;
end $$;

create table private.g03_file_attempts(
 source_id uuid primary key references public.knowledge_sources(id) on delete cascade,
 company_id uuid not null references public.companies(id) on delete cascade,
 branch_id uuid not null,
 foreign key(company_id,branch_id) references public.company_branches(company_id,id),
 attempt_id uuid not null unique,
 actor_id uuid not null, session_id uuid not null,
 state text not null check(state in ('running','published','failed')),
 expires_at timestamptz not null,
 source_updated_at timestamptz not null, content_version integer not null,
 storage_path text not null,object_id uuid not null,object_updated_at timestamptz not null
);
alter table private.g03_file_attempts enable row level security;
revoke all on private.g03_file_attempts from public,anon,authenticated,service_role;

create function private.g03_lock_attempt_actor(p_actor_id uuid,p_session_id uuid,p_company_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' or p_actor_id is null or p_session_id is null or p_company_id is null
 then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'session_id',p_session_id,'role','authenticated')::text,true);
 perform 1 from public.companies where id=p_company_id and status<>'suspended' for share nowait;
 if not found then raise exception 'forbidden' using errcode='42501';end if;
 perform private.g03_lock_actor(p_company_id,'publish');
end; $$;
revoke all on function private.g03_lock_attempt_actor(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Caller supplies a stable new UUID before dispatch; a lost claim response can
-- recover that same active attempt. Deadline is trusted-server input; the actual
-- lease duration/heartbeat cadence is a separate operational approval, not set here.
create function private.g03_lock_attempt_branch(p_company_id uuid,p_branch_id uuid,p_source_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from private.es02_branch_knowledge_sources b join public.company_branches br
 on br.company_id=b.company_id and br.id=b.branch_id
 where b.company_id=p_company_id and b.branch_id=p_branch_id and b.source_id=p_source_id for share of b,br nowait;
 if not found then raise exception 'BRANCH_BINDING_REQUIRED' using errcode='42501';end if;
end; $$;
revoke all on function private.g03_lock_attempt_branch(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.g03_claim_file_attempt(
 p_actor_id uuid,p_session_id uuid,p_company_id uuid,p_source_id uuid,p_attempt_id uuid,p_branch_id uuid,
 p_expected_version integer,p_expected_updated_at timestamptz,p_storage_path text,
 p_object_id uuid,p_object_updated_at timestamptz,p_expires_at timestamptz,p_recover_attempt_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.knowledge_sources%rowtype;a private.g03_file_attempts%rowtype;
begin
 perform private.g03_lock_attempt_actor(p_actor_id,p_session_id,p_company_id);
 if p_attempt_id is null or p_source_id is null or p_expires_at is null or p_expires_at<=clock_timestamp()
 then raise exception 'invalid_input' using errcode='22023';end if;
 -- Keep established object -> source -> input-epoch lock order. All are NOWAIT.
 perform 1 from storage.objects where id=p_object_id and bucket_id='company-knowledge'
   and name=p_storage_path and updated_at=p_object_updated_at for share nowait;
 if not found then return jsonb_build_object('ok',false,'code','OBJECT_CONFLICT');end if;
 select * into k from public.knowledge_sources where id=p_source_id and company_id=p_company_id and kind='file' for update nowait;
 if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
 perform private.g03_lock_attempt_branch(p_company_id,p_branch_id,p_source_id);
 select * into a from private.g03_file_attempts where source_id=p_source_id for update nowait;
 if a.attempt_id=p_attempt_id and a.branch_id=p_branch_id and a.actor_id=p_actor_id and a.session_id=p_session_id and a.state='running'
   and a.expires_at>clock_timestamp() and a.source_updated_at=k.updated_at
 then return jsonb_build_object('ok',true,'replayed',true,'attemptId',a.attempt_id,'source',to_jsonb(k));end if;
 if a.attempt_id=p_attempt_id then return jsonb_build_object('ok',false,'code','ATTEMPT_RETIRED');end if;
 if k.content_version is distinct from p_expected_version or k.updated_at is distinct from p_expected_updated_at
   or k.storage_path is distinct from p_storage_path then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if k.status='processing' then
   if a.attempt_id is null then return jsonb_build_object('ok',false,'code','LEGACY_PROCESSING_REVIEW_REQUIRED');end if;
   if a.branch_id is distinct from p_branch_id or a.state<>'running' or a.expires_at>clock_timestamp() or p_recover_attempt_id is distinct from a.attempt_id
     or a.source_updated_at is distinct from k.updated_at then return jsonb_build_object('ok',false,'code','BUSY');end if;
 elsif k.status not in ('draft','stored','ready','failed') then return jsonb_build_object('ok',false,'code','INVALID_STATE');
 end if;
 perform 1 from private.g03_company_inputs where company_id=p_company_id for update nowait;
 update public.knowledge_sources set content='',status='processing',failure_code=null where id=k.id returning * into k;
 insert into private.g03_file_attempts(source_id,company_id,branch_id,attempt_id,actor_id,session_id,state,expires_at,source_updated_at,content_version,storage_path,object_id,object_updated_at)
 values(k.id,k.company_id,p_branch_id,p_attempt_id,p_actor_id,p_session_id,'running',p_expires_at,k.updated_at,k.content_version,k.storage_path,p_object_id,p_object_updated_at)
 on conflict(source_id) do update set branch_id=excluded.branch_id,attempt_id=excluded.attempt_id,actor_id=excluded.actor_id,session_id=excluded.session_id,
   state='running',expires_at=excluded.expires_at,source_updated_at=excluded.source_updated_at,content_version=excluded.content_version,
   storage_path=excluded.storage_path,object_id=excluded.object_id,object_updated_at=excluded.object_updated_at;
 return jsonb_build_object('ok',true,'replayed',false,'attemptId',p_attempt_id,'source',to_jsonb(k));
exception when lock_not_available or unique_violation then return jsonb_build_object('ok',false,'code','CONFLICT');
end; $$;

-- No expired token may heartbeat or fail after recovery. For a crashed worker,
-- the next explicit claim must name the expired attempt and mint a different UUID.
create function public.g03_control_file_attempt(
 p_actor_id uuid,p_session_id uuid,p_company_id uuid,p_source_id uuid,p_attempt_id uuid,p_branch_id uuid,
 p_action text,p_expires_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.knowledge_sources%rowtype;a private.g03_file_attempts%rowtype;
begin
 perform private.g03_lock_attempt_actor(p_actor_id,p_session_id,p_company_id);
 if p_action is null or p_action not in ('heartbeat','fail') then raise exception 'invalid_input' using errcode='22023';end if;
 select * into k from public.knowledge_sources where id=p_source_id and company_id=p_company_id for update nowait;
 if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
 perform private.g03_lock_attempt_branch(p_company_id,p_branch_id,p_source_id);
 select * into a from private.g03_file_attempts where source_id=p_source_id for update nowait;
 if a.attempt_id is distinct from p_attempt_id or a.branch_id is distinct from p_branch_id or a.actor_id is distinct from p_actor_id or a.session_id is distinct from p_session_id
   or a.state is distinct from 'running' or a.expires_at<=clock_timestamp() or k.status<>'processing'
   or a.source_updated_at is distinct from k.updated_at or a.content_version is distinct from k.content_version
   or a.storage_path is distinct from k.storage_path then return jsonb_build_object('ok',false,'code','ATTEMPT_CONFLICT');end if;
 if p_action='heartbeat' then
   if p_expires_at is null or p_expires_at<=a.expires_at then raise exception 'invalid_input' using errcode='22023';end if;
   update private.g03_file_attempts set expires_at=p_expires_at where source_id=k.id;
 else
   perform 1 from private.g03_company_inputs where company_id=p_company_id for update nowait;
   update public.knowledge_sources set status='failed',failure_code='extract_failed',content='' where id=k.id returning * into k;
   update private.g03_file_attempts set state='failed',source_updated_at=k.updated_at where source_id=k.id;
 end if;
 return jsonb_build_object('ok',true,'source',to_jsonb(k));
exception when lock_not_available then return jsonb_build_object('ok',false,'code','CONFLICT');
end; $$;

create or replace function public.g03_publish_prepared_file(p_actor_id uuid,p_session_id uuid,p_source_id uuid,p_company_id uuid,
  p_expected_version integer,p_storage_path text,p_text text,p_file_sha256 text,p_byte_size bigint,p_object_id uuid,p_object_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.knowledge_sources%rowtype;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
  if p_file_sha256 !~ '^[0-9a-f]{64}$' or p_file_sha256 is null or btrim(coalesce(p_text,''))='' or p_byte_size<1 or p_byte_size>10485760
    then raise exception 'invalid_input' using errcode='22023';end if;
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'session_id',p_session_id,'role','authenticated')::text,true);
  -- Company first, matching the profile-save RPC; never wait for any source
  -- row after acquiring the input guard. Suspension cannot pass this write.
  perform 1 from public.companies where id=p_company_id and status<>'suspended' for share nowait;
  if not found then raise exception 'forbidden' using errcode='42501';end if;
  perform private.g03_lock_actor(p_company_id,'publish');
  -- Lock object before source, matching the existing Storage invalidation trigger.
  perform 1 from storage.objects where id=p_object_id and bucket_id='company-knowledge' and name=p_storage_path and updated_at=p_object_updated_at for share nowait;
  if not found then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  perform 1 from public.knowledge_sources where id=p_source_id and company_id=p_company_id for update nowait;
  if not found then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  -- Enrollment persists after completion: the legacy signature cannot bypass
  -- the attempt fence, even when content_version did not advance on recovery.
  if exists(select 1 from private.g03_file_attempts where source_id=p_source_id) then
    perform private.g03_lock_attempt_branch(p_company_id,(select branch_id from private.g03_file_attempts where source_id=p_source_id),p_source_id);
    perform 1 from private.g03_file_attempts a join public.knowledge_sources k on k.id=a.source_id
      where a.source_id=p_source_id and a.company_id=p_company_id and a.state='running'
        and a.attempt_id::text=coalesce(current_setting('velora.g03_attempt',true),'')
        and a.actor_id=p_actor_id and a.session_id=p_session_id and a.expires_at>clock_timestamp()
        and a.source_updated_at=k.updated_at and a.content_version=k.content_version
        and a.storage_path=k.storage_path and a.object_id=p_object_id and a.object_updated_at=p_object_updated_at
      for update of a nowait;
    if not found then return jsonb_build_object('ok',false,'code','ATTEMPT_CONFLICT');end if;
  end if;
  perform 1 from private.g03_company_inputs where company_id=p_company_id for update nowait;
  perform set_config('velora.g03_publish','1',true);
  update public.knowledge_sources set content=p_text,status='ready',failure_code=null,prepared_file_sha256=p_file_sha256
    where id=p_source_id and company_id=p_company_id and kind='file' and status='processing'
      and content_version=p_expected_version and storage_path=p_storage_path and byte_size=p_byte_size
      and storage_path like p_company_id::text||'/'||p_source_id::text||'/%' returning * into r;
  perform set_config('velora.g03_publish','0',true);
  if not found or r.id is null then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  return jsonb_build_object('ok',true,'source',to_jsonb(r));
exception when lock_not_available then return jsonb_build_object('ok',false,'code','CONFLICT');
end; $$;

create function public.g03_publish_file_attempt(
 p_attempt_id uuid,p_actor_id uuid,p_session_id uuid,p_source_id uuid,p_company_id uuid,p_branch_id uuid,
 p_expected_version integer,p_storage_path text,p_text text,p_file_sha256 text,p_byte_size bigint,p_object_id uuid,p_object_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;previous_token text;
begin
 if current_setting('role',true)<>'service_role' or p_attempt_id is null
 then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from private.g03_file_attempts where source_id=p_source_id and company_id=p_company_id and branch_id=p_branch_id and attempt_id=p_attempt_id)
 then return jsonb_build_object('ok',false,'code','ATTEMPT_CONFLICT');end if;
 previous_token:=coalesce(current_setting('velora.g03_attempt',true),'');
 perform set_config('velora.g03_attempt',p_attempt_id::text,true);
 result:=public.g03_publish_prepared_file(p_actor_id,p_session_id,p_source_id,p_company_id,p_expected_version,p_storage_path,p_text,p_file_sha256,p_byte_size,p_object_id,p_object_updated_at);
 perform set_config('velora.g03_attempt',previous_token,true);
 if result->>'ok'='true' then
   update private.g03_file_attempts set state='published' where source_id=p_source_id and attempt_id=p_attempt_id and state='running';
 end if;
 return result;
end; $$;

revoke all on function public.g03_claim_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,uuid,timestamptz,timestamptz,uuid),
 public.g03_control_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz),
 public.g03_publish_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,bigint,uuid,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.g03_claim_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,uuid,timestamptz,timestamptz,uuid),
 public.g03_control_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz),
 public.g03_publish_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,bigint,uuid,timestamptz)
 to service_role;
-- Existing g03_publish_prepared_file signature, ACL, actor checks, object byte
-- generation checks, source version checks and proof triggers are preserved.
-- No existing business row is enrolled or rewritten by this DDL.
notify pgrst,'reload schema';
commit;

-- REVIEW CANDIDATE ONLY. Apply only after 10-file-attempts.review.sql on disposable DB.
-- Extends attempts with provider_dispatch, list/read RPCs, and typed fail codes for review holds.
begin;
do $$ begin raise exception 'REVIEW_ONLY_NOT_APPROVED_FOR_EXECUTION'; end $$;
set local search_path='';
set local lock_timeout='2s';
set local statement_timeout='30s';

do $$ begin
  if to_regclass('private.g03_file_attempts') is null then raise exception 'FILE_ATTEMPTS_BASELINE_REQUIRED'; end if;
end $$;

alter table private.g03_file_attempts
  add column if not exists provider_dispatch text not null default 'none'
    check (provider_dispatch in ('none','dispatched','unknown','verified'));

create or replace function public.g03_list_running_file_attempts(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501'; end if;
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'invalid_input' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'source_id',a.source_id,'attempt_id',a.attempt_id,'company_id',a.company_id,'branch_id',a.branch_id,
    'actor_id',a.actor_id,'session_id',a.session_id,'expires_at',a.expires_at,
    'provider_dispatch',a.provider_dispatch,'content_version',a.content_version,'storage_path',a.storage_path,
    'object_id',a.object_id,'object_updated_at',a.object_updated_at
  ) order by a.expires_at asc), '[]'::jsonb)
  into rows
  from (
    select * from private.g03_file_attempts where state='running' order by expires_at asc limit p_limit
  ) a;
  return rows;
end; $$;

create or replace function public.g03_read_file_attempt(p_source_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.g03_file_attempts%rowtype;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501'; end if;
  if p_source_id is null then raise exception 'invalid_input' using errcode='22023'; end if;
  select * into a from private.g03_file_attempts where source_id=p_source_id;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  return jsonb_build_object(
    'ok',true,'attempt_id',a.attempt_id,'state',a.state,'expires_at',a.expires_at,
    'content_version',a.content_version,'storage_path',a.storage_path,
    'provider_dispatch',a.provider_dispatch,'branch_id',a.branch_id,
    'actor_id',a.actor_id,'session_id',a.session_id,'company_id',a.company_id,
    'object_id',a.object_id,'object_updated_at',a.object_updated_at
  );
end; $$;

-- Replace claim so expired recovery is refused after provider contact (review hold).
create or replace function public.g03_claim_file_attempt(
 p_actor_id uuid,p_session_id uuid,p_company_id uuid,p_source_id uuid,p_attempt_id uuid,p_branch_id uuid,
 p_expected_version integer,p_expected_updated_at timestamptz,p_storage_path text,
 p_object_id uuid,p_object_updated_at timestamptz,p_expires_at timestamptz,p_recover_attempt_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.knowledge_sources%rowtype;a private.g03_file_attempts%rowtype;
begin
 perform private.g03_lock_attempt_actor(p_actor_id,p_session_id,p_company_id);
 if p_attempt_id is null or p_source_id is null or p_expires_at is null or p_expires_at<=clock_timestamp()
 then raise exception 'invalid_input' using errcode='22023';end if;
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
   if a.provider_dispatch is distinct from 'none' and a.expires_at<=clock_timestamp()
     and p_recover_attempt_id is not distinct from a.attempt_id
   then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED','attemptId',a.attempt_id);end if;
   if a.branch_id is distinct from p_branch_id or a.state<>'running' or a.expires_at>clock_timestamp() or p_recover_attempt_id is distinct from a.attempt_id
     or a.source_updated_at is distinct from k.updated_at or coalesce(a.provider_dispatch,'none')<>'none'
   then return jsonb_build_object('ok',false,'code','BUSY');end if;
 elsif k.status not in ('draft','stored','ready','failed') then return jsonb_build_object('ok',false,'code','INVALID_STATE');
 end if;
 perform 1 from private.g03_company_inputs where company_id=p_company_id for update nowait;
 update public.knowledge_sources set content='',status='processing',failure_code=null where id=k.id returning * into k;
 insert into private.g03_file_attempts(source_id,company_id,branch_id,attempt_id,actor_id,session_id,state,expires_at,source_updated_at,content_version,storage_path,object_id,object_updated_at,provider_dispatch)
 values(k.id,k.company_id,p_branch_id,p_attempt_id,p_actor_id,p_session_id,'running',p_expires_at,k.updated_at,k.content_version,k.storage_path,p_object_id,p_object_updated_at,'none')
 on conflict(source_id) do update set branch_id=excluded.branch_id,attempt_id=excluded.attempt_id,actor_id=excluded.actor_id,session_id=excluded.session_id,
   state='running',expires_at=excluded.expires_at,source_updated_at=excluded.source_updated_at,content_version=excluded.content_version,
   storage_path=excluded.storage_path,object_id=excluded.object_id,object_updated_at=excluded.object_updated_at,provider_dispatch='none';
 return jsonb_build_object('ok',true,'replayed',false,'attemptId',p_attempt_id,'source',to_jsonb(k));
exception when lock_not_available or unique_violation then return jsonb_build_object('ok',false,'code','CONFLICT');
end; $$;

-- Replace control to accept optional failure_code and mark provider_dispatch on fail.
-- Expired leases may only be failed into a review hold after provider contact.
drop function if exists public.g03_control_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz);
drop function if exists public.g03_control_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text);
create function public.g03_control_file_attempt(
 p_actor_id uuid,p_session_id uuid,p_company_id uuid,p_source_id uuid,p_attempt_id uuid,p_branch_id uuid,
 p_action text,p_expires_at timestamptz default null,p_failure_code text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.knowledge_sources%rowtype;a private.g03_file_attempts%rowtype;
  fail_code text; lease_ok boolean;
begin
 perform private.g03_lock_attempt_actor(p_actor_id,p_session_id,p_company_id);
 if p_action is null or p_action not in ('heartbeat','fail') then raise exception 'invalid_input' using errcode='22023'; end if;
 select * into k from public.knowledge_sources where id=p_source_id and company_id=p_company_id for update nowait;
 if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
 perform private.g03_lock_attempt_branch(p_company_id,p_branch_id,p_source_id);
 select * into a from private.g03_file_attempts where source_id=p_source_id for update nowait;
 if a.attempt_id is distinct from p_attempt_id or a.branch_id is distinct from p_branch_id or a.actor_id is distinct from p_actor_id or a.session_id is distinct from p_session_id
   or a.state is distinct from 'running' or k.status<>'processing'
   or a.source_updated_at is distinct from k.updated_at or a.content_version is distinct from k.content_version
   or a.storage_path is distinct from k.storage_path then return jsonb_build_object('ok',false,'code','ATTEMPT_CONFLICT'); end if;
 lease_ok:=a.expires_at>clock_timestamp();
 if p_action='heartbeat' then
   if not lease_ok then return jsonb_build_object('ok',false,'code','ATTEMPT_CONFLICT'); end if;
   if p_expires_at is null or p_expires_at<=a.expires_at then raise exception 'invalid_input' using errcode='22023'; end if;
   update private.g03_file_attempts set expires_at=p_expires_at where source_id=k.id;
 else
   fail_code:=coalesce(nullif(btrim(p_failure_code),''),'extract_failed');
   if char_length(fail_code)>64 then raise exception 'invalid_input' using errcode='22023'; end if;
   if not lease_ok then
     if coalesce(a.provider_dispatch,'none')='none' or fail_code<>'provider_outcome_unknown'
     then return jsonb_build_object('ok',false,'code','ATTEMPT_CONFLICT'); end if;
   end if;
   perform 1 from private.g03_company_inputs where company_id=p_company_id for update nowait;
   update public.knowledge_sources set status='failed',failure_code=fail_code,content='' where id=k.id returning * into k;
   update private.g03_file_attempts
     set state='failed',source_updated_at=k.updated_at,
         provider_dispatch=case when fail_code='provider_outcome_unknown' then 'unknown' else provider_dispatch end
     where source_id=k.id;
 end if;
 return jsonb_build_object('ok',true,'source',to_jsonb(k));
exception when lock_not_available then return jsonb_build_object('ok',false,'code','CONFLICT');
end; $$;

create or replace function public.g03_mark_file_attempt_dispatched(
 p_actor_id uuid,p_session_id uuid,p_company_id uuid,p_source_id uuid,p_attempt_id uuid,p_branch_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.g03_file_attempts%rowtype;
begin
  perform private.g03_lock_attempt_actor(p_actor_id,p_session_id,p_company_id);
  select * into a from private.g03_file_attempts where source_id=p_source_id for update nowait;
  if a.attempt_id is distinct from p_attempt_id or a.branch_id is distinct from p_branch_id
    or a.actor_id is distinct from p_actor_id or a.session_id is distinct from p_session_id
    or a.state<>'running' or a.expires_at<=clock_timestamp()
  then return jsonb_build_object('ok',false,'code','ATTEMPT_CONFLICT'); end if;
  if a.provider_dispatch<>'none' then return jsonb_build_object('ok',true,'replayed',true,'provider_dispatch',a.provider_dispatch); end if;
  update private.g03_file_attempts set provider_dispatch='dispatched' where source_id=p_source_id;
  return jsonb_build_object('ok',true,'replayed',false,'provider_dispatch','dispatched');
exception when lock_not_available then return jsonb_build_object('ok',false,'code','CONFLICT');
end; $$;

revoke all on function public.g03_claim_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,uuid,timestamptz,timestamptz,uuid),
 public.g03_list_running_file_attempts(integer),
 public.g03_read_file_attempt(uuid),
 public.g03_control_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text),
 public.g03_mark_file_attempt_dispatched(uuid,uuid,uuid,uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.g03_claim_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,uuid,timestamptz,timestamptz,uuid),
 public.g03_list_running_file_attempts(integer),
 public.g03_read_file_attempt(uuid),
 public.g03_control_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text),
 public.g03_mark_file_attempt_dispatched(uuid,uuid,uuid,uuid,uuid,uuid)
 to service_role;
notify pgrst,'reload schema';
commit;

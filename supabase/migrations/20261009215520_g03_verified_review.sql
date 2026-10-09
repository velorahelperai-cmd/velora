-- G03: structural setup evidence only. No live flags, financial writes or backfill.
begin;

alter table public.knowledge_sources
  add column prepared_file_sha256 text check (prepared_file_sha256 ~ '^[0-9a-f]{64}$'),
  add column prepared_text_sha256 text check (prepared_text_sha256 ~ '^[0-9a-f]{64}$'),
  add column prepared_content_version integer;
alter table public.company_review_requests
  add column submitted_manifest jsonb,
  add column submitted_manifest_sha256 text,
  add column submitted_input_epoch bigint,
  add column submitted_intent_sha256 text,
  add column proof_checked_at timestamptz;

create table private.g03_company_inputs (
  company_id uuid primary key references public.companies(id) on delete cascade,
  input_epoch bigint not null default 0
);
insert into private.g03_company_inputs(company_id) select id from public.companies;
create table private.g03_review_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  session_id uuid not null,
  action text not null check (action in ('submit','resubmit','approve')),
  expected_revision integer,
  input_epoch bigint not null,
  manifest jsonb not null,
  manifest_sha256 text not null,
  intent_sha256 text not null,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  observations jsonb,
  consumed_at timestamptz
);
create index g03_review_checks_actor_idx on private.g03_review_checks(company_id,actor_id,session_id,created_at desc);
revoke all on private.g03_company_inputs,private.g03_review_checks from public,anon,authenticated,service_role;

create function private.g03_sha(p_text text) returns text
language sql immutable set search_path='' as $$
  select encode(extensions.digest(convert_to(p_text,'UTF8'),'sha256'),'hex');
$$;

-- AFTER writers acquire the source row first, then this shared guard. A final
-- decision acquires the guard and uses MVCC reads (never source FOR UPDATE).
-- Thus overlapping writers either precede the decision or invalidate it after.
create function private.g03_bump_inputs() returns trigger
language plpgsql security definer set search_path='' as $$
declare cid uuid; old_cid uuid;
begin
  if tg_table_name='companies' then
    if tg_op='UPDATE' and (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new;end if;
    cid:=new.id;
  else
    if tg_op='UPDATE' and (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new;end if;
    if tg_op<>'DELETE' then cid:=new.company_id;end if;
    if tg_op<>'INSERT' then old_cid:=old.company_id;end if;
  end if;
  -- Sorted even for service-owned cross-company moves, avoiding two-guard inversions.
  insert into private.g03_company_inputs(company_id,input_epoch)
  select x,1 from (select distinct unnest(array[cid,old_cid]) x) q where x is not null
    and exists(select 1 from public.companies where id=x) order by x
  on conflict(company_id) do update set input_epoch=private.g03_company_inputs.input_epoch+1;
  return coalesce(new,old);
end; $$;
create trigger g03_company_input_epoch after insert or update on public.companies
  for each row execute function private.g03_bump_inputs();
create trigger g03_knowledge_input_epoch after insert or update or delete on public.knowledge_sources
  for each row execute function private.g03_bump_inputs();
create trigger g03_owner_input_epoch after insert or update or delete on public.company_members
  for each row execute function private.g03_bump_inputs();

-- Run after version and usage-role triggers. Client edits cannot assign or keep
-- an extraction proof for a changed file/text/version. No historical backfill.
create function private.g03_prepared_file_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.prepared_file_sha256:=null;new.prepared_text_sha256:=null;new.prepared_content_version:=null;
  elsif coalesce(current_setting('velora.g03_publish',true),'')='1' then
    new.prepared_text_sha256:=private.g03_sha(new.content);
    new.prepared_content_version:=new.content_version;
  elsif new.content_version is distinct from old.content_version or new.status is distinct from 'ready'
    or new.byte_size is distinct from old.byte_size or new.kind is distinct from old.kind then
    new.prepared_file_sha256:=null;new.prepared_text_sha256:=null;new.prepared_content_version:=null;
  else
    new.prepared_file_sha256:=old.prepared_file_sha256;
    new.prepared_text_sha256:=old.prepared_text_sha256;
    new.prepared_content_version:=old.prepared_content_version;
  end if;
  return new;
end; $$;
create trigger knowledge_sources_zz_g03_prepared_file before insert or update on public.knowledge_sources
  for each row execute function private.g03_prepared_file_guard();

-- The current actor's session is checked again at the write, not just before
-- Storage I/O. Lock the permission read set shared with existing revocation RPCs.
create function private.g03_lock_actor(p_company_id uuid,p_action text,p_requester uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();sid uuid;
begin
  if actor is null then raise exception 'not_authenticated' using errcode='42501';end if;
  begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then sid:=null;end;
  if sid is null then raise exception 'session_required' using errcode='42501';end if;
  -- No activity-before-session lock: deletion owns session then cascades activity.
  -- NOWAIT throughout this read set prevents inversions with multi-statement
  -- profile/permission RPCs. A conflict rolls back and requires a fresh check.
  perform 1 from auth.users where id=any(array[actor,p_requester]) order by id for share nowait;
  perform 1 from auth.sessions where id=sid and user_id=actor for share nowait;
  if not found then raise exception 'session_expired' using errcode='42501';end if;
  perform 1 from private.app_session_activity where session_id=sid and user_id=actor for share nowait;
  if not found or not exists(select 1 from private.app_session_activity where session_id=sid and user_id=actor
    and expired_at is null and last_activity_at<=clock_timestamp() and last_activity_at>clock_timestamp()-interval '2 hours')
    or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null)
    then raise exception 'session_expired' using errcode='42501';end if;
  perform 1 from public.company_members where company_id=p_company_id order by user_id for share nowait;
  perform 1 from public.platform_admins where user_id=actor or user_id in
    (select manager_user_id from public.company_member_grants where company_id=p_company_id) order by user_id for share nowait;
  perform 1 from public.platform_admin_scopes where company_id=p_company_id order by admin_user_id for share nowait;
  perform 1 from public.company_member_grants where company_id=p_company_id order by user_id for share nowait;
  if p_action in ('submit','resubmit') then perform private.require_active_owner(p_company_id);
  elsif p_action='publish' then
    if not private.user_has_company_capability(actor,p_company_id,'knowledge.write')
      and not private.can_admin_company(p_company_id,'knowledge.write')
      then raise exception 'forbidden' using errcode='42501';end if;
  elsif p_action in ('approve','request_changes') then
    if not private.actor_may_review_company(p_company_id) then raise exception 'forbidden' using errcode='42501';end if;
  else raise exception 'invalid_input' using errcode='22023';end if;
  if p_requester is not null and not exists(select 1 from public.company_members m join auth.users u on u.id=m.user_id
    where m.company_id=p_company_id and m.user_id=p_requester and m.role='owner' and m.status='active' and u.email_confirmed_at is not null)
    then raise exception 'requester_revoked' using errcode='42501';end if;
end; $$;

create function private.g03_manifest(p_company_id uuid,p_requester uuid) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object('company',to_jsonb(c)-'created_at'-'updated_at',
  'requester',jsonb_build_object('user_id',p_requester,
    'verified_email',coalesce((select u.email_confirmed_at is not null from auth.users u where u.id=p_requester),false),
    'email_sha256',(select private.g03_sha(lower(coalesce(u.email,''))) from auth.users u where u.id=p_requester),'active_owner',exists(
    select 1 from public.company_members m where m.company_id=c.id and m.user_id=p_requester and m.role='owner' and m.status='active')),
  'sources',coalesce((select jsonb_agg(jsonb_build_object(
    'id',k.id,'company_id',k.company_id,'kind',k.kind,'title',k.title,'usage_role',k.usage_role,
    'status',k.status,'content_version',k.content_version,'text_sha256',private.g03_sha(k.content),
    'approved_for_answers',k.approved_for_answers,'approved_version',k.approved_version,'approved_at',k.approved_at,'approved_by',k.approved_by,
    'storage_path',k.storage_path,'file_name',k.file_name,'content_type',k.content_type,'byte_size',k.byte_size,
    'prepared_file_sha256',k.prepared_file_sha256,'prepared_text_sha256',k.prepared_text_sha256,'prepared_content_version',k.prepared_content_version)
    order by k.id) from public.knowledge_sources k where k.company_id=c.id),'[]'::jsonb))
from public.companies c where c.id=p_company_id;
$$;

create function private.g03_readiness(p_company_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare n integer;
begin
  if not exists(select 1 from public.companies where id=p_company_id and status<>'suspended'
    and btrim(display_name)<>'' and btrim(business_type)<>'' and btrim(hours)<>'' ) then return 'PROFILE_INCOMPLETE';end if;
  select count(*) into n from public.knowledge_sources where company_id=p_company_id
    and status='ready' and approved_for_answers and approved_version=content_version and btrim(content)<>'';
  if n>40 then return 'SOURCE_LIMIT';end if;
  if not exists(select 1 from public.knowledge_sources where company_id=p_company_id and usage_role='knowledge'
    and status='ready' and approved_for_answers and approved_version=content_version and btrim(content)<>'') then return 'KNOWLEDGE_INCOMPLETE';end if;
  if exists(select 1 from public.knowledge_sources where company_id=p_company_id and kind='file'
    and status='ready' and approved_for_answers and approved_version=content_version and btrim(content)<>''
    and (prepared_file_sha256 is null or prepared_content_version is distinct from content_version
      or prepared_text_sha256 is distinct from private.g03_sha(content))) then return 'FILE_REPREPARE_REQUIRED';end if;
  return 'OK';
end; $$;

create function private.g03_proof_current(p_company_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select coalesce((select r.submitted_manifest_sha256=private.g03_sha(private.g03_manifest(r.company_id,r.requested_by)::text)
  and r.submitted_input_epoch=g.input_epoch and private.g03_readiness(r.company_id)='OK'
  from public.company_review_requests r join private.g03_company_inputs g using(company_id) where r.company_id=p_company_id),false);
$$;

-- Preserve the existing JSON contract and append honest DB validity/observation time.
alter function private.company_review_request_json(uuid) rename to company_review_request_json_pre_g03;
create function private.company_review_request_json(p_company_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
select private.company_review_request_json_pre_g03(p_company_id)||jsonb_build_object(
  'proof_current',private.g03_proof_current(p_company_id),'proof_checked_at',r.proof_checked_at,
  'submitted_manifest_sha256',r.submitted_manifest_sha256)
from public.company_review_requests r where company_id=p_company_id;
$$;

create function public.g03_begin_review_check(
  p_action text,p_company_id uuid,p_expected_revision integer default null,p_number_ownership text default null,
  p_whatsapp_number text default null,p_readiness_confirmed boolean default null,p_owner_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();requester uuid;manifest jsonb;epoch bigint;intent jsonb;check_id uuid;code text;wa text;rec public.company_review_requests%rowtype;
begin
  if p_action not in ('submit','resubmit','approve') or p_action is null or p_company_id is null then raise exception 'invalid_input' using errcode='22023';end if;
  select * into rec from public.company_review_requests where company_id=p_company_id;
  requester:=case when p_action='approve' then rec.requested_by else actor end;
  perform private.g03_lock_actor(p_company_id,p_action,requester);
  select input_epoch into epoch from private.g03_company_inputs where company_id=p_company_id for update nowait;
  if not found then raise exception 'not_found' using errcode='P0002';end if;
  if p_action='approve' and (rec.status is distinct from 'pending_review' or rec.revision is distinct from p_expected_revision
    or not private.g03_proof_current(p_company_id)) then return jsonb_build_object('ok',false,'code','CONFLICT','request',private.company_review_request_json(p_company_id));end if;
  if p_action<>'submit' and (rec.company_id is null or rec.revision is distinct from p_expected_revision) then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  code:=private.g03_readiness(p_company_id);
  if code<>'OK' then return jsonb_build_object('ok',false,'code',code);end if;
  wa:=btrim(coalesce(p_whatsapp_number,''));
  if p_action in ('submit','resubmit') then
    if p_readiness_confirmed is distinct from true or p_number_ownership not in ('own','new') or p_number_ownership is null
      or length(wa)>40 or (p_number_ownership='own' and wa='') then raise exception 'invalid_input' using errcode='22023';end if;
    if p_number_ownership='new' then wa:='';end if;
  end if;
  intent:=jsonb_build_object('action',p_action,'revision',p_expected_revision,'ownership',p_number_ownership,
    'number',wa,'ready',p_readiness_confirmed,'note',btrim(coalesce(p_owner_note,'')));
  manifest:=private.g03_manifest(p_company_id,requester);
  insert into private.g03_review_checks(company_id,actor_id,session_id,action,expected_revision,input_epoch,manifest,manifest_sha256,intent_sha256)
    values(p_company_id,actor,(auth.jwt()->>'session_id')::uuid,p_action,p_expected_revision,epoch,manifest,private.g03_sha(manifest::text),private.g03_sha(intent::text)) returning id into check_id;
  return jsonb_build_object('ok',true,'check_id',check_id,'files',coalesce((select jsonb_agg(s) from jsonb_array_elements(manifest->'sources') s
    where s->>'kind'='file' and s->>'status'='ready' and s->>'approved_for_answers'='true' and s->>'approved_version'=s->>'content_version'),'[]'::jsonb));
exception when lock_not_available then return jsonb_build_object('ok',false,'code','CONFLICT');
end; $$;

create function public.g03_complete_review_check(p_check_id uuid,p_observations jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.g03_review_checks%rowtype;expected jsonb;observed jsonb;n integer;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
  select * into c from private.g03_review_checks where id=p_check_id for update;
  if not found or c.consumed_at is not null or c.completed_at is not null or c.created_at<clock_timestamp()-interval '60 seconds'
    then return jsonb_build_object('ok',false,'code','PROOF_EXPIRED');end if;
  if jsonb_typeof(p_observations) is distinct from 'array' then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE');end if;
  select count(*) into n from jsonb_array_elements(c.manifest->'sources') s where s->>'kind'='file' and s->>'status'='ready'
    and s->>'approved_for_answers'='true' and s->>'approved_version'=s->>'content_version';
  if jsonb_array_length(p_observations)<>n then return jsonb_build_object('ok',false,'code','FILE_CHANGED');end if;
  if (select count(distinct o->>'source_id') from jsonb_array_elements(p_observations) o)<>n then return jsonb_build_object('ok',false,'code','FILE_CHANGED');end if;
  for expected in select s from jsonb_array_elements(c.manifest->'sources') s where s->>'kind'='file' and s->>'status'='ready'
    and s->>'approved_for_answers'='true' and s->>'approved_version'=s->>'content_version' loop
    select o into observed from jsonb_array_elements(p_observations) o where o->>'source_id'=expected->>'id';
    if observed is null or observed->>'sha256' is distinct from expected->>'prepared_file_sha256'
      or observed->>'byte_size' is distinct from expected->>'byte_size'
      or coalesce(observed->>'object_id','')='' or coalesce(observed->>'object_updated_at','')=''
      or (observed->>'observed_at')::timestamptz<c.created_at or (observed->>'observed_at')::timestamptz>clock_timestamp()
      then return jsonb_build_object('ok',false,'code','FILE_CHANGED');end if;
  end loop;
  update private.g03_review_checks set observations=p_observations,completed_at=clock_timestamp() where id=c.id;
  return jsonb_build_object('ok',true);
end; $$;

create function public.g03_publish_prepared_file(p_actor_id uuid,p_session_id uuid,p_source_id uuid,p_company_id uuid,
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

create or replace function public.transition_company_review(
  p_action text,p_company_id uuid,p_expected_revision integer default null,p_number_ownership text default null,
  p_whatsapp_number text default null,p_readiness_confirmed boolean default null,p_owner_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();rec public.company_review_requests%rowtype;check_row private.g03_review_checks%rowtype;
  requester uuid;epoch bigint;manifest jsonb;intent jsonb;wa text:=btrim(coalesce(p_whatsapp_number,''));note text:=btrim(coalesce(p_owner_note,''));before_row jsonb;after_row jsonb;current_proof boolean;
begin
  if p_company_id is null or p_action is null or p_action not in ('submit','resubmit','approve','request_changes') then raise exception 'invalid_input' using errcode='22023';end if;
  select requested_by into requester from public.company_review_requests where company_id=p_company_id;
  if p_action in ('submit','resubmit') then requester:=actor;end if;
  perform private.g03_lock_actor(p_company_id,p_action,case when p_action='approve' then requester else null end);
  select input_epoch into epoch from private.g03_company_inputs where company_id=p_company_id for update nowait;
  if not found then raise exception 'not_found' using errcode='P0002';end if;
  select * into rec from public.company_review_requests where company_id=p_company_id for update nowait;
  before_row:=private.company_review_request_json(p_company_id);
  current_proof:=private.g03_proof_current(p_company_id);
  if p_action<>'submit' and (rec.company_id is null or p_expected_revision is distinct from rec.revision) then
    return jsonb_build_object('ok',false,'code','CONFLICT','request',before_row);end if;
  if p_action in ('submit','resubmit') then
    if p_readiness_confirmed is distinct from true or p_number_ownership is null or p_number_ownership not in ('own','new')
      or length(wa)>40 or (p_number_ownership='own' and wa='') then raise exception 'invalid_input' using errcode='22023';end if;
    if p_number_ownership='new' then wa:='';end if;
  end if;
  if p_action<>'request_changes' then
    intent:=jsonb_build_object('action',p_action,'revision',p_expected_revision,'ownership',p_number_ownership,'number',wa,'ready',p_readiness_confirmed,'note',note);
    manifest:=private.g03_manifest(p_company_id,requester);
    select * into check_row from private.g03_review_checks where company_id=p_company_id and actor_id=actor
      and session_id=(auth.jwt()->>'session_id')::uuid and action=p_action and expected_revision is not distinct from p_expected_revision
      and intent_sha256=private.g03_sha(intent::text) and completed_at is not null and consumed_at is null
      and created_at>clock_timestamp()-interval '60 seconds' order by created_at desc limit 1 for update;
    if not found then return jsonb_build_object('ok',false,'code','PROOF_REQUIRED','request',before_row);end if;
    if check_row.input_epoch<>epoch or check_row.manifest_sha256<>private.g03_sha(manifest::text)
      or private.g03_readiness(p_company_id)<>'OK' then return jsonb_build_object('ok',false,'code','CONFLICT','request',before_row);end if;
    if p_action='approve' and not current_proof then return jsonb_build_object('ok',false,'code','CONFLICT','request',before_row);end if;
  end if;
  if p_action='submit' and rec.company_id is not null then
    if current_proof and rec.requested_by=actor and rec.number_ownership=p_number_ownership and rec.whatsapp_number=wa
      and rec.readiness_confirmed=p_readiness_confirmed then
      update private.g03_review_checks set consumed_at=clock_timestamp() where id=check_row.id;
      return jsonb_build_object('ok',true,'code','EXISTING','request',before_row);
    end if;
    return jsonb_build_object('ok',false,'code','CONFLICT','request',before_row);
  end if;
  if p_action='resubmit' and rec.status<>'changes_requested' and current_proof then return jsonb_build_object('ok',false,'code','CONFLICT','request',before_row);end if;
  if p_action in ('approve','request_changes') and rec.status<>'pending_review' then return jsonb_build_object('ok',false,'code','CONFLICT','request',before_row);end if;
  if length(note)>2000 or (p_action='request_changes' and note='') then raise exception 'invalid_input' using errcode='22023';end if;
  if p_action='submit' then
    insert into public.company_review_requests(company_id,requested_by,number_ownership,whatsapp_number,readiness_confirmed,status,revision,
      submitted_manifest,submitted_manifest_sha256,submitted_input_epoch,submitted_intent_sha256,proof_checked_at)
    values(p_company_id,actor,p_number_ownership,wa,true,'pending_review',1,manifest,check_row.manifest_sha256,epoch,check_row.intent_sha256,check_row.completed_at);
  elsif p_action='resubmit' then
    update public.company_review_requests set requested_by=actor,number_ownership=p_number_ownership,whatsapp_number=wa,readiness_confirmed=true,
      requested_at=clock_timestamp(),status='pending_review',revision=revision+1,decided_by=null,decided_at=null,owner_note='',
      submitted_manifest=manifest,submitted_manifest_sha256=check_row.manifest_sha256,submitted_input_epoch=epoch,
      submitted_intent_sha256=check_row.intent_sha256,proof_checked_at=check_row.completed_at where company_id=p_company_id;
  else
    update public.company_review_requests set status=case p_action when 'approve' then 'approved' else 'changes_requested' end,
      revision=revision+1,decided_by=actor,decided_at=clock_timestamp(),owner_note=note,
      proof_checked_at=case p_action when 'approve' then check_row.completed_at else proof_checked_at end where company_id=p_company_id;
  end if;
  if check_row.id is not null then update private.g03_review_checks set consumed_at=clock_timestamp() where id=check_row.id;end if;
  after_row:=private.company_review_request_json(p_company_id);
  perform private.write_admin_audit(actor,p_company_id,'review.'||p_action,before_row,after_row);
  return jsonb_build_object('ok',true,'code','OK','request',after_row);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','CONFLICT');
end; $$;

-- Dedicated read: legacy rows remain historical, never silently called current.
create function public.g03_read_review_request(p_company_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    join private.app_session_activity a on a.session_id=s.id and a.user_id=u.id
    where u.id=auth.uid() and u.email_confirmed_at is not null and s.id=(auth.jwt()->>'session_id')::uuid
    and a.expired_at is null and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours')
    then raise exception 'forbidden' using errcode='42501';end if;
  if not exists(select 1 from public.companies where id=p_company_id and status<>'suspended') then raise exception 'forbidden' using errcode='42501';end if;
  if not exists(select 1 from public.company_members where company_id=p_company_id and user_id=auth.uid() and role='owner' and status='active')
    and not private.actor_may_review_company(p_company_id) then raise exception 'forbidden' using errcode='42501';end if;
  return private.company_review_request_json(p_company_id);
end; $$;

revoke all on function private.g03_sha(text),private.g03_bump_inputs(),private.g03_prepared_file_guard(),
  private.g03_lock_actor(uuid,text,uuid),private.g03_manifest(uuid,uuid),private.g03_readiness(uuid),private.g03_proof_current(uuid),
  private.company_review_request_json(uuid) from public,anon,authenticated,service_role;
revoke all on function public.g03_begin_review_check(text,uuid,integer,text,text,boolean,text),public.g03_read_review_request(uuid),
  public.g03_complete_review_check(uuid,jsonb),public.g03_publish_prepared_file(uuid,uuid,uuid,uuid,integer,text,text,text,bigint,uuid,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.g03_begin_review_check(text,uuid,integer,text,text,boolean,text),public.g03_read_review_request(uuid) to authenticated;
grant execute on function public.g03_complete_review_check(uuid,jsonb),
  public.g03_publish_prepared_file(uuid,uuid,uuid,uuid,integer,text,text,text,bigint,uuid,timestamptz) to service_role;
-- Keep the existing authenticated-only transition grant.
comment on column public.company_review_requests.proof_checked_at is 'Storage bytes observed at this check time only; no permanent or DB/Storage atomic guarantee.';
comment on column public.knowledge_sources.prepared_file_sha256 is 'Trusted SHA-256 of the actual extraction buffer, bound to prepared text/version. NULL for legacy preparations.';
commit;

-- Local immutable setup uploads and durable deletion. No approved policy is seeded.
begin;
alter table public.company_setup_drafts add column file_deletion_started_at timestamptz;
alter table public.companies add column setup_file_destruction_at timestamptz;
create table private.master_setup_file_policy(country text primary key,state text not null check(state in ('UNCONFIGURED','APPROVED')),approved_version text);
create table private.master_setup_file_intents(
 id uuid primary key,draft_id uuid not null references public.company_setup_drafts(draft_id),company_id uuid not null references public.companies(id),
 user_id uuid not null references auth.users(id),draft_generation bigint not null,source_id uuid not null unique,
 path text not null unique,file_name text not null,content_type text not null,byte_size bigint not null,
 state text not null default 'reserved' check(state in ('reserved','uploaded','ready','deletion_pending','deleted')),
 object_id uuid,object_updated_at timestamptz,upload_until timestamptz not null default clock_timestamp()+interval '5 minutes'
);
create table private.master_setup_file_jobs(
 id uuid primary key default gen_random_uuid(),intent_id uuid not null unique references private.master_setup_file_intents(id),
 state text not null check(state in ('blocked','queued','claimed','retry','deleted','cancelled','escalated')),
 reason text not null check(reason in ('manual_cancel','free_expiry','file_remove','paid_retention')),
 payment_receipt_id uuid,claim_token uuid,lease_until timestamptz,next_attempt_at timestamptz not null default clock_timestamp(),
 attempts integer not null default 0,last_error text,started_at timestamptz,finished_at timestamptz
);
create table private.master_setup_file_obligations(
 draft_id uuid not null references public.company_setup_drafts(draft_id),receipt_id uuid not null,
 company_id uuid not null references public.companies(id),state text not null default 'requires_financial_reconciliation',created_at timestamptz not null default clock_timestamp(),primary key(draft_id,receipt_id)
);
alter table private.master_setup_file_policy enable row level security;alter table private.master_setup_file_intents enable row level security;
alter table private.master_setup_file_jobs enable row level security;alter table private.master_setup_file_obligations enable row level security;
revoke all on private.master_setup_file_policy,private.master_setup_file_intents,private.master_setup_file_jobs,private.master_setup_file_obligations from public,anon,authenticated,service_role;
create function private.master_setup_scoped_path(p text) returns boolean language sql immutable set search_path='' as $$select p ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/setup/[a-f0-9-]{36}/[^/]+$'$$;
create function private.master_setup_delete_path_valid(p text,cid uuid,sid uuid) returns boolean language sql immutable set search_path='' as $$select p like cid::text||'/'||sid::text||'/%' and p !~ '[%\\[:cntrl:]]' and not exists(select 1 from unnest(string_to_array(p,'/')) v where v in('','.','..'))$$;
create function private.master_setup_file_policy_approved(cid uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.master_setup_file_policy p join public.companies c on c.country=p.country where c.id=cid and p.state='APPROVED' and nullif(p.approved_version,'') is not null)$$;
create function private.master_setup_enqueue_file(p_intent uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$declare i private.master_setup_file_intents;begin
 select * into i from private.master_setup_file_intents where id=p_intent;
 update private.master_setup_file_intents set state='deletion_pending' where id=p_intent and state<>'deleted';
 update public.knowledge_sources set approved_for_answers=false,approved_version=null,approved_at=null,approved_by=null where id=i.source_id and company_id=i.company_id;
 insert into private.master_setup_file_jobs(intent_id,state,reason,payment_receipt_id) values(i.id,case when private.master_setup_file_policy_approved(i.company_id) then 'queued' else 'blocked' end,p_reason,private.master_setup_draft_paid_receipt(i.company_id)) on conflict(intent_id) do update set reason=excluded.reason,payment_receipt_id=excluded.payment_receipt_id,state=excluded.state,next_attempt_at=clock_timestamp(),claim_token=null,lease_until=null,last_error=null where master_setup_file_jobs.started_at is null and master_setup_file_jobs.state='cancelled' and p_reason='paid_retention';
end;$$;
create function private.master_setup_close_files() returns trigger language plpgsql security definer set search_path='' as $$declare i record;begin
 if new.state in ('cancelled','deletion_pending') and old.state is distinct from new.state then
 for i in select id from private.master_setup_file_intents where draft_id=new.draft_id and state<>'deleted' loop perform private.master_setup_enqueue_file(i.id,case when new.state='cancelled' then 'manual_cancel' else 'free_expiry' end);end loop;
 end if;return new;
end;$$;
create trigger master_setup_close_files after update of state on public.company_setup_drafts for each row execute function private.master_setup_close_files();
create function public.master_reserve_setup_file(p_expected_user_id uuid,p_company_id uuid,p_draft_id uuid,p_expected_generation bigint,p_attempt_id uuid,p_file_name text,p_content_type text,p_byte_size bigint) returns jsonb language plpgsql security definer set search_path='' as $$declare d public.company_setup_drafts;i private.master_setup_file_intents;sid uuid;path text;begin
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if p_attempt_id is null or p_file_name is null or length(p_file_name) not between 1 and 180 or p_file_name ~ '[/\\[:cntrl:]]' or p_content_type is null or length(p_content_type)>120 or p_byte_size is null or p_byte_size not between 1 and 10485760 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_expected_user_id::text||':setup-draft',0));perform 1 from public.companies where id=p_company_id for update;
 select * into d from public.company_setup_drafts where draft_id=p_draft_id and user_id=p_expected_user_id and company_id=p_company_id for update;
 if d.draft_id is null or not private.master_setup_draft_session(p_expected_user_id) or not public.can_use_company_setup_draft(p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if d.state<>'active' or d.file_deletion_started_at is not null or (d.paid_protected_at is null and clock_timestamp()>=d.expires_at) then return jsonb_build_object('ok',false,'code','DRAFT_CLOSED');end if;
 select * into i from private.master_setup_file_intents where id=p_attempt_id;
 if i.id is not null then
 if i.draft_id<>d.draft_id or i.file_name<>p_file_name or i.content_type<>p_content_type or i.byte_size<>p_byte_size then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if i.state in ('deletion_pending','deleted') then return jsonb_build_object('ok',false,'code','FILE_CLOSED');end if;
 else
 if p_expected_generation is distinct from d.generation then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 sid:=gen_random_uuid();path:=p_company_id::text||'/'||sid::text||'/setup/'||p_attempt_id::text||'/'||p_file_name;
 insert into private.master_setup_file_intents(id,draft_id,company_id,user_id,draft_generation,source_id,path,file_name,content_type,byte_size) values(p_attempt_id,d.draft_id,p_company_id,p_expected_user_id,d.generation,sid,path,p_file_name,p_content_type,p_byte_size) returning * into i;
 insert into public.knowledge_sources(id,company_id,kind,title,content,file_name,content_type,byte_size,storage_path,status,created_by) values(sid,p_company_id,'file',left(p_file_name,200),'',p_file_name,p_content_type,p_byte_size,path,'draft',p_expected_user_id);
 -- A new in-flight file invalidates a previous deletion preview without claiming confirmed activity.
 update public.company_setup_drafts set revision=revision+1,generation=generation+1,updated_at=clock_timestamp() where draft_id=d.draft_id returning * into d;
 end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('intentId',i.id,'sourceId',i.source_id,'path',i.path,'state',i.state,'draftGeneration',d.generation,'draftRevision',d.revision));
end;$$;
create function private.master_setup_upload_allowed(p text) returns boolean language sql volatile security definer set search_path='' as $$select exists(select 1 from private.master_setup_file_intents i join public.company_setup_drafts d on d.draft_id=i.draft_id join public.companies c on c.id=i.company_id where i.path=p and i.user_id=auth.uid() and i.state='reserved' and i.upload_until>clock_timestamp() and d.state='active' and d.file_deletion_started_at is null and c.setup_file_destruction_at is null and private.master_setup_draft_session(auth.uid()) and public.can_use_company_setup_draft(i.company_id))$$;
create function private.master_setup_unscoped_upload_allowed(p text) returns boolean language plpgsql volatile security definer set search_path='' as $$declare cid uuid;begin
 begin cid:=split_part(p,'/',1)::uuid;exception when invalid_text_representation then return true;end;
 if exists(select 1 from public.companies where id=cid and setup_file_destruction_at is not null) then return false;end if;
 return not exists(select 1 from public.company_setup_drafts where company_id=cid and state='active') or exists(select 1 from public.knowledge_sources k where k.company_id=cid and k.storage_path=p and not exists(select 1 from private.master_setup_file_intents i where i.source_id=k.id));
end;$$;
create function private.master_setup_object_access(p text,p_write boolean default false) returns boolean language plpgsql volatile security definer set search_path='' as $$declare cid uuid;begin
 begin cid:=split_part(p,'/',1)::uuid;exception when invalid_text_representation then return true;end;
 if exists(select 1 from public.companies where id=cid and setup_file_destruction_at is not null) then return false;end if;
 if exists(select 1 from private.master_setup_file_intents where path=p) then
  if p_write then return false;end if;
  return exists(select 1 from private.master_setup_file_intents i join public.company_setup_drafts d on d.draft_id=i.draft_id where i.path=p and i.state in('uploaded','ready') and d.state in('active','completed') and d.file_deletion_started_at is null);
 end if;return true;
end;$$;
create policy master_setup_storage_read on storage.objects as restrictive for select to authenticated using(bucket_id<>'company-knowledge' or (not private.master_setup_scoped_path(name) and private.master_setup_object_access(name,false)));
create policy master_setup_storage_insert on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'company-knowledge' or case when private.master_setup_scoped_path(name) then private.master_setup_upload_allowed(name) else private.master_setup_unscoped_upload_allowed(name) end);
create policy master_setup_storage_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'company-knowledge' or (not private.master_setup_scoped_path(name) and private.master_setup_object_access(name,true))) with check(bucket_id<>'company-knowledge' or (not private.master_setup_scoped_path(name) and private.master_setup_object_access(name,true)));
create policy master_setup_storage_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'company-knowledge' or (not private.master_setup_scoped_path(name) and private.master_setup_object_access(name,true)));
create function private.master_setup_record_object() returns trigger language plpgsql security definer set search_path='' as $$declare i private.master_setup_file_intents;d public.company_setup_drafts;begin
 if new.bucket_id<>'company-knowledge' then return new;end if;
 select * into i from private.master_setup_file_intents where path=new.name;if i.id is null then return new;end if;
 select * into d from public.company_setup_drafts where draft_id=i.draft_id;
 update private.master_setup_file_intents set object_id=new.id,object_updated_at=new.updated_at,state=case when d.state in ('active','completed') then 'uploaded' else 'deletion_pending' end where id=i.id;
 if d.state not in ('active','completed') then
 perform private.master_setup_enqueue_file(i.id,case when d.state='cancelled' then 'manual_cancel' else 'free_expiry' end);
 -- Sweep late object arrival even if a prior absence check already completed.
 update private.master_setup_file_jobs set state=case when private.master_setup_file_policy_approved(i.company_id) then 'queued' else 'blocked' end,next_attempt_at=clock_timestamp(),finished_at=null where intent_id=i.id and state='deleted';
 end if;return new;
end;$$;
create trigger master_setup_record_object after insert on storage.objects for each row execute function private.master_setup_record_object();
create function public.master_finalize_setup_file(p_expected_user_id uuid,p_intent_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare i private.master_setup_file_intents;d public.company_setup_drafts;n timestamptz;begin
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 select * into i from private.master_setup_file_intents where id=p_intent_id and user_id=p_expected_user_id;if i.id is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_expected_user_id::text||':setup-draft',0));perform 1 from public.companies where id=i.company_id for update;
 select * into d from public.company_setup_drafts where draft_id=i.draft_id for update;n:=clock_timestamp();
 if not private.master_setup_draft_session(p_expected_user_id) or not public.can_use_company_setup_draft(i.company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if d.state<>'active' or d.file_deletion_started_at is not null then return jsonb_build_object('ok',false,'code','DRAFT_CLOSED');end if;
 select * into i from private.master_setup_file_intents where id=p_intent_id for update;
 if i.state='ready' then return jsonb_build_object('ok',true,'sourceId',i.source_id,'draftGeneration',d.generation);end if;
 if not exists(select 1 from storage.objects o where o.id=i.object_id and o.name=i.path and o.bucket_id='company-knowledge' and o.updated_at=i.object_updated_at) then return jsonb_build_object('ok',false,'code','OBJECT_MISSING');end if;
 update private.master_setup_file_intents set state='ready' where id=i.id;
 update public.knowledge_sources set status='stored' where id=i.source_id and company_id=i.company_id;
 update public.company_setup_drafts set revision=revision+1,generation=generation+1,last_meaningful_activity_at=n,updated_at=n,expires_at=case when paid_protected_at is null then n+interval '720 hours' else null end where draft_id=d.draft_id returning * into d;
 perform private.master_schedule_setup_draft(d.draft_id);
 return jsonb_build_object('ok',true,'sourceId',i.source_id,'draftGeneration',d.generation);
end;$$;
create function private.master_setup_source_visible(p_source uuid) returns boolean language sql volatile security definer set search_path='' as $$select not exists(select 1 from private.master_setup_file_intents where source_id=p_source) or exists(select 1 from private.master_setup_file_intents i join public.company_setup_drafts d on d.draft_id=i.draft_id where i.source_id=p_source and d.state in ('active','completed') and d.file_deletion_started_at is null and i.state in ('reserved','uploaded','ready'))$$;
create policy master_setup_source_gate on public.knowledge_sources as restrictive for all to authenticated using(private.master_setup_source_visible(id)) with check(private.master_setup_source_visible(id));
create function private.master_setup_guard_source() returns trigger language plpgsql security definer set search_path='' as $$declare i private.master_setup_file_intents;begin
 select * into i from private.master_setup_file_intents where source_id=case when tg_op='DELETE' then old.id else new.id end;
 if tg_op='DELETE' then if i.id is not null and i.state<>'deleted' then raise exception 'SCOPED_FILE_REQUIRES_DURABLE_DELETION' using errcode='42501';end if;return old;end if;
 if i.id is not null and (new.company_id<>i.company_id or new.kind<>'file' or new.storage_path is distinct from i.path or new.file_name is distinct from i.file_name or new.content_type is distinct from i.content_type or new.byte_size is distinct from i.byte_size) then raise exception 'IMMUTABLE_SETUP_FILE_SCOPE' using errcode='42501';end if;
 if i.id is null and (private.master_setup_scoped_path(new.storage_path) or (tg_op='INSERT' and new.kind='file' and exists(select 1 from public.company_setup_drafts where company_id=new.company_id and state='active'))) then raise exception 'SETUP_UPLOAD_INTENT_REQUIRED' using errcode='42501';end if;return new;
end;$$;
create trigger master_setup_guard_source before insert or update or delete on public.knowledge_sources for each row execute function private.master_setup_guard_source();
create function public.master_authorize_setup_file(p_expected_user_id uuid,p_company_id uuid,p_source_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare i private.master_setup_file_intents;begin
 if not private.master_setup_draft_session(p_expected_user_id) or not public.can_use_company_setup_draft(p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into i from private.master_setup_file_intents where source_id=p_source_id and company_id=p_company_id;
 if i.id is null then return jsonb_build_object('ok',false,'code','NOT_SCOPED');end if;
 if not private.master_setup_source_visible(p_source_id) or i.state not in ('uploaded','ready') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not exists(select 1 from storage.objects where id=i.object_id and name=i.path and bucket_id='company-knowledge' and updated_at=i.object_updated_at) then return jsonb_build_object('ok',false,'code','OBJECT_GENERATION_CHANGED');end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('path',i.path,'objectId',i.object_id,'objectUpdatedAt',i.object_updated_at,'fileName',i.file_name,'contentType',i.content_type,'byteSize',i.byte_size));
end;$$;
-- Preview scope is derived from durable intents, including unfinished uploads.
alter function public.master_setup_draft_action(uuid,uuid,bigint,bigint,text,uuid) set schema private;
alter function private.master_setup_draft_action(uuid,uuid,bigint,bigint,text,uuid) rename to master_setup_draft_action_pre_files;
revoke all on function private.master_setup_draft_action_pre_files(uuid,uuid,bigint,bigint,text,uuid) from public,anon,authenticated,service_role;
create function public.master_setup_draft_action(p_expected_user_id uuid,p_draft_id uuid,p_expected_revision bigint,p_expected_generation bigint,p_action text,p_confirmation_token uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;cnt integer;begin
 result:=private.master_setup_draft_action_pre_files(p_expected_user_id,p_draft_id,p_expected_revision,p_expected_generation,p_action,p_confirmation_token);
 if result->>'ok'='true' and p_action='preview_cancel' then
 select count(*) into cnt from private.master_setup_file_intents where draft_id=p_draft_id and state<>'deleted';
 result:=jsonb_set(result,'{data,scopedFileCount}',to_jsonb(cnt));result:=jsonb_set(result,'{data,scope}','"draft_and_setup_files"'::jsonb);
 end if;return result;
end;$$;
create function public.master_request_setup_file_delete(p_expected_user_id uuid,p_company_id uuid,p_source_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare i private.master_setup_file_intents;begin
 if not private.master_setup_draft_session(p_expected_user_id) or not public.can_use_company_setup_draft(p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_expected_user_id::text||':setup-draft',0));perform 1 from public.companies where id=p_company_id for update;
 if not private.master_setup_draft_session(p_expected_user_id) or not public.can_use_company_setup_draft(p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into i from private.master_setup_file_intents where source_id=p_source_id and company_id=p_company_id for update;
 if i.id is null then return jsonb_build_object('ok',false,'code','NOT_SCOPED');end if;
 perform private.master_setup_enqueue_file(i.id,'file_remove');return jsonb_build_object('ok',true,'state','deletion_pending','cleanupPolicy',case when private.master_setup_file_policy_approved(p_company_id) then 'APPROVED' else 'UNCONFIGURED' end);
end;$$;
create function public.master_claim_setup_file_deletion() returns jsonb language plpgsql security definer set search_path='' as $$declare j private.master_setup_file_jobs;i private.master_setup_file_intents;d public.company_setup_drafts;receipt uuid;n timestamptz;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select q.* into j from private.master_setup_file_jobs q join private.master_setup_file_intents x on x.id=q.intent_id where q.state in ('blocked','queued','retry','claimed') and q.next_attempt_at<=clock_timestamp() and (q.lease_until is null or q.lease_until<=clock_timestamp()) and private.master_setup_file_policy_approved(x.company_id) order by q.next_attempt_at,q.id limit 1;
 if j.id is null then
  if exists(select 1 from private.master_setup_file_jobs q join private.master_setup_file_intents x on x.id=q.intent_id where q.state in('blocked','queued','retry') and not private.master_setup_file_policy_approved(x.company_id)) then return jsonb_build_object('ok',false,'code','LEGAL_POLICY_UNCONFIGURED');end if;
  return jsonb_build_object('ok',true,'claim',null);
 end if;
 select * into i from private.master_setup_file_intents where id=j.intent_id;
 perform 1 from public.companies where id=i.company_id for update;
 select * into j from private.master_setup_file_jobs where id=j.id for update skip locked;
 if not found or j.state not in ('blocked','queued','retry','claimed') or j.lease_until>clock_timestamp() then return jsonb_build_object('ok',true,'claim',null);end if;
 if not private.master_setup_file_policy_approved(i.company_id) then return jsonb_build_object('ok',false,'code','LEGAL_POLICY_UNCONFIGURED');end if;
 select * into d from public.company_setup_drafts where draft_id=i.draft_id for update;n:=clock_timestamp();receipt:=private.master_setup_draft_paid_receipt(i.company_id);
 if j.started_at is null and d.file_deletion_started_at is null and receipt is distinct from j.payment_receipt_id then update private.master_setup_file_jobs set state='cancelled',last_error='PAYMENT_WON' where id=j.id;return jsonb_build_object('ok',true,'claim',null);end if;
 if not private.master_setup_delete_path_valid(i.path,i.company_id,i.source_id) or (not private.master_setup_scoped_path(i.path) and j.reason<>'paid_retention') then update private.master_setup_file_jobs set state='escalated',last_error='FILE_SCOPE_REVIEW_REQUIRED' where id=j.id;return jsonb_build_object('ok',false,'code','FILE_SCOPE_REVIEW_REQUIRED');end if;
 -- An upload accepted before closure may still be in flight. Do not certify absence early.
 if i.object_id is null and i.upload_until>clock_timestamp() then update private.master_setup_file_jobs set next_attempt_at=i.upload_until where id=j.id;return jsonb_build_object('ok',true,'claim',null,'code','UPLOAD_IN_FLIGHT');end if;
 -- This committed cutover wins against subsequent payments. A lease is not a cancellation gate.
 if j.reason<>'file_remove' then
 update public.company_setup_drafts set file_deletion_started_at=coalesce(file_deletion_started_at,n) where draft_id=d.draft_id;
 if j.reason='paid_retention' then update public.companies set setup_file_destruction_at=coalesce(setup_file_destruction_at,n) where id=i.company_id;end if;
 end if;
 update private.master_setup_file_jobs set state='claimed',started_at=coalesce(started_at,n),claim_token=gen_random_uuid(),lease_until=n+interval '60 seconds',attempts=attempts+1 where id=j.id returning * into j;
 return jsonb_build_object('ok',true,'claim',jsonb_build_object('jobId',j.id,'claimToken',j.claim_token,'bucket','company-knowledge','path',i.path,'objectId',i.object_id,'objectUpdatedAt',i.object_updated_at,'companyId',i.company_id,'sourceId',i.source_id,'reason',j.reason,'pathBindingVerified',private.master_setup_delete_path_valid(i.path,i.company_id,i.source_id)));
end;$$;
create function public.master_inspect_setup_file_object(p_path text) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not exists(select 1 from private.master_setup_file_intents where path=p_path) then raise insufficient_privilege;end if;
 select jsonb_build_object('id',id,'updatedAt',updated_at) into result from storage.objects where bucket_id='company-knowledge' and name=p_path;return result;
end;$$;
create function public.master_finish_setup_file_deletion(p_job_id uuid,p_claim_token uuid,p_outcome text) returns boolean language plpgsql security definer set search_path='' as $$declare j private.master_setup_file_jobs;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into j from private.master_setup_file_jobs where id=p_job_id and claim_token=p_claim_token and state='claimed' for update;if not found then return false;end if;
 if p_outcome='absent' and exists(select 1 from storage.objects o join private.master_setup_file_intents i on i.path=o.name where i.id=j.intent_id and o.bucket_id='company-knowledge') then return false;end if;
 if p_outcome='absent' then update private.master_setup_file_jobs set state='deleted',finished_at=clock_timestamp(),lease_until=null where id=j.id;update private.master_setup_file_intents set state='deleted' where id=j.intent_id;delete from public.knowledge_sources where id=(select source_id from private.master_setup_file_intents where id=j.intent_id);
 elsif p_outcome='generation_conflict' then update private.master_setup_file_jobs set state='escalated',last_error='OBJECT_GENERATION_CHANGED',lease_until=null where id=j.id;
 elsif p_outcome='retry' then update private.master_setup_file_jobs set state='retry',last_error='ABSENCE_UNCONFIRMED',lease_until=null,next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)) where id=j.id;
 else return false;end if;return true;
end;$$;
create function private.master_setup_payment_after_delete() returns trigger language plpgsql security definer set search_path='' as $$declare receipt uuid;begin
 perform 1 from public.companies where id=new.company_id for update;receipt:=private.master_setup_draft_paid_receipt(new.company_id);if receipt is null then return new;end if;
 insert into private.master_setup_file_obligations(draft_id,receipt_id,company_id) select draft_id,receipt,new.company_id from public.company_setup_drafts where company_id=new.company_id and file_deletion_started_at is not null on conflict do nothing;return new;
end;$$;
create constraint trigger master_setup_payment_after_delete after insert on public.billing_settlement_outcomes deferrable initially deferred for each row when(new.outcome='granted' and new.provider_environment='live') execute function private.master_setup_payment_after_delete();
-- Preserve native authorization and add a company tombstone fence when those kernels exist.
do $$declare name text;sig regprocedure;def text;begin
 foreach name in array array['private.user_has_company_capability(uuid,uuid,text)','public.has_company_capability(uuid,text)'] loop
 sig:=to_regprocedure(name);if sig is null then continue;end if;def:=pg_get_functiondef(sig);
 if name like 'private.%' then
 execute replace(def,'FUNCTION private.user_has_company_capability(','FUNCTION private.master_files_native_user_capability(');
 execute 'create or replace function private.user_has_company_capability(p_user_id uuid,p_company_id uuid,p_capability text) returns boolean language sql volatile security definer set search_path='''' as $body$select private.master_files_native_user_capability(p_user_id,p_company_id,p_capability) and not exists(select 1 from public.companies where id=p_company_id and setup_file_destruction_at is not null and p_capability=any(array[''wa.conversations.reply'',''wa.conversations.take_over'',''wa.conversations.resume'',''wa.conversations.close'',''wa.conversations.assign'',''ig.conversations.reply'',''ig.conversations.assign'',''knowledge.write'',''knowledge.delete'',''company.profile.write'',''company.staff.manage'']))$body$';
 revoke all on function private.master_files_native_user_capability(uuid,uuid,text),private.user_has_company_capability(uuid,uuid,text) from public,anon,authenticated,service_role;
 else
 execute replace(def,'FUNCTION public.has_company_capability(','FUNCTION private.master_files_native_has_capability(');
 execute 'create or replace function public.has_company_capability(p_company_id uuid,p_capability text) returns boolean language sql volatile security definer set search_path='''' as $body$select private.master_files_native_has_capability(p_company_id,p_capability) and not exists(select 1 from public.companies where id=p_company_id and setup_file_destruction_at is not null and p_capability=any(array[''wa.conversations.reply'',''wa.conversations.take_over'',''wa.conversations.resume'',''wa.conversations.close'',''wa.conversations.assign'',''ig.conversations.reply'',''ig.conversations.assign'',''knowledge.write'',''knowledge.delete'',''company.profile.write'',''company.staff.manage'']))$body$';
 revoke all on function private.master_files_native_has_capability(uuid,text) from public,anon,authenticated,service_role;revoke all on function public.has_company_capability(uuid,text) from public,anon,authenticated,service_role;grant execute on function public.has_company_capability(uuid,text) to authenticated;
 end if;
 end loop;
end;$$;
revoke all on function private.master_setup_scoped_path(text),private.master_setup_delete_path_valid(text,uuid,uuid),private.master_setup_file_policy_approved(uuid),private.master_setup_enqueue_file(uuid,text),private.master_setup_close_files(),private.master_setup_upload_allowed(text),private.master_setup_unscoped_upload_allowed(text),private.master_setup_object_access(text,boolean),private.master_setup_record_object(),private.master_setup_source_visible(uuid),private.master_setup_payment_after_delete(),private.master_setup_guard_source(),public.master_inspect_setup_file_object(text) from public,anon,authenticated,service_role;
grant execute on function private.master_setup_scoped_path(text),private.master_setup_upload_allowed(text),private.master_setup_unscoped_upload_allowed(text),private.master_setup_object_access(text,boolean),private.master_setup_source_visible(uuid) to authenticated;
revoke all on function public.master_reserve_setup_file(uuid,uuid,uuid,bigint,uuid,text,text,bigint),public.master_finalize_setup_file(uuid,uuid),public.master_authorize_setup_file(uuid,uuid,uuid),public.master_request_setup_file_delete(uuid,uuid,uuid),public.master_setup_draft_action(uuid,uuid,bigint,bigint,text,uuid),public.master_claim_setup_file_deletion(),public.master_finish_setup_file_deletion(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.master_reserve_setup_file(uuid,uuid,uuid,bigint,uuid,text,text,bigint),public.master_finalize_setup_file(uuid,uuid),public.master_authorize_setup_file(uuid,uuid,uuid),public.master_request_setup_file_delete(uuid,uuid,uuid),public.master_setup_draft_action(uuid,uuid,bigint,bigint,text,uuid) to authenticated;
grant execute on function public.master_claim_setup_file_deletion(),public.master_finish_setup_file_deletion(uuid,uuid,text),public.master_inspect_setup_file_object(text) to service_role;
notify pgrst,'reload schema';commit;

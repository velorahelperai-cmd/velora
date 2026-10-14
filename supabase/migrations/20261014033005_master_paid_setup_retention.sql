-- Paid setup retention uses native current financial proof and the same company
-- lock as settlement. Legal approval is intentionally empty by default.
begin;
create table private.master_paid_retention_policy(
 country text primary key,chat_version text,setup_version text,
 check(chat_version is null or length(btrim(chat_version))>0),
 check(setup_version is null or length(btrim(setup_version))>0)
);
create table private.master_paid_setup_retention(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),receipt_id uuid not null,
 expired_at timestamptz not null,delete_at timestamptz not null,
 state text not null default 'queued' check(state in('queued','blocked','started','deleted','cancelled','escalated')),
 deletion_started_at timestamptz,completed_at timestamptz,last_checked_at timestamptz not null default clock_timestamp(),
 unique(company_id,receipt_id)
);
create table private.master_paid_retention_notifications(
 episode_id uuid not null references private.master_paid_setup_retention(id),kind text not null check(kind in('setup_30d','setup_7d','setup_24h')),
 due_at timestamptz not null,state text not null default 'UNCONFIGURED' check(state in('UNCONFIGURED','queued','accepted','unknown','cancelled')),
 primary key(episode_id,kind)
);
create table private.master_paid_retention_checks(company_id uuid primary key references public.companies(id),checked_at timestamptz not null);
alter table private.master_paid_retention_policy enable row level security;
alter table private.master_paid_setup_retention enable row level security;
alter table private.master_paid_retention_notifications enable row level security;
alter table private.master_paid_retention_checks enable row level security;
revoke all on private.master_paid_retention_policy,private.master_paid_setup_retention,private.master_paid_retention_notifications,private.master_paid_retention_checks from public,anon,authenticated,service_role;
create function private.master_paid_retention_approved(cid uuid,kind text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.master_paid_retention_policy p join public.companies c on c.country=p.country where c.id=cid
  and case kind when 'chat' then p.chat_version is not null when 'setup' then p.setup_version is not null and private.master_setup_file_policy_approved(cid) else false end);
$$;
-- Keep the original worker and policy OIDs; backfill cannot mark unapproved
-- destruction completed. Unknown native bodies abort the entire migration.
do $$declare d text;anchor text:='if n>=e.delete_at and e.purged_at is null then';begin
 d:=replace(pg_get_functiondef('public.billing_run_expiry_company(uuid)'::regprocedure),chr(13),'');
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'PAID_RETENTION_EXPIRY_WORKER_DRIFT';end if;
 d:=replace(d,anchor,'if n>=e.delete_at and e.purged_at is null and private.master_paid_retention_approved(p_company_id,''chat'') then');execute d;
end;$$;
create function private.master_paid_setup_retention_locked(cid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;e private.master_paid_setup_retention;expiry timestamptz;n timestamptz;d public.company_setup_drafts;k public.knowledge_sources;i private.master_setup_file_intents;c public.companies;obj storage.objects;begin
 perform 1 from public.companies where id=cid for update;
 update private.master_paid_setup_retention set state='deleted',completed_at=clock_timestamp() where company_id=cid and state='started'
 and not exists(select 1 from private.master_setup_file_intents where company_id=cid and state<>'deleted');
 r:=private.billing_lifecycle_receipt(cid);n:=clock_timestamp();
 if r is null then return jsonb_build_object('ok',true,'setupRetention','NO_PROVEN_SUBSCRIPTION');end if;
 -- A confirmed newer receipt wins before any irreversible cutover, even while
 -- its activation is still waiting. A browser checkout never cancels this job.
 update private.master_paid_setup_retention set state='cancelled',last_checked_at=n where company_id=cid and receipt_id<>(r->>'receiptId')::uuid and deletion_started_at is null and state in('queued','blocked');
 update private.master_paid_retention_notifications x set state='cancelled' from private.master_paid_setup_retention z where x.episode_id=z.id and z.company_id=cid and z.state='cancelled' and x.state in('UNCONFIGURED','queued');
 expiry:=nullif(r->>'expiredAt','')::timestamptz;
 if expiry is null or not isfinite(expiry) or n<expiry then return jsonb_build_object('ok',true,'setupRetention','ACTIVE_OR_AWAITING_ACTIVATION');end if;
 insert into private.master_paid_setup_retention(company_id,receipt_id,expired_at,delete_at) values(cid,(r->>'receiptId')::uuid,expiry,expiry+interval '2160 hours') on conflict(company_id,receipt_id) do nothing;
 select * into e from private.master_paid_setup_retention where company_id=cid and receipt_id=(r->>'receiptId')::uuid for update;
 update private.master_paid_setup_retention set last_checked_at=n where id=e.id;
 insert into private.master_paid_retention_notifications(episode_id,kind,due_at) values(e.id,'setup_30d',e.delete_at-interval '720 hours'),(e.id,'setup_7d',e.delete_at-interval '168 hours'),(e.id,'setup_24h',e.delete_at-interval '24 hours') on conflict do nothing;
 if e.state in('cancelled','deleted','escalated') then return jsonb_build_object('ok',true,'setupRetention',upper(e.state));end if;
 if e.deletion_started_at is not null then return jsonb_build_object('ok',true,'setupRetention','DELETION_PENDING','requiresNewBusiness',true);end if;
 if n<e.delete_at then return jsonb_build_object('ok',true,'setupRetention','RETAINED','deleteAt',e.delete_at);end if;
 if not private.master_paid_retention_approved(cid,'setup') then update private.master_paid_setup_retention set state='blocked' where id=e.id;return jsonb_build_object('ok',true,'setupRetention','LEGAL_POLICY_UNCONFIGURED');end if;
 select * into c from public.companies where id=cid;
 -- Only paths proven to belong to this company and source can enter an external
 -- deletion job. Legacy/foreign ambiguity needs review, never a guessed purge.
 if exists(select 1 from public.knowledge_sources s where s.company_id=cid and s.kind='file' and s.storage_path is not null
  and not exists(select 1 from private.master_setup_file_intents x where x.source_id=s.id and x.company_id=cid and x.path=s.storage_path)
  and not private.master_setup_delete_path_valid(s.storage_path,cid,s.id)) then
  update private.master_paid_setup_retention set state='escalated' where id=e.id;return jsonb_build_object('ok',true,'setupRetention','FILE_SCOPE_REVIEW_REQUIRED');end if;
 -- Validate orphan paths and source collisions before any irreversible cutover.
 if exists(select 1 from storage.objects o where o.bucket_id='company-knowledge' and o.name like cid::text||'/%'
  and not exists(select 1 from private.master_setup_file_intents x where x.path=o.name)
  and (split_part(o.name,'/',2) !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or o.name ~ '[%\\[:cntrl:]]' or exists(select 1 from unnest(string_to_array(o.name,'/')) v where v in('','.','..'))
   or exists(select 1 from private.master_setup_file_intents x where x.company_id=cid and x.source_id::text=split_part(o.name,'/',2) and x.path<>o.name)))
 or exists(select 1 from storage.objects where bucket_id='company-knowledge' and name like cid::text||'/%' group by split_part(name,'/',2) having count(*)>1) then
  update private.master_paid_setup_retention set state='escalated' where id=e.id;return jsonb_build_object('ok',true,'setupRetention','FILE_SCOPE_REVIEW_REQUIRED');end if;
 select * into d from public.company_setup_drafts where company_id=cid order by updated_at desc,draft_id limit 1 for update;
 if d.draft_id is null then
  insert into public.company_setup_drafts(user_id,company_id,state,payload,last_meaningful_activity_at,expires_at,paid_protected_at,paid_protection_receipt_id)
  values(c.created_by,cid,'completed',jsonb_build_object('business',jsonb_build_object('name',c.display_name,'type',c.business_type,'replyLanguage',c.reply_language,'country',c.country,'city',c.city,'hours',c.hours,'contactPhone',c.contact_phone,'contactEmail',c.contact_email),'setupStep',0),n,null,n,e.receipt_id) returning * into d;
 end if;
 for k in select * from public.knowledge_sources where company_id=cid and kind='file' and storage_path is not null loop
  select * into i from private.master_setup_file_intents where source_id=k.id;
  if i.id is null then
   select * into obj from storage.objects where bucket_id='company-knowledge' and name=k.storage_path;
   insert into private.master_setup_file_intents(id,draft_id,company_id,user_id,draft_generation,source_id,path,file_name,content_type,byte_size,state,object_id,object_updated_at,upload_until)
   values(gen_random_uuid(),d.draft_id,cid,d.user_id,d.generation,k.id,k.storage_path,coalesce(k.file_name,k.id::text),coalesce(k.content_type,'application/octet-stream'),coalesce(k.byte_size,0),'ready',obj.id,obj.updated_at,n) returning * into i;
  end if;
  perform private.master_setup_enqueue_file(i.id,'paid_retention');
 end loop;
 -- Adopt orphaned objects only inside this company's knowledge namespace and
 -- with a valid source UUID. Never sweep a bucket or an unrecognised prefix.
 for obj in select * from storage.objects o where o.bucket_id='company-knowledge' and o.name like cid::text||'/%'
 and not exists(select 1 from private.master_setup_file_intents x where x.path=o.name) loop
  if split_part(obj.name,'/',2) !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or obj.name like '%/../%' or obj.name like '%//%' or split_part(obj.name,'/',3)='' then
   raise exception 'PAID_RETENTION_ORPHAN_SCOPE_REVIEW_REQUIRED';
  end if;
  insert into private.master_setup_file_intents(id,draft_id,company_id,user_id,draft_generation,source_id,path,file_name,content_type,byte_size,state,object_id,object_updated_at,upload_until)
  values(gen_random_uuid(),d.draft_id,cid,d.user_id,d.generation,split_part(obj.name,'/',2)::uuid,obj.name,split_part(obj.name,'/',3),'application/octet-stream',0,'ready',obj.id,obj.updated_at,n);
 end loop;
 -- Reserved uploads have no settled source yet. They must also be swept.
 for i in select * from private.master_setup_file_intents where company_id=cid and state<>'deleted' loop perform private.master_setup_enqueue_file(i.id,'paid_retention');end loop;
 update public.companies set setup_file_destruction_at=coalesce(setup_file_destruction_at,n),city='',hours='',contact_phone='',contact_email='' where id=cid;
 update public.company_setup_drafts set state='deletion_pending',file_deletion_started_at=coalesce(file_deletion_started_at,n),closed_at=coalesce(closed_at,n),generation=generation+1,revision=revision+1,
 payload=jsonb_build_object('business',jsonb_build_object('name','','type','other','replyLanguage','both','country','','city','','hours','','contactPhone','','contactEmail',''),'setupStep',0) where company_id=cid;
 delete from public.knowledge_sources s where s.company_id=cid and not exists(select 1 from private.master_setup_file_intents x where x.source_id=s.id and x.state<>'deleted');
 update private.master_paid_setup_retention set state='started',deletion_started_at=coalesce(deletion_started_at,n) where id=e.id;
 if not exists(select 1 from private.master_setup_file_intents where company_id=cid and state<>'deleted') then update private.master_paid_setup_retention set state='deleted',completed_at=n where id=e.id;return jsonb_build_object('ok',true,'setupRetention','DELETED','requiresNewBusiness',true);end if;
 return jsonb_build_object('ok',true,'setupRetention','DELETION_PENDING','requiresNewBusiness',true);
end;$$;
-- Reuse the native worker scheduler. It reaches day90 even after day60 chat purge.
alter function public.billing_run_expiry_company(uuid) rename to master_paid_native_run_expiry_company;
create function public.billing_run_expiry_company(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare r jsonb;t jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 perform 1 from public.companies where id=p_company_id for update;
 r:=public.master_paid_native_run_expiry_company(p_company_id);t:=private.master_paid_setup_retention_locked(p_company_id);
 insert into private.master_paid_retention_checks values(p_company_id,clock_timestamp()) on conflict(company_id) do update set checked_at=excluded.checked_at;
 return r||jsonb_build_object('setupRetention',t->>'setupRetention','requiresNewBusiness',coalesce((t->>'requiresNewBusiness')::boolean,false));
end;$$;
alter function public.billing_expiry_candidates(integer) rename to master_paid_native_expiry_candidates;
create function public.billing_expiry_candidates(p_limit integer default 10) returns jsonb language plpgsql security definer set search_path='' as $$declare native jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_limit not between 1 and 50 then raise exception 'INVALID_LIMIT';end if;
 native:=public.master_paid_native_expiry_candidates(50);
 return coalesce((select jsonb_agg(company_id) from(select q.company_id from(
  select value::uuid as company_id from jsonb_array_elements_text(native)
  union select company_id from private.billing_expiry_episodes where cancelled_at is null
  union select company_id from private.master_paid_setup_retention where state in('queued','blocked','started')
 ) q left join private.master_paid_retention_checks h on h.company_id=q.company_id
 where not exists(select 1 from private.master_paid_setup_retention z where z.company_id=q.company_id and z.state='deleted' and private.billing_lifecycle_receipt(q.company_id)->>'receiptId'=z.receipt_id::text)
 order by coalesce(h.checked_at,'-infinity'::timestamptz),q.company_id limit p_limit) v),'[]'::jsonb);
end;$$;
revoke all on function private.master_paid_retention_approved(uuid,text),private.master_paid_setup_retention_locked(uuid),public.master_paid_native_run_expiry_company(uuid),public.master_paid_native_expiry_candidates(integer),public.billing_run_expiry_company(uuid),public.billing_expiry_candidates(integer) from public,anon,authenticated,service_role;
grant execute on function public.billing_run_expiry_company(uuid),public.billing_expiry_candidates(integer) to service_role;
commit;

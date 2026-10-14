-- Reversible owner archive and audited deletion requests. No destructive executor.
begin;
alter table public.companies add column archived_at timestamptz;
create table private.master_business_archive_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into private.master_business_archive_settings default values;
create table private.master_business_lifecycle_audit(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete restrict,actor_id uuid not null,session_id uuid not null,event text not null check(event in('archive','restore','delete_request')),previous_version bigint not null,new_version bigint not null,created_at timestamptz not null default clock_timestamp());
create table private.master_business_deletion_policy(country text primary key,purpose_policy_version text,legal_policy_version text);
-- No identity document, MFA recency, AMR method, legal approval or country policy is invented here.
create table private.master_business_deletion_requests(id uuid primary key default gen_random_uuid(),attempt_id uuid not null,user_id uuid not null,session_id uuid not null,company_id uuid not null references public.companies(id) on delete restrict,expected_version bigint not null,reason text not null,state text not null default 'awaiting_stepup_policy' check(state in('awaiting_stepup_policy','awaiting_stepup','awaiting_legal_review')),legal_policy text not null default 'UNCONFIGURED' check(legal_policy='UNCONFIGURED'),created_at timestamptz not null default clock_timestamp(),unique(user_id,attempt_id));
alter table private.master_business_archive_settings enable row level security;
alter table private.master_business_lifecycle_audit enable row level security;
alter table private.master_business_deletion_policy enable row level security;
alter table private.master_business_deletion_requests enable row level security;
revoke all on private.master_business_archive_settings,private.master_business_lifecycle_audit,private.master_business_deletion_policy,private.master_business_deletion_requests from public,anon,authenticated,service_role;
create function private.master_company_not_archived(cid uuid) returns boolean language sql volatile security definer set search_path='' as $$select exists(select 1 from public.companies where id=cid and archived_at is null)$$;
create function private.master_archive_owner(uid uuid,cid uuid) returns boolean language sql volatile security definer set search_path='' as $$select private.master_setup_draft_session(uid) and exists(select 1 from public.company_members where company_id=cid and user_id=uid and role='owner' and status='active')$$;
create function private.master_business_lifecycle_receipt(c public.companies) returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('id',c.id,'name',c.display_name,'status',c.status,'version',c.version,'archivedAt',c.archived_at,'restoreAllowed',c.setup_file_destruction_at is null)$$;
create function public.master_list_owned_businesses(p_expected_user_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$begin
 if not (select enabled from private.master_business_archive_settings where singleton) then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 return jsonb_build_object('ok',true,'data',coalesce((select jsonb_agg(private.master_business_lifecycle_receipt(c) order by c.display_name,c.id) from public.companies c join public.company_members m on m.company_id=c.id where m.user_id=p_expected_user_id and m.role='owner' and m.status='active'),'[]'::jsonb));
end;$$;
create function public.master_business_workspace_allowed(p_company_id uuid) returns boolean language sql volatile security definer set search_path='' as $$select private.master_setup_draft_session(auth.uid()) and private.master_company_not_archived(p_company_id) and exists(select 1 from public.company_members where company_id=p_company_id and user_id=auth.uid() and status='active')$$;
create function public.master_set_business_archive(p_expected_user_id uuid,p_company_id uuid,p_expected_version bigint,p_archived boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$declare c public.companies;v bigint;begin
 if not (select enabled from private.master_business_archive_settings where singleton) then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if p_expected_version is null or p_expected_version<1 or p_archived is null then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into c from public.companies where id=p_company_id for update;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not private.master_archive_owner(p_expected_user_id,p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.company_members where company_id=p_company_id and user_id=p_expected_user_id for share;
 if not p_archived and c.setup_file_destruction_at is not null then return jsonb_build_object('ok',false,'code','NEW_BUSINESS_REQUIRED');end if;
 if (c.archived_at is not null)=p_archived then return jsonb_build_object('ok',true,'data',private.master_business_lifecycle_receipt(c));end if;
 if c.version<>p_expected_version then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 v:=c.version;update public.companies set archived_at=case when p_archived then clock_timestamp() else null end where id=p_company_id returning * into c;
 insert into private.master_business_lifecycle_audit(company_id,actor_id,session_id,event,previous_version,new_version) values(p_company_id,p_expected_user_id,(auth.jwt()->>'session_id')::uuid,case when p_archived then 'archive' else 'restore' end,v,c.version);
 return jsonb_build_object('ok',true,'data',private.master_business_lifecycle_receipt(c));
end;$$;
create function public.master_request_business_deletion(p_expected_user_id uuid,p_company_id uuid,p_expected_version bigint,p_attempt_id uuid,p_reason text) returns jsonb language plpgsql volatile security definer set search_path='' as $$declare c public.companies;r private.master_business_deletion_requests;begin
 if not (select enabled from private.master_business_archive_settings where singleton) then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if p_attempt_id is null or p_expected_version is null or p_expected_version<1 or p_reason is null or length(btrim(p_reason))<1 or length(p_reason)>1000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into c from public.companies where id=p_company_id for update;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not private.master_archive_owner(p_expected_user_id,p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.company_members where company_id=p_company_id and user_id=p_expected_user_id for share;
 select * into r from private.master_business_deletion_requests where user_id=p_expected_user_id and attempt_id=p_attempt_id;
 if found then
  if r.company_id<>p_company_id or r.session_id::text<>auth.jwt()->>'session_id' or r.reason<>btrim(p_reason) then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 else
  if c.version<>p_expected_version then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  insert into private.master_business_deletion_requests(attempt_id,user_id,session_id,company_id,expected_version,reason) values(p_attempt_id,p_expected_user_id,(auth.jwt()->>'session_id')::uuid,p_company_id,p_expected_version,btrim(p_reason)) returning * into r;
  insert into private.master_business_lifecycle_audit(company_id,actor_id,session_id,event,previous_version,new_version) values(p_company_id,p_expected_user_id,r.session_id,'delete_request',c.version,c.version);
 end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('id',r.id,'state',r.state,'legalPolicy',r.legal_policy));
end;$$;
-- Keep the original authorization OIDs so previously-created RLS policies invoke these fences.
do $$declare def text;sig regprocedure;begin
 sig:=to_regprocedure('private.user_has_company_capability(uuid,uuid,text)');if sig is null then raise exception 'ARCHIVE_CAPABILITY_FOUNDATION_REQUIRED';end if;
 def:=pg_get_functiondef(sig);execute replace(def,'FUNCTION private.user_has_company_capability(','FUNCTION private.master_archive_native_user_capability(');
 execute 'create or replace function private.user_has_company_capability(p_user_id uuid,p_company_id uuid,p_capability text) returns boolean language sql volatile security definer set search_path='''' as $b$select private.master_archive_native_user_capability(p_user_id,p_company_id,p_capability) and (private.master_company_not_archived(p_company_id) or p_capability<>all(array[''wa.conversations.reply'',''wa.conversations.take_over'',''wa.conversations.resume'',''wa.conversations.close'',''wa.conversations.assign'',''ig.conversations.reply'',''ig.conversations.assign'',''knowledge.write'',''knowledge.delete'',''company.profile.write'',''company.staff.manage'']))$b$';
 sig:=to_regprocedure('public.has_company_capability(uuid,text)');if sig is null then raise exception 'ARCHIVE_CAPABILITY_FOUNDATION_REQUIRED';end if;
 def:=pg_get_functiondef(sig);execute replace(def,'FUNCTION public.has_company_capability(','FUNCTION private.master_archive_native_has_capability(');
 execute 'create or replace function public.has_company_capability(p_company_id uuid,p_capability text) returns boolean language sql volatile security definer set search_path='''' as $b$select private.master_archive_native_has_capability(p_company_id,p_capability) and (private.master_company_not_archived(p_company_id) or p_capability<>all(array[''wa.conversations.reply'',''wa.conversations.take_over'',''wa.conversations.resume'',''wa.conversations.close'',''wa.conversations.assign'',''ig.conversations.reply'',''ig.conversations.assign'',''knowledge.write'',''knowledge.delete'',''company.profile.write'',''company.staff.manage'']))$b$';
 sig:=to_regprocedure('private.master_activation_channel_gate(uuid,text,text)');if sig is null then raise exception 'ARCHIVE_ACTIVATION_FOUNDATION_REQUIRED';end if;
 def:=pg_get_functiondef(sig);execute replace(def,'FUNCTION private.master_activation_channel_gate(','FUNCTION private.master_archive_native_channel_gate(');
 execute 'create or replace function private.master_activation_channel_gate(cid uuid,ch text,op text) returns boolean language sql volatile security definer set search_path='''' as $b$select private.master_archive_native_channel_gate(cid,ch,op) and (op=''read'' or private.master_company_not_archived(cid))$b$';
 sig:=to_regprocedure('private.master_activation_human_deadline(uuid,text,uuid)');if sig is null then raise exception 'ARCHIVE_ACTIVATION_FOUNDATION_REQUIRED';end if;
 def:=pg_get_functiondef(sig);execute replace(def,'FUNCTION private.master_activation_human_deadline(','FUNCTION private.master_archive_native_human_deadline(');
 execute 'create or replace function private.master_activation_human_deadline(cid uuid,ch text,rid uuid) returns timestamptz language sql volatile security definer set search_path='''' as $b$select case when private.master_company_not_archived(cid) then private.master_archive_native_human_deadline(cid,ch,rid) else null end$b$';
 sig:=to_regprocedure('private.master_activation_can_operate(uuid)');if sig is null then raise exception 'ARCHIVE_ACTIVATION_FOUNDATION_REQUIRED';end if;
 def:=pg_get_functiondef(sig);execute replace(def,'FUNCTION private.master_activation_can_operate(','FUNCTION private.master_archive_native_can_operate(');
 execute 'create or replace function private.master_activation_can_operate(cid uuid) returns boolean language sql volatile security definer set search_path='''' as $b$select private.master_archive_native_can_operate(cid) and private.master_company_not_archived(cid)$b$';
 sig:=to_regprocedure('private.channel_operation_allowed(uuid,text,text)');if sig is null then raise exception 'ARCHIVE_CHANNEL_FOUNDATION_REQUIRED';end if;
 def:=pg_get_functiondef(sig);execute replace(def,'FUNCTION private.channel_operation_allowed(','FUNCTION private.master_archive_native_channel_operation(');
 execute 'create or replace function private.channel_operation_allowed(cid uuid,ch text,op text) returns boolean language sql volatile security definer set search_path='''' as $b$select private.master_archive_native_channel_operation(cid,ch,op) and (op=''read'' or private.master_company_not_archived(cid))$b$';
end;$$;
create policy master_archive_knowledge_insert on public.knowledge_sources as restrictive for insert to authenticated with check(private.master_company_not_archived(company_id));
create policy master_archive_knowledge_update on public.knowledge_sources as restrictive for update to authenticated using(private.master_company_not_archived(company_id)) with check(private.master_company_not_archived(company_id));
create policy master_archive_knowledge_delete on public.knowledge_sources as restrictive for delete to authenticated using(private.master_company_not_archived(company_id));
create function private.master_archive_storage_writable(path text) returns boolean language sql volatile security definer set search_path='' as $$select not exists(select 1 from public.companies where id::text=split_part(path,'/',1) and archived_at is not null)$$;
create policy master_archive_storage_insert on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'company-knowledge' or private.master_archive_storage_writable(name));
create policy master_archive_storage_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'company-knowledge' or private.master_archive_storage_writable(name)) with check(bucket_id<>'company-knowledge' or private.master_archive_storage_writable(name));
create policy master_archive_storage_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'company-knowledge' or private.master_archive_storage_writable(name));
create function private.master_archive_profile_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true)='authenticated' and old.archived_at is not null and row(old.display_name,old.business_type,old.reply_language,old.country,old.city,old.hours,old.contact_phone,old.contact_email) is distinct from row(new.display_name,new.business_type,new.reply_language,new.country,new.city,new.hours,new.contact_phone,new.contact_email) then raise exception 'ARCHIVED_BUSINESS';end if;return new;
end;$$;
create trigger master_archive_profile_guard before update on public.companies for each row execute function private.master_archive_profile_guard();
-- Native draft/channel writes use ownership directly rather than the capability kernel.
-- Recheck after the canonical company lock, including late writes that began before archive.
create function private.master_archive_company_write_guard() returns trigger language plpgsql volatile security definer set search_path='' as $$declare a timestamptz;begin
 if current_setting('role',true)='authenticated' and new.company_id is not null then
  select archived_at into a from public.companies where id=new.company_id for update;
  if a is not null then raise exception 'ARCHIVED_BUSINESS' using errcode='42501';end if;
 end if;return new;
end;$$;
create trigger master_archive_draft_write_guard before insert or update on public.company_setup_drafts for each row execute function private.master_archive_company_write_guard();
create trigger master_archive_source_write_guard before insert or update on public.knowledge_sources for each row execute function private.master_archive_company_write_guard();
create trigger master_archive_channel_write_guard before insert or update on private.company_selected_channels for each row execute function private.master_archive_company_write_guard();
revoke all on function private.master_archive_company_write_guard() from public,anon,authenticated,service_role;
revoke all on function private.master_archive_owner(uuid,uuid),private.master_business_lifecycle_receipt(public.companies),private.master_archive_profile_guard(),private.master_archive_native_user_capability(uuid,uuid,text),private.user_has_company_capability(uuid,uuid,text),private.master_archive_native_has_capability(uuid,text),private.master_archive_native_channel_gate(uuid,text,text),private.master_activation_channel_gate(uuid,text,text),private.master_archive_native_human_deadline(uuid,text,uuid),private.master_activation_human_deadline(uuid,text,uuid),private.master_archive_native_can_operate(uuid),private.master_activation_can_operate(uuid),private.master_archive_native_channel_operation(uuid,text,text),private.channel_operation_allowed(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function private.master_company_not_archived(uuid),private.master_archive_storage_writable(text) from public,anon,service_role;grant execute on function private.master_company_not_archived(uuid),private.master_archive_storage_writable(text) to authenticated;
revoke all on function public.master_list_owned_businesses(uuid),public.master_business_workspace_allowed(uuid),public.master_set_business_archive(uuid,uuid,bigint,boolean),public.master_request_business_deletion(uuid,uuid,bigint,uuid,text),public.has_company_capability(uuid,text) from public,anon,service_role;
grant execute on function public.master_list_owned_businesses(uuid),public.master_business_workspace_allowed(uuid),public.master_set_business_archive(uuid,uuid,bigint,boolean),public.master_request_business_deletion(uuid,uuid,bigint,uuid,text),public.has_company_capability(uuid,text) to authenticated;
commit;

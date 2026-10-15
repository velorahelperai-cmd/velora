-- Extends existing company/membership authority; no production data is removed.
begin;
alter table public.companies add column version bigint not null default 1 check(version>0);
drop index if exists public.company_members_one_active_owner_per_user;

create table private.company_creation_attempts(
 user_id uuid not null, idempotency_key uuid not null, payload jsonb not null,
 company_id uuid not null references public.companies(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),primary key(user_id,idempotency_key)
);
create index company_creation_attempts_user_time on private.company_creation_attempts(user_id,created_at);
create table private.company_profile_write_audit(
 id bigint generated always as identity primary key,company_id uuid not null references public.companies(id) on delete restrict,
 actor_id uuid not null,action text not null,previous_version bigint,new_version bigint,
 created_at timestamptz not null default clock_timestamp()
);
create table private.company_sensitive_change_requests(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete restrict,
 actor_id uuid not null,expected_version bigint not null,field text not null check(field='country'),
 old_value text not null,new_value text not null,status text not null default 'pending' check(status in ('pending','approved','rejected','superseded')),
 created_at timestamptz not null default clock_timestamp(),unique(company_id,expected_version,field,new_value)
);
alter table private.company_creation_attempts enable row level security;
alter table private.company_profile_write_audit enable row level security;
alter table private.company_sensitive_change_requests enable row level security;
revoke all on private.company_creation_attempts,private.company_profile_write_audit,private.company_sensitive_change_requests from public,anon,authenticated;

create function private.master_business_actor(p_expected_user_id uuid) returns boolean language sql security definer set search_path='' as $$
 select p_expected_user_id=auth.uid() and auth.jwt()->>'role'='authenticated' and public.app_session_is_valid()
 and exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where u.id=p_expected_user_id
 and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>clock_timestamp())
 and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()));
$$;
revoke all on function private.master_business_actor(uuid) from public,anon,authenticated;

create function private.master_business_payload(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16000 then return false;end if;
 if exists(select 1 from jsonb_object_keys(p) as fields(key_name) where fields.key_name not in ('name','type','replyLanguage','country','city','hours','contactPhone','contactEmail')) then return false;end if;
 foreach k in array array['name','type','replyLanguage','country','city','hours','contactPhone','contactEmail'] loop
  if jsonb_typeof(p->k) is distinct from 'string' then return false;end if;
 end loop;
 if btrim(p->>'name')='' or btrim(p->>'type')='' or btrim(p->>'country')='' then return false;end if;
 return private.valid_company_setup_payload(jsonb_build_object('business',p,'setupStep',0));
end;$$;
revoke all on function private.master_business_payload(jsonb) from public,anon,authenticated;

create function private.master_company_profile_version() returns trigger language plpgsql set search_path='' as $$
begin new.version:=old.version+1;return new;end;$$;
revoke all on function private.master_company_profile_version() from public,anon,authenticated;
create trigger master_company_profile_version before update on public.companies for each row execute function private.master_company_profile_version();

create function public.create_owner_company_attempt(p_expected_user_id uuid,p_idempotency_key uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior private.company_creation_attempts;created public.companies;d public.company_setup_drafts;begun jsonb;begin
 if not coalesce(private.master_business_actor(p_expected_user_id),false) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then return jsonb_build_object('ok',false,'code','UNVERIFIED');end if;
 if not coalesce(private.master_account_can_create_company(p_expected_user_id),false) then return jsonb_build_object('ok',false,'code','PHONE_REQUIRED');end if;
 if p_idempotency_key is null or not private.master_business_payload(p_payload) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':setup-draft',0));
 perform 1 from auth.users u join auth.sessions s on s.user_id=u.id where u.id=auth.uid() and s.id::text=auth.jwt()->>'session_id' for share of u,s;
 perform 1 from public.company_members where user_id=auth.uid() and status='active' for share;
 if not coalesce(private.master_business_actor(p_expected_user_id),false) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not coalesce(private.master_account_can_create_company(p_expected_user_id),false) then return jsonb_build_object('ok',false,'code','PHONE_REQUIRED');end if;
 select * into prior from private.company_creation_attempts where user_id=auth.uid() and idempotency_key=p_idempotency_key;
 if prior.company_id is not null then
  if prior.payload<>p_payload then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  select c.* into created from public.companies c join public.company_members m on m.company_id=c.id where c.id=prior.company_id and m.user_id=auth.uid() and m.role='owner' and m.status='active';
  if created.id is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  return jsonb_build_object('ok',true,'data',to_jsonb(created));
 end if;
 if not exists(select 1 from public.company_members where user_id=auth.uid() and role='owner' and status='active')
 and (public.is_platform_admin() or exists(select 1 from public.company_members where user_id=auth.uid() and status='active')) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if exists(select 1 from public.company_setup_drafts where user_id=auth.uid() and (state='legacy_conflict' or state='active' and company_id is not null)) then return jsonb_build_object('ok',false,'code','DRAFT_ACTIVE');end if;
 -- Short burst protection is not a commercial limit on the number of businesses.
 if (select count(*) from private.company_creation_attempts where user_id=auth.uid() and created_at>clock_timestamp()-interval '10 minutes')>=10 then return jsonb_build_object('ok',false,'code','THROTTLED');end if;
 select * into d from public.company_setup_drafts where user_id=auth.uid() and state='active' and company_id is null for update;
 if d.draft_id is not null and d.payload->'business' is distinct from p_payload then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if d.draft_id is null then
  begun:=public.begin_company_setup_draft(p_expected_user_id,null,p_idempotency_key,jsonb_build_object('business',p_payload,'setupStep',0));
  if not coalesce((begun->>'ok')::boolean,false) then return jsonb_build_object('ok',false,'code','DRAFT_ACTIVE');end if;
 end if;
 insert into public.companies(display_name,business_type,country,reply_language,city,hours,contact_phone,contact_email,created_by)
 values(btrim(p_payload->>'name'),btrim(p_payload->>'type'),btrim(p_payload->>'country'),p_payload->>'replyLanguage',p_payload->>'city',p_payload->>'hours',p_payload->>'contactPhone',p_payload->>'contactEmail',auth.uid()) returning * into created;
 insert into public.company_members(company_id,user_id,role,status,member_name) values(created.id,auth.uid(),'owner','active',created.display_name);
 insert into private.company_creation_attempts(user_id,idempotency_key,payload,company_id) values(auth.uid(),p_idempotency_key,p_payload,created.id);
 insert into private.company_profile_write_audit(company_id,actor_id,action,new_version) values(created.id,auth.uid(),'created',created.version);
 return jsonb_build_object('ok',true,'data',to_jsonb(created));
end;$$;
revoke all on function public.create_owner_company_attempt(uuid,uuid,jsonb) from public,anon;
grant execute on function public.create_owner_company_attempt(uuid,uuid,jsonb) to authenticated;

create function public.update_owner_company_profile(p_expected_user_id uuid,p_company_id uuid,p_expected_version bigint,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.companies;begin
 if p_expected_user_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not coalesce(private.master_business_actor(p_expected_user_id),false) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not public.app_identity_is_verified() then return jsonb_build_object('ok',false,'code','UNVERIFIED');end if;
 if not private.master_business_payload(p_patch) or p_expected_version is null or p_expected_version<1 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into saved from public.companies where id=p_company_id for update;
 perform 1 from public.company_members where company_id=p_company_id and user_id=auth.uid() and role='owner' and status='active' for share;
 if not found or saved.id is null or saved.status='suspended' then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not coalesce(private.master_business_actor(p_expected_user_id),false) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if saved.version<>p_expected_version then return jsonb_build_object('ok',false,'code','CONFLICT','currentVersion',saved.version);end if;
 if p_patch->>'country'<>saved.country then
  insert into private.company_sensitive_change_requests(company_id,actor_id,expected_version,field,old_value,new_value)
  values(p_company_id,auth.uid(),saved.version,'country',saved.country,p_patch->>'country') on conflict do nothing;
  return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');
 end if;
 update public.companies set display_name=btrim(p_patch->>'name'),business_type=btrim(p_patch->>'type'),reply_language=p_patch->>'replyLanguage',
 city=p_patch->>'city',hours=p_patch->>'hours',contact_phone=p_patch->>'contactPhone',contact_email=p_patch->>'contactEmail',updated_at=clock_timestamp() where id=p_company_id returning * into saved;
 insert into private.company_profile_write_audit(company_id,actor_id,action,previous_version,new_version) values(saved.id,auth.uid(),'profile_updated',p_expected_version,saved.version);
 return jsonb_build_object('ok',true,'data',to_jsonb(saved));
end;$$;
revoke all on function public.update_owner_company_profile(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.update_owner_company_profile(uuid,uuid,bigint,jsonb) to authenticated;

-- Remove unchecked column grants and old owner mutation APIs. Admin definer
-- paths retain their existing independent authorization and now increment version.
revoke update on public.companies from authenticated;
do $$declare col record;begin
 for col in select distinct column_name from information_schema.column_privileges where table_schema='public' and table_name='companies' and grantee='authenticated' and privilege_type='UPDATE' loop
  execute format('revoke update(%I) on public.companies from authenticated',col.column_name);
 end loop;
 if to_regprocedure('public.upsert_owner_company(text,text,text,text,text,text,text,text,text)') is not null then execute 'revoke execute on function public.upsert_owner_company(text,text,text,text,text,text,text,text,text) from public,anon,authenticated';end if;
 if to_regprocedure('public.upsert_selected_owner_company(uuid,text,text,text,text,text,text,text,text,text)') is not null then execute 'revoke execute on function public.upsert_selected_owner_company(uuid,text,text,text,text,text,text,text,text,text) from public,anon,authenticated';end if;
end;$$;
notify pgrst,'reload schema';
commit;

begin;
create function private.valid_company_setup_payload(p_payload jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare business jsonb; field text; limit_len int;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>16000
    or jsonb_typeof(p_payload->'setupStep') is distinct from 'number'
    or coalesce(p_payload->>'setupStep','') !~ '^[0-7]$'
    or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('business','businessBaseline','setupStep')) then return false; end if;
  for business in select p_payload->'business' union all select p_payload->'businessBaseline' where p_payload ? 'businessBaseline' loop
    if jsonb_typeof(business) is distinct from 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(business) k where k not in ('name','type','replyLanguage','country','city','hours','contactPhone','contactEmail')) then return false; end if;
    foreach field in array array['name','type','replyLanguage','country','city','hours','contactPhone','contactEmail'] loop
      limit_len:=case field when 'name' then 120 when 'city' then 160 when 'hours' then 2000 when 'contactPhone' then 40 when 'contactEmail' then 254 when 'replyLanguage' then 4 else 80 end;
      if jsonb_typeof(business->field) is distinct from 'string' or length(business->>field)>limit_len or business->>field ~ '[[:cntrl:]]' then return false; end if;
    end loop;
    if business->>'replyLanguage' not in ('ar','en','both')
      or (btrim(business->>'contactEmail')<>'' and business->>'contactEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
      or (btrim(business->>'contactPhone')<>'' and regexp_replace(business->>'contactPhone','[[:space:]-]','','g') !~ '^\+[0-9]{7,15}$') then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.valid_company_setup_payload(jsonb) from public,anon,authenticated;
-- Durable editable progress only. This table cannot authorize completion or activation.
create table public.company_setup_drafts (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  scope_id uuid generated always as (coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid)) stored,
  payload jsonb not null,
  revision bigint not null default 1 check(revision > 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(user_id,scope_id),
  check(private.valid_company_setup_payload(payload))
);
alter table public.company_setup_drafts enable row level security;
revoke all on public.company_setup_drafts from public,anon,authenticated;
grant select on public.company_setup_drafts to authenticated;

-- Database identity is authoritative; no user-editable metadata grants access.
create function public.can_use_company_setup_draft(p_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.app_session_is_valid()
    and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id')
    and exists(select 1 from auth.users u where u.id=auth.uid() and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null))
    and case when p_company_id is null then
      not exists(select 1 from public.company_members m where m.user_id=auth.uid() and m.status='active')
    else exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id
      where m.user_id=auth.uid() and m.company_id=p_company_id and m.role='owner' and m.status='active' and c.status<>'suspended') end;
$$;
revoke all on function public.can_use_company_setup_draft(uuid) from public,anon;
grant execute on function public.can_use_company_setup_draft(uuid) to authenticated;
create policy setup_draft_read on public.company_setup_drafts for select to authenticated
  using(user_id=(select auth.uid()) and public.can_use_company_setup_draft(company_id));
create policy setup_draft_insert on public.company_setup_drafts for insert to authenticated
  with check(user_id=(select auth.uid()) and public.can_use_company_setup_draft(company_id));
create policy setup_draft_update on public.company_setup_drafts for update to authenticated
  using(user_id=(select auth.uid()) and public.can_use_company_setup_draft(company_id))
  with check(user_id=(select auth.uid()) and public.can_use_company_setup_draft(company_id));

create function public.save_company_setup_draft(p_expected_user_id uuid,p_company_id uuid,p_expected_revision bigint,p_payload jsonb)
-- Definer is intentional: only this checked CAS endpoint may write the table.
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.company_setup_drafts;
begin
  if auth.uid() is null or not public.app_session_is_valid() then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
  if p_expected_user_id is distinct from auth.uid() or not public.can_use_company_setup_draft(p_company_id) then
    return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  if p_expected_revision is null or p_expected_revision<0 or not private.valid_company_setup_payload(p_payload) then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':setup-draft',0));
  if p_company_id is not null then
    perform 1 from public.company_members m join public.companies c on c.id=m.company_id
      where m.user_id=auth.uid() and m.company_id=p_company_id for share of m,c;
  end if;
  if not public.can_use_company_setup_draft(p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  select * into saved from public.company_setup_drafts where user_id=auth.uid() and company_id is not distinct from p_company_id for update;
  -- Retrying an identical committed payload returns its durable receipt without rewriting.
  if saved.user_id is not null and saved.payload=p_payload then return jsonb_build_object('ok',true,'data',to_jsonb(saved)); end if;
  if coalesce(saved.revision,0)<>p_expected_revision then return jsonb_build_object('ok',false,'code','CONFLICT'); end if;
  if saved.user_id is null then
    insert into public.company_setup_drafts(user_id,company_id,payload) values(auth.uid(),p_company_id,p_payload) returning * into saved;
  else
    update public.company_setup_drafts set payload=p_payload,revision=revision+1,updated_at=clock_timestamp()
      where user_id=auth.uid() and company_id is not distinct from p_company_id returning * into saved;
  end if;
  return jsonb_build_object('ok',true,'data',to_jsonb(saved));
end;
$$;
revoke all on function public.save_company_setup_draft(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_company_setup_draft(uuid,uuid,bigint,jsonb) to authenticated;

-- Attach the user's pre-company progress in the same transaction as creation.
-- The private trigger can move the row once membership makes the null scope unreadable.
create function private.attach_company_setup_draft() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role='owner' and new.status='active' and exists(select 1 from public.companies c where c.id=new.company_id and c.created_by=new.user_id)
    and not exists(select 1 from public.company_members m where m.user_id=new.user_id and m.status='active' and m.company_id<>new.company_id) then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':setup-draft',0));
    update public.company_setup_drafts set company_id=new.company_id,revision=revision+1,updated_at=clock_timestamp()
      where user_id=new.user_id and company_id is null;
  end if;
  return new;
end;
$$;
revoke all on function private.attach_company_setup_draft() from public,anon,authenticated;
create trigger attach_company_setup_draft after insert on public.company_members for each row execute function private.attach_company_setup_draft();
commit;

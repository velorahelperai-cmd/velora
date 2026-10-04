-- VEL-005D: platform admin, audit log, admin RPCs (no re-apply of VEL-005A)

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null,
  note text not null default ''
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_company_created_idx
  on public.admin_audit_logs (company_id, created_at desc);

create index if not exists admin_audit_logs_actor_created_idx
  on public.admin_audit_logs (actor_user_id, created_at desc);

alter table public.platform_admins enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on table public.platform_admins from anon, authenticated, public;
revoke all on table public.admin_audit_logs from anon, authenticated, public;

grant select on table public.platform_admins to authenticated;
grant select on table public.admin_audit_logs to authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins as a
    where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

drop policy if exists platform_admins_select_self on public.platform_admins;
create policy platform_admins_select_self
  on public.platform_admins
  for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_platform_admin());

drop policy if exists admin_audit_logs_select_admin on public.admin_audit_logs;
create policy admin_audit_logs_select_admin
  on public.admin_audit_logs
  for select
  to authenticated
  using (public.is_platform_admin());

drop policy if exists companies_select_admin on public.companies;
create policy companies_select_admin
  on public.companies
  for select
  to authenticated
  using (public.is_platform_admin());

drop policy if exists company_members_select_admin on public.company_members;
create policy company_members_select_admin
  on public.company_members
  for select
  to authenticated
  using (public.is_platform_admin());

create or replace function private.write_admin_audit(
  p_actor uuid,
  p_company_id uuid,
  p_action text,
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_audit_logs (actor_user_id, company_id, action, before_data, after_data)
  values (p_actor, p_company_id, p_action, p_before, p_after);
end;
$$;

revoke all on function private.write_admin_audit(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;

create or replace function private.grant_platform_admin_by_email(
  p_email text,
  p_note text default 'bootstrap'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  actor uuid := auth.uid();
begin
  select u.id
    into target
  from auth.users as u
  where lower(u.email) = lower(btrim(p_email))
    and u.email_confirmed_at is not null
  order by u.created_at asc
  limit 1;

  if target is null then
    raise exception 'admin_user_not_found_or_unverified' using errcode = 'P0002';
  end if;

  insert into public.platform_admins (user_id, granted_by, note)
  values (target, actor, coalesce(p_note, ''))
  on conflict (user_id) do update
    set note = excluded.note;

  return target;
end;
$$;

revoke all on function private.grant_platform_admin_by_email(text, text) from public, anon, authenticated;

create or replace function private.require_platform_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.platform_admins as a where a.user_id = uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return uid;
end;
$$;

revoke all on function private.require_platform_admin() from public, anon, authenticated;

-- Status change allowed only when admin RPC sets a transaction-local flag.
create or replace function private.companies_guard_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'immutable_company_columns' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and coalesce(current_setting('velora.allow_status_change', true), '') is distinct from 'on'
  then
    raise exception 'immutable_company_columns' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.admin_list_companies(p_search text default '')
returns table (
  id uuid,
  display_name text,
  status text,
  business_type text,
  country text,
  city text,
  contact_phone text,
  contact_email text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  owner_email text,
  owner_name text,
  member_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  q text := '%' || lower(btrim(coalesce(p_search, ''))) || '%';
begin
  perform private.require_platform_admin();

  return query
  select
    c.id,
    c.display_name,
    c.status,
    c.business_type,
    c.country,
    c.city,
    c.contact_phone,
    c.contact_email,
    c.created_by,
    c.created_at,
    c.updated_at,
    u.email::text as owner_email,
    coalesce(m.member_name, '') as owner_name,
    (select count(*) from public.company_members as cm where cm.company_id = c.id) as member_count
  from public.companies as c
  left join public.company_members as m
    on m.company_id = c.id and m.role = 'owner' and m.status = 'active'
  left join auth.users as u on u.id = m.user_id
  where btrim(coalesce(p_search, '')) = ''
     or lower(c.display_name) like q
     or lower(coalesce(u.email, '')) like q
     or lower(coalesce(c.contact_email, '')) like q
     or lower(coalesce(c.contact_phone, '')) like q
     or lower(coalesce(c.city, '')) like q
  order by c.created_at desc;
end;
$$;

revoke all on function public.admin_list_companies(text) from public, anon;
grant execute on function public.admin_list_companies(text) to authenticated;

create or replace function public.admin_get_company(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  company jsonb;
  members jsonb;
begin
  actor := private.require_platform_admin();
  select to_jsonb(c) into company from public.companies as c where c.id = p_company_id;
  if company is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', m.company_id,
    'user_id', m.user_id,
    'role', m.role,
    'status', m.status,
    'member_name', m.member_name,
    'created_at', m.created_at,
    'email', u.email,
    'phone', u.phone
  ) order by m.created_at), '[]'::jsonb)
    into members
  from public.company_members as m
  left join auth.users as u on u.id = m.user_id
  where m.company_id = p_company_id;

  return jsonb_build_object('company', company, 'members', members, 'viewer', actor);
end;
$$;

revoke all on function public.admin_get_company(uuid) from public, anon;
grant execute on function public.admin_get_company(uuid) to authenticated;

create or replace function public.admin_update_company(
  p_company_id uuid,
  p_display_name text,
  p_business_type text,
  p_reply_language text,
  p_country text,
  p_city text,
  p_hours text,
  p_contact_phone text,
  p_contact_email text
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  before_row public.companies;
  after_row public.companies;
  cleaned_name text := btrim(coalesce(p_display_name, ''));
begin
  actor := private.require_platform_admin();

  if char_length(cleaned_name) < 1 or char_length(cleaned_name) > 120 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  if coalesce(p_reply_language, '') not in ('ar', 'en', 'both') then
    raise exception 'invalid_reply_language' using errcode = '22023';
  end if;

  select * into before_row from public.companies as c where c.id = p_company_id for update;
  if before_row.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.companies as c
  set
    display_name = cleaned_name,
    business_type = coalesce(nullif(btrim(coalesce(p_business_type, '')), ''), c.business_type),
    reply_language = p_reply_language,
    country = coalesce(nullif(btrim(coalesce(p_country, '')), ''), c.country),
    city = coalesce(p_city, ''),
    hours = coalesce(p_hours, ''),
    contact_phone = coalesce(p_contact_phone, ''),
    contact_email = coalesce(p_contact_email, ''),
    updated_at = now()
  where c.id = p_company_id
  returning * into after_row;

  perform private.write_admin_audit(
    actor,
    p_company_id,
    'company.update',
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

revoke all on function public.admin_update_company(uuid, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_update_company(uuid, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.admin_set_company_status(
  p_company_id uuid,
  p_status text
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  before_row public.companies;
  after_row public.companies;
begin
  actor := private.require_platform_admin();

  if coalesce(p_status, '') not in ('setup', 'active', 'suspended') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into before_row from public.companies as c where c.id = p_company_id for update;
  if before_row.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform set_config('velora.allow_status_change', 'on', true);

  update public.companies as c
  set status = p_status, updated_at = now()
  where c.id = p_company_id
  returning * into after_row;

  perform private.write_admin_audit(
    actor,
    p_company_id,
    'company.status',
    jsonb_build_object('status', before_row.status),
    jsonb_build_object('status', after_row.status)
  );

  return after_row;
end;
$$;

revoke all on function public.admin_set_company_status(uuid, text) from public, anon;
grant execute on function public.admin_set_company_status(uuid, text) to authenticated;

create or replace function public.admin_set_member_status(
  p_company_id uuid,
  p_user_id uuid,
  p_status text,
  p_role text default null,
  p_member_name text default null
)
returns public.company_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  before_row public.company_members;
  after_row public.company_members;
begin
  actor := private.require_platform_admin();

  if coalesce(p_status, '') not in ('active', 'disabled') then
    raise exception 'invalid_member_status' using errcode = '22023';
  end if;
  if p_role is not null and p_role not in ('owner', 'staff') then
    raise exception 'invalid_member_role' using errcode = '22023';
  end if;

  select * into before_row
  from public.company_members as m
  where m.company_id = p_company_id and m.user_id = p_user_id
  for update;

  if before_row.user_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.company_members as m
  set
    status = p_status,
    role = coalesce(p_role, m.role),
    member_name = coalesce(nullif(btrim(coalesce(p_member_name, '')), ''), m.member_name)
  where m.company_id = p_company_id and m.user_id = p_user_id
  returning * into after_row;

  perform private.write_admin_audit(
    actor,
    p_company_id,
    'member.update',
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

revoke all on function public.admin_set_member_status(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.admin_set_member_status(uuid, uuid, text, text, text) to authenticated;

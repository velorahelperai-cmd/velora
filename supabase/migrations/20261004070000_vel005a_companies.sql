-- VEL-005A: companies, memberships, RLS, race-safe owner company upsert

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 120),
  status text not null default 'setup'
    check (status in ('setup', 'active', 'suspended')),
  business_type text not null default 'restaurant',
  reply_language text not null default 'both'
    check (reply_language in ('ar', 'en', 'both')),
  country text not null default 'OM',
  city text not null default '',
  hours text not null default '',
  contact_phone text not null default '',
  contact_email text not null default '',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  member_name text not null default '',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index if not exists company_members_user_status_idx
  on public.company_members (user_id, status, company_id);

-- One active owner membership per user for this foundation round.
create unique index if not exists company_members_one_active_owner_per_user
  on public.company_members (user_id)
  where (role = 'owner' and status = 'active');

alter table public.companies enable row level security;
alter table public.company_members enable row level security;

revoke all on table public.companies from anon, authenticated, public;
revoke all on table public.company_members from anon, authenticated, public;

grant select on table public.companies to authenticated;
grant update (
  display_name,
  business_type,
  reply_language,
  country,
  city,
  hours,
  contact_phone,
  contact_email,
  updated_at
) on table public.companies to authenticated;

grant select on table public.company_members to authenticated;

drop policy if exists company_members_select_own on public.company_members;
create policy company_members_select_own
  on public.company_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists companies_select_member on public.companies;
create policy companies_select_member
  on public.companies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.company_members as m
      where m.company_id = companies.id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
    and companies.status in ('setup', 'active')
  );

drop policy if exists companies_update_owner on public.companies;
create policy companies_update_owner
  on public.companies
  for update
  to authenticated
  using (
    companies.status <> 'suspended'
    and exists (
      select 1
      from public.company_members as m
      where m.company_id = companies.id
        and m.user_id = (select auth.uid())
        and m.role = 'owner'
        and m.status = 'active'
    )
  )
  with check (
    companies.status <> 'suspended'
    and exists (
      select 1
      from public.company_members as m
      where m.company_id = companies.id
        and m.user_id = (select auth.uid())
        and m.role = 'owner'
        and m.status = 'active'
    )
  );

create or replace function private.companies_guard_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.status is distinct from old.status
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'immutable_company_columns' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists companies_guard_immutable on public.companies;
create trigger companies_guard_immutable
  before update on public.companies
  for each row
  execute function private.companies_guard_immutable();

create or replace function private.upsert_owner_company(
  p_display_name text,
  p_business_type text default 'restaurant',
  p_reply_language text default 'both',
  p_country text default 'OM',
  p_city text default '',
  p_hours text default '',
  p_contact_phone text default '',
  p_contact_email text default '',
  p_member_name text default ''
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cleaned_name text := btrim(coalesce(p_display_name, ''));
  existing_id uuid;
  row_company public.companies;
  member_label text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if char_length(cleaned_name) < 1 or char_length(cleaned_name) > 120 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;

  if coalesce(p_reply_language, '') not in ('ar', 'en', 'both') then
    raise exception 'invalid_reply_language' using errcode = '22023';
  end if;

  -- Serialize creates/updates per caller so concurrent retries share one company.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select m.company_id
    into existing_id
  from public.company_members as m
  where m.user_id = uid
    and m.role = 'owner'
    and m.status = 'active'
  order by m.created_at asc
  limit 1;

  member_label := coalesce(nullif(btrim(coalesce(p_member_name, '')), ''), cleaned_name);

  if existing_id is not null then
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
    where c.id = existing_id
      and c.status <> 'suspended'
    returning c.* into row_company;

    if row_company.id is null then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    update public.company_members as m
    set member_name = coalesce(nullif(btrim(coalesce(p_member_name, '')), ''), m.member_name)
    where m.company_id = existing_id
      and m.user_id = uid;

    return row_company;
  end if;

  insert into public.companies (
    display_name,
    status,
    business_type,
    reply_language,
    country,
    city,
    hours,
    contact_phone,
    contact_email,
    created_by
  ) values (
    cleaned_name,
    'setup',
    coalesce(nullif(btrim(coalesce(p_business_type, '')), ''), 'restaurant'),
    p_reply_language,
    coalesce(nullif(btrim(coalesce(p_country, '')), ''), 'OM'),
    coalesce(p_city, ''),
    coalesce(p_hours, ''),
    coalesce(p_contact_phone, ''),
    coalesce(p_contact_email, ''),
    uid
  )
  returning * into row_company;

  insert into public.company_members (company_id, user_id, role, status, member_name)
  values (row_company.id, uid, 'owner', 'active', member_label);

  return row_company;
exception
  when unique_violation then
    -- Concurrent create lost the unique owner index; return the winner row.
    select c.*
      into row_company
    from public.company_members as m
    join public.companies as c on c.id = m.company_id
    where m.user_id = uid
      and m.role = 'owner'
      and m.status = 'active'
    order by m.created_at asc
    limit 1;

    if row_company.id is null then
      raise;
    end if;
    return row_company;
end;
$$;

revoke all on function private.upsert_owner_company(
  text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;

-- Thin public RPC: authenticated-only entry; SECURITY DEFINER so private schema stays unusable to clients.
create or replace function public.upsert_owner_company(
  p_display_name text,
  p_business_type text default 'restaurant',
  p_reply_language text default 'both',
  p_country text default 'OM',
  p_city text default '',
  p_hours text default '',
  p_contact_phone text default '',
  p_contact_email text default '',
  p_member_name text default ''
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.companies;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  result := private.upsert_owner_company(
    p_display_name,
    p_business_type,
    p_reply_language,
    p_country,
    p_city,
    p_hours,
    p_contact_phone,
    p_contact_email,
    p_member_name
  );
  return result;
end;
$$;

revoke all on function public.upsert_owner_company(
  text, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.upsert_owner_company(
  text, text, text, text, text, text, text, text, text
) to authenticated;

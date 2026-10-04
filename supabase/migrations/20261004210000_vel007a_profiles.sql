-- VEL-007A: user profiles (full_name) linked to auth.users with RLS

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default ''
    check (char_length(btrim(full_name)) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_full_name_idx
  on public.profiles (full_name);

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated, public;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function private.profiles_guard_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'immutable_profile_columns' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_guard_immutable on public.profiles;
create trigger profiles_guard_immutable
  before update on public.profiles
  for each row
  execute function private.profiles_guard_immutable();

-- Create/refresh profile when an auth user is created (name from signup metadata or OAuth).
create or replace function private.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_name text;
begin
  raw_name := coalesce(
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    ''
  );
  insert into public.profiles (user_id, full_name)
  values (new.id, left(raw_name, 120))
  on conflict (user_id) do update
    set full_name = case
      when btrim(public.profiles.full_name) = '' and btrim(excluded.full_name) <> ''
        then excluded.full_name
      else public.profiles.full_name
    end,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row
  execute function private.handle_new_user_profile();

-- Backfill existing users (safe on empty/new projects).
insert into public.profiles (user_id, full_name)
select
  u.id,
  left(
    coalesce(
      nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(btrim(coalesce(u.raw_user_meta_data ->> 'name', '')), ''),
      ''
    ),
    120
  )
from auth.users as u
on conflict (user_id) do nothing;

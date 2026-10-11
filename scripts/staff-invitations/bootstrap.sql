-- Synthetic local dependencies only. No application, provider or cloud access.
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin;end if;
end;$$;
create schema auth;
create schema private;
revoke create on schema public from public;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt(),auth.uid() to anon, authenticated;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp());
create table public.companies(id uuid primary key,display_name text not null,status text not null);
-- Exact material membership columns/checks/indexes from 20261004070000_vel005a_companies.sql.
create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  member_name text not null default '',
  created_at timestamptz not null default now(),
  primary key(company_id, user_id)
);
create index company_members_user_status_idx on public.company_members(user_id,status,company_id);
create unique index company_members_one_active_owner_per_user on public.company_members(user_id) where role='owner' and status='active';
alter table public.company_members enable row level security;
revoke all on public.company_members from anon,authenticated,public;
grant select on public.company_members to authenticated;
create policy company_members_select_own on public.company_members for select to authenticated using(user_id=(select auth.uid()));
create table public.company_member_grants(company_id uuid,user_id uuid,capabilities text[] not null,manager_user_id uuid,status text not null,revision integer not null default 1,primary key(company_id,user_id));
create table public.admin_audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid not null references auth.users(id),company_id uuid references public.companies(id),action text not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default clock_timestamp());
alter table public.admin_audit_logs enable row level security;
revoke all on public.admin_audit_logs from public,anon,authenticated;
-- Exact write_admin_audit body from 20261004090000_vel005d_platform_admin.sql.
create function private.write_admin_audit(p_actor uuid,p_company_id uuid,p_action text,p_before jsonb,p_after jsonb)
returns void language plpgsql security definer set search_path='' as $$begin
  insert into public.admin_audit_logs(actor_user_id,company_id,action,before_data,after_data)
  values(p_actor,p_company_id,p_action,p_before,p_after);
end;$$;
revoke all on function private.write_admin_audit(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;

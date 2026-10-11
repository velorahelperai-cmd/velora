-- Synthetic dependencies only. The harness refuses any networked/production target.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin;end if;
end;$$;
create schema if not exists auth;
create schema if not exists private;
revoke create on schema public from public;
create table if not exists auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);
create table if not exists auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
grant usage on schema auth to authenticated,anon;
create table if not exists public.profiles(user_id uuid primary key references auth.users(id),full_name text not null,support_code text not null);
create table if not exists public.platform_admins(user_id uuid primary key references auth.users(id),role text not null,status text not null,revision integer not null default 1);
create table if not exists public.companies(id uuid primary key);
create table if not exists public.platform_admin_scopes(admin_user_id uuid references public.platform_admins(user_id),company_id uuid references public.companies(id),usable_capabilities text[] not null,delegable_capabilities text[] not null,revision integer not null default 1,primary key(admin_user_id,company_id));
create table if not exists public.company_members(company_id uuid references public.companies(id),user_id uuid references auth.users(id),role text not null,status text not null,primary key(company_id,user_id));
create table if not exists public.company_member_grants(company_id uuid,user_id uuid,capabilities text[] not null,manager_user_id uuid,status text not null,revision integer not null default 1,primary key(company_id,user_id));
create table if not exists public.admin_audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid not null references auth.users(id),company_id uuid references public.companies(id),action text not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default now());
alter table public.platform_admins enable row level security;
alter table public.platform_admin_scopes enable row level security;
alter table public.profiles enable row level security;
alter table public.admin_audit_logs enable row level security;
create table if not exists private.app_session_activity(session_id uuid primary key references auth.sessions(id),user_id uuid not null references auth.users(id),last_activity_at timestamptz not null,expired_at timestamptz);
create table if not exists private.app_session_settings(singleton boolean primary key check(singleton),enabled boolean not null);
insert into private.app_session_settings values(true,true) on conflict(singleton)do nothing;

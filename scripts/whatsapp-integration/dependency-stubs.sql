-- TEST ONLY: substitutes external Supabase Auth/Storage infrastructure.
-- Project public/private tables, triggers, RLS and RPCs come from real migrations.
do $$ begin create role anon;exception when duplicate_object then null;end $$;
do $$ begin create role authenticated;exception when duplicate_object then null;end $$;
do $$ begin create role service_role bypassrls;exception when duplicate_object then null;end $$;
create schema auth; create schema storage; create schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public,auth,storage,extensions to anon,authenticated,service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
create table auth.users(id uuid primary key,email text,phone text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now());
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz default now(),updated_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('role',true),''))$$;
create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
grant all on auth.users,auth.sessions,storage.buckets,storage.objects to service_role;

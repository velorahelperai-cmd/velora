-- TEST ONLY: minimal dependency boundary. These are NOT production Auth/RLS
-- definitions and never establish Supabase cloud compatibility. All Billing
-- tables, constraints, triggers and functions come from actual migrations.
CREATE SCHEMA auth;
CREATE SCHEMA private;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE TABLE public.companies(id uuid PRIMARY KEY,display_name text,status text NOT NULL DEFAULT 'active',created_by uuid REFERENCES auth.users(id));
CREATE TABLE public.company_members(company_id uuid REFERENCES public.companies(id),user_id uuid REFERENCES auth.users(id),role text,status text);
CREATE FUNCTION public.app_session_is_valid() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(current_setting('test.valid_session',true),'')='true';
$$;
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(current_setting('test.platform_owner',true),'')='true';
$$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid(),public.app_session_is_valid(),public.is_platform_owner() TO anon,authenticated,service_role;

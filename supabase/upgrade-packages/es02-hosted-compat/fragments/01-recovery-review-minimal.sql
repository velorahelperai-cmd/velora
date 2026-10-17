-- Minimal REVIEW/STATUS recovery schema for tip-fenced RPCs only.
-- NOT the full 20261014033009 phone-change / attestation / apply system.
-- Policy remains UNCONFIGURED (enabled=false). No identity replacement authority.
-- Session helper uses real auth.sessions (+ app_session_is_valid when present).

create schema if not exists private;

-- Current-session helper (install only when absent — never unconditional true).
do $$
begin
  if to_regprocedure('private.master_phone_current_session(uuid)') is null then
    execute $fn$
      create function private.master_phone_current_session(p_user_id uuid)
      returns uuid
      language plpgsql
      volatile
      security definer
      set search_path = ''
      as $body$
      declare
        sid uuid;
      begin
        if p_user_id is null or p_user_id is distinct from auth.uid() then
          return null;
        end if;
        begin
          sid := (auth.jwt()->>'session_id')::uuid;
        exception when invalid_text_representation then
          return null;
        end;
        if sid is null then
          return null;
        end if;
        if not exists (
          select 1
          from auth.sessions s
          join auth.users u on u.id = s.user_id
          where s.id = sid
            and s.user_id = p_user_id
            and u.deleted_at is null
            and (u.banned_until is null or u.banned_until <= clock_timestamp())
            and (s.not_after is null or s.not_after > clock_timestamp())
            and u.email_confirmed_at is not null
        ) then
          return null;
        end if;
        if to_regprocedure('public.app_session_is_valid()') is not null
           and public.app_session_is_valid() is not true then
          return null;
        end if;
        return sid;
      end;
      $body$;
    $fn$;
  end if;
end;
$$;

revoke all on function private.master_phone_current_session(uuid) from public, anon, authenticated, service_role;

create table if not exists private.master_identity_recovery_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  criteria_version text,
  approval_reference text,
  check (
    not enabled
    or (
      nullif(btrim(criteria_version), '') is not null
      and nullif(btrim(approval_reference), '') is not null
    )
  )
);

insert into private.master_identity_recovery_policy (singleton, enabled)
values (true, false)
on conflict (singleton) do nothing;

create table if not exists private.master_identity_recovery_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  opened_by uuid not null references auth.users (id),
  open_session_id uuid not null,
  request_key uuid not null,
  reason text not null check (reason in ('lost_phone', 'lost_email_and_phone')),
  state text not null default 'review'
    check (state in ('review', 'needs_evidence', 'rejected', 'approved_for_manual_recovery')),
  created_at timestamptz not null default clock_timestamp(),
  unique (opened_by, request_key)
);

create index if not exists master_recovery_subject_created
  on private.master_identity_recovery_cases (user_id, created_at desc);

create unique index if not exists master_one_open_identity_review
  on private.master_identity_recovery_cases (user_id)
  where state in ('review', 'needs_evidence');

create table if not exists private.master_identity_recovery_sources (
  source text primary key,
  independence_group text not null,
  criteria_version text not null,
  approval_reference text not null,
  enabled boolean not null default false,
  check (
    length(btrim(source)) between 1 and 100
    and length(btrim(independence_group)) between 1 and 100
    and length(btrim(criteria_version)) > 0
    and length(btrim(approval_reference)) > 0
  )
);

create table if not exists private.master_identity_recovery_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references private.master_identity_recovery_cases (id),
  user_id uuid not null references auth.users (id),
  source text not null references private.master_identity_recovery_sources (source),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  independence_group text not null,
  criteria_version text not null,
  verified_at timestamptz not null default clock_timestamp(),
  unique (source, evidence_reference)
);

create table if not exists private.master_identity_recovery_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references private.master_identity_recovery_cases (id),
  actor_user_id uuid references auth.users (id),
  actor_session_id uuid,
  event text not null,
  created_at timestamptz not null default clock_timestamp()
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'master_identity_recovery_policy',
    'master_identity_recovery_cases',
    'master_identity_recovery_sources',
    'master_identity_recovery_evidence',
    'master_identity_recovery_events'
  ]
  loop
    execute format('alter table private.%I enable row level security', t);
    execute format(
      'revoke all on table private.%I from public, anon, authenticated, service_role',
      t
    );
  end loop;
end;
$$;

create or replace function private.master_recovery_platform_owner()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  sid := private.master_phone_current_session(auth.uid());
  if sid is null
     or not exists (
       select 1 from auth.users
       where id = auth.uid() and email_confirmed_at is not null
     ) then
    return false;
  end if;
  if to_regclass('public.platform_admins') is null then
    return false;
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended(auth.uid()::text || ':session-revocation', 0));
  perform 1 from auth.sessions where id = sid and user_id = auth.uid() for share;
  perform 1
  from public.platform_admins
  where user_id = auth.uid() and role = 'owner' and status = 'active'
  for share;
  return found and private.master_phone_current_session(auth.uid()) = sid;
end;
$$;

revoke all on function private.master_recovery_platform_owner() from public, anon, authenticated, service_role;

create or replace function private.master_identity_recovery_case_json(cid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'userId', c.user_id,
    'reason', c.reason,
    'state', c.state,
    'createdAt', c.created_at,
    'verifiedEvidence', (
      select count(distinct independence_group)
      from private.master_identity_recovery_evidence
      where case_id = c.id
    )
  )
  from private.master_identity_recovery_cases c
  where c.id = cid;
$$;

revoke all on function private.master_identity_recovery_case_json(uuid)
  from public, anon, authenticated, service_role;

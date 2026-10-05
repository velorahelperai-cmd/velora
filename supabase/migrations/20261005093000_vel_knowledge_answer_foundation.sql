-- VEL-KNOWLEDGE-ANSWER-01 foundation (unapplied)
-- Owner approval for answer context + server-owned content versioning.
-- Approval is per current version only; not a public-file flag.
--
-- Privileges (PostgreSQL): table-level INSERT/UPDATE from prior migration
-- supersede column-only REVOKE. Revoke broad grants, then GRANT app columns only.
--
-- APPLY BLOCKER (Supabase): triggers on storage.objects touch a managed schema.
-- Supabase docs recommend not modifying the managed Storage schema. Before apply,
-- verify role/compat for CREATE TRIGGER on storage.objects. Do not treat this
-- design as publish-approved until that check passes. App code stays as-is.

alter table public.knowledge_sources
  add column if not exists content_version integer not null default 1,
  add column if not exists approved_for_answers boolean not null default false,
  add column if not exists approved_version integer,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users (id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'knowledge_sources_content_version_chk'
      and conrelid = 'public.knowledge_sources'::regclass
  ) then
    alter table public.knowledge_sources
      add constraint knowledge_sources_content_version_chk
      check (content_version >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'knowledge_sources_approved_version_chk'
      and conrelid = 'public.knowledge_sources'::regclass
  ) then
    alter table public.knowledge_sources
      add constraint knowledge_sources_approved_version_chk
      check (
        approved_version is null
        or approved_version >= 1
      );
  end if;
end;
$$;

comment on column public.knowledge_sources.approved_for_answers is
  'Owner-approved for customer-answer context for approved_version only. Not a public file flag. Set only via set_knowledge_source_approval.';
comment on column public.knowledge_sources.content_version is
  'Server-owned. Increments on content/file/reprocess changes; approval applies only to approved_version.';

-- Replace table-wide INSERT/UPDATE (prior migration) with column grants for app writes.
-- Kept: SELECT/DELETE table-level; RLS unchanged; approval only via RPC (security definer).
-- App INSERT columns: company_id, kind, title, content, file_name, content_type,
--   byte_size, storage_path, status, failure_code, created_by
-- App UPDATE columns: kind, title, content, file_name, content_type, byte_size,
--   storage_path, status, failure_code, updated_at
-- Denied to authenticated: content_version, approved_for_answers, approved_version,
--   approved_at, approved_by (and identity columns on UPDATE).
revoke all on table public.knowledge_sources from authenticated;

grant select, delete on table public.knowledge_sources to authenticated;

grant insert (
  company_id,
  kind,
  title,
  content,
  file_name,
  content_type,
  byte_size,
  storage_path,
  status,
  failure_code,
  created_by
) on table public.knowledge_sources to authenticated;

grant update (
  kind,
  title,
  content,
  file_name,
  content_type,
  byte_size,
  storage_path,
  status,
  failure_code,
  updated_at
) on table public.knowledge_sources to authenticated;

-- New sources unapproved. Version/approval are server-controlled.
-- Reprocess (processing -> ready) bumps version even when extracted text is unchanged.
create or replace function private.knowledge_sources_version_and_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- missing_ok setting yields NULL; coalesce so IF NOT cannot be skipped.
  allow_approval boolean := (
    coalesce(pg_catalog.current_setting('velora.knowledge_approval', true), '') = '1'
  );
  must_bump boolean := false;
begin
  if tg_op = 'INSERT' then
    new.content_version := 1;
    new.approved_for_answers := false;
    new.approved_version := null;
    new.approved_at := null;
    new.approved_by := null;
    return new;
  end if;

  -- Ignore client attempts to forge version/approval unless the approval RPC opted in.
  if not allow_approval then
    new.content_version := old.content_version;
    new.approved_for_answers := old.approved_for_answers;
    new.approved_version := old.approved_version;
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
  end if;

  must_bump :=
    new.content is distinct from old.content
    or new.title is distinct from old.title
    or new.storage_path is distinct from old.storage_path
    or new.file_name is distinct from old.file_name
    or new.content_type is distinct from old.content_type
    or (old.status = 'processing' and new.status = 'ready');

  if must_bump then
    new.content_version := old.content_version + 1;
    new.approved_for_answers := false;
    new.approved_version := null;
    new.approved_at := null;
    new.approved_by := null;
  end if;

  -- Leaving ready always drops answer approval.
  if new.status is distinct from 'ready' then
    new.approved_for_answers := false;
    new.approved_version := null;
    new.approved_at := null;
    new.approved_by := null;
  end if;

  -- Approval RPC: stamp server time/actor and bind to current version only.
  if allow_approval and new.approved_for_answers = true then
    if new.status is distinct from 'ready' then
      raise exception 'approval_requires_ready' using errcode = '22023';
    end if;
    if coalesce(pg_catalog.btrim(new.content), '') = '' then
      raise exception 'approval_requires_content' using errcode = '22023';
    end if;
    new.approved_version := new.content_version;
    new.approved_at := pg_catalog.now();
    new.approved_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists knowledge_sources_version_and_approval on public.knowledge_sources;
create trigger knowledge_sources_version_and_approval
  before insert or update on public.knowledge_sources
  for each row
  execute function private.knowledge_sources_version_and_approval();

-- Owner-only RPC: sole path to set/clear approval (server stamps version/time/actor).
create or replace function public.set_knowledge_source_approval(
  p_source_id uuid,
  p_approved boolean
)
returns public.knowledge_sources
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  row public.knowledge_sources;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into row
  from public.knowledge_sources
  where id = p_source_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not private.is_active_company_owner(row.company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('velora.knowledge_approval', '1', true);

  if p_approved then
    if row.status is distinct from 'ready'
       or coalesce(pg_catalog.btrim(row.content), '') = '' then
      raise exception 'not_ready' using errcode = '22023';
    end if;

    update public.knowledge_sources
    set
      approved_for_answers = true,
      approved_version = content_version,
      approved_at = pg_catalog.now(),
      approved_by = uid
    where id = p_source_id
      and company_id = row.company_id
      and status = 'ready'
      and content_version = row.content_version
    returning * into row;

    if not found then
      raise exception 'version_changed' using errcode = '40001';
    end if;
  else
    update public.knowledge_sources
    set
      approved_for_answers = false,
      approved_version = null,
      approved_at = null,
      approved_by = null
    where id = p_source_id
      and company_id = row.company_id
    returning * into row;
  end if;

  return row;
end;
$$;

revoke all on function public.set_knowledge_source_approval(uuid, boolean) from public, anon;
grant execute on function public.set_knowledge_source_approval(uuid, boolean) to authenticated;

-- Invalidate knowledge rows tied to a storage object path.
-- p_leave_identity: object identity gone (DELETE, rename-away, leave bucket) → clear path.
create or replace function private.knowledge_invalidate_storage_path(
  p_path text,
  p_leave_identity boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_path is null or length(p_path) = 0 then
    return;
  end if;

  update public.knowledge_sources as ks
  set
    content = '',
    status = case
      when p_leave_identity then 'failed'
      when ks.status in ('ready', 'processing') then 'stored'
      else ks.status
    end,
    failure_code = case
      when p_leave_identity then 'extract_failed'
      else null
    end,
    storage_path = case
      when p_leave_identity then null
      else ks.storage_path
    end
  where ks.kind = 'file'
    and ks.storage_path = p_path;
end;
$$;

revoke all on function private.knowledge_invalidate_storage_path(text, boolean) from public, anon;

-- Direct Storage mutate must not leave prior extracted text approved.
-- UPDATE invalidates OLD and NEW identities (rename/move, leave/enter bucket, same-path replace).
create or replace function private.knowledge_invalidate_for_storage_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.bucket_id = 'company-knowledge' then
      perform private.knowledge_invalidate_storage_path(old.name, true);
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.bucket_id = 'company-knowledge' then
      perform private.knowledge_invalidate_storage_path(new.name, false);
    end if;
    return new;
  end if;

  -- UPDATE
  if old.bucket_id = 'company-knowledge' then
    if new.bucket_id is distinct from 'company-knowledge'
       or old.name is distinct from new.name then
      -- Left bucket or renamed away: OLD identity is gone.
      perform private.knowledge_invalidate_storage_path(old.name, true);
    else
      -- Same-path replace within company-knowledge.
      perform private.knowledge_invalidate_storage_path(old.name, false);
    end if;
  end if;

  if new.bucket_id = 'company-knowledge'
     and (
       old.bucket_id is distinct from 'company-knowledge'
       or old.name is distinct from new.name
     ) then
    -- Entered bucket or renamed onto NEW path.
    perform private.knowledge_invalidate_storage_path(new.name, false);
  end if;

  return new;
end;
$$;

drop trigger if exists knowledge_invalidate_on_storage_insert on storage.objects;
drop trigger if exists knowledge_invalidate_on_storage_update on storage.objects;
drop trigger if exists knowledge_invalidate_on_storage_delete on storage.objects;

-- APPLY BLOCKER: confirm CREATE TRIGGER on storage.objects is allowed in this project
-- (Supabase managed Storage schema). Not publish-approved until verified.
create trigger knowledge_invalidate_on_storage_insert
  after insert on storage.objects
  for each row
  when (new.bucket_id = 'company-knowledge')
  execute function private.knowledge_invalidate_for_storage_object();

create trigger knowledge_invalidate_on_storage_update
  after update on storage.objects
  for each row
  when (new.bucket_id = 'company-knowledge' or old.bucket_id = 'company-knowledge')
  execute function private.knowledge_invalidate_for_storage_object();

create trigger knowledge_invalidate_on_storage_delete
  after delete on storage.objects
  for each row
  when (old.bucket_id = 'company-knowledge')
  execute function private.knowledge_invalidate_for_storage_object();

create index if not exists knowledge_sources_company_approved_ready_idx
  on public.knowledge_sources (company_id, updated_at desc)
  where approved_for_answers = true
    and status = 'ready'
    and approved_version = content_version;

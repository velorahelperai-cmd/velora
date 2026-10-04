-- VEL-006A: company knowledge sources + private storage (new migration only)

create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('text', 'file')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  content text not null default '',
  file_name text,
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  storage_path text,
  status text not null default 'draft'
    check (status in ('draft', 'stored', 'ready', 'failed')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_sources_file_meta_chk check (
    (
      kind = 'text'
      and file_name is null
      and content_type is null
      and byte_size is null
      and storage_path is null
    )
    or (
      kind = 'file'
      and file_name is not null
      and char_length(btrim(file_name)) between 1 and 260
    )
  ),
  constraint knowledge_sources_storage_prefix_chk check (
    storage_path is null
    or storage_path like (company_id::text || '/%')
  )
);

create index if not exists knowledge_sources_company_updated_idx
  on public.knowledge_sources (company_id, updated_at desc);

create index if not exists knowledge_sources_company_kind_idx
  on public.knowledge_sources (company_id, kind);

alter table public.knowledge_sources enable row level security;

revoke all on table public.knowledge_sources from anon, authenticated, public;
grant select, insert, update, delete on table public.knowledge_sources to authenticated;

create or replace function private.is_active_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members as m
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function private.is_active_company_owner(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members as m
    join public.companies as c on c.id = m.company_id
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
      and m.status = 'active'
      and c.status <> 'suspended'
  );
$$;

revoke all on function private.is_active_company_member(uuid) from public, anon;
revoke all on function private.is_active_company_owner(uuid) from public, anon;
grant execute on function private.is_active_company_member(uuid) to authenticated;
grant execute on function private.is_active_company_owner(uuid) to authenticated;

create or replace function private.knowledge_sources_guard_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.company_id is distinct from old.company_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
    then
      raise exception 'immutable_knowledge_columns' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists knowledge_sources_guard_immutable on public.knowledge_sources;
create trigger knowledge_sources_guard_immutable
  before update on public.knowledge_sources
  for each row
  execute function private.knowledge_sources_guard_immutable();

drop policy if exists knowledge_sources_select_member_or_admin on public.knowledge_sources;
create policy knowledge_sources_select_member_or_admin
  on public.knowledge_sources
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or private.is_active_company_member(company_id)
  );

drop policy if exists knowledge_sources_insert_owner on public.knowledge_sources;
create policy knowledge_sources_insert_owner
  on public.knowledge_sources
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_active_company_owner(company_id)
  );

drop policy if exists knowledge_sources_update_owner on public.knowledge_sources;
create policy knowledge_sources_update_owner
  on public.knowledge_sources
  for update
  to authenticated
  using (private.is_active_company_owner(company_id))
  with check (private.is_active_company_owner(company_id));

drop policy if exists knowledge_sources_delete_owner on public.knowledge_sources;
create policy knowledge_sources_delete_owner
  on public.knowledge_sources
  for delete
  to authenticated
  using (private.is_active_company_owner(company_id));

-- Private storage bucket for company knowledge files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-knowledge',
  'company-knowledge',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.storage_company_id(p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  part text;
begin
  part := split_part(coalesce(p_name, ''), '/', 1);
  if part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return part::uuid;
  end if;
  return null;
end;
$$;

revoke all on function private.storage_company_id(text) from public, anon;
grant execute on function private.storage_company_id(text) to authenticated;

drop policy if exists company_knowledge_select_member_or_admin on storage.objects;
create policy company_knowledge_select_member_or_admin
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'company-knowledge'
    and (
      public.is_platform_admin()
      or private.is_active_company_member(private.storage_company_id(name))
    )
  );

drop policy if exists company_knowledge_insert_owner on storage.objects;
create policy company_knowledge_insert_owner
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'company-knowledge'
    and private.is_active_company_owner(private.storage_company_id(name))
  );

drop policy if exists company_knowledge_update_owner on storage.objects;
create policy company_knowledge_update_owner
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'company-knowledge'
    and private.is_active_company_owner(private.storage_company_id(name))
  )
  with check (
    bucket_id = 'company-knowledge'
    and private.is_active_company_owner(private.storage_company_id(name))
  );

drop policy if exists company_knowledge_delete_owner on storage.objects;
create policy company_knowledge_delete_owner
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'company-knowledge'
    and private.is_active_company_owner(private.storage_company_id(name))
  );

-- VEL-ACCESS-MANAGEMENT-01-FIX2 (local package — do NOT apply without separate approval)
-- Includes FIX + FIX2: RLS helper grants, claim contract, capability-scoped can_admin_company.
-- Closes is_platform_admin bypasses; no staff grant seed; conversion table only.
-- Does not promote platform owner. Does not alter company ownership.
-- Delegated without scopes ≠ general admin. Fail closed after migrate.

begin;

-- ---------------------------------------------------------------------------
-- Capability catalogs (grantable = fully enforced only)
-- ---------------------------------------------------------------------------
create or replace function private.access_platform_capabilities()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'platform.manage_admins',
    'platform.search_accounts',
    'platform.manage_companies',
    'platform.manage_access',
    'platform.view_audit'
  ]::text[];
$$;

create or replace function private.access_company_capabilities()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'wa.conversations.read',
    'wa.conversations.reply',
    'wa.conversations.take_over',
    'wa.conversations.resume',
    'wa.conversations.close',
    'wa.conversations.assign',
    'knowledge.read',
    'knowledge.write',
    'knowledge.delete',
    'company.profile.read',
    'company.profile.write',
    'company.staff.manage'
  ]::text[];
$$;

-- Prior effective staff ops (membership era) — for conversion snapshot only; no expand.
create or replace function private.access_prior_staff_capabilities()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'wa.conversations.read',
    'wa.conversations.reply',
    'wa.conversations.take_over',
    'wa.conversations.resume',
    'wa.conversations.close',
    'knowledge.read',
    'company.profile.read'
  ]::text[];
$$;

revoke all on function private.access_platform_capabilities() from public, anon, authenticated;
revoke all on function private.access_company_capabilities() from public, anon, authenticated;
revoke all on function private.access_prior_staff_capabilities() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Extend platform_admins
-- ---------------------------------------------------------------------------
alter table public.platform_admins
  add column if not exists role text,
  add column if not exists status text,
  add column if not exists revision integer,
  add column if not exists updated_at timestamptz;

update public.platform_admins
set
  role = coalesce(role, 'delegated'),
  status = coalesce(status, 'active'),
  revision = coalesce(revision, 1),
  updated_at = coalesce(updated_at, granted_at, now())
where true;

alter table public.platform_admins
  alter column role set default 'delegated',
  alter column status set default 'active',
  alter column revision set default 1,
  alter column updated_at set default now();

alter table public.platform_admins
  alter column role set not null,
  alter column status set not null,
  alter column revision set not null,
  alter column updated_at set not null;

alter table public.platform_admins drop constraint if exists platform_admins_role_check;
alter table public.platform_admins
  add constraint platform_admins_role_check check (role in ('owner', 'delegated'));

alter table public.platform_admins drop constraint if exists platform_admins_status_check;
alter table public.platform_admins
  add constraint platform_admins_status_check check (status in ('active', 'disabled'));

create unique index if not exists platform_admins_one_active_owner
  on public.platform_admins (role)
  where (role = 'owner' and status = 'active');

-- ---------------------------------------------------------------------------
-- Tables (scopes before is_platform_admin SQL body references them)
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admin_scopes (
  admin_user_id uuid not null references public.platform_admins (user_id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  usable_capabilities text[] not null default '{}'::text[],
  delegable_capabilities text[] not null default '{}'::text[],
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (admin_user_id, company_id)
);

alter table public.platform_admin_scopes enable row level security;
revoke all on table public.platform_admin_scopes from anon, authenticated, public;
grant select on table public.platform_admin_scopes to authenticated;

create or replace function public.is_platform_owner()
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
      and a.role = 'owner'
      and a.status = 'active'
  );
$$;

revoke all on function public.is_platform_owner() from public, anon;
grant execute on function public.is_platform_owner() to authenticated;

-- Owner OR (delegated WITH ≥1 scope). Delegated without scope → false.
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
      and a.status = 'active'
      and (
        a.role = 'owner'
        or (
          a.role = 'delegated'
          and exists (
            select 1
            from public.platform_admin_scopes as s
            where s.admin_user_id = a.user_id
          )
        )
      )
  );
$$;

drop policy if exists platform_admin_scopes_select on public.platform_admin_scopes;
create policy platform_admin_scopes_select
  on public.platform_admin_scopes
  for select
  to authenticated
  using (
    public.is_platform_owner()
    or admin_user_id = (select auth.uid())
  );

create table if not exists public.company_member_grants (
  company_id uuid not null,
  user_id uuid not null,
  capabilities text[] not null default '{}'::text[],
  conversation_scope text not null default 'all_company'
    check (conversation_scope in ('all_company', 'assigned_only')),
  manager_user_id uuid references auth.users (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (company_id, user_id),
  foreign key (company_id, user_id)
    references public.company_members (company_id, user_id)
    on delete cascade
);

alter table public.company_member_grants enable row level security;
revoke all on table public.company_member_grants from anon, authenticated, public;
grant select on table public.company_member_grants to authenticated;

-- Conversion snapshot: prior effective caps, NOT written to grants until bootstrap apply.
create table if not exists public.access_staff_capability_conversion (
  company_id uuid not null,
  user_id uuid not null,
  capabilities text[] not null,
  conversation_scope text not null default 'all_company'
    check (conversation_scope in ('all_company', 'assigned_only')),
  captured_at timestamptz not null default now(),
  applied_at timestamptz,
  primary key (company_id, user_id),
  foreign key (company_id, user_id)
    references public.company_members (company_id, user_id)
    on delete cascade
);

alter table public.access_staff_capability_conversion enable row level security;
revoke all on table public.access_staff_capability_conversion from anon, authenticated, public;
grant select on table public.access_staff_capability_conversion to authenticated;

drop policy if exists access_staff_capability_conversion_select on public.access_staff_capability_conversion;
create policy access_staff_capability_conversion_select
  on public.access_staff_capability_conversion
  for select
  to authenticated
  using (public.is_platform_owner());

insert into public.access_staff_capability_conversion (
  company_id, user_id, capabilities, conversation_scope, captured_at
)
select
  m.company_id,
  m.user_id,
  private.access_prior_staff_capabilities(),
  'all_company',
  now()
from public.company_members as m
where m.status = 'active'
  and m.role = 'staff'
on conflict (company_id, user_id) do nothing;

-- Explicitly do NOT seed company_member_grants.

-- ---------------------------------------------------------------------------
-- Evaluators
-- ---------------------------------------------------------------------------
-- Drop legacy signature (scope-only was insufficient).
drop function if exists private.can_admin_company(uuid);

create or replace function private.can_admin_company(p_company_id uuid, p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  cap text := btrim(coalesce(p_capability, ''));
begin
  if actor is null or p_company_id is null or cap = '' then
    return false;
  end if;
  if public.is_platform_owner() then
    return true;
  end if;
  -- Delegated: must have this company scope AND the required capability in usable[].
  return exists (
    select 1
    from public.platform_admins as a
    join public.platform_admin_scopes as s
      on s.admin_user_id = a.user_id
    where a.user_id = actor
      and a.status = 'active'
      and a.role = 'delegated'
      and s.company_id = p_company_id
      and cap = any (s.usable_capabilities)
  );
end;
$$;

revoke all on function private.can_admin_company(uuid, text) from public, anon;
grant execute on function private.can_admin_company(uuid, text) to authenticated;

drop policy if exists company_member_grants_select on public.company_member_grants;
create policy company_member_grants_select
  on public.company_member_grants
  for select
  to authenticated
  using (
    public.is_platform_owner()
    or user_id = (select auth.uid())
    or private.can_admin_company(company_id, 'company.staff.manage')
  );

create or replace function private.manager_delegation_covers(
  p_manager uuid,
  p_company_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins as a
    join public.platform_admin_scopes as s
      on s.admin_user_id = a.user_id
    where a.user_id = p_manager
      and a.status = 'active'
      and a.role = 'delegated'
      and s.company_id = p_company_id
      and p_capability = any (s.delegable_capabilities)
  );
$$;

create or replace function private.user_has_company_capability(
  p_user_id uuid,
  p_company_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cap text := btrim(coalesce(p_capability, ''));
  member_role text;
  member_status text;
  g_caps text[];
  g_status text;
  g_manager uuid;
begin
  if p_user_id is null or p_company_id is null or cap = '' then
    return false;
  end if;
  if not (cap = any (private.access_company_capabilities())) then
    return false;
  end if;

  select m.role, m.status into member_role, member_status
  from public.company_members as m
  where m.company_id = p_company_id and m.user_id = p_user_id;

  if member_role is null or member_status <> 'active' then
    return false;
  end if;
  if member_role = 'owner' then
    return true;
  end if;

  select g.capabilities, g.status, g.manager_user_id
  into g_caps, g_status, g_manager
  from public.company_member_grants as g
  where g.company_id = p_company_id and g.user_id = p_user_id;

  if g_status is distinct from 'active' or g_caps is null or not (cap = any (g_caps)) then
    return false;
  end if;
  if g_manager is null then
    return true;
  end if;
  return private.manager_delegation_covers(g_manager, p_company_id, cap);
end;
$$;

revoke all on function private.user_has_company_capability(uuid, uuid, text) from public, anon, authenticated;

create or replace function private.user_conversation_readable(
  p_user_id uuid,
  p_company_id uuid,
  p_assigned_to uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  scope text;
  g_status text;
  member_role text;
begin
  if p_user_id is null or p_company_id is null then
    return false;
  end if;
  if not private.user_has_company_capability(p_user_id, p_company_id, 'wa.conversations.read') then
    return false;
  end if;

  select m.role into member_role
  from public.company_members as m
  where m.company_id = p_company_id and m.user_id = p_user_id and m.status = 'active';

  if member_role = 'owner' then
    return true;
  end if;

  select g.conversation_scope, g.status into scope, g_status
  from public.company_member_grants as g
  where g.company_id = p_company_id and g.user_id = p_user_id;

  if g_status is distinct from 'active' then
    return false;
  end if;
  if scope = 'all_company' then
    return true;
  end if;
  if scope = 'assigned_only' then
    return p_assigned_to is not distinct from p_user_id;
  end if;
  return false;
end;
$$;

revoke all on function private.user_conversation_readable(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.has_company_capability(
  p_company_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  cap text := btrim(coalesce(p_capability, ''));
  member_role text;
  member_status text;
  g_caps text[];
  g_status text;
  g_manager uuid;
begin
  if actor is null or p_company_id is null or cap = '' then
    return false;
  end if;
  if not (cap = any (private.access_company_capabilities())) then
    return false;
  end if;

  select m.role, m.status
  into member_role, member_status
  from public.company_members as m
  where m.company_id = p_company_id
    and m.user_id = actor;

  if member_role is null or member_status <> 'active' then
    return false;
  end if;

  if member_role = 'owner' then
    return true;
  end if;

  select g.capabilities, g.status, g.manager_user_id
  into g_caps, g_status, g_manager
  from public.company_member_grants as g
  where g.company_id = p_company_id
    and g.user_id = actor;

  if g_status is distinct from 'active' or g_caps is null or not (cap = any (g_caps)) then
    return false;
  end if;

  -- Independent (owner-issued) when manager_user_id is null.
  if g_manager is null then
    return true;
  end if;

  return private.manager_delegation_covers(g_manager, p_company_id, cap);
end;
$$;

revoke all on function public.has_company_capability(uuid, text) from public, anon;
grant execute on function public.has_company_capability(uuid, text) to authenticated;

create or replace function public.company_conversation_scope(p_company_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  member_role text;
  scope text;
  g_status text;
begin
  if actor is null or p_company_id is null then
    return null;
  end if;

  select m.role into member_role
  from public.company_members as m
  where m.company_id = p_company_id
    and m.user_id = actor
    and m.status = 'active';

  if member_role is null then
    return null;
  end if;
  if member_role = 'owner' then
    return 'all_company';
  end if;

  select g.conversation_scope, g.status into scope, g_status
  from public.company_member_grants as g
  where g.company_id = p_company_id
    and g.user_id = actor;

  if g_status is distinct from 'active' then
    return null;
  end if;
  return scope; -- never coalesce to all_company
end;
$$;

revoke all on function public.company_conversation_scope(uuid) from public, anon;
grant execute on function public.company_conversation_scope(uuid) to authenticated;

create or replace function private.conversation_readable(
  p_company_id uuid,
  p_assigned_to uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  scope text;
begin
  if actor is null or p_company_id is null then
    return false;
  end if;
  if private.can_admin_company(p_company_id, 'wa.conversations.read') then
    return true;
  end if;
  if not public.has_company_capability(p_company_id, 'wa.conversations.read') then
    return false;
  end if;
  scope := public.company_conversation_scope(p_company_id);
  if scope = 'all_company' then
    return true;
  end if;
  if scope = 'assigned_only' then
    return p_assigned_to is not distinct from actor;
  end if;
  return false;
end;
$$;

revoke all on function private.conversation_readable(uuid, uuid) from public, anon;
grant execute on function private.conversation_readable(uuid, uuid) to authenticated;

create or replace function private.disable_dependent_grants(p_manager uuid, p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.company_member_grants as g
  set status = 'disabled',
      revision = g.revision + 1,
      updated_at = now()
  where g.manager_user_id = p_manager
    and (p_company_id is null or g.company_id = p_company_id)
    and g.status = 'active';
end;
$$;

revoke all on function private.disable_dependent_grants(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: WhatsApp — no blanket platform admin; wa.read + assigned_only in policy
-- ---------------------------------------------------------------------------
drop policy if exists whatsapp_conversations_select on public.whatsapp_conversations;
drop policy if exists whatsapp_conversations_select_member_or_admin on public.whatsapp_conversations;
create policy whatsapp_conversations_select
  on public.whatsapp_conversations
  for select
  to authenticated
  using (private.conversation_readable(company_id, assigned_to));

drop policy if exists whatsapp_messages_select on public.whatsapp_messages;
drop policy if exists whatsapp_messages_select_member_or_admin on public.whatsapp_messages;
create policy whatsapp_messages_select
  on public.whatsapp_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.whatsapp_conversations as c
      where c.id = conversation_id
        and c.company_id = whatsapp_messages.company_id
        and private.conversation_readable(c.company_id, c.assigned_to)
    )
  );

drop policy if exists whatsapp_delivery_statuses_select on public.whatsapp_delivery_statuses;
drop policy if exists whatsapp_delivery_statuses_select_member_or_admin on public.whatsapp_delivery_statuses;
create policy whatsapp_delivery_statuses_select
  on public.whatsapp_delivery_statuses
  for select
  to authenticated
  using (
    (
      private.is_active_company_member(company_id)
      and public.has_company_capability(company_id, 'wa.conversations.read')
    )
    or private.can_admin_company(company_id, 'wa.conversations.read')
  );

drop policy if exists whatsapp_conversation_events_select_member on public.whatsapp_conversation_events;
create policy whatsapp_conversation_events_select_member
  on public.whatsapp_conversation_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.whatsapp_conversations as c
      where c.id = conversation_id
        and c.company_id = whatsapp_conversation_events.company_id
        and private.conversation_readable(c.company_id, c.assigned_to)
    )
  );

-- Knowledge + storage: can_admin_company / capability instead of is_platform_admin
drop policy if exists knowledge_sources_select_member_or_admin on public.knowledge_sources;
create policy knowledge_sources_select_member_or_admin
  on public.knowledge_sources
  for select
  to authenticated
  using (
    private.can_admin_company(company_id, 'knowledge.read')
    or (
      private.is_active_company_member(company_id)
      and public.has_company_capability(company_id, 'knowledge.read')
    )
  );

drop policy if exists knowledge_sources_insert_owner on public.knowledge_sources;
create policy knowledge_sources_insert_owner
  on public.knowledge_sources
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      private.is_active_company_owner(company_id)
      or (
        private.is_active_company_member(company_id)
        and public.has_company_capability(company_id, 'knowledge.write')
      )
    )
  );

drop policy if exists knowledge_sources_update_owner on public.knowledge_sources;
create policy knowledge_sources_update_owner
  on public.knowledge_sources
  for update
  to authenticated
  using (
    private.is_active_company_owner(company_id)
    or (
      private.is_active_company_member(company_id)
      and public.has_company_capability(company_id, 'knowledge.write')
    )
  )
  with check (
    private.is_active_company_owner(company_id)
    or (
      private.is_active_company_member(company_id)
      and public.has_company_capability(company_id, 'knowledge.write')
    )
  );

drop policy if exists knowledge_sources_delete_owner on public.knowledge_sources;
create policy knowledge_sources_delete_owner
  on public.knowledge_sources
  for delete
  to authenticated
  using (
    private.is_active_company_owner(company_id)
    or (
      private.is_active_company_member(company_id)
      and public.has_company_capability(company_id, 'knowledge.delete')
    )
  );

drop policy if exists company_knowledge_select_member_or_admin on storage.objects;
create policy company_knowledge_select_member_or_admin
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'company-knowledge'
    and (
      private.can_admin_company(private.storage_company_id(name), 'knowledge.read')
      or (
        private.is_active_company_member(private.storage_company_id(name))
        and public.has_company_capability(private.storage_company_id(name), 'knowledge.read')
      )
    )
  );

drop policy if exists company_knowledge_insert_owner on storage.objects;
create policy company_knowledge_insert_owner
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'company-knowledge'
    and (
      private.is_active_company_owner(private.storage_company_id(name))
      or (
        private.is_active_company_member(private.storage_company_id(name))
        and public.has_company_capability(private.storage_company_id(name), 'knowledge.write')
      )
    )
  );

drop policy if exists company_knowledge_update_owner on storage.objects;
create policy company_knowledge_update_owner
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'company-knowledge'
    and (
      private.is_active_company_owner(private.storage_company_id(name))
      or (
        private.is_active_company_member(private.storage_company_id(name))
        and public.has_company_capability(private.storage_company_id(name), 'knowledge.write')
      )
    )
  )
  with check (
    bucket_id = 'company-knowledge'
    and (
      private.is_active_company_owner(private.storage_company_id(name))
      or (
        private.is_active_company_member(private.storage_company_id(name))
        and public.has_company_capability(private.storage_company_id(name), 'knowledge.write')
      )
    )
  );

drop policy if exists company_knowledge_delete_owner on storage.objects;
create policy company_knowledge_delete_owner
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'company-knowledge'
    and (
      private.is_active_company_owner(private.storage_company_id(name))
      or (
        private.is_active_company_member(private.storage_company_id(name))
        and public.has_company_capability(private.storage_company_id(name), 'knowledge.delete')
      )
    )
  );

-- WhatsApp company links: scoped admin, not blanket is_platform_admin
drop policy if exists whatsapp_company_links_select on public.whatsapp_company_links;
drop policy if exists whatsapp_company_links_select_member_or_admin on public.whatsapp_company_links;
do $$
begin
  if exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'whatsapp_company_links'
  ) then
    execute $p$
      drop policy if exists whatsapp_company_links_select_admin on public.whatsapp_company_links;
      drop policy if exists whatsapp_company_links_select on public.whatsapp_company_links;
      create policy whatsapp_company_links_select
        on public.whatsapp_company_links
        for select
        to authenticated
        using (
          private.is_active_company_member(company_id)
          or private.can_admin_company(company_id, 'platform.manage_companies')
        )
    $p$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform-wide search: owner only
-- ---------------------------------------------------------------------------
create or replace function public.admin_search_accounts(
  p_query text default '',
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  user_id uuid,
  support_code text,
  full_name text,
  email text,
  account_phone text,
  email_confirmed boolean,
  companies jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  q_raw text := btrim(coalesce(p_query, ''));
  q text := lower(q_raw);
  q_phone text := private.normalize_phone_digits(q_raw);
  q_code text := upper(q_raw);
  q_name_esc text := private.escape_like_pattern(q);
  lim int := greatest(1, least(coalesce(p_limit, 20), 50));
  off int := greatest(0, least(coalesce(p_offset, 0), 100000));
  recent int;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_platform_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if char_length(q_raw) > 120 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(872334151, hashtext(actor::text));

  select count(*)::int
  into recent
  from public.admin_audit_logs as al
  where al.actor_user_id = actor
    and al.action = 'admin.search_accounts'
    and al.created_at > now() - interval '60 seconds';

  if recent >= 30 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  perform private.write_admin_audit(
    actor,
    null,
    'admin.search_accounts',
    '{}'::jsonb,
    jsonb_build_object('q_len', char_length(q_raw), 'limit', lim, 'offset', off, 'browse', q_raw = '')
  );

  return query
  select
    u.id as user_id,
    p.support_code,
    p.full_name,
    u.email::text,
    nullif(btrim(coalesce(u.phone, '')), '')::text as account_phone,
    (u.email_confirmed_at is not null) as email_confirmed,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'company_id', c.id,
          'display_name', c.display_name,
          'role', m.role,
          'status', m.status,
          'company_status', c.status,
          'business_phone', nullif(btrim(c.contact_phone), '')
        )
        order by c.display_name
      )
      from public.company_members as m
      join public.companies as c on c.id = m.company_id
      where m.user_id = u.id
    ), '[]'::jsonb) as companies
  from auth.users as u
  left join public.profiles as p on p.user_id = u.id
  where
    q_raw = ''
    or upper(coalesce(p.support_code, '')) = q_code
    or lower(coalesce(u.email, '')) = q
    or (
      q_phone <> ''
      and private.normalize_phone_digits(coalesce(u.phone, '')) = q_phone
    )
    or (
      char_length(q) >= 2
      and lower(coalesce(p.full_name, '')) like '%' || q_name_esc || '%' escape '\'
    )
  order by u.created_at desc nulls last
  limit lim offset off;
end;
$$;

revoke all on function public.admin_search_accounts(text, integer, integer) from public, anon;
grant execute on function public.admin_search_accounts(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- control_whatsapp_conversation: capabilities + assign separate from take_over
-- ---------------------------------------------------------------------------
alter table public.whatsapp_conversation_events
  drop constraint if exists whatsapp_conversation_events_action_chk;
alter table public.whatsapp_conversation_events
  add constraint whatsapp_conversation_events_action_chk
  check (action in ('take_over', 'resume', 'close', 'reopen_inbound', 'assign'));

drop function if exists public.control_whatsapp_conversation(uuid, text, integer);
drop function if exists public.control_whatsapp_conversation(uuid, text, integer, uuid);

create or replace function public.control_whatsapp_conversation(
  p_conversation_id uuid,
  p_action text,
  p_expected_revision integer,
  p_assignee_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_action text := pg_catalog.btrim(coalesce(p_action, ''));
  v_conv public.whatsapp_conversations%rowtype;
  v_company public.companies%rowtype;
  v_needed text;
  v_updated public.whatsapp_conversations%rowtype;
  v_assignee_ok boolean;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_conversation_id is null
     or p_expected_revision is null
     or v_action not in ('take_over', 'resume', 'close', 'assign') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_conv
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into v_company
  from public.companies
  where id = v_conv.company_id;

  if not found or v_company.status = 'suspended' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if not private.conversation_readable(v_conv.company_id, v_conv.assigned_to) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  v_needed := case v_action
    when 'take_over' then 'wa.conversations.take_over'
    when 'resume' then 'wa.conversations.resume'
    when 'close' then 'wa.conversations.close'
    when 'assign' then 'wa.conversations.assign'
  end;

  if not public.has_company_capability(v_conv.company_id, v_needed) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_conv.control_revision is distinct from p_expected_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'conflict',
      'conversation', jsonb_build_object(
        'id', v_conv.id,
        'status', v_conv.status,
        'automation_allowed', v_conv.automation_allowed,
        'automation_generation', v_conv.automation_generation,
        'control_revision', v_conv.control_revision,
        'assigned_to', v_conv.assigned_to,
        'control_actor_id', v_conv.control_actor_id,
        'control_acted_at', v_conv.control_acted_at
      )
    );
  end if;

  if v_action = 'assign' then
    if p_assignee_user_id is not null then
      select exists (
        select 1 from public.company_members as m
        where m.company_id = v_conv.company_id
          and m.user_id = p_assignee_user_id
          and m.status = 'active'
          and m.role in ('owner', 'staff')
      ) into v_assignee_ok;
      if not v_assignee_ok then
        return jsonb_build_object('ok', false, 'code', 'invalid_input');
      end if;
    end if;
  end if;

  perform pg_catalog.set_config('velora.conversation_control', '1', true);

  if v_action = 'take_over' then
    -- Do NOT set assigned_to = uid (assign is a separate capability).
    update public.whatsapp_conversations as c
    set
      status = 'handed_over',
      automation_allowed = false,
      automation_generation = c.automation_generation + 1,
      control_revision = c.control_revision + 1,
      control_actor_id = uid,
      control_acted_at = pg_catalog.now()
    where c.id = v_conv.id
      and c.control_revision = p_expected_revision
    returning * into v_updated;
  elsif v_action = 'resume' then
    update public.whatsapp_conversations as c
    set
      status = 'open',
      automation_allowed = true,
      control_revision = c.control_revision + 1,
      assigned_to = null,
      control_actor_id = uid,
      control_acted_at = pg_catalog.now()
    where c.id = v_conv.id
      and c.control_revision = p_expected_revision
    returning * into v_updated;
  elsif v_action = 'close' then
    update public.whatsapp_conversations as c
    set
      status = 'resolved',
      automation_allowed = false,
      automation_generation = c.automation_generation + 1,
      control_revision = c.control_revision + 1,
      control_actor_id = uid,
      control_acted_at = pg_catalog.now()
    where c.id = v_conv.id
      and c.control_revision = p_expected_revision
    returning * into v_updated;
  else
    -- assign
    update public.whatsapp_conversations as c
    set
      assigned_to = p_assignee_user_id,
      control_revision = c.control_revision + 1,
      control_actor_id = uid,
      control_acted_at = pg_catalog.now()
    where c.id = v_conv.id
      and c.control_revision = p_expected_revision
    returning * into v_updated;
  end if;

  if not found then
    select * into v_conv from public.whatsapp_conversations where id = p_conversation_id;
    return jsonb_build_object(
      'ok', false,
      'code', 'conflict',
      'conversation', jsonb_build_object(
        'id', v_conv.id,
        'status', v_conv.status,
        'automation_allowed', v_conv.automation_allowed,
        'automation_generation', v_conv.automation_generation,
        'control_revision', v_conv.control_revision,
        'assigned_to', v_conv.assigned_to,
        'control_actor_id', v_conv.control_actor_id,
        'control_acted_at', v_conv.control_acted_at
      )
    );
  end if;

  insert into public.whatsapp_conversation_events (
    company_id, conversation_id, actor_user_id, action, revision, automation_generation
  ) values (
    v_updated.company_id,
    v_updated.id,
    uid,
    v_action,
    v_updated.control_revision,
    v_updated.automation_generation
  );

  return jsonb_build_object(
    'ok', true,
    'action', v_action,
    'conversation', jsonb_build_object(
      'id', v_updated.id,
      'status', v_updated.status,
      'automation_allowed', v_updated.automation_allowed,
      'automation_generation', v_updated.automation_generation,
      'control_revision', v_updated.control_revision,
      'assigned_to', v_updated.assigned_to,
      'control_actor_id', v_updated.control_actor_id,
      'control_acted_at', v_updated.control_acted_at
    )
  );
end;
$$;

revoke all on function public.control_whatsapp_conversation(uuid, text, integer, uuid) from public, anon;
grant execute on function public.control_whatsapp_conversation(uuid, text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_whatsapp_send_intent: require reply + readable conversation
-- ---------------------------------------------------------------------------
create or replace function public.create_whatsapp_send_intent(
  p_client_op_id text,
  p_conversation_id uuid,
  p_body text,
  p_phone_number_id text,
  p_sender_kind text default 'staff',
  p_expected_automation_generation integer default null,
  p_link_id uuid default null,
  p_link_generation bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_op text := pg_catalog.btrim(coalesce(p_client_op_id, ''));
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_phone text := pg_catalog.btrim(coalesce(p_phone_number_id, ''));
  v_sender text := pg_catalog.btrim(coalesce(p_sender_kind, 'staff'));
  v_conv public.whatsapp_conversations%rowtype;
  v_company public.companies%rowtype;
  v_existing public.whatsapp_send_intents%rowtype;
  v_row public.whatsapp_send_intents%rowtype;
  v_gen integer := p_expected_automation_generation;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_conversation_id is null
     or char_length(v_op) < 8 or char_length(v_op) > 128
     or char_length(v_body) < 1 or char_length(v_body) > 4096
     or v_phone = ''
     or v_sender <> 'staff' then
    -- create_whatsapp_send_intent is staff-only for authenticated; assistant via service_role helper.
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_conv
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into v_company
  from public.companies
  where id = v_conv.company_id;

  if not found or v_company.status = 'suspended' then
    return jsonb_build_object('ok', false, 'code', 'company_suspended');
  end if;

  if not public.has_company_capability(v_conv.company_id, 'wa.conversations.reply') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if not private.conversation_readable(v_conv.company_id, v_conv.assigned_to) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_conv.phone_number_id is distinct from v_phone then
    return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
  end if;

  v_gen := null;

  select * into v_existing
  from public.whatsapp_send_intents as i
  where i.company_id = v_conv.company_id
    and i.client_op_id = v_op
  for update;

  if found then
    if not private.whatsapp_send_intent_fields_match(
      v_existing, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id, v_body, v_sender, v_gen,
      p_link_id, p_link_generation
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'content_mismatch',
        'intent', private.whatsapp_send_intent_public(v_existing)
      );
    end if;
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'intent', private.whatsapp_send_intent_public(v_existing)
    );
  end if;

  insert into public.whatsapp_send_intents (
    client_op_id, company_id, conversation_id, phone_number_id, recipient_wa_id,
    body, sender_kind, actor_user_id, outcome, expected_automation_generation,
    link_id, link_generation
  ) values (
    v_op, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id,
    v_body, v_sender, uid, 'ready', v_gen,
    p_link_id, p_link_generation
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'intent', private.whatsapp_send_intent_public(v_row)
  );
exception
  when unique_violation then
    select * into v_existing
    from public.whatsapp_send_intents as i
    where i.company_id = v_conv.company_id
      and i.client_op_id = v_op;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'unavailable');
    end if;
    if not private.whatsapp_send_intent_fields_match(
      v_existing, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id, v_body, v_sender, v_gen,
      p_link_id, p_link_generation
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'content_mismatch',
        'intent', private.whatsapp_send_intent_public(v_existing)
      );
    end if;
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'intent', private.whatsapp_send_intent_public(v_existing)
    );
end;
$$;

revoke all on function public.create_whatsapp_send_intent(text, uuid, text, text, text, integer, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.create_whatsapp_send_intent(text, uuid, text, text, text, integer, uuid, bigint)
  to authenticated;

-- claim: restore ready→attempting contract; service_role only (never expose token to authenticated)
create or replace function public.claim_whatsapp_send_attempt(
  p_intent_id uuid,
  p_actor_user_id uuid,
  p_lease_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease integer := greatest(15, least(coalesce(p_lease_seconds, 90), 300));
  v_row public.whatsapp_send_intents%rowtype;
  v_conv public.whatsapp_conversations%rowtype;
  v_company public.companies%rowtype;
  v_token uuid;
begin
  -- Callable only by service_role (worker). p_actor_user_id is worker-supplied, not end-user JWT.
  if p_intent_id is null or p_actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_row
  from public.whatsapp_send_intents
  where id = p_intent_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into v_company
  from public.companies
  where id = v_row.company_id;

  if not found or v_company.status = 'suspended' then
    return jsonb_build_object(
      'ok', false,
      'code', 'company_suspended',
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  select * into v_conv
  from public.whatsapp_conversations
  where id = v_row.conversation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_conv.company_id is distinct from v_row.company_id
     or v_conv.phone_number_id is distinct from v_row.phone_number_id
     or v_conv.customer_wa_id is distinct from v_row.recipient_wa_id then
    return jsonb_build_object(
      'ok', false,
      'code', 'binding_mismatch',
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  if not private.whatsapp_intent_link_current(v_row) then
    return jsonb_build_object(
      'ok', false,
      'code', 'link_changed',
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  if v_row.sender_kind = 'staff' then
    if not private.user_has_company_capability(p_actor_user_id, v_row.company_id, 'wa.conversations.reply')
       or not private.user_conversation_readable(p_actor_user_id, v_row.company_id, v_conv.assigned_to) then
      return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
  elsif v_row.sender_kind = 'assistant' then
    if v_conv.automation_allowed is not true
       or v_conv.status = 'resolved'
       or v_row.expected_automation_generation is null
       or v_conv.automation_generation is distinct from v_row.expected_automation_generation then
      return jsonb_build_object(
        'ok', false,
        'code', 'automation_blocked',
        'intent', private.whatsapp_send_intent_public(v_row)
      );
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if v_row.outcome = 'ready' then
    v_token := gen_random_uuid();
    update public.whatsapp_send_intents as i
    set outcome = 'attempting',
        attempt_token = v_token,
        attempt_started_at = now(),
        attempt_expires_at = now() + make_interval(secs => v_lease),
        updated_at = now()
    where i.id = v_row.id
      and i.outcome = 'ready'
    returning * into v_row;

    if not found then
      select * into v_row from public.whatsapp_send_intents where id = p_intent_id;
      return jsonb_build_object(
        'ok', false,
        'code', 'in_progress',
        'intent', private.whatsapp_send_intent_public(v_row)
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'claimed', true,
      'attempt_token', v_token,
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  if v_row.outcome = 'attempting' then
    return jsonb_build_object(
      'ok', false,
      'code', 'in_progress',
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'claimed', false,
    'intent', private.whatsapp_send_intent_public(v_row)
  );
end;
$$;

revoke all on function public.claim_whatsapp_send_attempt(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_send_attempt(uuid, uuid, integer) to service_role;


-- ---------------------------------------------------------------------------
-- Access management RPCs
-- ---------------------------------------------------------------------------
create or replace function private.actor_may_manage_staff(p_company_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or p_company_id is null then
    return false;
  end if;
  if public.is_platform_owner() then
    return true;
  end if;
  if exists (
    select 1 from public.company_members as m
    where m.company_id = p_company_id
      and m.user_id = actor
      and m.role = 'owner'
      and m.status = 'active'
  ) then
    return true;
  end if;
  return exists (
    select 1
    from public.platform_admins as a
    join public.platform_admin_scopes as s on s.admin_user_id = a.user_id
    where a.user_id = actor
      and a.status = 'active'
      and a.role = 'delegated'
      and s.company_id = p_company_id
      and 'company.staff.manage' = any (s.delegable_capabilities)
  );
end;
$$;

revoke all on function private.actor_may_manage_staff(uuid) from public, anon, authenticated;

create or replace function private.resolve_grant_manager(p_company_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  -- Owner-issued independent grants: manager_user_id null.
  if public.is_platform_owner() then
    return null;
  end if;
  if exists (
    select 1 from public.company_members as m
    where m.company_id = p_company_id and m.user_id = actor
      and m.role = 'owner' and m.status = 'active'
  ) then
    return null;
  end if;
  -- Delegated admin: dependent on this actor (ignore client manager_user_id).
  return actor;
end;
$$;

revoke all on function private.resolve_grant_manager(uuid) from public, anon, authenticated;

create or replace function public.access_get_user_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target auth.users%rowtype;
  plat public.platform_admins%rowtype;
  memberships jsonb;
  grants jsonb;
  scopes jsonb;
  scoped uuid[];
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into target from auth.users as u where u.id = p_user_id;
  if target.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into plat from public.platform_admins as a where a.user_id = p_user_id;

  if public.is_platform_owner() then
    scoped := null;
  else
    select coalesce(array_agg(s.company_id), '{}'::uuid[])
    into scoped
    from public.platform_admin_scopes as s
    where s.admin_user_id = actor;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', m.company_id,
    'role', m.role,
    'status', m.status,
    'display_name', c.display_name,
    'company_status', c.status
  ) order by c.display_name), '[]'::jsonb)
  into memberships
  from public.company_members as m
  join public.companies as c on c.id = m.company_id
  where m.user_id = p_user_id
    and (scoped is null or m.company_id = any (scoped));

  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', g.company_id,
    'capabilities', to_jsonb(g.capabilities),
    'conversation_scope', g.conversation_scope,
    'manager_user_id', g.manager_user_id,
    'status', g.status,
    'revision', g.revision
  )), '[]'::jsonb)
  into grants
  from public.company_member_grants as g
  where g.user_id = p_user_id
    and (scoped is null or g.company_id = any (scoped));

  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', s.company_id,
    'usable_capabilities', to_jsonb(s.usable_capabilities),
    'delegable_capabilities', to_jsonb(s.delegable_capabilities),
    'revision', s.revision
  )), '[]'::jsonb)
  into scopes
  from public.platform_admin_scopes as s
  where s.admin_user_id = p_user_id
    and (scoped is null or s.company_id = any (scoped) or public.is_platform_owner());

  return jsonb_build_object(
    'ok', true,
    'user_id', target.id,
    'email', target.email,
    'email_confirmed', target.email_confirmed_at is not null,
    'platform', case
      when plat.user_id is null then null
      else jsonb_build_object(
        'role', plat.role,
        'status', plat.status,
        'revision', plat.revision,
        'granted_at', plat.granted_at,
        'note', plat.note
      )
    end,
    'memberships', memberships,
    'grants', grants,
    'admin_scopes', scopes,
    'catalog', jsonb_build_object(
      'platform', to_jsonb(private.access_platform_capabilities()),
      'company', to_jsonb(private.access_company_capabilities())
    )
  );
end;
$$;

revoke all on function public.access_get_user_snapshot(uuid) from public, anon;
grant execute on function public.access_get_user_snapshot(uuid) to authenticated;

create or replace function public.access_set_member_grants(
  p_company_id uuid,
  p_user_id uuid,
  p_capabilities text[],
  p_conversation_scope text,
  p_manager_user_id uuid,
  p_expected_revision integer,
  p_reason text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  member public.company_members%rowtype;
  existing public.company_member_grants%rowtype;
  caps text[] := coalesce(p_capabilities, '{}'::text[]);
  scope text := coalesce(nullif(btrim(p_conversation_scope), ''), 'all_company');
  reason text := left(btrim(coalesce(p_reason, '')), 240);
  allowed text[];
  cap text;
  next_rev int;
  v_manager uuid;
  updated int;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- Client cannot choose manager; ignore p_manager_user_id.
  if p_expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'revision_required');
  end if;
  if p_company_id is null or p_user_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if scope not in ('all_company', 'assigned_only') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not private.actor_may_manage_staff(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not public.is_platform_owner()
     and not exists (
       select 1 from public.company_members as m
       where m.company_id = p_company_id and m.user_id = actor and m.role = 'owner' and m.status = 'active'
     )
  then
    select s.delegable_capabilities into allowed
    from public.platform_admin_scopes as s
    where s.admin_user_id = actor and s.company_id = p_company_id;
    foreach cap in array caps loop
      if allowed is null or not (cap = any (allowed)) then
        raise exception 'forbidden' using errcode = '42501';
      end if;
    end loop;
  end if;

  foreach cap in array caps loop
    if not (cap = any (private.access_company_capabilities())) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end loop;

  select * into member
  from public.company_members as m
  where m.company_id = p_company_id and m.user_id = p_user_id;
  if member.user_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_member');
  end if;
  if member.role = 'owner' then
    return jsonb_build_object('ok', false, 'code', 'owner_grants_implicit');
  end if;

  select * into existing
  from public.company_member_grants as g
  where g.company_id = p_company_id and g.user_id = p_user_id
  for update;

  -- Independent (manager_user_id null) grants stay owner-issued; delegated cannot steal source.
  if existing.user_id is not null and existing.manager_user_id is null then
    if not (
      public.is_platform_owner()
      or exists (
        select 1 from public.company_members as m
        where m.company_id = p_company_id and m.user_id = actor
          and m.role = 'owner' and m.status = 'active'
      )
    ) then
      return jsonb_build_object('ok', false, 'code', 'independent_grant_protected');
    end if;
    v_manager := null;
  elsif existing.user_id is not null
        and existing.manager_user_id is not null
        and existing.manager_user_id is distinct from actor
        and not public.is_platform_owner()
        and not exists (
          select 1 from public.company_members as m
          where m.company_id = p_company_id and m.user_id = actor
            and m.role = 'owner' and m.status = 'active'
        )
  then
    return jsonb_build_object('ok', false, 'code', 'grant_owned_by_other_manager');
  else
    v_manager := private.resolve_grant_manager(p_company_id);
  end if;

  if existing.user_id is not null then
    next_rev := existing.revision + 1;
    update public.company_member_grants as g
    set
      capabilities = caps,
      conversation_scope = scope,
      manager_user_id = v_manager,
      status = 'active',
      revision = next_rev,
      updated_at = now(),
      updated_by = actor
    where g.company_id = p_company_id
      and g.user_id = p_user_id
      and g.revision = p_expected_revision;
    get diagnostics updated = row_count;
    if updated = 0 then
      return jsonb_build_object('ok', false, 'code', 'revision_conflict', 'revision', existing.revision);
    end if;
  else
    if p_expected_revision <> 0 then
      return jsonb_build_object('ok', false, 'code', 'revision_conflict', 'revision', 0);
    end if;
    next_rev := 1;
    insert into public.company_member_grants (
      company_id, user_id, capabilities, conversation_scope, manager_user_id, status, revision, updated_by
    ) values (
      p_company_id, p_user_id, caps, scope, v_manager, 'active', next_rev, actor
    );
  end if;

  perform private.write_admin_audit(
    actor,
    p_company_id,
    'access.set_member_grants',
    jsonb_build_object(
      'user_id', p_user_id,
      'before', case when existing.user_id is null then null else to_jsonb(existing) end
    ),
    jsonb_build_object(
      'user_id', p_user_id,
      'capabilities', to_jsonb(caps),
      'conversation_scope', scope,
      'manager_user_id', v_manager,
      'revision', next_rev,
      'reason', reason
    )
  );

  return jsonb_build_object('ok', true, 'revision', next_rev);
end;
$$;

revoke all on function public.access_set_member_grants(uuid, uuid, text[], text, uuid, integer, text) from public, anon;
grant execute on function public.access_set_member_grants(uuid, uuid, text[], text, uuid, integer, text) to authenticated;

create or replace function public.access_add_company_staff(
  p_company_id uuid,
  p_user_id uuid,
  p_capabilities text[],
  p_conversation_scope text,
  p_expected_grant_revision integer,
  p_reason text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  member public.company_members%rowtype;
  caps text[] := coalesce(p_capabilities, '{}'::text[]);
  scope text := coalesce(nullif(btrim(p_conversation_scope), ''), 'all_company');
  reason text := left(btrim(coalesce(p_reason, '')), 240);
  created boolean := false;
  reactivated boolean := false;
  cap text;
  r jsonb;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_expected_grant_revision is null then
    raise exception 'revision_required' using errcode = '22023';
  end if;
  if p_company_id is null or p_user_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if scope not in ('all_company', 'assigned_only') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not private.actor_may_manage_staff(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users as u where u.id = p_user_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  foreach cap in array caps loop
    if not (cap = any (private.access_company_capabilities())) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end loop;

  select * into member
  from public.company_members as m
  where m.company_id = p_company_id and m.user_id = p_user_id
  for update;

  if member.user_id is not null then
    if member.role = 'owner' then
      raise exception 'already_owner' using errcode = '22023';
    end if;
    if member.status <> 'active' then
      update public.company_members as m
      set status = 'active'
      where m.company_id = p_company_id and m.user_id = p_user_id;
      reactivated := true;
    end if;
  else
    insert into public.company_members (company_id, user_id, role, status)
    values (p_company_id, p_user_id, 'staff', 'active');
    created := true;
  end if;

  r := public.access_set_member_grants(
    p_company_id,
    p_user_id,
    caps,
    scope,
    null,
    p_expected_grant_revision,
    reason
  );

  -- JSON failure must roll back membership insert/reactivation.
  if r is null or coalesce((r->>'ok')::boolean, false) is not true then
    raise exception 'grant_failed:%', coalesce(r->>'code', 'unavailable') using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'revision', coalesce((r->>'revision')::int, 1),
    'created_membership', created,
    'reactivated_membership', reactivated
  );
end;
$$;

revoke all on function public.access_add_company_staff(uuid, uuid, text[], text, integer, text) from public, anon;
grant execute on function public.access_add_company_staff(uuid, uuid, text[], text, integer, text) to authenticated;

create or replace function public.access_set_admin_scope(
  p_admin_user_id uuid,
  p_company_id uuid,
  p_usable text[],
  p_delegable text[],
  p_expected_revision integer,
  p_reason text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  plat public.platform_admins%rowtype;
  existing public.platform_admin_scopes%rowtype;
  usable text[] := coalesce(p_usable, '{}'::text[]);
  delegable text[] := coalesce(p_delegable, '{}'::text[]);
  reason text := left(btrim(coalesce(p_reason, '')), 240);
  cap text;
  next_rev int;
  updated int;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_platform_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'revision_required');
  end if;
  if p_admin_user_id is null or p_company_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_admin_user_id = actor then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into plat from public.platform_admins as a where a.user_id = p_admin_user_id;
  if plat.user_id is null or plat.role <> 'delegated' or plat.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'not_delegated_admin');
  end if;

  foreach cap in array usable || delegable loop
    if not (cap = any (private.access_company_capabilities())
            or cap = any (private.access_platform_capabilities())) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end loop;

  foreach cap in array delegable loop
    if not (cap = any (usable)) then
      return jsonb_build_object('ok', false, 'code', 'delegable_not_subset');
    end if;
  end loop;

  select * into existing
  from public.platform_admin_scopes as s
  where s.admin_user_id = p_admin_user_id and s.company_id = p_company_id
  for update;

  if existing.admin_user_id is not null then
    next_rev := existing.revision + 1;
    update public.platform_admin_scopes as s
    set usable_capabilities = usable,
        delegable_capabilities = delegable,
        revision = next_rev,
        updated_at = now(),
        updated_by = actor
    where s.admin_user_id = p_admin_user_id
      and s.company_id = p_company_id
      and s.revision = p_expected_revision;
    get diagnostics updated = row_count;
    if updated = 0 then
      return jsonb_build_object('ok', false, 'code', 'revision_conflict', 'revision', existing.revision);
    end if;
    -- Shrinking delegable invalidates dependent grants for caps no longer covered
    -- via full disable of dependent grants for this manager+company (re-grant required).
    perform private.disable_dependent_grants(p_admin_user_id, p_company_id);
  else
    if p_expected_revision <> 0 then
      return jsonb_build_object('ok', false, 'code', 'revision_conflict', 'revision', 0);
    end if;
    next_rev := 1;
    insert into public.platform_admin_scopes (
      admin_user_id, company_id, usable_capabilities, delegable_capabilities, revision, updated_by
    ) values (
      p_admin_user_id, p_company_id, usable, delegable, next_rev, actor
    );
  end if;

  -- Empty usable ⇒ delete scope and invalidate dependents
  if cardinality(usable) = 0 then
    delete from public.platform_admin_scopes as s
    where s.admin_user_id = p_admin_user_id and s.company_id = p_company_id;
    perform private.disable_dependent_grants(p_admin_user_id, p_company_id);
  end if;

  perform private.write_admin_audit(
    actor,
    p_company_id,
    'access.set_admin_scope',
    jsonb_build_object('admin_user_id', p_admin_user_id, 'before', case when existing.admin_user_id is null then null else to_jsonb(existing) end),
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'usable', to_jsonb(usable),
      'delegable', to_jsonb(delegable),
      'revision', next_rev,
      'reason', reason
    )
  );

  return jsonb_build_object('ok', true, 'revision', next_rev);
end;
$$;

revoke all on function public.access_set_admin_scope(uuid, uuid, text[], text[], integer, text) from public, anon;
grant execute on function public.access_set_admin_scope(uuid, uuid, text[], text[], integer, text) to authenticated;

create or replace function public.access_set_platform_role(
  p_user_id uuid,
  p_role text,
  p_status text,
  p_expected_revision integer,
  p_note text default '',
  p_reason text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  existing public.platform_admins%rowtype;
  role_v text := btrim(coalesce(p_role, ''));
  status_v text := btrim(coalesce(p_status, 'active'));
  note_v text := left(btrim(coalesce(p_note, '')), 240);
  reason text := left(btrim(coalesce(p_reason, '')), 240);
  owner_count int;
  next_rev int;
  updated int;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_platform_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'revision_required');
  end if;
  if p_user_id is null or role_v not in ('owner', 'delegated') or status_v not in ('active', 'disabled') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_user_id = actor and (role_v <> 'owner' or status_v <> 'active') then
    return jsonb_build_object('ok', false, 'code', 'cannot_demote_self');
  end if;

  -- Serialize last-owner checks
  perform pg_advisory_xact_lock(872334152);

  select * into existing from public.platform_admins as a where a.user_id = p_user_id for update;

  if existing.user_id is not null
     and existing.role = 'owner'
     and existing.status = 'active'
     and (role_v <> 'owner' or status_v <> 'active')
  then
    select count(*)::int into owner_count
    from public.platform_admins as a
    where a.role = 'owner' and a.status = 'active';
    if owner_count <= 1 then
      return jsonb_build_object('ok', false, 'code', 'last_owner');
    end if;
  end if;

  if existing.user_id is not null then
    next_rev := existing.revision + 1;
    update public.platform_admins as a
    set role = role_v,
        status = status_v,
        revision = next_rev,
        note = note_v,
        updated_at = now()
    where a.user_id = p_user_id
      and a.revision = p_expected_revision;
    get diagnostics updated = row_count;
    if updated = 0 then
      return jsonb_build_object('ok', false, 'code', 'revision_conflict', 'revision', existing.revision);
    end if;
  else
    if not exists (select 1 from auth.users as u where u.id = p_user_id) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if p_expected_revision <> 0 then
      return jsonb_build_object('ok', false, 'code', 'revision_conflict', 'revision', 0);
    end if;
    next_rev := 1;
    insert into public.platform_admins (user_id, role, status, revision, granted_by, note)
    values (p_user_id, role_v, status_v, next_rev, actor, note_v);
  end if;

  if status_v = 'disabled' or role_v <> 'delegated' then
    delete from public.platform_admin_scopes as s where s.admin_user_id = p_user_id;
    perform private.disable_dependent_grants(p_user_id, null);
  end if;

  perform private.write_admin_audit(
    actor,
    null,
    'access.set_platform_role',
    jsonb_build_object('user_id', p_user_id, 'before', case when existing.user_id is null then null else to_jsonb(existing) end),
    jsonb_build_object('user_id', p_user_id, 'role', role_v, 'status', status_v, 'revision', next_rev, 'reason', reason)
  );

  return jsonb_build_object('ok', true, 'revision', next_rev);
end;
$$;

revoke all on function public.access_set_platform_role(uuid, text, text, integer, text, text) from public, anon;
grant execute on function public.access_set_platform_role(uuid, text, text, integer, text, text) to authenticated;

-- Apply conversion → grants (owner only; used by bootstrap package)
create or replace function public.access_apply_staff_capability_conversion(
  p_company_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  n int := 0;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_platform_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.company_member_grants (
    company_id, user_id, capabilities, conversation_scope, manager_user_id, status, revision, updated_by
  )
  select
    c.company_id,
    c.user_id,
    c.capabilities,
    c.conversation_scope,
    null, -- independent (owner-issued via conversion)
    'active',
    1,
    actor
  from public.access_staff_capability_conversion as c
  join public.company_members as m
    on m.company_id = c.company_id and m.user_id = c.user_id
  where c.applied_at is null
    and m.role = 'staff'
    and m.status = 'active'
    and (p_company_id is null or c.company_id = p_company_id)
  on conflict (company_id, user_id) do nothing;

  get diagnostics n = row_count;

  update public.access_staff_capability_conversion as c
  set applied_at = now()
  where c.applied_at is null
    and (p_company_id is null or c.company_id = p_company_id)
    and exists (
      select 1 from public.company_member_grants as g
      where g.company_id = c.company_id and g.user_id = c.user_id
    );

  perform private.write_admin_audit(
    actor,
    p_company_id,
    'access.apply_staff_capability_conversion',
    '{}'::jsonb,
    jsonb_build_object('inserted_or_kept', n, 'company_id', p_company_id)
  );

  return jsonb_build_object('ok', true, 'applied_rows', n);
end;
$$;

revoke all on function public.access_apply_staff_capability_conversion(uuid) from public, anon;
grant execute on function public.access_apply_staff_capability_conversion(uuid) to authenticated;

-- WA link admin getters: can_admin_company instead of is_platform_admin
create or replace function public.admin_get_whatsapp_company_link(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.whatsapp_company_links%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if p_company_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  if not private.can_admin_company(p_company_id, 'platform.manage_companies') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select * into v_row
  from public.whatsapp_company_links
  where company_id = p_company_id;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'link', jsonb_build_object(
        'id', null,
        'company_id', p_company_id,
        'requested_display_number', '',
        'keep_on_phone', false,
        'status', 'not_connected',
        'verified_display_number', null,
        'inbound_tested_at', null,
        'outbound_tested_at', null,
        'reception_send_tested', false,
        'prior_link_evidence', false,
        'last_error_code', null,
        'admin_note', null,
        'provider_phone_number_id', null,
        'created_at', null,
        'updated_at', null
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'link', private.whatsapp_company_link_public(v_row, true)
  );
end;
$$;

revoke all on function public.admin_get_whatsapp_company_link(uuid) from public, anon;
grant execute on function public.admin_get_whatsapp_company_link(uuid) to authenticated;

comment on table public.platform_admin_scopes is
  'VEL-ACCESS-MANAGEMENT-01-FIX: delegated admin company scopes. Empty after migrate until owner grants.';
comment on table public.company_member_grants is
  'VEL-ACCESS-MANAGEMENT-01-FIX: staff grants. No seed; conversion table holds prior snapshot.';
comment on table public.access_staff_capability_conversion is
  'Prior staff effective caps snapshot. Applied only via access_apply_staff_capability_conversion / bootstrap.';


-- ===========================================================================
-- FIX2 appendix: close remaining is_platform_admin / require_platform_admin bypasses
-- ===========================================================================

-- require_platform_admin: active owner OR delegated with ≥1 scope (UI gate only).
-- Must NOT authorize company data — callers that touch a company must use can_admin_company(cap).
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
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return uid;
end;
$$;

create or replace function private.require_platform_owner()
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
  if not public.is_platform_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return uid;
end;
$$;

revoke all on function private.require_platform_owner() from public, anon, authenticated;

-- Global overview / search already owner-only above. Tighten overview if recreated.
create or replace function public.admin_overview_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    'accounts_total', (select count(*)::int from auth.users),
    'accounts_without_company', (
      select count(*)::int
      from auth.users as u
      where not exists (
        select 1 from public.company_members as m where m.user_id = u.id
      )
    ),
    'accounts_without_active_company', (
      select count(*)::int
      from auth.users as u
      where not exists (
        select 1
        from public.company_members as m
        where m.user_id = u.id
          and m.status = 'active'
      )
    ),
    'companies_total', (select count(*)::int from public.companies),
    'companies_setup', (select count(*)::int from public.companies where status = 'setup'),
    'companies_active', (select count(*)::int from public.companies where status = 'active'),
    'companies_suspended', (select count(*)::int from public.companies where status = 'suspended')
  );
end;
$$;

revoke all on function public.admin_overview_stats() from public, anon;
grant execute on function public.admin_overview_stats() to authenticated;

-- Review requests: scoped capability, not blanket is_platform_admin
drop policy if exists company_review_requests_select on public.company_review_requests;
create policy company_review_requests_select
  on public.company_review_requests
  for select
  to authenticated
  using (
    private.can_admin_company(company_id, 'platform.manage_companies')
    or (
      private.is_active_company_member(company_id)
      and exists (
        select 1
        from public.company_members as m
        where m.company_id = company_review_requests.company_id
          and m.user_id = (select auth.uid())
          and m.role = 'owner'
          and m.status = 'active'
      )
    )
  );

-- admin_audit_logs: owner only (no delegated global audit)
drop policy if exists admin_audit_logs_select on public.admin_audit_logs;
create policy admin_audit_logs_select
  on public.admin_audit_logs
  for select
  to authenticated
  using (public.is_platform_owner());

-- Assistant send intent: service_role trusted path only
create or replace function public.create_whatsapp_assistant_send_intent(
  p_client_op_id text,
  p_conversation_id uuid,
  p_body text,
  p_phone_number_id text,
  p_expected_automation_generation integer,
  p_link_id uuid default null,
  p_link_generation bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op text := pg_catalog.btrim(coalesce(p_client_op_id, ''));
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_phone text := pg_catalog.btrim(coalesce(p_phone_number_id, ''));
  v_conv public.whatsapp_conversations%rowtype;
  v_company public.companies%rowtype;
  v_existing public.whatsapp_send_intents%rowtype;
  v_row public.whatsapp_send_intents%rowtype;
  v_gen integer := p_expected_automation_generation;
begin
  if p_conversation_id is null
     or char_length(v_op) < 8 or char_length(v_op) > 128
     or char_length(v_body) < 1 or char_length(v_body) > 4096
     or v_phone = ''
     or v_gen is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_conv
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into v_company from public.companies where id = v_conv.company_id;
  if not found or v_company.status = 'suspended' then
    return jsonb_build_object('ok', false, 'code', 'company_suspended');
  end if;

  if v_conv.phone_number_id is distinct from v_phone then
    return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
  end if;

  if v_conv.automation_allowed is not true
     or v_conv.status = 'resolved'
     or v_conv.automation_generation is distinct from v_gen then
    return jsonb_build_object('ok', false, 'code', 'automation_blocked');
  end if;

  select * into v_existing
  from public.whatsapp_send_intents as i
  where i.company_id = v_conv.company_id
    and i.client_op_id = v_op
  for update;

  if found then
    if not private.whatsapp_send_intent_fields_match(
      v_existing, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id, v_body, 'assistant', v_gen,
      p_link_id, p_link_generation
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'content_mismatch',
        'intent', private.whatsapp_send_intent_public(v_existing)
      );
    end if;
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'intent', private.whatsapp_send_intent_public(v_existing)
    );
  end if;

  insert into public.whatsapp_send_intents (
    client_op_id, company_id, conversation_id, phone_number_id, recipient_wa_id,
    body, sender_kind, actor_user_id, outcome, expected_automation_generation,
    link_id, link_generation
  ) values (
    v_op, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id,
    v_body, 'assistant', null, 'ready', v_gen,
    p_link_id, p_link_generation
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'intent', private.whatsapp_send_intent_public(v_row)
  );
exception
  when unique_violation then
    select * into v_existing
    from public.whatsapp_send_intents as i
    where i.company_id = v_conv.company_id
      and i.client_op_id = v_op;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'unavailable');
    end if;
    if not private.whatsapp_send_intent_fields_match(
      v_existing, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id, v_body, 'assistant', v_gen,
      p_link_id, p_link_generation
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'content_mismatch',
        'intent', private.whatsapp_send_intent_public(v_existing)
      );
    end if;
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'intent', private.whatsapp_send_intent_public(v_existing)
    );
end;
$$;

revoke all on function public.create_whatsapp_assistant_send_intent(text, uuid, text, text, integer, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.create_whatsapp_assistant_send_intent(text, uuid, text, text, integer, uuid, bigint)
  to service_role;

-- Patch transition_company_review admin gate: scoped capability (replace bare is_platform_admin).
-- Full function body is large; inject via wrapper check function used at top of transitions.
create or replace function private.actor_may_review_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_admin_company(p_company_id, 'platform.manage_companies');
$$;

revoke all on function private.actor_may_review_company(uuid) from public, anon;
grant execute on function private.actor_may_review_company(uuid) to authenticated;

comment on function public.is_platform_admin() is
  'FIX2: UI/entry gate only (owner or delegated with ≥1 scope). Never authorize company data — use can_admin_company(company, capability).';


-- FIX2: scoped review transitions / company admin reads
create or replace function public.transition_company_review(
  p_action text,
  p_company_id uuid,
  p_expected_revision integer default null,
  p_number_ownership text default null,
  p_whatsapp_number text default null,
  p_readiness_confirmed boolean default null,
  p_owner_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  is_admin boolean := false;
  rec public.company_review_requests%rowtype;
  before_row jsonb;
  after_row jsonb;
  ownership text;
  wa text;
  note text;
  audit_action text;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_company_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if p_action is null or p_action not in ('submit', 'resubmit', 'request_changes', 'approve') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  is_admin := private.actor_may_review_company(p_company_id);

  if p_action in ('submit', 'resubmit') then
    perform private.require_active_owner(p_company_id);
  elsif p_action in ('request_changes', 'approve') then
    if not is_admin then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    -- Ensure company exists (admin path).
    if not exists (select 1 from public.companies as c where c.id = p_company_id) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  select * into rec
  from public.company_review_requests as rr
  where rr.company_id = p_company_id
  for update;

  -- First submit: insert, or return existing without overwrite.
  if p_action = 'submit' then
    if found then
      return jsonb_build_object(
        'ok', true,
        'code', 'EXISTING',
        'request', private.company_review_request_json(p_company_id)
      );
    end if;

    if p_readiness_confirmed is distinct from true then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    ownership := p_number_ownership;
    if ownership is null or ownership not in ('own', 'new') then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    wa := btrim(coalesce(p_whatsapp_number, ''));
    if char_length(wa) > 40 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if ownership = 'own' and wa = '' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if ownership = 'new' then
      wa := '';
    end if;

    begin
      insert into public.company_review_requests (
        company_id,
        requested_by,
        number_ownership,
        whatsapp_number,
        readiness_confirmed,
        status,
        revision,
        decided_by,
        decided_at,
        owner_note
      ) values (
        p_company_id,
        actor,
        ownership,
        wa,
        true,
        'pending_review',
        1,
        null,
        null,
        ''
      );
    exception
      when unique_violation then
        return jsonb_build_object(
          'ok', true,
          'code', 'EXISTING',
          'request', private.company_review_request_json(p_company_id)
        );
    end;

    after_row := private.company_review_request_json(p_company_id);
    perform private.write_admin_audit(
      actor,
      p_company_id,
      'review.submit',
      null,
      after_row
    );

    return jsonb_build_object(
      'ok', true,
      'code', 'OK',
      'request', after_row
    );
  end if;

  -- All other actions require an existing row.
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Optimistic concurrency: expected revision must match (same transaction).
  if p_expected_revision is null or p_expected_revision <> rec.revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'CONFLICT',
      'request', private.company_review_request_json(p_company_id)
    );
  end if;

  before_row := private.company_review_request_json(p_company_id);

  if p_action = 'resubmit' then
    if rec.status <> 'changes_requested' then
      return jsonb_build_object(
        'ok', false,
        'code', 'CONFLICT',
        'request', before_row
      );
    end if;

    if p_readiness_confirmed is distinct from true then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    ownership := p_number_ownership;
    if ownership is null or ownership not in ('own', 'new') then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    wa := btrim(coalesce(p_whatsapp_number, ''));
    if char_length(wa) > 40 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if ownership = 'own' and wa = '' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if ownership = 'new' then
      wa := '';
    end if;

    update public.company_review_requests as rr
    set
      number_ownership = ownership,
      whatsapp_number = wa,
      readiness_confirmed = true,
      requested_by = actor,
      requested_at = now(),
      status = 'pending_review',
      revision = rr.revision + 1,
      decided_by = null,
      decided_at = null,
      owner_note = ''
    where rr.company_id = p_company_id;

    audit_action := 'review.resubmit';

  elsif p_action = 'request_changes' then
    if rec.status <> 'pending_review' then
      return jsonb_build_object(
        'ok', false,
        'code', 'CONFLICT',
        'request', before_row
      );
    end if;

    note := btrim(coalesce(p_owner_note, ''));
    if note = '' or char_length(note) > 2000 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;

    update public.company_review_requests as rr
    set
      status = 'changes_requested',
      revision = rr.revision + 1,
      decided_by = actor,
      decided_at = now(),
      owner_note = note
    where rr.company_id = p_company_id;

    audit_action := 'review.request_changes';

  elsif p_action = 'approve' then
    if rec.status <> 'pending_review' then
      return jsonb_build_object(
        'ok', false,
        'code', 'CONFLICT',
        'request', before_row
      );
    end if;

    -- Optional note (may be empty). Does not alter company/payment/WhatsApp/AI.
    note := btrim(coalesce(p_owner_note, ''));
    if char_length(note) > 2000 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;

    update public.company_review_requests as rr
    set
      status = 'approved',
      revision = rr.revision + 1,
      decided_by = actor,
      decided_at = now(),
      owner_note = note
    where rr.company_id = p_company_id;

    audit_action := 'review.approve';
  end if;

  after_row := private.company_review_request_json(p_company_id);
  perform private.write_admin_audit(
    actor,
    p_company_id,
    audit_action,
    before_row,
    after_row
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'OK',
    'request', after_row
  );
end;
$$;

revoke all on function public.transition_company_review(text, uuid, integer, text, text, boolean, text)
  from public, anon;
grant execute on function public.transition_company_review(text, uuid, integer, text, text, boolean, text)
  to authenticated;

comment on function public.transition_company_review(text, uuid, integer, text, text, boolean, text) is
  'Owner submit/resubmit or admin request_changes/approve for setup review. Conflict returns CONFLICT with no mutation.';

-- ---------------------------------------------------------------------------
-- Admin list/detail: expose review status (DROP required when widening RETURNS TABLE)
-- ---------------------------------------------------------------------------

drop function if exists public.admin_list_companies(text);

create function public.admin_list_companies(p_search text default '')
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
  member_count bigint,
  review_requested_at timestamptz,
  review_requested_by uuid,
  review_status text,
  review_revision integer
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
    (select count(*) from public.company_members as cm where cm.company_id = c.id) as member_count,
    rr.requested_at as review_requested_at,
    rr.requested_by as review_requested_by,
    rr.status as review_status,
    rr.revision as review_revision
  from public.companies as c
  left join public.company_members as m
    on m.company_id = c.id and m.role = 'owner' and m.status = 'active'
  left join auth.users as u on u.id = m.user_id
  left join public.company_review_requests as rr on rr.company_id = c.id
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
  audits jsonb;
  review_request jsonb;
begin
  actor := private.require_platform_admin();
  if not private.can_admin_company(p_company_id, 'platform.manage_companies') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'action', l.action,
    'actor_user_id', l.actor_user_id,
    'actor_email', u.email,
    'created_at', l.created_at,
    'before_data', l.before_data,
    'after_data', l.after_data
  ) order by l.created_at desc), '[]'::jsonb)
    into audits
  from (
    select *
    from public.admin_audit_logs as al
    where al.company_id = p_company_id
    order by al.created_at desc
    limit 50
  ) as l
  left join auth.users as u on u.id = l.actor_user_id;

  review_request := private.company_review_request_json(p_company_id);

  return jsonb_build_object(
    'company', company,
    'members', members,
    'audits', audits,
    'review_request', review_request,
    'viewer', actor
  );
end;
$$;


drop function if exists public.admin_list_companies(text);
create function public.admin_list_companies(p_search text default '')
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
  member_count bigint,
  review_requested_at timestamptz,
  review_requested_by uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  q text := '%' || lower(btrim(coalesce(p_search, ''))) || '%';
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

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
    (select count(*) from public.company_members as cm where cm.company_id = c.id) as member_count,
    rr.requested_at as review_requested_at,
    rr.requested_by as review_requested_by
  from public.companies as c
  left join public.company_members as m
    on m.company_id = c.id and m.role = 'owner' and m.status = 'active'
  left join auth.users as u on u.id = m.user_id
  left join public.company_review_requests as rr on rr.company_id = c.id
  where (
      public.is_platform_owner()
      or private.can_admin_company(c.id, 'platform.manage_companies')
    )
    and (
      btrim(coalesce(p_search, '')) = ''
      or lower(c.display_name) like q
      or lower(coalesce(u.email, '')) like q
      or lower(coalesce(c.contact_email, '')) like q
      or lower(coalesce(c.contact_phone, '')) like q
      or lower(coalesce(c.city, '')) like q
    )
  order by c.created_at desc;
end;
$$;

revoke all on function public.admin_list_companies(text) from public, anon;
grant execute on function public.admin_list_companies(text) to authenticated;

-- FIX2: WhatsApp link admin RPCs — capability-scoped
create or replace function public.admin_update_whatsapp_link_note(
  p_company_id uuid,
  p_admin_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(pg_catalog.btrim(coalesce(p_admin_note, '')), '');
  v_row public.whatsapp_company_links%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if not private.can_admin_company(p_company_id, 'platform.manage_companies') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_company_id is null or (v_note is not null and char_length(v_note) > 2000) then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_row
  from public.whatsapp_company_links
  where company_id = p_company_id
  for update;

  if not found then
    insert into public.whatsapp_company_links (company_id, status, admin_note)
    values (p_company_id, 'not_connected', v_note)
    returning * into v_row;
  else
    update public.whatsapp_company_links as l
    set admin_note = v_note,
        updated_at = now()
    where l.id = v_row.id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'link', private.whatsapp_company_link_public(v_row, true)
  );
end;
$$;

create or replace function public.admin_mark_whatsapp_link_needs_external(
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.whatsapp_company_links%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if not private.can_admin_company(p_company_id, 'platform.manage_companies') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_company_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_row
  from public.whatsapp_company_links
  where company_id = p_company_id
  for update;

  if not found or v_row.status is distinct from 'request_saved' then
    return jsonb_build_object('ok', false, 'code', 'invalid_state');
  end if;

  update public.whatsapp_company_links as l
  set status = 'needs_external_action',
      updated_at = now()
  where l.id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'link', private.whatsapp_company_link_public(v_row, true)
  );
end;
$$;

-- ===========================================================================
-- FIX2b: close remaining admin company RPCs + select policies + real audit policy name
-- ===========================================================================

drop policy if exists companies_select_admin on public.companies;
create policy companies_select_admin
  on public.companies
  for select
  to authenticated
  using (
    public.is_platform_owner()
    or private.can_admin_company(id, 'platform.manage_companies')
  );

drop policy if exists company_members_select_admin on public.company_members;
create policy company_members_select_admin
  on public.company_members
  for select
  to authenticated
  using (
    public.is_platform_owner()
    or private.can_admin_company(company_id, 'platform.manage_companies')
    or private.can_admin_company(company_id, 'company.staff.manage')
  );

-- Real policy name from 20261004090000 (not admin_audit_logs_select).
drop policy if exists admin_audit_logs_select on public.admin_audit_logs;
drop policy if exists admin_audit_logs_select_admin on public.admin_audit_logs;
create policy admin_audit_logs_select_admin
  on public.admin_audit_logs
  for select
  to authenticated
  using (
    public.is_platform_owner()
    or (
      company_id is not null
      and private.can_admin_company(company_id, 'platform.view_audit')
    )
  );

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
  if not private.can_admin_company(p_company_id, 'platform.manage_companies') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

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
  if not private.can_admin_company(p_company_id, 'platform.manage_companies') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

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
  if not private.can_admin_company(p_company_id, 'company.staff.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

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

  -- Owner membership cannot be disabled or demoted via this RPC.
  if before_row.role = 'owner' then
    if p_status = 'disabled' then
      raise exception 'owner_membership_protected' using errcode = '42501';
    end if;
    if p_role is not null and p_role is distinct from 'owner' then
      raise exception 'owner_membership_protected' using errcode = '42501';
    end if;
  end if;

  -- Ownership cannot be granted here (self or others). Transfer is a separate process.
  if p_role is not null
     and p_role = 'owner'
     and before_row.role is distinct from 'owner' then
    raise exception 'ownership_transfer_separate' using errcode = '42501';
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

commit;

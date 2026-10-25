-- Account-owned unpaid preparation draft (DEC-PREP-SERVER-DRAFT-001).
-- Separate from retired company_setup_drafts unpaid path. No subscription/business activation.
begin;

create or replace function private.account_prep_expires_at(p_created timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  -- Four calendar months UTC; PostgreSQL month arithmetic clamps end-of-month days.
  select (timezone('utc', p_created) + interval '4 months') at time zone 'utc';
$$;

revoke all on function private.account_prep_expires_at(timestamptz) from public, anon, authenticated;

create or replace function private.valid_account_prep_payload(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  website jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then return false; end if;
  if octet_length(p_payload::text) > 32000 then return false; end if;
  if exists (
    select 1 from jsonb_object_keys(p_payload) k
    where k not in ('name','website','country','city','phone','type','whatsappExisting','goals','branches')
  ) then return false; end if;

  if p_payload ? 'name' and (
    jsonb_typeof(p_payload->'name') is distinct from 'string'
    or length(p_payload->>'name') > 120
    or p_payload->>'name' ~ '[[:cntrl:]]'
  ) then return false; end if;

  if p_payload ? 'country' and (
    jsonb_typeof(p_payload->'country') is distinct from 'string'
    or length(p_payload->>'country') > 8
    or p_payload->>'country' ~ '[[:cntrl:]]'
  ) then return false; end if;

  if p_payload ? 'city' and (
    jsonb_typeof(p_payload->'city') is distinct from 'string'
    or length(p_payload->>'city') > 120
    or p_payload->>'city' ~ '[[:cntrl:]]'
  ) then return false; end if;

  if p_payload ? 'phone' and (
    jsonb_typeof(p_payload->'phone') is distinct from 'string'
    or length(p_payload->>'phone') > 40
    or p_payload->>'phone' ~ '[[:cntrl:]]'
  ) then return false; end if;

  if p_payload ? 'type' and (
    jsonb_typeof(p_payload->'type') is distinct from 'string'
    or length(p_payload->>'type') > 120
    or p_payload->>'type' ~ '[[:cntrl:]]'
  ) then return false; end if;

  if p_payload ? 'whatsappExisting'
    and jsonb_typeof(p_payload->'whatsappExisting') is distinct from 'null'
    and p_payload->>'whatsappExisting' not in ('yes','no')
  then return false; end if;

  if p_payload ? 'website' and jsonb_typeof(p_payload->'website') is distinct from 'null' then
    website := p_payload->'website';
    if jsonb_typeof(website) is distinct from 'object' then return false; end if;
    if website->>'kind' = 'none' then
      if exists(select 1 from jsonb_object_keys(website) k where k not in ('kind')) then return false; end if;
    elsif website->>'kind' = 'url' then
      if jsonb_typeof(website->'value') is distinct from 'string'
        or length(website->>'value') > 200
        or website->>'value' ~ '[[:cntrl:]]'
        or website->>'value' !~ '^https?://'
      then return false; end if;
      if exists(select 1 from jsonb_object_keys(website) k where k not in ('kind','value')) then return false; end if;
    else
      return false;
    end if;
  end if;

  if p_payload ? 'goals' then
    if jsonb_typeof(p_payload->'goals') is distinct from 'array' then return false; end if;
    if jsonb_array_length(p_payload->'goals') > 8 then return false; end if;
    if exists (
      select 1 from jsonb_array_elements_text(p_payload->'goals') as g(value)
      where g.value not in ('support','sales','marketing','bookings','orders')
    ) then return false; end if;
  end if;

  if p_payload ? 'branches' then
    if jsonb_typeof(p_payload->'branches') is distinct from 'array' then return false; end if;
    if jsonb_array_length(p_payload->'branches') < 1 or jsonb_array_length(p_payload->'branches') > 20 then return false; end if;
    if exists (
      select 1 from jsonb_array_elements(p_payload->'branches') as b(value)
      where jsonb_typeof(b.value) is distinct from 'object'
        or exists(select 1 from jsonb_object_keys(b.value) k where k not in ('name','city','contactPhone'))
        or jsonb_typeof(b.value->'name') is distinct from 'string' or length(b.value->>'name') > 120 or b.value->>'name' ~ '[[:cntrl:]]'
        or jsonb_typeof(b.value->'city') is distinct from 'string' or length(b.value->>'city') > 120 or b.value->>'city' ~ '[[:cntrl:]]'
        or (
          b.value ? 'contactPhone' and jsonb_typeof(b.value->'contactPhone') is distinct from 'null'
          and (
            jsonb_typeof(b.value->'contactPhone') is distinct from 'string'
            or length(b.value->>'contactPhone') > 40
            or b.value->>'contactPhone' ~ '[[:cntrl:]]'
          )
        )
    ) then return false; end if;
  end if;

  return true;
end;
$$;

revoke all on function private.valid_account_prep_payload(jsonb) from public, anon, authenticated;

create table public.account_prep_drafts (
  draft_id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  version bigint not null default 0 check (version >= 0),
  state text not null default 'active' check (state in ('active','linked','expired_pending_cleanup','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  linked_order_id uuid null,
  check (private.valid_account_prep_payload(payload)),
  check (expires_at > created_at)
);

create unique index account_prep_drafts_one_active
  on public.account_prep_drafts(account_id)
  where state = 'active';

create index account_prep_drafts_expiry
  on public.account_prep_drafts(expires_at)
  where state = 'active';

alter table public.account_prep_drafts enable row level security;
revoke all on public.account_prep_drafts from public, anon, authenticated;
grant select on public.account_prep_drafts to authenticated;

create or replace function public.can_use_account_prep_draft()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(public.app_session_is_valid(), false)
    and exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
        and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
    )
    -- Match /account/businesses/new and create_owner_company_attempt eligibility.
    -- Active owner membership includes archived-business history, as in getCompanyAccess.
    and (
      exists (
        select 1 from public.company_members m
        where m.user_id = auth.uid() and m.role = 'owner' and m.status = 'active'
      )
      or (
        not coalesce(public.is_platform_admin(), true)
        and not exists (
          select 1 from public.company_members m
          where m.user_id = auth.uid() and m.status = 'active'
        )
      )
    );
$$;

revoke all on function public.can_use_account_prep_draft() from public, anon;
grant execute on function public.can_use_account_prep_draft() to authenticated;

create policy account_prep_draft_read on public.account_prep_drafts
  for select to authenticated
  using (
    account_id = (select auth.uid())
    and state = 'active'
    and expires_at > now()
    and public.can_use_account_prep_draft()
  );

create or replace function public.read_account_prep_draft(p_expected_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.account_prep_drafts;
begin
  if auth.uid() is null or not coalesce(public.app_session_is_valid(), false) then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if p_expected_account_id is distinct from auth.uid() or not public.can_use_account_prep_draft() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  select * into d
  from public.account_prep_drafts
  where account_id = auth.uid()
    and state = 'active'
    and expires_at > now()
  limit 1;
  if d.draft_id is null then
    return jsonb_build_object('ok', true, 'data', null);
  end if;
  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'draft_id', d.draft_id,
      'account_id', d.account_id,
      'payload', d.payload,
      'version', d.version,
      'state', d.state,
      'created_at', d.created_at,
      'updated_at', d.updated_at,
      'expires_at', d.expires_at
    )
  );
end;
$$;

revoke all on function public.read_account_prep_draft(uuid) from public, anon;
grant execute on function public.read_account_prep_draft(uuid) to authenticated;

create or replace function public.save_account_prep_draft(
  p_expected_account_id uuid,
  p_expected_version bigint,
  p_patch jsonb,
  p_draft_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.account_prep_drafts;
  merged jsonb;
  n timestamptz := now();
begin
  if auth.uid() is null or not coalesce(public.app_session_is_valid(), false) then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if p_expected_account_id is distinct from auth.uid() or not public.can_use_account_prep_draft() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_expected_version is null or p_expected_version < 0 or not private.valid_account_prep_payload(p_patch) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':account-prep-draft', 0));

  -- Waiting for another save must not retain revoked session or account eligibility.
  if auth.uid() is null or not coalesce(public.app_session_is_valid(), false) then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if p_expected_account_id is distinct from auth.uid() or not public.can_use_account_prep_draft() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into d
  from public.account_prep_drafts
  where account_id = auth.uid() and state = 'active'
  for update;

  if d.draft_id is not null and d.expires_at <= n then
    update public.account_prep_drafts
      set state = 'expired_pending_cleanup', updated_at = n
      where draft_id = d.draft_id;
    d := null;
  end if;

  if d.draft_id is null then
    if p_expected_version <> 0 then
      return jsonb_build_object('ok', false, 'code', 'CONFLICT');
    end if;
    if p_draft_id is not null then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
    insert into public.account_prep_drafts(account_id, payload, version, created_at, updated_at, expires_at)
    values (
      auth.uid(),
      p_patch,
      1,
      n,
      n,
      private.account_prep_expires_at(n)
    )
    returning * into d;
    return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'draft_id', d.draft_id,
        'account_id', d.account_id,
        'payload', d.payload,
        'version', d.version,
        'state', d.state,
        'created_at', d.created_at,
        'updated_at', d.updated_at,
        'expires_at', d.expires_at
      )
    );
  end if;

  if p_draft_id is not null and p_draft_id is distinct from d.draft_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if d.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  merged := coalesce(d.payload, '{}'::jsonb) || p_patch;
  if not private.valid_account_prep_payload(merged) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- Idempotent retry of identical patch at same version returns current receipt without bump.
  if merged = d.payload then
    return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'draft_id', d.draft_id,
        'account_id', d.account_id,
        'payload', d.payload,
        'version', d.version,
        'state', d.state,
        'created_at', d.created_at,
        'updated_at', d.updated_at,
        'expires_at', d.expires_at
      )
    );
  end if;

  update public.account_prep_drafts
    set payload = merged,
        version = d.version + 1,
        updated_at = n
        -- expires_at intentionally unchanged: visit does not extend retention
    where draft_id = d.draft_id
    returning * into d;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'draft_id', d.draft_id,
      'account_id', d.account_id,
      'payload', d.payload,
      'version', d.version,
      'state', d.state,
      'created_at', d.created_at,
      'updated_at', d.updated_at,
      'expires_at', d.expires_at
    )
  );
end;
$$;

revoke all on function public.save_account_prep_draft(uuid, bigint, jsonb, uuid) from public, anon;
grant execute on function public.save_account_prep_draft(uuid, bigint, jsonb, uuid) to authenticated;

-- Dry-run listing only. No destructive delete. Production delete requires separate owner approval.
create or replace function public.account_prep_draft_expiry_dry_run(p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rows jsonb;
  lim int := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  -- service_role / platform owner callers only in application layer; deny anon/authenticated direct use.
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'draft_id', d.draft_id,
    'account_id', d.account_id,
    'version', d.version,
    'state', d.state,
    'created_at', d.created_at,
    'expires_at', d.expires_at,
    'linked_order_id', d.linked_order_id
    -- payload omitted: LOG-001 — no form field values in cleanup receipts
  ) order by d.expires_at asc), '[]'::jsonb)
  into rows
  from (
    select *
    from public.account_prep_drafts d
    where d.state in ('active', 'expired_pending_cleanup')
      and d.expires_at <= now()
      and d.linked_order_id is null
    order by d.expires_at asc
    limit lim
  ) d;
  return jsonb_build_object('ok', true, 'mode', 'dry_run', 'count', jsonb_array_length(rows), 'candidates', rows);
end;
$$;

revoke all on function public.account_prep_draft_expiry_dry_run(int) from public, anon, authenticated;
grant execute on function public.account_prep_draft_expiry_dry_run(int) to service_role;

commit;

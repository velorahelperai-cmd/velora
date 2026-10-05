-- VEL-WA-TENANT-CONNECTION-01: per-company WhatsApp link registry (local only — do not apply here).
-- Does not wire webhook/send. Env single-tenant path remains the live runtime.

-- ---------------------------------------------------------------------------
-- Link registry: request fields vs provider-verified identity (server-owned)
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_company_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Customer-typed request (not proof of Meta connection)
  requested_display_number text not null default '',
  keep_on_phone boolean not null default false,
  -- Honest connection status (not inferred from review approval or old chats)
  status text not null default 'not_connected',
  -- Provider-verified identity — never client-writable
  provider_phone_number_id text null,
  verified_display_number text null,
  -- Separate evidence; never inferred from number save or historical conversations
  inbound_tested_at timestamptz null,
  outbound_tested_at timestamptz null,
  last_error_code text null,
  admin_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_company_links_company_uid unique (company_id),
  constraint whatsapp_company_links_status_chk
    check (status in (
      'not_connected',
      'request_saved',
      'needs_external_action',
      'verified',
      'error',
      'disconnected'
    )),
  constraint whatsapp_company_links_requested_len
    check (char_length(requested_display_number) <= 40),
  constraint whatsapp_company_links_verified_len
    check (verified_display_number is null or char_length(verified_display_number) <= 40),
  constraint whatsapp_company_links_provider_id_len
    check (provider_phone_number_id is null or char_length(provider_phone_number_id) <= 64),
  constraint whatsapp_company_links_admin_note_len
    check (admin_note is null or char_length(admin_note) <= 2000),
  -- Verified rows must carry a provider identity; unverified must not pretend to.
  constraint whatsapp_company_links_verified_requires_provider
    check (
      (status = 'verified' and provider_phone_number_id is not null)
      or (status is distinct from 'verified')
    )
);

comment on table public.whatsapp_company_links is
  'Per-company WhatsApp link registry. Request ≠ connected. Review approval ≠ WhatsApp/AI/billing. One primary row per company in this package; multi-number admin deferred.';

comment on column public.whatsapp_company_links.requested_display_number is
  'Number typed by the owner as a provisioning request — not provider-verified.';
comment on column public.whatsapp_company_links.provider_phone_number_id is
  'Meta phone_number_id when server-verified. Never set by the browser.';
comment on column public.whatsapp_company_links.inbound_tested_at is
  'Separate evidence that inbound was tested — not inferred from chats or saved request.';
comment on column public.whatsapp_company_links.outbound_tested_at is
  'Separate evidence that outbound was tested — not inferred from chats or saved request.';

-- Active verified provider identities cannot belong to two companies (ownership transfer deferred).
create unique index if not exists whatsapp_company_links_active_provider_phone_uid
  on public.whatsapp_company_links (provider_phone_number_id)
  where provider_phone_number_id is not null
    and status = 'verified';

create index if not exists whatsapp_company_links_status_idx
  on public.whatsapp_company_links (status, updated_at desc);

alter table public.whatsapp_company_links enable row level security;

revoke all on table public.whatsapp_company_links from public, anon, authenticated;

-- Members may read non-secret display fields only (no internal attempt tokens / credentials — none stored here).
grant select (
  id, company_id, requested_display_number, keep_on_phone, status,
  verified_display_number, inbound_tested_at, outbound_tested_at,
  last_error_code, created_at, updated_at
) on table public.whatsapp_company_links to authenticated;
-- provider_phone_number_id and admin_note: not granted to authenticated (admin via RPC snapshot).

do $$
begin
  grant all on table public.whatsapp_company_links to service_role;
exception when undefined_object then null;
end;
$$;

drop policy if exists whatsapp_company_links_select_member on public.whatsapp_company_links;
create policy whatsapp_company_links_select_member
  on public.whatsapp_company_links
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or private.is_active_company_member(company_id)
  );

-- No direct insert/update/delete for authenticated — ownership fields are server/RPC only.

-- ---------------------------------------------------------------------------
-- Public snapshot helpers (never expose secrets; none are stored on this row)
-- ---------------------------------------------------------------------------
create or replace function private.whatsapp_company_link_public(
  p_row public.whatsapp_company_links,
  p_include_admin boolean default false
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'company_id', p_row.company_id,
    'requested_display_number', p_row.requested_display_number,
    'keep_on_phone', p_row.keep_on_phone,
    'status', p_row.status,
    -- Verified / tested columns are server-owned. When status is not verified they are
    -- historical evidence of a prior link — never proof that the current request is tested.
    'verified_display_number', p_row.verified_display_number,
    'inbound_tested_at', p_row.inbound_tested_at,
    'outbound_tested_at', p_row.outbound_tested_at,
    'reception_send_tested', (
      p_row.status = 'verified'
      and p_row.inbound_tested_at is not null
      and p_row.outbound_tested_at is not null
    ),
    'prior_link_evidence', (
      p_row.status is distinct from 'verified'
      and (
        p_row.verified_display_number is not null
        or p_row.inbound_tested_at is not null
        or p_row.outbound_tested_at is not null
        or (p_include_admin and p_row.provider_phone_number_id is not null)
      )
    ),
    'last_error_code', p_row.last_error_code,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'admin_note', case when p_include_admin then p_row.admin_note else null end,
    -- Provider id only for platform admin snapshots — not for member clients.
    'provider_phone_number_id', case when p_include_admin then p_row.provider_phone_number_id else null end
  );
$$;

-- ---------------------------------------------------------------------------
-- Owner/member: read own company link (or empty not_connected view)
-- ---------------------------------------------------------------------------
create or replace function public.get_whatsapp_company_link()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_company_id uuid;
  v_role text;
  v_company_status text;
  v_row public.whatsapp_company_links%rowtype;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select m.company_id, m.role, c.status
  into v_company_id, v_role, v_company_status
  from public.company_members as m
  join public.companies as c on c.id = m.company_id
  where m.user_id = uid
    and m.status = 'active'
  order by case when m.role = 'owner' then 0 else 1 end, m.created_at
  limit 1;

  if v_company_id is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_company_status = 'suspended' then
    return jsonb_build_object('ok', false, 'code', 'company_suspended');
  end if;

  select * into v_row
  from public.whatsapp_company_links
  where company_id = v_company_id;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'link', jsonb_build_object(
        'id', null,
        'company_id', v_company_id,
        'requested_display_number', '',
        'keep_on_phone', false,
        'status', 'not_connected',
        'verified_display_number', null,
        'inbound_tested_at', null,
        'outbound_tested_at', null,
        'reception_send_tested', false,
        'prior_link_evidence', false,
        'last_error_code', null,
        'created_at', null,
        'updated_at', null
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'link', private.whatsapp_company_link_public(v_row, false)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner: save provisioning request (does NOT connect WhatsApp / AI / billing)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_whatsapp_link_request(
  p_requested_display_number text,
  p_keep_on_phone boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_company_id uuid;
  v_role text;
  v_company_status text;
  v_number text := pg_catalog.btrim(coalesce(p_requested_display_number, ''));
  v_row public.whatsapp_company_links%rowtype;
  v_next_status text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if char_length(v_number) < 5 or char_length(v_number) > 40 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select m.company_id, m.role, c.status
  into v_company_id, v_role, v_company_status
  from public.company_members as m
  join public.companies as c on c.id = m.company_id
  where m.user_id = uid
    and m.status = 'active'
    and m.role = 'owner'
  order by m.created_at
  limit 1;

  if v_company_id is null or v_role is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_company_status = 'suspended' then
    return jsonb_build_object('ok', false, 'code', 'company_suspended');
  end if;

  select * into v_row
  from public.whatsapp_company_links
  where company_id = v_company_id
  for update;

  if found then
    -- Owner cannot overwrite an active verified provider binding via this RPC.
    if v_row.status = 'verified' then
      return jsonb_build_object(
        'ok', false,
        'code', 'already_verified',
        'link', private.whatsapp_company_link_public(v_row, false)
      );
    end if;
    -- After error/disconnected (or other non-verified statuses), a new request updates only
    -- request fields. Prior verified_display_number / tested timestamps / provider id stay
    -- server-owned as historical prior-link evidence — client cannot forge or clear them.
    -- Snapshot marks prior_link_evidence and keeps reception_send_tested false until verified.
    v_next_status := 'request_saved';
    update public.whatsapp_company_links as l
    set requested_display_number = v_number,
        keep_on_phone = coalesce(p_keep_on_phone, false),
        status = v_next_status,
        last_error_code = null,
        updated_at = now()
    where l.id = v_row.id
    returning * into v_row;
  else
    insert into public.whatsapp_company_links (
      company_id, requested_display_number, keep_on_phone, status
    ) values (
      v_company_id, v_number, coalesce(p_keep_on_phone, false), 'request_saved'
    )
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'link', private.whatsapp_company_link_public(v_row, false)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: read link for a company (includes note + provider id for ops, no secrets)
-- ---------------------------------------------------------------------------
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
  if not public.is_platform_admin() then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_company_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
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

-- ---------------------------------------------------------------------------
-- Admin: follow-up note only — cannot forge verified or tested
-- ---------------------------------------------------------------------------
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
  if not public.is_platform_admin() then
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

-- Mark needs_external_action from request_saved only (honest ops follow-up — not verified).
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
  if not public.is_platform_admin() then
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
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_transition',
      'link', case when found then private.whatsapp_company_link_public(v_row, true) else null end
    );
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

-- ---------------------------------------------------------------------------
-- Resolver (service_role): company from verified provider phone id — not wired yet
-- ---------------------------------------------------------------------------
create or replace function public.resolve_whatsapp_company_by_provider_phone(
  p_provider_phone_number_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := pg_catalog.btrim(coalesce(p_provider_phone_number_id, ''));
  v_row public.whatsapp_company_links%rowtype;
  v_company_status text;
begin
  if v_phone = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'eligible', false);
  end if;

  select * into v_row
  from public.whatsapp_company_links
  where provider_phone_number_id = v_phone
    and status = 'verified';

  if not found then
    -- Unknown / inactive / not verified — reject. Do not guess first company.
    return jsonb_build_object('ok', false, 'code', 'unknown_or_inactive', 'eligible', false);
  end if;

  select c.status into v_company_status
  from public.companies as c
  where c.id = v_row.company_id;

  if v_company_status is null or v_company_status = 'suspended' then
    return jsonb_build_object(
      'ok', false,
      'code', 'company_suspended',
      'company_id', v_row.company_id,
      'eligible', false
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'eligible', true,
    'company_id', v_row.company_id,
    'link_id', v_row.id,
    'provider_phone_number_id', v_row.provider_phone_number_id,
    'status', v_row.status
  );
end;
$$;

revoke all on function public.get_whatsapp_company_link() from public, anon, authenticated;
revoke all on function public.upsert_whatsapp_link_request(text, boolean) from public, anon, authenticated;
revoke all on function public.admin_get_whatsapp_company_link(uuid) from public, anon, authenticated;
revoke all on function public.admin_update_whatsapp_link_note(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_mark_whatsapp_link_needs_external(uuid) from public, anon, authenticated;
revoke all on function public.resolve_whatsapp_company_by_provider_phone(text) from public, anon, authenticated;

grant execute on function public.get_whatsapp_company_link() to authenticated;
grant execute on function public.upsert_whatsapp_link_request(text, boolean) to authenticated;
grant execute on function public.admin_get_whatsapp_company_link(uuid) to authenticated;
grant execute on function public.admin_update_whatsapp_link_note(uuid, text) to authenticated;
grant execute on function public.admin_mark_whatsapp_link_needs_external(uuid) to authenticated;

do $$
begin
  grant execute on function public.resolve_whatsapp_company_by_provider_phone(text) to service_role;
exception when undefined_object then null;
end;
$$;

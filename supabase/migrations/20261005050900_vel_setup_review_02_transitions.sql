-- VEL-SETUP-REVIEW-02
-- Setup review decisions/transitions. Approval does NOT change company/payment/WhatsApp/AI status.
-- Mutations only via limited-privilege RPC (no direct UPDATE/DELETE for authenticated).

-- ---------------------------------------------------------------------------
-- Schema: one request per company + decision fields
-- ---------------------------------------------------------------------------

alter table public.company_review_requests
  add column if not exists status text not null default 'pending_review',
  add column if not exists revision integer not null default 1,
  add column if not exists decided_by uuid references auth.users (id),
  add column if not exists decided_at timestamptz,
  add column if not exists owner_note text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_review_requests_status_check'
      and conrelid = 'public.company_review_requests'::regclass
  ) then
    alter table public.company_review_requests
      add constraint company_review_requests_status_check
      check (status in ('pending_review', 'changes_requested', 'approved'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_review_requests_revision_check'
      and conrelid = 'public.company_review_requests'::regclass
  ) then
    alter table public.company_review_requests
      add constraint company_review_requests_revision_check
      check (revision >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_review_requests_owner_note_len'
      and conrelid = 'public.company_review_requests'::regclass
  ) then
    alter table public.company_review_requests
      add constraint company_review_requests_owner_note_len
      check (char_length(owner_note) <= 2000);
  end if;
end $$;

comment on column public.company_review_requests.status is
  'Setup review only: pending_review | changes_requested | approved. Not company/payment/WhatsApp/AI.';
comment on column public.company_review_requests.revision is
  'Starts at 1; increments on each successful transition.';
comment on column public.company_review_requests.owner_note is
  'Current note directed to the owner (required when status = changes_requested).';

-- Authenticated clients: SELECT only. Mutations go through the RPC.
revoke insert, update, delete on table public.company_review_requests from anon, authenticated, public;
grant select on table public.company_review_requests to authenticated;

-- Owners may read their company's review.* audit rows (not full admin audit).
drop policy if exists admin_audit_logs_select_review_owner on public.admin_audit_logs;
create policy admin_audit_logs_select_review_owner
  on public.admin_audit_logs
  for select
  to authenticated
  using (
    action like 'review.%'
    and company_id is not null
    and private.is_active_company_member(company_id)
    and exists (
      select 1
      from public.company_members as m
      where m.company_id = admin_audit_logs.company_id
        and m.user_id = (select auth.uid())
        and m.role = 'owner'
        and m.status = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers (private)
-- ---------------------------------------------------------------------------

create or replace function private.company_review_request_json(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  select jsonb_build_object(
    'company_id', rr.company_id,
    'requested_by', rr.requested_by,
    'requested_by_email', u.email,
    'number_ownership', rr.number_ownership,
    'whatsapp_number', rr.whatsapp_number,
    'readiness_confirmed', rr.readiness_confirmed,
    'requested_at', rr.requested_at,
    'status', rr.status,
    'revision', rr.revision,
    'decided_by', rr.decided_by,
    'decided_at', rr.decided_at,
    'owner_note', rr.owner_note
  )
    into payload
  from public.company_review_requests as rr
  left join auth.users as u on u.id = rr.requested_by
  where rr.company_id = p_company_id;

  return payload;
end;
$$;

revoke all on function private.company_review_request_json(uuid) from public, anon, authenticated;

create or replace function private.require_active_owner(p_company_id uuid)
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

  if not exists (
    select 1
    from public.company_members as m
    join public.companies as c on c.id = m.company_id
    where m.company_id = p_company_id
      and m.user_id = uid
      and m.role = 'owner'
      and m.status = 'active'
      and c.status <> 'suspended'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return uid;
end;
$$;

revoke all on function private.require_active_owner(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Transition RPC
-- ---------------------------------------------------------------------------

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

  is_admin := public.is_platform_admin();

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

revoke all on function public.admin_get_company(uuid) from public, anon;
grant execute on function public.admin_get_company(uuid) to authenticated;

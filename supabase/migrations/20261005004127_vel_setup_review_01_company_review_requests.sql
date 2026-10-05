-- VEL-SETUP-REVIEW-01 (A12 / K08 / W10)
-- Company-scoped setup review request. Not payment, activation, WhatsApp link, or AI readiness.

create table if not exists public.company_review_requests (
  company_id uuid primary key references public.companies (id) on delete cascade,
  requested_by uuid not null references auth.users (id),
  number_ownership text not null
    check (number_ownership in ('own', 'new')),
  whatsapp_number text not null default '',
  readiness_confirmed boolean not null default true
    check (readiness_confirmed = true),
  requested_at timestamptz not null default now(),
  constraint company_review_requests_whatsapp_len
    check (char_length(whatsapp_number) <= 40)
);

comment on table public.company_review_requests is
  'Owner-submitted setup review request per company. Does not activate WhatsApp, billing, or AI.';

create index if not exists company_review_requests_requested_at_idx
  on public.company_review_requests (requested_at desc);

alter table public.company_review_requests enable row level security;

revoke all on table public.company_review_requests from anon, authenticated, public;
grant select on table public.company_review_requests to authenticated;
-- Column-level INSERT only: requested_at (and any future server-owned cols) stay DB-defaulted.
grant insert (
  company_id,
  requested_by,
  number_ownership,
  whatsapp_number,
  readiness_confirmed
) on table public.company_review_requests to authenticated;

drop policy if exists company_review_requests_select on public.company_review_requests;
create policy company_review_requests_select
  on public.company_review_requests
  for select
  to authenticated
  using (
    public.is_platform_admin()
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

drop policy if exists company_review_requests_insert on public.company_review_requests;
create policy company_review_requests_insert
  on public.company_review_requests
  for insert
  to authenticated
  with check (
    requested_by = (select auth.uid())
    and private.is_active_company_member(company_id)
    and exists (
      select 1
      from public.company_members as m
      where m.company_id = company_review_requests.company_id
        and m.user_id = (select auth.uid())
        and m.role = 'owner'
        and m.status = 'active'
    )
  );

-- No update/delete for authenticated: one immutable request per company (PK enforces uniqueness).

-- DROP required: CREATE OR REPLACE cannot change OUT/RETURNS TABLE columns safely.
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
    rr.requested_by as review_requested_by
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

  select jsonb_build_object(
    'company_id', rr.company_id,
    'requested_by', rr.requested_by,
    'requested_by_email', u.email,
    'number_ownership', rr.number_ownership,
    'whatsapp_number', rr.whatsapp_number,
    'readiness_confirmed', rr.readiness_confirmed,
    'requested_at', rr.requested_at
  )
    into review_request
  from public.company_review_requests as rr
  left join auth.users as u on u.id = rr.requested_by
  where rr.company_id = p_company_id;

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

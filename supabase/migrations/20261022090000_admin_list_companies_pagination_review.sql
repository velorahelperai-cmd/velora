-- ============================================================================
-- MIGRATION: 20261022090000_admin_list_companies_pagination_review.sql
-- PURPOSE: Server-side pagination, status filtering, stable ordering, and N+1
--          avoidance for Velora Platform Admin company directory.
-- STATUS: FOR CODE REVIEW ONLY — DO NOT APPLY TO HOSTED / PRODUCTION DB DIRECTLY
--         (Strictly enforces public.is_platform_owner(); platform owner only)
-- ============================================================================

-- 1. Optimized server-paginated RPC (platform owner only)
create or replace function public.admin_list_companies_page(
  p_search text default '',
  p_status text default 'all',
  p_limit int default 25,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  q_raw text := btrim(coalesce(p_search, ''));
  q text := '%' || lower(q_raw) || '%';
  status_filter text := btrim(coalesce(p_status, 'all'));
  lim int := least(greatest(coalesce(p_limit, 25), 1), 100);
  off int := greatest(coalesce(p_offset, 0), 0);
  v_total_count bigint := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- Direct RPC execution strictly requires verified platform owner; no delegated access
  if not public.is_platform_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- The role helper alone is not session authority. Never trust JWT email metadata.
  if not coalesce((public.check_app_session(false)->>'ok')::boolean, false)
     or not exists (
       select 1 from auth.users as owner_identity
       where owner_identity.id = actor
         and owner_identity.email_confirmed_at is not null
         and lower(btrim(owner_identity.email)) = 'velorahelperai@gmail.com'
     ) then
    raise exception 'owner_identity_or_session_invalid' using errcode = '42501';
  end if;

  -- Total matching count using the EXACT same filters and authorization scope
  select count(*)
  into v_total_count
  from public.companies as c
  left join public.company_members as m
    on m.company_id = c.id and m.role = 'owner' and m.status = 'active'
  left join auth.users as u on u.id = m.user_id
  left join public.company_review_requests as rr on rr.company_id = c.id
  where public.is_platform_owner()
    and (status_filter = 'all' or c.status = status_filter or (status_filter = 'pending_review' and rr.status = 'pending_review'))
    and (
      q_raw = ''
      or lower(c.display_name) like q
      or lower(coalesce(u.email, '')) like q
      or lower(coalesce(c.contact_email, '')) like q
      or lower(coalesce(c.contact_phone, '')) like q
      or lower(coalesce(c.city, '')) like q
    );

  -- Page rows: bounded, stably sorted by (created_at desc, id desc), aggregated member count (no N+1)
  select coalesce(jsonb_agg(row_data), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', c.id,
      'display_name', c.display_name,
      'status', c.status,
      'business_type', c.business_type,
      'country', c.country,
      'city', c.city,
      'contact_phone', c.contact_phone,
      'contact_email', c.contact_email,
      'created_by', c.created_by,
      'created_at', c.created_at,
      'updated_at', c.updated_at,
      'owner_email', u.email::text,
      'owner_name', coalesce(m.member_name, ''),
      'member_count', coalesce(cm_counts.cnt, 0),
      'review_requested_at', rr.requested_at,
      'review_requested_by', rr.requested_by
      , 'review_status', rr.status, 'review_revision', rr.revision
    ) as row_data
    from public.companies as c
    left join public.company_members as m
      on m.company_id = c.id and m.role = 'owner' and m.status = 'active'
    left join auth.users as u on u.id = m.user_id
    left join public.company_review_requests as rr on rr.company_id = c.id
    left join (
      select company_id, count(*)::bigint as cnt
      from public.company_members
      group by company_id
    ) as cm_counts on cm_counts.company_id = c.id
    where public.is_platform_owner()
      and (status_filter = 'all' or c.status = status_filter or (status_filter = 'pending_review' and rr.status = 'pending_review'))
      and (
        q_raw = ''
        or lower(c.display_name) like q
        or lower(coalesce(u.email, '')) like q
        or lower(coalesce(c.contact_email, '')) like q
        or lower(coalesce(c.contact_phone, '')) like q
        or lower(coalesce(c.city, '')) like q
      )
    order by c.created_at desc, c.id desc
    limit lim
    offset off
  ) as page_subquery;

  return jsonb_build_object(
    'total_count', v_total_count,
    'limit', lim,
    'offset', off,
    'rows', v_rows
  );
end;
$$;

revoke all on function public.admin_list_companies_page(text, text, int, int) from public, anon;
grant execute on function public.admin_list_companies_page(text, text, int, int) to authenticated;

comment on function public.admin_list_companies_page(text, text, int, int) is
  'Velora Platform Admin company directory with server-side pagination (limit 1-100), status filtering, stable sorting (created_at desc, id desc), and aggregated member counts.';

-- 2. Legacy RPC tightened review contract: owner only
create or replace function public.admin_list_companies(p_search text default '')
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
  -- Direct legacy RPC execution strictly requires verified platform owner; no delegated admin
  if not public.is_platform_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not coalesce((public.check_app_session(false)->>'ok')::boolean, false)
     or not exists (
       select 1 from auth.users as owner_identity
       where owner_identity.id = actor
         and owner_identity.email_confirmed_at is not null
         and lower(btrim(owner_identity.email)) = 'velorahelperai@gmail.com'
     ) then
    raise exception 'owner_identity_or_session_invalid' using errcode = '42501';
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
  where public.is_platform_owner()
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

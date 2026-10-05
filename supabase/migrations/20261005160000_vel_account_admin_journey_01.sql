-- VEL-ACCOUNT-ADMIN-JOURNEY-01 (local — apply only after explicit approval)
-- Final contract for admin account browse/search + overview stats.
-- Auth.users is the account source; profiles are optional (LEFT JOIN, never created here).
-- email_confirmed = (email_confirmed_at IS NOT NULL) only — phone confirmation does not count.
-- Rate limit (30/min/actor) + country-aware phone match live HERE (final). 090000 only adds helpers.
--
-- Signature change: RETURNS TABLE gains email_confirmed — CREATE OR REPLACE cannot alter OUT cols.
-- Safe path: DROP exact signature admin_search_accounts(text, integer, integer) WITHOUT CASCADE,
-- then CREATE + grants, inside one transaction.

begin;

-- Phone helpers (idempotent). Same definitions as 090000 so order 090000→160000 or 160000 alone is safe.
create or replace function private.country_calling_code(p_country text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(btrim(coalesce(p_country, '')))
    when 'OM' then '968'
    when 'OMAN' then '968'
    else ''
  end;
$$;

revoke all on function private.country_calling_code(text) from public, anon, authenticated;

create or replace function private.normalize_phone_for_country(p_raw text, p_country text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text;
  had_plus boolean := false;
  had_00 boolean := false;
  digits text;
  cc text := private.country_calling_code(p_country);
begin
  if p_raw is null or btrim(p_raw) = '' then
    return '';
  end if;

  cleaned := regexp_replace(btrim(p_raw), '[^0-9+]', '', 'g');
  had_plus := left(cleaned, 1) = '+';
  had_00 := left(cleaned, 2) = '00';
  digits := private.normalize_phone_digits(p_raw);

  if digits = '' then
    return '';
  end if;

  if had_plus or had_00 then
    return digits;
  end if;

  if cc = '' then
    return digits;
  end if;

  if cc = '968' and char_length(digits) = 8 then
    return cc || digits;
  end if;

  if char_length(digits) >= char_length(cc) + 7
     and left(digits, char_length(cc)) = cc
  then
    return digits;
  end if;

  if char_length(digits) between 7 and 10
     and left(digits, char_length(cc)) <> cc
  then
    return cc || ltrim(digits, '0');
  end if;

  return digits;
end;
$$;

revoke all on function private.normalize_phone_for_country(text, text) from public, anon, authenticated;

-- Exact signature only. No CASCADE — fails loudly if unexpected dependents exist.
drop function if exists public.admin_search_accounts(text, integer, integer);

create function public.admin_search_accounts(
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
  -- Hard browse/search window: offset capped (not unlimited). Client must surface the cap.
  off int := greatest(0, least(coalesce(p_offset, 0), 100000));
  recent int;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if char_length(q_raw) > 120 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- 30 searches / rolling 60s per admin (shared via admin_audit_logs).
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

  -- Auth is the account row source. One row per auth user. Profiles optional — never insert here.
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
      and char_length(q_phone) >= 7
      and (
        private.normalize_phone_digits(coalesce(u.phone, '')) = q_phone
        or private.normalize_phone_digits(coalesce(u.phone, ''))
             = private.normalize_phone_for_country(q_raw, '')
        or exists (
          select 1
          from public.company_members as m2
          join public.companies as c2 on c2.id = m2.company_id
          where m2.user_id = u.id
            and (
              private.normalize_phone_for_country(c2.contact_phone, c2.country) = q_phone
              or private.normalize_phone_for_country(c2.contact_phone, c2.country)
                   = private.normalize_phone_for_country(q_raw, c2.country)
              or private.normalize_phone_digits(c2.contact_phone) = q_phone
            )
        )
      )
    )
    or (
      char_length(q) >= 2
      and lower(coalesce(p.full_name, '')) like '%' || q_name_esc || '%' escape '\'
    )
  order by coalesce(p.support_code, '') asc, u.id asc
  limit lim
  offset off;
end;
$$;

revoke all on function public.admin_search_accounts(text, integer, integer) from public, anon;
grant execute on function public.admin_search_accounts(text, integer, integer) to authenticated;

comment on function public.admin_search_accounts(text, integer, integer) is
  'Platform-admin Auth-sourced account browse/search. Empty query browses. email_confirmed=email only. Rate-limited 30/min. Offset hard-cap 100000. Profiles optional.';

create or replace function public.admin_overview_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    -- Same Auth source as admin_search_accounts browse.
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

comment on function public.admin_overview_stats() is
  'Platform admin totals from Auth + companies. accounts_without_company ≠ without_active_membership. Not billing.';

commit;

-- VEL-INTEGRATION-FIX-02
-- Unapplied. Completes FIX-01 contracts: search rate limit + country-aware phone match.
-- Relies on existing admin_audit_logs (no paid rate-limit service).

-- ---------------------------------------------------------------------------
-- Phone normalize with optional trusted country (OM → 968). Never invent when
-- country is absent. Shared numbers remain allowed (no uniqueness).
-- ---------------------------------------------------------------------------

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

  -- Preserve international markers (+ / 00) before digit cleanup.
  cleaned := regexp_replace(btrim(p_raw), '[^0-9+]', '', 'g');
  had_plus := left(cleaned, 1) = '+';
  had_00 := left(cleaned, 2) = '00';
  digits := private.normalize_phone_digits(p_raw);

  if digits = '' then
    return '';
  end if;

  -- Explicit international: never prepend company country (e.g. +65… stays 65…).
  if had_plus or had_00 then
    return digits;
  end if;

  -- No trusted country mapping: do not invent a prefix.
  if cc = '' then
    return digits;
  end if;

  -- Oman national is 8 digits. Do not treat an 8-digit number as international
  -- merely because it starts with 968 — always apply the trusted national prefix.
  if cc = '968' and char_length(digits) = 8 then
    return cc || digits;
  end if;

  -- Already international length with matching country code — keep as-is.
  if char_length(digits) >= char_length(cc) + 7
     and left(digits, char_length(cc)) = cc
  then
    return digits;
  end if;

  -- Clear national length under a trusted country — prefix once.
  if char_length(digits) between 7 and 10
     and left(digits, char_length(cc)) <> cc
  then
    return cc || ltrim(digits, '0');
  end if;

  -- Ambiguous without +/00 — return digits only; do not guess.
  return digits;
end;
$$;

revoke all on function private.normalize_phone_for_country(text, text) from public, anon, authenticated;

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
  off int := greatest(0, least(coalesce(p_offset, 0), 5000));
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

  -- Atomic per-admin rate limit: serialize check+consume under a transaction lock.
  -- Scope: shared across app instances via Postgres (admin_audit_logs). No paid service.
  -- Limit: 30 searches / rolling 60s.
  perform pg_advisory_xact_lock(
    872334151, -- stable namespace for admin.search_accounts
    hashtext(actor::text)
  );

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
    jsonb_build_object('q_len', char_length(q_raw), 'limit', lim, 'offset', off)
  );

  if q_raw = '' then
    return;
  end if;

  return query
  select
    p.user_id,
    p.support_code,
    p.full_name,
    u.email::text,
    -- Original account phone display (not invented); matching uses digits only.
    nullif(btrim(coalesce(u.phone, '')), '')::text as account_phone,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'company_id', c.id,
          'display_name', c.display_name,
          'role', m.role,
          'status', m.status,
          'business_phone', nullif(btrim(c.contact_phone), '')
        )
        order by c.display_name
      )
      from public.company_members as m
      join public.companies as c on c.id = m.company_id
      where m.user_id = p.user_id
    ), '[]'::jsonb) as companies
  from public.profiles as p
  join auth.users as u on u.id = p.user_id
  where
    upper(p.support_code) = q_code
    or lower(coalesce(u.email, '')) = q
    or (
      q_phone <> ''
      and char_length(q_phone) >= 7
      and (
        -- Account phone: digits only — no country guess when auth has no country.
        private.normalize_phone_digits(coalesce(u.phone, '')) = q_phone
        or private.normalize_phone_digits(coalesce(u.phone, ''))
             = private.normalize_phone_for_country(q_raw, '')
        or exists (
          select 1
          from public.company_members as m2
          join public.companies as c2 on c2.id = m2.company_id
          where m2.user_id = p.user_id
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
      and lower(p.full_name) like '%' || q_name_esc || '%' escape '\'
    )
  order by p.support_code asc, p.user_id asc
  limit lim
  offset off;
end;
$$;

revoke all on function public.admin_search_accounts(text, int, int) from public, anon;
grant execute on function public.admin_search_accounts(text, int, int) to authenticated;

comment on function public.admin_search_accounts(text, int, int) is
  'Platform-admin account search. Rate-limited via admin_audit_logs (30/min/actor). Account phone ≠ business phone; shared phones allowed.';

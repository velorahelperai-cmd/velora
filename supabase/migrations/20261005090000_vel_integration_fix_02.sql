-- VEL-INTEGRATION-FIX-02 (unapplied)
-- Phone helpers only. Final admin_search_accounts (browse + email_confirmed + Auth source +
-- rate limit) lives in 20261005160000_vel_account_admin_journey_01 — do NOT redefine search here
-- or a later apply of this file would wipe browse/email_confirmed.

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

comment on function private.normalize_phone_for_country(text, text) is
  'Country-aware phone digits for trusted country (OM→968). No invent when country absent. Used by admin_search_accounts in 160000.';

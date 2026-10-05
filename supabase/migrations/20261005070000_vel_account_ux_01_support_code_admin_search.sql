-- VEL-ACCOUNT-UX-01: stable support_code on profiles + admin account search RPC
-- Unapplied migration — do not apply from this package without explicit ops approval.

-- ---------------------------------------------------------------------------
-- support_code: VEL-XXXX-XXXX-XXXX (immutable after assign, unique)
-- ---------------------------------------------------------------------------

create or replace function private.generate_support_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw text := '';
  i int;
  idx int;
begin
  for i in 1..12 loop
    idx := 1 + floor(random() * char_length(alphabet))::int;
    raw := raw || substr(alphabet, idx, 1);
  end loop;
  return 'VEL-' || substr(raw, 1, 4) || '-' || substr(raw, 5, 4) || '-' || substr(raw, 9, 4);
end;
$$;

revoke all on function private.generate_support_code() from public, anon, authenticated;

create or replace function private.assign_unique_support_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  candidate text;
  attempts int := 0;
begin
  loop
    attempts := attempts + 1;
    candidate := private.generate_support_code();
    exit when not exists (
      select 1 from public.profiles as p where p.support_code = candidate
    );
    if attempts >= 8 then
      raise exception 'support_code_collision' using errcode = '23505';
    end if;
  end loop;
  return candidate;
end;
$$;

revoke all on function private.assign_unique_support_code() from public, anon, authenticated;

alter table public.profiles
  add column if not exists support_code text;

-- Allow blank → assigned once; never change a non-blank code (backfill-safe).
create or replace function private.profiles_guard_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'immutable_profile_columns' using errcode = '42501';
  end if;
  if new.support_code is distinct from old.support_code then
    if old.support_code is not null and btrim(old.support_code) <> '' then
      raise exception 'immutable_profile_columns' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_support_code_format'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_support_code_format
      check (
        support_code is null
        or support_code ~ '^VEL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'
      );
  end if;
end;
$$;

-- Unique index first (Postgres allows multiple NULLs) so backfill retries on real 23505.
create unique index if not exists profiles_support_code_uidx
  on public.profiles (support_code);

-- Collision-aware backfill; keeps any already-assigned codes.
do $$
declare
  r record;
  attempts int;
  candidate text;
begin
  for r in
    select p.user_id
    from public.profiles as p
    where p.support_code is null or btrim(p.support_code) = ''
  loop
    attempts := 0;
    loop
      attempts := attempts + 1;
      candidate := private.generate_support_code();
      begin
        update public.profiles as p
        set support_code = candidate
        where p.user_id = r.user_id
          and (p.support_code is null or btrim(p.support_code) = '');
        exit;
      exception
        when unique_violation then
          if attempts >= 8 then
            raise;
          end if;
      end;
    end loop;
  end loop;
end;
$$;

alter table public.profiles
  alter column support_code set not null;

-- Tighten format check now that nulls are gone.
alter table public.profiles drop constraint if exists profiles_support_code_format;
alter table public.profiles
  add constraint profiles_support_code_format
  check (support_code ~ '^VEL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$');

create or replace function private.profiles_set_support_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Always server-assign on insert — clients cannot forge a support code.
  new.support_code := private.assign_unique_support_code();
  return new;
end;
$$;

drop trigger if exists profiles_set_support_code on public.profiles;
create trigger profiles_set_support_code
  before insert on public.profiles
  for each row
  execute function private.profiles_set_support_code();

-- Keep new-user profile path generating support_code via insert trigger.
create or replace function private.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_name text;
begin
  raw_name := coalesce(
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    ''
  );
  insert into public.profiles (user_id, full_name)
  values (new.id, left(raw_name, 120))
  on conflict (user_id) do update
    set full_name = case
      when btrim(public.profiles.full_name) = '' and btrim(excluded.full_name) <> ''
        then excluded.full_name
      else public.profiles.full_name
    end,
    updated_at = now();
  return new;
end;
$$;

-- Clients cannot forge support_code on insert/update via direct table writes:
-- insert trigger assigns when blank; update trigger blocks changes.
-- Upserts that omit support_code still get a server-assigned value on insert.

-- ---------------------------------------------------------------------------
-- Phone normalization for admin search (digits; optional leading +)
-- Does not invent missing digits. Shared phones are allowed (no uniqueness).
-- ---------------------------------------------------------------------------

create or replace function private.normalize_phone_digits(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Strip separators; treat leading 00 as international (+). Never invent missing digits.
  select case
    when p_raw is null or btrim(p_raw) = '' then ''
    else regexp_replace(
      case
        when left(regexp_replace(btrim(p_raw), '[^0-9+]', '', 'g'), 2) = '00'
          then substr(regexp_replace(btrim(p_raw), '[^0-9+]', '', 'g'), 3)
        else regexp_replace(btrim(p_raw), '[^0-9+]', '', 'g')
      end,
      '[^0-9]',
      '',
      'g'
    )
  end;
$$;

revoke all on function private.normalize_phone_digits(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin account search (platform admin only). Reads auth.users email/phone
-- inside security definer — not exposed as a public enumeration surface.
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
  companies jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := lower(btrim(coalesce(p_query, '')));
  q_phone text := private.normalize_phone_digits(coalesce(p_query, ''));
  lim int := greatest(1, least(coalesce(p_limit, 20), 50));
  off int := greatest(0, least(coalesce(p_offset, 0), 5000));
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if char_length(q) > 120 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  return query
  select
    p.user_id,
    p.support_code,
    p.full_name,
    u.email::text,
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
  where q = ''
     or p.support_code ilike '%' || upper(q) || '%'
     or lower(p.full_name) like '%' || q || '%'
     or lower(coalesce(u.email, '')) like '%' || q || '%'
     or (
       q_phone <> ''
       and char_length(q_phone) >= 4
       and (
         private.normalize_phone_digits(coalesce(u.phone, '')) like '%' || q_phone || '%'
         or exists (
           select 1
           from public.company_members as m2
           join public.companies as c2 on c2.id = m2.company_id
           where m2.user_id = p.user_id
             and private.normalize_phone_digits(c2.contact_phone) like '%' || q_phone || '%'
         )
       )
     )
  order by p.support_code asc, p.user_id asc
  limit lim
  offset off;
end;
$$;

revoke all on function public.admin_search_accounts(text, int, int) from public, anon;
grant execute on function public.admin_search_accounts(text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin read-only stored WhatsApp conversations for a verified company
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_company_conversations(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  company_row public.companies%rowtype;
  wa_number text;
  link_phone_ids text[];
  convs jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into company_row
  from public.companies as c
  where c.id = p_company_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'NOT_FOUND'
    );
  end if;

  select nullif(btrim(r.whatsapp_number), '')
  into wa_number
  from public.company_review_requests as r
  where r.company_id = p_company_id;

  select array_agg(distinct w.phone_number_id)
  into link_phone_ids
  from public.whatsapp_conversations as w
  where w.company_id = p_company_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', w.id,
      'customer_name', w.customer_name,
      'customer_wa_id', w.customer_wa_id,
      'phone_number_id', w.phone_number_id,
      'last_message_at', w.last_message_at,
      'messages', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'body', m.body,
            'sender', m.sender,
            'direction', m.direction,
            'received_at', m.received_at
          )
          order by m.received_at asc
        )
        from public.whatsapp_messages as m
        where m.company_id = p_company_id
          and m.conversation_id = w.id
      ), '[]'::jsonb)
    )
    order by w.last_message_at desc
  ), '[]'::jsonb)
  into convs
  from public.whatsapp_conversations as w
  where w.company_id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'company_id', company_row.id,
    'company_name', company_row.display_name,
    'whatsapp_number', wa_number,
    'link_provisioned', coalesce(cardinality(link_phone_ids), 0) > 0,
    'conversations', convs
  );
end;
$$;

revoke all on function public.admin_list_company_conversations(uuid) from public, anon;
grant execute on function public.admin_list_company_conversations(uuid) to authenticated;

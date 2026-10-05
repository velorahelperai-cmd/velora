-- VEL-INTEGRATION-FIX-01
-- Hardening on top of ACCOUNT-UX / SETUP-02 (unapplied until ops approve).
-- 1) support_code: retry on real unique_violation (insert + backfill)
-- 2) admin_search_accounts: exact code/email/phone; escaped limited name match
-- 3) admin_list_company_conversations: explicit phone identity + pagination

-- ---------------------------------------------------------------------------
-- support_code collision handling
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

create or replace function private.profiles_set_support_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Always server-assign on insert — clients cannot forge a support code.
  -- Pre-check alone is insufficient under concurrency; callers retry on 23505.
  new.support_code := private.generate_support_code();
  return new;
end;
$$;

create or replace function private.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_name text;
  attempts int := 0;
begin
  raw_name := coalesce(
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    ''
  );

  loop
    attempts := attempts + 1;
    begin
      insert into public.profiles (user_id, full_name)
      values (new.id, left(raw_name, 120));
      exit;
    exception
      when unique_violation then
        if exists (select 1 from public.profiles as p where p.user_id = new.id) then
          update public.profiles as p
          set full_name = case
            when btrim(p.full_name) = '' and btrim(left(raw_name, 120)) <> ''
              then left(raw_name, 120)
            else p.full_name
          end,
          updated_at = now()
          where p.user_id = new.id;
          exit;
        end if;
        -- Likely support_code unique collision under concurrency — retry insert.
        if attempts >= 8 then
          raise;
        end if;
    end;
  end loop;

  return new;
end;
$$;

-- Ensure immutable guard still allows blank → assign (never rewrite existing codes).
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

-- Remaining blanks only (idempotent). Existing non-blank codes are never updated.
do $$
declare
  r record;
  attempts int;
  candidate text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'support_code'
  ) then
    return;
  end if;

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

-- ---------------------------------------------------------------------------
-- Admin account search (exact code/email/phone; limited escaped name)
-- ---------------------------------------------------------------------------

create or replace function private.normalize_phone_digits(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
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

create or replace function private.escape_like_pattern(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(coalesce(p_raw, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

revoke all on function private.escape_like_pattern(text) from public, anon, authenticated;

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
  q_raw text := btrim(coalesce(p_query, ''));
  q text := lower(q_raw);
  q_phone text := private.normalize_phone_digits(q_raw);
  q_code text := upper(q_raw);
  q_name_esc text := private.escape_like_pattern(q);
  lim int := greatest(1, least(coalesce(p_limit, 20), 50));
  off int := greatest(0, least(coalesce(p_offset, 0), 5000));
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if char_length(q_raw) > 120 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if q_raw = '' then
    return;
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
  where
    upper(p.support_code) = q_code
    or lower(coalesce(u.email, '')) = q
    or (
      q_phone <> ''
      and char_length(q_phone) >= 7
      and (
        private.normalize_phone_digits(coalesce(u.phone, '')) = q_phone
        or exists (
          select 1
          from public.company_members as m2
          join public.companies as c2 on c2.id = m2.company_id
          where m2.user_id = p.user_id
            and private.normalize_phone_digits(c2.contact_phone) = q_phone
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

-- ---------------------------------------------------------------------------
-- Admin conversations: company + phone identity + pagination (read-only)
-- ---------------------------------------------------------------------------

drop function if exists public.admin_list_company_conversations(uuid);
drop function if exists public.admin_list_company_conversations(uuid, text, int, int);

create or replace function public.admin_list_company_conversations(
  p_company_id uuid,
  p_phone_number_id text default null,
  p_limit int default 20,
  p_offset int default 0,
  p_message_limit int default 50,
  p_message_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  company_row public.companies%rowtype;
  review_wa text;
  phone_id text := nullif(btrim(coalesce(p_phone_number_id, '')), '');
  identities jsonb;
  convs jsonb;
  lim int := greatest(1, least(coalesce(p_limit, 20), 50));
  off int := greatest(0, least(coalesce(p_offset, 0), 5000));
  msg_lim int := greatest(1, least(coalesce(p_message_limit, 50), 100));
  msg_off int := greatest(0, least(coalesce(p_message_offset, 0), 5000));
  total_count int := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into company_row
  from public.companies as c
  where c.id = p_company_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  select nullif(btrim(r.whatsapp_number), '')
  into review_wa
  from public.company_review_requests as r
  where r.company_id = p_company_id;

  select coalesce(jsonb_agg(
    jsonb_build_object('phone_number_id', x.phone_number_id)
    order by x.phone_number_id
  ), '[]'::jsonb)
  into identities
  from (
    select distinct w.phone_number_id
    from public.whatsapp_conversations as w
    where w.company_id = p_company_id
      and nullif(btrim(w.phone_number_id), '') is not null
  ) as x;

  -- Without an explicit phone identity: return options only — never all conversations.
  if phone_id is null then
    return jsonb_build_object(
      'ok', true,
      'company_id', company_row.id,
      'company_name', company_row.display_name,
      'review_whatsapp_number', review_wa,
      'selected_phone_number_id', null,
      'phone_identities', identities,
      'link_provisioned', jsonb_array_length(identities) > 0,
      'send_receive_verified', false,
      'total', 0,
      'limit', lim,
      'offset', off,
      'message_limit', msg_lim,
      'message_offset', msg_off,
      'conversations', '[]'::jsonb
    );
  end if;

  if not exists (
    select 1
    from public.whatsapp_conversations as w
    where w.company_id = p_company_id
      and w.phone_number_id = phone_id
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_PHONE'
    );
  end if;

  select count(*)::int
  into total_count
  from public.whatsapp_conversations as w
  where w.company_id = p_company_id
    and w.phone_number_id = phone_id;

  select coalesce(jsonb_agg(row_json order by (row_json ->> 'last_message_at') desc nulls last), '[]'::jsonb)
  into convs
  from (
    select jsonb_build_object(
      'id', w.id,
      'customer_name', w.customer_name,
      'customer_wa_id', w.customer_wa_id,
      'phone_number_id', w.phone_number_id,
      'last_message_at', w.last_message_at,
      'message_total', (
        select count(*)::int
        from public.whatsapp_messages as m
        where m.company_id = p_company_id
          and m.conversation_id = w.id
      ),
      'message_limit', msg_lim,
      'message_offset', msg_off,
      'messages', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', page_m.id,
            'body', page_m.body,
            'sender', page_m.sender,
            'direction', page_m.direction,
            'received_at', page_m.received_at
          )
          order by page_m.received_at asc, page_m.id asc
        )
        from (
          select m.id, m.body, m.sender, m.direction, m.received_at
          from public.whatsapp_messages as m
          where m.company_id = p_company_id
            and m.conversation_id = w.id
          order by m.received_at asc, m.id asc
          limit msg_lim
          offset msg_off
        ) as page_m
      ), '[]'::jsonb)
    ) as row_json
    from public.whatsapp_conversations as w
    where w.company_id = p_company_id
      and w.phone_number_id = phone_id
    order by w.last_message_at desc nulls last, w.id asc
    limit lim
    offset off
  ) as page;

  return jsonb_build_object(
    'ok', true,
    'company_id', company_row.id,
    'company_name', company_row.display_name,
    'review_whatsapp_number', review_wa,
    'selected_phone_number_id', phone_id,
    'phone_identities', identities,
    'link_provisioned', jsonb_array_length(identities) > 0,
    'send_receive_verified', false,
    'total', total_count,
    'limit', lim,
    'offset', off,
    'message_limit', msg_lim,
    'message_offset', msg_off,
    'conversations', convs
  );
end;
$$;

revoke all on function public.admin_list_company_conversations(uuid, text, int, int, int, int) from public, anon;
grant execute on function public.admin_list_company_conversations(uuid, text, int, int, int, int) to authenticated;

-- Explicit tenant selection and capability checks, compatible with databases before ACCESS.
begin;
create or replace function private.authorization_can_admin_company(p_company_id uuid, p_capability text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare allowed boolean;
begin
  if auth.uid() is null then return false; end if;
  if to_regprocedure('private.can_admin_company(uuid,text)') is not null then
    execute 'select private.can_admin_company($1, $2)' into allowed using p_company_id, p_capability;
    return coalesce(allowed, false);
  end if;
  -- Before ACCESS, platform administrators are global; delegated scopes do not exist.
  return coalesce(public.is_platform_admin(), false);
end;
$$;
revoke all on function private.authorization_can_admin_company(uuid,text) from public, anon, authenticated;


create or replace function private.upsert_owner_company(
  p_display_name text,
  p_business_type text default 'restaurant',
  p_reply_language text default 'both',
  p_country text default 'OM',
  p_city text default '',
  p_hours text default '',
  p_contact_phone text default '',
  p_contact_email text default '',
  p_member_name text default ''
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cleaned_name text := btrim(coalesce(p_display_name, ''));
  existing_id uuid;
  row_company public.companies;
  member_label text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if char_length(cleaned_name) < 1 or char_length(cleaned_name) > 120 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;

  if coalesce(p_reply_language, '') not in ('ar', 'en', 'both') then
    raise exception 'invalid_reply_language' using errcode = '22023';
  end if;

  -- Serialize creates/updates per caller so concurrent retries share one company.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  if (select count(*) from public.company_members m where m.user_id = uid and m.status = 'active' and m.role = 'owner') > 1 then
    raise exception 'company_selection_required' using errcode = '22023';
  end if;

  select m.company_id
    into existing_id
  from public.company_members as m
  where m.user_id = uid
    and m.role = 'owner'
    and m.status = 'active'
  order by m.created_at asc
  limit 1;

  member_label := coalesce(nullif(btrim(coalesce(p_member_name, '')), ''), cleaned_name);

  if existing_id is not null then
    update public.companies as c
    set
      display_name = cleaned_name,
      business_type = coalesce(nullif(btrim(coalesce(p_business_type, '')), ''), c.business_type),
      reply_language = p_reply_language,
      country = coalesce(nullif(btrim(coalesce(p_country, '')), ''), c.country),
      city = coalesce(p_city, ''),
      hours = coalesce(p_hours, ''),
      contact_phone = coalesce(p_contact_phone, ''),
      contact_email = coalesce(p_contact_email, ''),
      updated_at = now()
    where c.id = existing_id
      and c.status <> 'suspended'
    returning c.* into row_company;

    if row_company.id is null then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    update public.company_members as m
    set member_name = coalesce(nullif(btrim(coalesce(p_member_name, '')), ''), m.member_name)
    where m.company_id = existing_id
      and m.user_id = uid;

    return row_company;
  end if;

  insert into public.companies (
    display_name,
    status,
    business_type,
    reply_language,
    country,
    city,
    hours,
    contact_phone,
    contact_email,
    created_by
  ) values (
    cleaned_name,
    'setup',
    coalesce(nullif(btrim(coalesce(p_business_type, '')), ''), 'restaurant'),
    p_reply_language,
    coalesce(nullif(btrim(coalesce(p_country, '')), ''), 'OM'),
    coalesce(p_city, ''),
    coalesce(p_hours, ''),
    coalesce(p_contact_phone, ''),
    coalesce(p_contact_email, ''),
    uid
  )
  returning * into row_company;

  insert into public.company_members (company_id, user_id, role, status, member_name)
  values (row_company.id, uid, 'owner', 'active', member_label);

  return row_company;
exception
  when unique_violation then
    -- Concurrent create lost the unique owner index; return the winner row.
    select c.*
      into row_company
    from public.company_members as m
    join public.companies as c on c.id = m.company_id
    where m.user_id = uid
      and m.role = 'owner'
      and m.status = 'active'
    order by m.created_at asc
    limit 1;

    if row_company.id is null then
      raise;
    end if;
    return row_company;
end;
$$;

create or replace function public.upsert_owner_company(
  p_display_name text,
  p_business_type text default 'restaurant',
  p_reply_language text default 'both',
  p_country text default 'OM',
  p_city text default '',
  p_hours text default '',
  p_contact_phone text default '',
  p_contact_email text default '',
  p_member_name text default ''
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.companies;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  result := private.upsert_owner_company(
    p_display_name,
    p_business_type,
    p_reply_language,
    p_country,
    p_city,
    p_hours,
    p_contact_phone,
    p_contact_email,
    p_member_name
  );
  return result;
end;
$$;

create or replace function public.upsert_selected_owner_company(
  p_company_id uuid,
  p_display_name text,
  p_business_type text default 'restaurant',
  p_reply_language text default 'both',
  p_country text default 'OM',
  p_city text default '',
  p_hours text default '',
  p_contact_phone text default '',
  p_contact_email text default '',
  p_member_name text default ''
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cleaned_name text := btrim(coalesce(p_display_name, ''));
  existing_id uuid;
  row_company public.companies;
  member_label text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if char_length(cleaned_name) < 1 or char_length(cleaned_name) > 120 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;

  if coalesce(p_reply_language, '') not in ('ar', 'en', 'both') then
    raise exception 'invalid_reply_language' using errcode = '22023';
  end if;

  -- Serialize creates/updates per caller so concurrent retries share one company.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select m.company_id into existing_id
  from public.company_members m join public.companies c on c.id = m.company_id
  where m.company_id = p_company_id and m.user_id = uid
    and m.role = 'owner' and m.status = 'active' and c.status <> 'suspended';
  if existing_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  member_label := coalesce(nullif(btrim(coalesce(p_member_name, '')), ''), cleaned_name);

  if existing_id is not null then
    update public.companies as c
    set
      display_name = cleaned_name,
      business_type = coalesce(nullif(btrim(coalesce(p_business_type, '')), ''), c.business_type),
      reply_language = p_reply_language,
      country = coalesce(nullif(btrim(coalesce(p_country, '')), ''), c.country),
      city = coalesce(p_city, ''),
      hours = coalesce(p_hours, ''),
      contact_phone = coalesce(p_contact_phone, ''),
      contact_email = coalesce(p_contact_email, ''),
      updated_at = now()
    where c.id = existing_id
      and c.status <> 'suspended'
    returning c.* into row_company;

    if row_company.id is null then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    update public.company_members as m
    set member_name = coalesce(nullif(btrim(coalesce(p_member_name, '')), ''), m.member_name)
    where m.company_id = existing_id
      and m.user_id = uid;

    return row_company;
  end if;

  raise exception 'forbidden' using errcode = '42501';
end;
$$;

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

  if (select count(*) from public.company_members m where m.user_id = uid and m.status = 'active') > 1 then
    return jsonb_build_object('ok', false, 'code', 'company_selection_required');
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

  if (select count(*) from public.company_members m where m.user_id = uid and m.status = 'active' and m.role = 'owner') > 1 then
    return jsonb_build_object('ok', false, 'code', 'company_selection_required');
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

create or replace function public.get_selected_whatsapp_company_link(p_company_id uuid)
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
  where m.company_id = p_company_id and m.user_id = uid
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

create or replace function public.upsert_selected_whatsapp_link_request(
  p_company_id uuid,
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
  where m.company_id = p_company_id and m.user_id = uid
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
  if not private.authorization_can_admin_company(p_company_id, 'wa.conversations.read') then
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
  if not private.authorization_can_admin_company(p_company_id, 'platform.manage_companies') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
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

  if private.authorization_can_admin_company(p_company_id, 'platform.view_audit') then
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
  else
    audits := '[]'::jsonb;
  end if;

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

do $install$
begin
  if to_regprocedure('public.access_get_user_snapshot(uuid)') is not null then
    execute $definition$
create or replace function public.access_get_user_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target auth.users%rowtype;
  plat public.platform_admins%rowtype;
  memberships jsonb;
  grants jsonb;
  scopes jsonb;
  scoped uuid[];
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if not public.is_platform_owner() and not exists (
    select 1 from public.company_members m
    where m.user_id = p_user_id and m.status = 'active'
      and private.can_admin_company(m.company_id, 'platform.manage_access')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into target from auth.users as u where u.id = p_user_id;
  if target.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into plat from public.platform_admins as a where a.user_id = p_user_id;

  if public.is_platform_owner() then
    scoped := null;
  else
    select coalesce(array_agg(s.company_id), '{}'::uuid[])
    into scoped
    from public.company_members as s
    where s.user_id = p_user_id and s.status = 'active'
      and private.can_admin_company(s.company_id, 'platform.manage_access');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', m.company_id,
    'role', m.role,
    'status', m.status,
    'display_name', c.display_name,
    'company_status', c.status
  ) order by c.display_name), '[]'::jsonb)
  into memberships
  from public.company_members as m
  join public.companies as c on c.id = m.company_id
  where m.user_id = p_user_id
    and (scoped is null or m.company_id = any (scoped));

  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', g.company_id,
    'capabilities', to_jsonb(g.capabilities),
    'conversation_scope', g.conversation_scope,
    'manager_user_id', g.manager_user_id,
    'status', g.status,
    'revision', g.revision
  )), '[]'::jsonb)
  into grants
  from public.company_member_grants as g
  where g.user_id = p_user_id
    and (scoped is null or g.company_id = any (scoped));

  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', s.company_id,
    'usable_capabilities', to_jsonb(s.usable_capabilities),
    'delegable_capabilities', to_jsonb(s.delegable_capabilities),
    'revision', s.revision
  )), '[]'::jsonb)
  into scopes
  from public.platform_admin_scopes as s
  where s.admin_user_id = p_user_id
    and public.is_platform_owner();

  return jsonb_build_object(
    'ok', true,
    'user_id', target.id,
    'email', target.email,
    'email_confirmed', target.email_confirmed_at is not null,
    'platform', case
      when not public.is_platform_owner() or plat.user_id is null then null
      else jsonb_build_object(
        'role', plat.role,
        'status', plat.status,
        'revision', plat.revision,
        'granted_at', plat.granted_at,
        'note', plat.note
      )
    end,
    'memberships', memberships,
    'grants', grants,
    'admin_scopes', scopes,
    'catalog', jsonb_build_object(
      'platform', to_jsonb(private.access_platform_capabilities()),
      'company', to_jsonb(private.access_company_capabilities())
    )
  );
end;
$$;
$definition$;
  end if;
end;
$install$;

revoke all on function private.upsert_owner_company(text,text,text,text,text,text,text,text,text) from public, anon, authenticated;

revoke all on function public.upsert_owner_company(text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.upsert_owner_company(text,text,text,text,text,text,text,text,text) to authenticated;

revoke all on function public.upsert_selected_owner_company(uuid,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.upsert_selected_owner_company(uuid,text,text,text,text,text,text,text,text,text) to authenticated;

revoke all on function public.get_whatsapp_company_link() from public, anon;
grant execute on function public.get_whatsapp_company_link() to authenticated;

revoke all on function public.upsert_whatsapp_link_request(text,boolean) from public, anon;
grant execute on function public.upsert_whatsapp_link_request(text,boolean) to authenticated;

revoke all on function public.get_selected_whatsapp_company_link(uuid) from public, anon;
grant execute on function public.get_selected_whatsapp_company_link(uuid) to authenticated;

revoke all on function public.upsert_selected_whatsapp_link_request(uuid,text,boolean) from public, anon;
grant execute on function public.upsert_selected_whatsapp_link_request(uuid,text,boolean) to authenticated;

revoke all on function public.admin_list_company_conversations(uuid,text,int,int,int,int) from public, anon;
grant execute on function public.admin_list_company_conversations(uuid,text,int,int,int,int) to authenticated;

revoke all on function public.admin_get_company(uuid) from public, anon;
grant execute on function public.admin_get_company(uuid) to authenticated;

commit;

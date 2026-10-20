-- Filename: 20261019222213_es02_b2_paid_branch_channel_selection.sql
-- Additive paid-branch inventory, initial channel binding, and bound read.
-- Does not replace 20261019214259_es02_b1_read_owned_branch_setup.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regrole('postgres') is null then
    raise exception 'ES02_B2_TRUSTED_OWNER_UNAVAILABLE';
  end if;
  if to_regprocedure('public.es02_read_owned_branch_setup(uuid,uuid,uuid)') is null
     or to_regprocedure('private.es02_require_active_actor(uuid)') is null
     or to_regclass('private.es02_branch_slot_rights') is null
     or to_regclass('public.company_branches') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.company_members') is null
     or to_regclass('public.whatsapp_company_links') is null
     or to_regclass('private.instagram_company_links') is null
     or to_regclass('private.instagram_oauth_attempts') is null then
    raise exception 'ES02_B2_BASELINE_MISSING';
  end if;
end;
$guard$;

create table private.es02_branch_channel_selections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  slot_index integer not null,
  account_id uuid not null references auth.users (id),
  client_op_id uuid not null,
  channels jsonb not null,
  request_payload jsonb not null,
  request_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, branch_id),
  unique (account_id, client_op_id),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id),
  foreign key (order_id, slot_index) references private.es02_branch_slot_rights (order_id, slot_index),
  check (channels = '["whatsapp"]'::jsonb or channels = '["instagram"]'::jsonb or channels = '["whatsapp","instagram"]'::jsonb),
  check (jsonb_typeof(request_payload) = 'object'),
  check (char_length(request_fingerprint) = 32)
);

alter table private.es02_branch_channel_selections owner to postgres;
alter table private.es02_branch_channel_selections enable row level security;
revoke all on table private.es02_branch_channel_selections from public;
revoke all on table private.es02_branch_channel_selections from anon;
revoke all on table private.es02_branch_channel_selections from authenticated;
revoke all on table private.es02_branch_channel_selections from service_role;

create or replace function public.es02_list_owned_paid_setup_branches(
  p_expected_account_id uuid,
  p_company_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  company public.companies%rowtype;
  branch public.company_branches%rowtype;
  observed jsonb;
  code text;
  listed jsonb := '[]'::jsonb;
begin
  if p_expected_account_id is null or p_company_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if not exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = actor and m.role = 'owner' and m.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  select * into company from public.companies where id = p_company_id;
  if company.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;
  if (company.status is distinct from 'setup' and company.status is distinct from 'active')
     or nullif(to_jsonb(company)->>'archived_at', '') is not null
     or nullif(to_jsonb(company)->>'setup_file_destruction_at', '') is not null then
    return jsonb_build_object('ok', false, 'code', 'SUSPENDED');
  end if;

  for branch in
    select * from public.company_branches
    where company_id = p_company_id
    order by is_primary desc, name, id
  loop
    observed := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, branch.id);
    code := observed->>'code';
    if observed->>'ok' is distinct from 'true' or code is distinct from 'SELECTION_REQUIRED' then
      if code in ('NOT_PROVISIONED', 'SUSPENDED') then
        continue;
      end if;
      return coalesce(observed, jsonb_build_object('ok', false, 'code', 'UNAVAILABLE'));
    end if;
    if observed->'data' ? 'selectedChannels'
       or (observed->'data'->>'companyId')::uuid is distinct from p_company_id
       or (observed->'data'->>'branchId')::uuid is distinct from branch.id
       or (observed->'data'->>'branchLabel') is distinct from branch.name then
      return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
    end if;
    listed := listed || jsonb_build_array(jsonb_build_object(
      'id', branch.id,
      'label', branch.name,
      'isPrimary', branch.is_primary
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'code', 'SELECTION_REQUIRED',
    'data', jsonb_build_object('companyId', p_company_id, 'branches', listed, 'asOf', clock_timestamp())
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_read_owned_branch_setup_binding(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  base jsonb;
  sel private.es02_branch_channel_selections%rowtype;
  payload jsonb;
  group_id uuid;
begin
  base := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if base->>'ok' is distinct from 'true' or base->>'code' is distinct from 'SELECTION_REQUIRED' then
    return base;
  end if;
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  select * into sel
  from private.es02_branch_channel_selections
  where company_id = p_company_id and branch_id = p_branch_id;
  if sel.id is null then
    return jsonb_set(base, '{binding}', 'null'::jsonb);
  end if;
  select o.original_order_group_id into group_id
  from private.es02_branch_slot_rights r
  join private.es02_account_orders o on o.id = r.order_id
  where r.company_id = p_company_id and r.branch_id = p_branch_id
    and r.order_id = sel.order_id and r.slot_index = sel.slot_index
    and o.account_id = actor;
  payload := jsonb_build_object(
    'accountId', sel.account_id,
    'companyId', sel.company_id,
    'branchId', sel.branch_id,
    'clientOpId', sel.client_op_id,
    'channels', sel.channels,
    'orderId', sel.order_id,
    'slotIndex', sel.slot_index
  );
  if group_id is null
     or sel.account_id is distinct from actor
     or sel.channels not in ('["whatsapp"]'::jsonb, '["instagram"]'::jsonb, '["whatsapp","instagram"]'::jsonb)
     or jsonb_array_length(sel.channels) > (base->'data'->>'maxChannels')::integer
     or (base->'data'->>'slotIndex')::integer is distinct from sel.slot_index
     or (base->'data'->>'orderGroupId')::uuid is distinct from group_id
     or sel.request_payload is distinct from payload
     or sel.request_fingerprint is distinct from pg_catalog.md5(payload::text) then
    return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
  end if;
  return jsonb_build_object('ok', true, 'code', 'BOUND', 'data', base->'data', 'binding', jsonb_build_object('channels', sel.channels));
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_select_owned_branch_channels(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_client_op_id uuid,
  p_channels jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  rights private.es02_branch_slot_rights%rowtype;
  observed jsonb;
  canonical jsonb := '[]'::jsonb;
  seen_whatsapp boolean := false;
  seen_instagram boolean := false;
  elem jsonb;
  channel text;
  wa_status text;
  wa_prior boolean := false;
  payload jsonb;
  locked private.es02_branch_slot_rights%rowtype;
  fingerprint text;
  receipt_id uuid;
  receipt_at timestamptz;
  existing private.es02_branch_channel_selections%rowtype;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_client_op_id is null
     or jsonb_typeof(p_channels) is distinct from 'array'
     or jsonb_array_length(p_channels) < 1 or jsonb_array_length(p_channels) > 2 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  for elem in select value from jsonb_array_elements(p_channels) loop
    if jsonb_typeof(elem) is distinct from 'string' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
    channel := elem #>> '{}';
    if channel = 'whatsapp' then
      if seen_whatsapp then return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT'); end if;
      seen_whatsapp := true;
    elsif channel = 'instagram' then
      if seen_instagram then return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT'); end if;
      seen_instagram := true;
    else
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
  end loop;
  if seen_whatsapp then canonical := canonical || jsonb_build_array('whatsapp'); end if;
  if seen_instagram then canonical := canonical || jsonb_build_array('instagram'); end if;

  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  observed := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if observed->>'ok' is distinct from 'true' or observed->>'code' is distinct from 'SELECTION_REQUIRED' then
    return coalesce(observed, jsonb_build_object('ok', false, 'code', 'UNAVAILABLE'));
  end if;
  if jsonb_array_length(canonical) > (observed->'data'->>'maxChannels')::integer then
    return jsonb_build_object('ok', false, 'code', 'ENTITLEMENT_EXCEEDED');
  end if;
  select * into rights
  from private.es02_branch_slot_rights
  where company_id = p_company_id and branch_id = p_branch_id;
  if rights.id is null
     or (observed->'data'->>'slotIndex')::integer is distinct from rights.slot_index
     or (observed->'data'->>'maxChannels')::integer is distinct from rights.channels then
    return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
  end if;
  payload := jsonb_build_object(
    'accountId', actor,
    'companyId', p_company_id,
    'branchId', p_branch_id,
    'clientOpId', p_client_op_id,
    'channels', canonical,
    'orderId', rights.order_id,
    'slotIndex', rights.slot_index
  );
  fingerprint := pg_catalog.md5(payload::text);
  select * into existing
  from private.es02_branch_channel_selections
  where account_id = actor and client_op_id = p_client_op_id;
  if existing.id is not null then
    if existing.request_payload = payload and existing.request_fingerprint = fingerprint
       and existing.company_id = p_company_id and existing.branch_id = p_branch_id
       and existing.order_id = rights.order_id and existing.slot_index = rights.slot_index
       and existing.channels = canonical then
      return jsonb_build_object(
        'ok', true, 'code', 'DUPLICATE',
        'data', jsonb_build_object(
          'receiptId', existing.id, 'companyId', existing.company_id, 'branchId', existing.branch_id,
          'channels', existing.channels, 'asOf', existing.created_at
        )
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;
  if exists (
    select 1 from private.es02_branch_channel_selections
    where company_id = p_company_id and branch_id = p_branch_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SELECTED');
  end if;

  select l.status,
         (l.verified_display_number is not null
          or l.inbound_tested_at is not null
          or l.outbound_tested_at is not null
          or l.provider_phone_number_id is not null)
    into wa_status, wa_prior
  from public.whatsapp_company_links l
  where l.company_id = p_company_id;
  if wa_status = 'verified'
     or exists (
       select 1 from private.instagram_company_links
       where company_id = p_company_id and status = 'active'
     ) then
    return jsonb_build_object('ok', false, 'code', 'CHANNEL_CONNECTED');
  end if;
  if wa_status in ('request_saved', 'needs_external_action', 'error')
     or wa_prior
     or exists (
       select 1 from private.instagram_company_links
       where company_id = p_company_id and status = 'retired'
     )
     or exists (
       select 1 from private.instagram_oauth_attempts
       where company_id = p_company_id and status in ('pending', 'claimed', 'vault_staged', 'bound', 'unknown')
     ) then
    return jsonb_build_object('ok', false, 'code', 'LEGACY_CHANNEL_UNSCOPED');
  end if;

  select * into locked
  from private.es02_branch_slot_rights
  where id = rights.id
  for update;
  observed := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if locked.id is null
     or observed->>'ok' is distinct from 'true'
     or observed->>'code' is distinct from 'SELECTION_REQUIRED'
     or locked.order_id is distinct from rights.order_id
     or locked.slot_index is distinct from rights.slot_index
     or locked.channels is distinct from rights.channels
     or (observed->'data'->>'slotIndex')::integer is distinct from locked.slot_index
     or (observed->'data'->>'maxChannels')::integer is distinct from locked.channels then
    return jsonb_build_object('ok', false, 'code', 'INCONSISTENT');
  end if;
  select * into existing
  from private.es02_branch_channel_selections
  where account_id = actor and client_op_id = p_client_op_id;
  if existing.id is not null then
    if existing.request_payload = payload and existing.channels = canonical
       and existing.company_id = p_company_id and existing.branch_id = p_branch_id
       and existing.order_id = locked.order_id and existing.slot_index = locked.slot_index then
      return jsonb_build_object(
        'ok', true, 'code', 'DUPLICATE',
        'data', jsonb_build_object(
          'receiptId', existing.id, 'companyId', existing.company_id, 'branchId', existing.branch_id,
          'channels', existing.channels, 'asOf', existing.created_at
        )
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;
  if exists (
    select 1 from private.es02_branch_channel_selections
    where company_id = p_company_id and branch_id = p_branch_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SELECTED');
  end if;
  begin
    insert into private.es02_branch_channel_selections (
      company_id, branch_id, order_id, slot_index, account_id, client_op_id,
      channels, request_payload, request_fingerprint
    ) values (
      p_company_id, p_branch_id, locked.order_id, locked.slot_index, actor, p_client_op_id,
      canonical, payload, fingerprint
    ) returning id, created_at into receipt_id, receipt_at;
    return jsonb_build_object(
      'ok', true, 'code', 'SELECTED',
      'data', jsonb_build_object(
        'receiptId', receipt_id, 'companyId', p_company_id, 'branchId', p_branch_id,
        'channels', canonical, 'asOf', receipt_at
      )
    );
  exception
    when unique_violation then
      select * into existing
      from private.es02_branch_channel_selections
      where account_id = actor and client_op_id = p_client_op_id;
      if existing.id is not null then
        if existing.request_payload = payload and existing.request_fingerprint = fingerprint
           and existing.company_id = p_company_id and existing.branch_id = p_branch_id
           and existing.order_id = locked.order_id and existing.slot_index = locked.slot_index
           and existing.channels = canonical then
          return jsonb_build_object(
            'ok', true, 'code', 'DUPLICATE',
            'data', jsonb_build_object(
              'receiptId', existing.id, 'companyId', existing.company_id, 'branchId', existing.branch_id,
              'channels', existing.channels, 'asOf', existing.created_at
            )
          );
        end if;
        return jsonb_build_object('ok', false, 'code', 'CONFLICT');
      end if;
      if exists (
        select 1 from private.es02_branch_channel_selections
        where company_id = p_company_id and branch_id = p_branch_id
      ) then
        return jsonb_build_object('ok', false, 'code', 'ALREADY_SELECTED');
      end if;
      return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end;
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

alter function public.es02_list_owned_paid_setup_branches(uuid, uuid) owner to postgres;
alter function public.es02_read_owned_branch_setup_binding(uuid, uuid, uuid) owner to postgres;
alter function public.es02_select_owned_branch_channels(uuid, uuid, uuid, uuid, jsonb) owner to postgres;

revoke all on function public.es02_list_owned_paid_setup_branches(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.es02_read_owned_branch_setup_binding(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.es02_select_owned_branch_channels(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.es02_list_owned_paid_setup_branches(uuid, uuid) to authenticated;
grant execute on function public.es02_read_owned_branch_setup_binding(uuid, uuid, uuid) to authenticated;
grant execute on function public.es02_select_owned_branch_channels(uuid, uuid, uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;

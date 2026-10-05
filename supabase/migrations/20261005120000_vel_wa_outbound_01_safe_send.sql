-- VEL-WA-OUTBOUND-01 / FIX: durable send intents, atomic claim, safe delivery linking.
-- Local migration only — do not apply from this package.

-- ---------------------------------------------------------------------------
-- Outbound message delivery snapshot (public-safe fields on messages)
-- ---------------------------------------------------------------------------
alter table public.whatsapp_messages
  add column if not exists delivery_state text,
  add column if not exists delivery_rank integer not null default 0,
  add column if not exists delivery_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_messages_delivery_state_chk'
      and conrelid = 'public.whatsapp_messages'::regclass
  ) then
    alter table public.whatsapp_messages
      add constraint whatsapp_messages_delivery_state_chk
      check (
        delivery_state is null
        or delivery_state in ('accepted', 'sent', 'delivered', 'read', 'failed')
      );
  end if;
end;
$$;

comment on column public.whatsapp_messages.delivery_state is
  'Latest applied provider/delivery state for UI. accepted ≠ delivered.';
comment on column public.whatsapp_messages.delivery_rank is
  'Monotonic rank for status application; older evidence must not overwrite newer.';

-- ---------------------------------------------------------------------------
-- Delivery status events: keep unmatched for safe rebind; never guess
-- ---------------------------------------------------------------------------
alter table public.whatsapp_delivery_statuses
  add column if not exists message_id uuid references public.whatsapp_messages (id) on delete set null,
  add column if not exists link_state text not null default 'unmatched';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_delivery_statuses_link_state_chk'
      and conrelid = 'public.whatsapp_delivery_statuses'::regclass
  ) then
    alter table public.whatsapp_delivery_statuses
      add constraint whatsapp_delivery_statuses_link_state_chk
      check (link_state in ('applied', 'unmatched', 'ignored_stale'));
  end if;
end;
$$;

create index if not exists whatsapp_delivery_statuses_unmatched_idx
  on public.whatsapp_delivery_statuses (company_id, phone_number_id, wa_message_id)
  where link_state = 'unmatched';

-- ---------------------------------------------------------------------------
-- Durable send intents (internal; attempt tokens never client-callable)
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_send_intents (
  id uuid primary key default gen_random_uuid(),
  client_op_id text not null,
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations (id) on delete cascade,
  phone_number_id text not null,
  recipient_wa_id text not null,
  body text not null,
  sender_kind text not null,
  actor_user_id uuid null,
  outcome text not null default 'ready',
  wa_message_id text null,
  message_id uuid null references public.whatsapp_messages (id) on delete set null,
  attempt_token uuid null,
  attempt_started_at timestamptz null,
  attempt_expires_at timestamptz null,
  provider_error_code text null,
  expected_automation_generation integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_send_intents_client_op_uid unique (company_id, client_op_id),
  constraint whatsapp_send_intents_sender_chk
    check (sender_kind in ('staff', 'assistant')),
  constraint whatsapp_send_intents_outcome_chk
    check (outcome in ('ready', 'attempting', 'accepted', 'rejected', 'unknown')),
  constraint whatsapp_send_intents_body_len
    check (char_length(body) > 0 and char_length(body) <= 4096),
  constraint whatsapp_send_intents_op_len
    check (char_length(client_op_id) >= 8 and char_length(client_op_id) <= 128)
);

create index if not exists whatsapp_send_intents_conversation_idx
  on public.whatsapp_send_intents (conversation_id, created_at desc);

create index if not exists whatsapp_send_intents_outcome_idx
  on public.whatsapp_send_intents (outcome, updated_at desc);

comment on table public.whatsapp_send_intents is
  'Durable outbound send operations. Lease expiry never auto-resends. Claim/finalize are service_role only.';

alter table public.whatsapp_send_intents enable row level security;

drop policy if exists whatsapp_send_intents_select_member on public.whatsapp_send_intents;
create policy whatsapp_send_intents_select_member
  on public.whatsapp_send_intents
  for select
  to authenticated
  using (private.is_active_company_member(company_id));

revoke all on table public.whatsapp_send_intents from public, anon, authenticated;
-- Display/outcome fields only — never attempt_token / lease columns to clients.
grant select (
  id, client_op_id, company_id, conversation_id, phone_number_id, recipient_wa_id,
  body, sender_kind, outcome, wa_message_id, message_id, provider_error_code,
  expected_automation_generation, created_at, updated_at
) on table public.whatsapp_send_intents to authenticated;

do $$
begin
  grant all on table public.whatsapp_send_intents to service_role;
exception when undefined_object then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.whatsapp_delivery_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case pg_catalog.lower(coalesce(p_status, ''))
    when 'accepted' then 1
    when 'sent' then 2
    when 'delivered' then 3
    when 'read' then 4
    when 'failed' then 5
    else 0
  end;
$$;

create or replace function private.whatsapp_send_intent_public(p_row public.whatsapp_send_intents)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'client_op_id', p_row.client_op_id,
    'company_id', p_row.company_id,
    'conversation_id', p_row.conversation_id,
    'phone_number_id', p_row.phone_number_id,
    'recipient_wa_id', p_row.recipient_wa_id,
    'body', p_row.body,
    'sender_kind', p_row.sender_kind,
    'outcome', p_row.outcome,
    'wa_message_id', p_row.wa_message_id,
    'message_id', p_row.message_id,
    'provider_error_code', p_row.provider_error_code,
    'expected_automation_generation', p_row.expected_automation_generation,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at
  );
$$;

-- Same fields for create + concurrent unique_violation paths.
create or replace function private.whatsapp_send_intent_fields_match(
  p_existing public.whatsapp_send_intents,
  p_company_id uuid,
  p_conversation_id uuid,
  p_phone_number_id text,
  p_recipient_wa_id text,
  p_body text,
  p_sender_kind text,
  p_expected_automation_generation integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_existing.company_id is not distinct from p_company_id
    and p_existing.conversation_id is not distinct from p_conversation_id
    and p_existing.phone_number_id is not distinct from p_phone_number_id
    and p_existing.recipient_wa_id is not distinct from p_recipient_wa_id
    and p_existing.body is not distinct from p_body
    and p_existing.sender_kind is not distinct from p_sender_kind
    and (
      p_sender_kind is distinct from 'assistant'
      or p_existing.expected_automation_generation is not distinct from p_expected_automation_generation
    );
$$;

-- ---------------------------------------------------------------------------
-- Create or return durable send intent (before any external provider call)
-- ---------------------------------------------------------------------------
create or replace function public.create_whatsapp_send_intent(
  p_client_op_id text,
  p_conversation_id uuid,
  p_body text,
  p_phone_number_id text,
  p_sender_kind text default 'staff',
  p_expected_automation_generation integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_op text := pg_catalog.btrim(coalesce(p_client_op_id, ''));
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_phone text := pg_catalog.btrim(coalesce(p_phone_number_id, ''));
  v_sender text := pg_catalog.btrim(coalesce(p_sender_kind, 'staff'));
  v_conv public.whatsapp_conversations%rowtype;
  v_company public.companies%rowtype;
  v_role text;
  v_existing public.whatsapp_send_intents%rowtype;
  v_row public.whatsapp_send_intents%rowtype;
  v_gen integer := p_expected_automation_generation;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_conversation_id is null
     or char_length(v_op) < 8 or char_length(v_op) > 128
     or char_length(v_body) < 1 or char_length(v_body) > 4096
     or v_phone = ''
     or v_sender not in ('staff', 'assistant') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_conv
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into v_company
  from public.companies
  where id = v_conv.company_id;

  if not found or v_company.status = 'suspended' then
    return jsonb_build_object('ok', false, 'code', 'company_suspended');
  end if;

  select m.role into v_role
  from public.company_members as m
  where m.company_id = v_conv.company_id
    and m.user_id = uid
    and m.status = 'active'
    and m.role in ('owner', 'staff');

  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_conv.phone_number_id is distinct from v_phone then
    return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
  end if;

  if v_sender = 'assistant' then
    if v_conv.automation_allowed is not true
       or v_conv.status = 'resolved'
       or v_gen is null
       or v_conv.automation_generation is distinct from v_gen then
      return jsonb_build_object(
        'ok', false,
        'code', 'automation_blocked',
        'automation_generation', v_conv.automation_generation,
        'control_revision', v_conv.control_revision,
        'status', v_conv.status,
        'automation_allowed', v_conv.automation_allowed
      );
    end if;
  else
    v_gen := null;
  end if;

  select * into v_existing
  from public.whatsapp_send_intents as i
  where i.company_id = v_conv.company_id
    and i.client_op_id = v_op
  for update;

  if found then
    if not private.whatsapp_send_intent_fields_match(
      v_existing, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id, v_body, v_sender, v_gen
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'content_mismatch',
        'intent', private.whatsapp_send_intent_public(v_existing)
      );
    end if;
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'intent', private.whatsapp_send_intent_public(v_existing)
    );
  end if;

  insert into public.whatsapp_send_intents (
    client_op_id, company_id, conversation_id, phone_number_id, recipient_wa_id,
    body, sender_kind, actor_user_id, outcome, expected_automation_generation
  ) values (
    v_op, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id,
    v_body, v_sender, uid, 'ready', v_gen
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'intent', private.whatsapp_send_intent_public(v_row)
  );
exception
  when unique_violation then
    select * into v_existing
    from public.whatsapp_send_intents as i
    where i.company_id = v_conv.company_id
      and i.client_op_id = v_op;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'unavailable');
    end if;
    -- Same field set as the found-path — same op + same text on different conversations ≠ match.
    if not private.whatsapp_send_intent_fields_match(
      v_existing, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id, v_body, v_sender, v_gen
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'content_mismatch',
        'intent', private.whatsapp_send_intent_public(v_existing)
      );
    end if;
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'intent', private.whatsapp_send_intent_public(v_existing)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic claim (service_role only). Re-verify bindings before ready→attempting.
-- Lease expiry never re-claims attempting/unknown.
-- ---------------------------------------------------------------------------
create or replace function public.claim_whatsapp_send_attempt(
  p_intent_id uuid,
  p_actor_user_id uuid,
  p_lease_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease integer := greatest(15, least(coalesce(p_lease_seconds, 90), 300));
  v_row public.whatsapp_send_intents%rowtype;
  v_conv public.whatsapp_conversations%rowtype;
  v_company public.companies%rowtype;
  v_role text;
  v_token uuid;
begin
  if p_intent_id is null or p_actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_row
  from public.whatsapp_send_intents
  where id = p_intent_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into v_company
  from public.companies
  where id = v_row.company_id;

  if not found or v_company.status = 'suspended' then
    return jsonb_build_object(
      'ok', false,
      'code', 'company_suspended',
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  select * into v_conv
  from public.whatsapp_conversations
  where id = v_row.conversation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Intent must still bind to live conversation phone + recipient.
  if v_conv.company_id is distinct from v_row.company_id
     or v_conv.phone_number_id is distinct from v_row.phone_number_id
     or v_conv.customer_wa_id is distinct from v_row.recipient_wa_id then
    return jsonb_build_object(
      'ok', false,
      'code', 'binding_mismatch',
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  if v_row.sender_kind = 'staff' then
    select m.role into v_role
    from public.company_members as m
    where m.company_id = v_row.company_id
      and m.user_id = p_actor_user_id
      and m.status = 'active'
      and m.role in ('owner', 'staff');
    if v_role is null then
      return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
  elsif v_row.sender_kind = 'assistant' then
    -- Automation eligibility + generation — snapshot only; cannot cancel an already-accepted send.
    if v_conv.automation_allowed is not true
       or v_conv.status = 'resolved'
       or v_row.expected_automation_generation is null
       or v_conv.automation_generation is distinct from v_row.expected_automation_generation then
      return jsonb_build_object(
        'ok', false,
        'code', 'automation_blocked',
        'intent', private.whatsapp_send_intent_public(v_row)
      );
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if v_row.outcome = 'ready' then
    v_token := gen_random_uuid();
    update public.whatsapp_send_intents as i
    set outcome = 'attempting',
        attempt_token = v_token,
        attempt_started_at = now(),
        attempt_expires_at = now() + make_interval(secs => v_lease),
        updated_at = now()
    where i.id = v_row.id
      and i.outcome = 'ready'
    returning * into v_row;

    if not found then
      select * into v_row from public.whatsapp_send_intents where id = p_intent_id;
      return jsonb_build_object(
        'ok', false,
        'code', 'in_progress',
        'intent', private.whatsapp_send_intent_public(v_row)
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'claimed', true,
      'attempt_token', v_token,
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  -- attempting / unknown / terminal: never re-authorize Graph from lease expiry.
  if v_row.outcome = 'attempting' then
    return jsonb_build_object(
      'ok', false,
      'code', 'in_progress',
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'claimed', false,
    'intent', private.whatsapp_send_intent_public(v_row)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Finalize (service_role only). Save provider acceptance evidence before message row.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_whatsapp_send_attempt(
  p_intent_id uuid,
  p_attempt_token uuid,
  p_result text,
  p_wa_message_id text default null,
  p_error_code text default null,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_result, '')));
  v_wamid text := nullif(pg_catalog.btrim(coalesce(p_wa_message_id, '')), '');
  v_row public.whatsapp_send_intents%rowtype;
  v_msg public.whatsapp_messages%rowtype;
  v_sent_at timestamptz := now();
  v_role text;
begin
  if p_intent_id is null or p_attempt_token is null
     or v_result not in ('accepted', 'rejected', 'unknown') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  if v_result = 'accepted' and v_wamid is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_row
  from public.whatsapp_send_intents
  where id = p_intent_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Optional actor re-check when provided by the trusted server action.
  if p_actor_user_id is not null and v_row.sender_kind = 'staff' then
    select m.role into v_role
    from public.company_members as m
    where m.company_id = v_row.company_id
      and m.user_id = p_actor_user_id
      and m.status = 'active'
      and m.role in ('owner', 'staff');
    if v_role is null then
      return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
  end if;

  if v_row.outcome in ('accepted', 'rejected', 'unknown') then
    return jsonb_build_object(
      'ok', true,
      'already_final', true,
      'intent', private.whatsapp_send_intent_public(v_row),
      'message', case
        when v_row.message_id is null then null
        else (
          select jsonb_build_object(
            'id', m.id,
            'body', m.body,
            'received_at', m.received_at,
            'delivery_state', m.delivery_state
          )
          from public.whatsapp_messages as m
          where m.id = v_row.message_id
        )
      end
    );
  end if;

  if v_row.outcome is distinct from 'attempting'
     or v_row.attempt_token is distinct from p_attempt_token then
    return jsonb_build_object(
      'ok', false,
      'code', 'claim_rejected',
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  if v_result = 'rejected' then
    update public.whatsapp_send_intents as i
    set outcome = 'rejected',
        provider_error_code = nullif(pg_catalog.left(coalesce(p_error_code, ''), 120), ''),
        attempt_token = null,
        updated_at = now()
    where i.id = v_row.id
    returning * into v_row;
    return jsonb_build_object('ok', true, 'intent', private.whatsapp_send_intent_public(v_row));
  end if;

  if v_result = 'unknown' then
    update public.whatsapp_send_intents as i
    set outcome = 'unknown',
        provider_error_code = nullif(pg_catalog.left(coalesce(p_error_code, ''), 120), ''),
        attempt_token = null,
        updated_at = now()
    where i.id = v_row.id
    returning * into v_row;
    return jsonb_build_object('ok', true, 'intent', private.whatsapp_send_intent_public(v_row));
  end if;

  -- accepted: if provider id already exists, verify identity — never return foreign message data.
  select * into v_msg
  from public.whatsapp_messages as m
  where m.wa_message_id = v_wamid
  for update;

  if found then
    if v_msg.company_id is distinct from v_row.company_id
       or v_msg.conversation_id is distinct from v_row.conversation_id
       or v_msg.direction is distinct from 'outbound'
       or v_msg.body is distinct from v_row.body then
      update public.whatsapp_send_intents as i
      set outcome = 'unknown',
          provider_error_code = 'provider_id_conflict',
          attempt_token = null,
          updated_at = now()
      where i.id = v_row.id
      returning * into v_row;
      return jsonb_build_object(
        'ok', false,
        'code', 'provider_id_conflict',
        'intent', private.whatsapp_send_intent_public(v_row)
      );
    end if;

    -- Matching existing row: record acceptance evidence + link.
    update public.whatsapp_send_intents as i
    set outcome = 'accepted',
        wa_message_id = v_wamid,
        message_id = v_msg.id,
        attempt_token = null,
        provider_error_code = null,
        updated_at = now()
    where i.id = v_row.id
    returning * into v_row;

    begin
      perform public.rebind_whatsapp_delivery_statuses(v_row.company_id, v_row.phone_number_id, v_wamid);
    exception
      when others then
        -- Acceptance evidence kept; display/status follow-up can retry without Graph.
        null;
    end;

    return jsonb_build_object(
      'ok', true,
      'intent', private.whatsapp_send_intent_public(v_row),
      'message', jsonb_build_object(
        'id', v_msg.id,
        'body', v_msg.body,
        'received_at', v_msg.received_at,
        'delivery_state', v_msg.delivery_state
      )
    );
  end if;

  -- Commit acceptance evidence in this subtransaction scope BEFORE display work.
  begin
    update public.whatsapp_send_intents as i
    set outcome = 'accepted',
        wa_message_id = v_wamid,
        attempt_token = null,
        provider_error_code = 'persist_pending',
        updated_at = now()
    where i.id = v_row.id
      and i.outcome = 'attempting'
      and i.attempt_token = p_attempt_token
    returning * into v_row;

    if not found then
      raise exception 'accept_evidence_lost' using errcode = 'P0001';
    end if;
  exception
    when others then
      -- Could not retain acceptance evidence — unresolved; do not invent recovery.
      select * into v_row from public.whatsapp_send_intents where id = p_intent_id;
      if found and v_row.outcome = 'attempting' then
        update public.whatsapp_send_intents as i
        set outcome = 'unknown',
            provider_error_code = 'accept_evidence_lost',
            attempt_token = null,
            updated_at = now()
        where i.id = v_row.id
        returning * into v_row;
      end if;
      return jsonb_build_object(
        'ok', false,
        'code', 'accept_evidence_lost',
        'intent', private.whatsapp_send_intent_public(v_row)
      );
  end;

  -- Narrow block: display insert + follow-up. Failures here must NOT undo acceptance evidence.
  begin
    insert into public.whatsapp_messages (
      company_id, conversation_id, wa_message_id, body, message_type,
      direction, sender, received_at, delivery_state, delivery_rank, delivery_updated_at
    ) values (
      v_row.company_id, v_row.conversation_id, v_wamid, v_row.body, 'text',
      'outbound',
      case when v_row.sender_kind = 'assistant' then 'assistant' else 'staff' end,
      v_sent_at, 'accepted', private.whatsapp_delivery_rank('accepted'), v_sent_at
    )
    returning * into v_msg;

    update public.whatsapp_conversations as c
    set last_message_at = greatest(c.last_message_at, v_sent_at)
    where c.id = v_row.conversation_id
      and c.company_id = v_row.company_id;

    update public.whatsapp_send_intents as i
    set message_id = v_msg.id,
        provider_error_code = null,
        updated_at = now()
    where i.id = v_row.id
    returning * into v_row;

    perform public.rebind_whatsapp_delivery_statuses(v_row.company_id, v_row.phone_number_id, v_wamid);

    return jsonb_build_object(
      'ok', true,
      'intent', private.whatsapp_send_intent_public(v_row),
      'message', jsonb_build_object(
        'id', v_msg.id,
        'body', v_msg.body,
        'received_at', v_msg.received_at,
        'delivery_state', v_msg.delivery_state
      )
    );
  exception
    when unique_violation then
      select * into v_msg
      from public.whatsapp_messages as m
      where m.wa_message_id = v_wamid
      for update;
      if not found
         or v_msg.company_id is distinct from v_row.company_id
         or v_msg.conversation_id is distinct from v_row.conversation_id
         or v_msg.direction is distinct from 'outbound'
         or v_msg.body is distinct from v_row.body then
        update public.whatsapp_send_intents as i
        set outcome = 'unknown',
            provider_error_code = 'provider_id_conflict',
            updated_at = now()
        where i.id = v_row.id
        returning * into v_row;
        return jsonb_build_object(
          'ok', false,
          'code', 'provider_id_conflict',
          'intent', private.whatsapp_send_intent_public(v_row)
        );
      end if;

      -- Matching row: conversation/intent link follow-up must not undo acceptance evidence.
      begin
        update public.whatsapp_conversations as c
        set last_message_at = greatest(c.last_message_at, v_msg.received_at)
        where c.id = v_row.conversation_id
          and c.company_id = v_row.company_id;

        update public.whatsapp_send_intents as i
        set message_id = v_msg.id,
            provider_error_code = null,
            updated_at = now()
        where i.id = v_row.id
        returning * into v_row;

        perform public.rebind_whatsapp_delivery_statuses(v_row.company_id, v_row.phone_number_id, v_wamid);

        return jsonb_build_object(
          'ok', true,
          'intent', private.whatsapp_send_intent_public(v_row),
          'message', jsonb_build_object(
            'id', v_msg.id,
            'body', v_msg.body,
            'received_at', v_msg.received_at,
            'delivery_state', v_msg.delivery_state
          )
        );
      exception
        when others then
          select * into v_row from public.whatsapp_send_intents where id = p_intent_id;
          return jsonb_build_object(
            'ok', true,
            'persist_pending', true,
            'intent', private.whatsapp_send_intent_public(v_row)
          );
      end;
    when others then
      -- Acceptance evidence retained (outer subtransaction); display/status retry only.
      select * into v_row from public.whatsapp_send_intents where id = p_intent_id;
      return jsonb_build_object(
        'ok', true,
        'persist_pending', true,
        'intent', private.whatsapp_send_intent_public(v_row)
      );
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retry message persist only (service_role) — never Graph
-- ---------------------------------------------------------------------------
create or replace function public.retry_whatsapp_send_persist(
  p_intent_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.whatsapp_send_intents%rowtype;
  v_msg public.whatsapp_messages%rowtype;
  v_sent_at timestamptz := now();
  v_role text;
begin
  if p_intent_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_row
  from public.whatsapp_send_intents
  where id = p_intent_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if p_actor_user_id is not null and v_row.sender_kind = 'staff' then
    select m.role into v_role
    from public.company_members as m
    where m.company_id = v_row.company_id
      and m.user_id = p_actor_user_id
      and m.status = 'active'
      and m.role in ('owner', 'staff');
    if v_role is null then
      return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
  end if;

  -- Only when acceptance evidence was retained.
  if v_row.outcome is distinct from 'accepted' or v_row.wa_message_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_persistable',
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  if v_row.message_id is not null then
    select * into v_msg from public.whatsapp_messages where id = v_row.message_id;
    return jsonb_build_object(
      'ok', true,
      'intent', private.whatsapp_send_intent_public(v_row),
      'message', jsonb_build_object(
        'id', v_msg.id,
        'body', v_msg.body,
        'received_at', v_msg.received_at,
        'delivery_state', v_msg.delivery_state
      )
    );
  end if;

  select * into v_msg
  from public.whatsapp_messages as m
  where m.wa_message_id = v_row.wa_message_id
  for update;

  if found then
    if v_msg.company_id is distinct from v_row.company_id
       or v_msg.conversation_id is distinct from v_row.conversation_id
       or v_msg.direction is distinct from 'outbound'
       or v_msg.body is distinct from v_row.body then
      update public.whatsapp_send_intents as i
      set outcome = 'unknown',
          provider_error_code = 'provider_id_conflict',
          updated_at = now()
      where i.id = v_row.id
      returning * into v_row;
      return jsonb_build_object(
        'ok', false,
        'code', 'provider_id_conflict',
        'intent', private.whatsapp_send_intent_public(v_row)
      );
    end if;
  else
    begin
      insert into public.whatsapp_messages (
        company_id, conversation_id, wa_message_id, body, message_type,
        direction, sender, received_at, delivery_state, delivery_rank, delivery_updated_at
      ) values (
        v_row.company_id, v_row.conversation_id, v_row.wa_message_id, v_row.body, 'text',
        'outbound',
        case when v_row.sender_kind = 'assistant' then 'assistant' else 'staff' end,
        v_sent_at, 'accepted', private.whatsapp_delivery_rank('accepted'), v_sent_at
      )
      returning * into v_msg;
    exception
      when unique_violation then
        select * into v_msg
        from public.whatsapp_messages as m
        where m.wa_message_id = v_row.wa_message_id
        for update;
        if not found
           or v_msg.company_id is distinct from v_row.company_id
           or v_msg.conversation_id is distinct from v_row.conversation_id
           or v_msg.direction is distinct from 'outbound'
           or v_msg.body is distinct from v_row.body then
          update public.whatsapp_send_intents as i
          set outcome = 'unknown',
              provider_error_code = 'provider_id_conflict',
              updated_at = now()
          where i.id = v_row.id
          returning * into v_row;
          return jsonb_build_object(
            'ok', false,
            'code', 'provider_id_conflict',
            'intent', private.whatsapp_send_intent_public(v_row)
          );
        end if;
      when others then
        -- Acceptance evidence already on intent; display retry only — never Graph.
        return jsonb_build_object(
          'ok', false,
          'code', 'persist_failed',
          'intent', private.whatsapp_send_intent_public(v_row)
        );
    end;
  end if;

  update public.whatsapp_conversations as c
  set last_message_at = greatest(c.last_message_at, v_msg.received_at)
  where c.id = v_row.conversation_id
    and c.company_id = v_row.company_id;

  update public.whatsapp_send_intents as i
  set message_id = v_msg.id,
      provider_error_code = null,
      updated_at = now()
  where i.id = v_row.id
  returning * into v_row;

  perform public.rebind_whatsapp_delivery_statuses(
    v_row.company_id, v_row.phone_number_id, v_row.wa_message_id
  );

  return jsonb_build_object(
    'ok', true,
    'intent', private.whatsapp_send_intent_public(v_row),
    'message', jsonb_build_object(
      'id', v_msg.id,
      'body', v_msg.body,
      'received_at', v_msg.received_at,
      'delivery_state', v_msg.delivery_state
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Apply / rebind delivery statuses — atomic conditional updates under row lock
-- ---------------------------------------------------------------------------
create or replace function public.rebind_whatsapp_delivery_statuses(
  p_company_id uuid,
  p_phone_number_id text,
  p_wa_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.whatsapp_messages%rowtype;
  v_ev public.whatsapp_delivery_statuses%rowtype;
  v_rank integer;
  v_applied integer := 0;
  v_kept integer := 0;
  v_updated public.whatsapp_messages%rowtype;
begin
  if p_company_id is null
     or nullif(pg_catalog.btrim(coalesce(p_phone_number_id, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(p_wa_message_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_msg
  from public.whatsapp_messages as m
  where m.company_id = p_company_id
    and m.wa_message_id = p_wa_message_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'applied', 0, 'unmatched', true);
  end if;

  if not exists (
    select 1
    from public.whatsapp_conversations as c
    where c.id = v_msg.conversation_id
      and c.company_id = p_company_id
      and c.phone_number_id = p_phone_number_id
  ) then
    return jsonb_build_object('ok', true, 'applied', 0, 'phone_mismatch', true);
  end if;

  for v_ev in
    select *
    from public.whatsapp_delivery_statuses as s
    where s.company_id = p_company_id
      and s.phone_number_id = p_phone_number_id
      and s.wa_message_id = p_wa_message_id
    order by s.occurred_at asc, s.created_at asc
    for update
  loop
    v_rank := private.whatsapp_delivery_rank(v_ev.status);
    if v_rank <= 0 then
      update public.whatsapp_delivery_statuses as s
      set link_state = 'unmatched',
          message_id = null
      where s.id = v_ev.id;
      v_kept := v_kept + 1;
      continue;
    end if;

    -- Atomic compare-and-set: lower rank never overwrites a higher committed rank.
    update public.whatsapp_messages as m
    set delivery_state = pg_catalog.lower(v_ev.status),
        delivery_rank = v_rank,
        delivery_updated_at = v_ev.occurred_at
    where m.id = v_msg.id
      and (
        m.delivery_rank < v_rank
        or (
          m.delivery_rank = v_rank
          and (m.delivery_updated_at is null or m.delivery_updated_at <= v_ev.occurred_at)
        )
      )
    returning * into v_updated;

    if found then
      v_msg := v_updated;
      update public.whatsapp_delivery_statuses as s
      set link_state = 'applied',
          message_id = v_msg.id
      where s.id = v_ev.id;
      v_applied := v_applied + 1;
    else
      update public.whatsapp_delivery_statuses as s
      set link_state = 'ignored_stale',
          message_id = v_msg.id
      where s.id = v_ev.id;
      v_kept := v_kept + 1;
      select * into v_msg from public.whatsapp_messages where id = v_msg.id;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'applied', v_applied, 'kept', v_kept);
end;
$$;

create or replace function public.apply_whatsapp_delivery_status(
  p_company_id uuid,
  p_phone_number_id text,
  p_wa_message_id text,
  p_status text,
  p_recipient_wa_id text,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_status, '')));
  v_phone text := pg_catalog.btrim(coalesce(p_phone_number_id, ''));
  v_wamid text := pg_catalog.btrim(coalesce(p_wa_message_id, ''));
  v_inserted boolean := false;
  v_id uuid;
begin
  if p_company_id is null or v_phone = '' or v_wamid = '' or v_status = ''
     or p_occurred_at is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  -- Never treat a generic acceptance synonym as delivered.
  if v_status = 'accepted' then
    v_status := 'sent';
  end if;

  begin
    insert into public.whatsapp_delivery_statuses (
      company_id, phone_number_id, wa_message_id, status,
      recipient_wa_id, occurred_at, link_state
    ) values (
      p_company_id, v_phone, v_wamid, v_status,
      coalesce(p_recipient_wa_id, ''), p_occurred_at, 'unmatched'
    )
    returning id into v_id;
    v_inserted := true;
  exception
    when unique_violation then
      return jsonb_build_object('ok', true, 'inserted', false, 'duplicate', true);
  end;

  perform public.rebind_whatsapp_delivery_statuses(p_company_id, v_phone, v_wamid);

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'id', v_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: claim / finalize / retry are server-only (service_role).
-- create_whatsapp_send_intent stays callable by authenticated members.
-- ---------------------------------------------------------------------------
revoke all on function public.create_whatsapp_send_intent(text, uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.claim_whatsapp_send_attempt(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.finalize_whatsapp_send_attempt(uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.retry_whatsapp_send_persist(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.apply_whatsapp_delivery_status(uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.rebind_whatsapp_delivery_statuses(uuid, text, text)
  from public, anon, authenticated;

-- Drop prior signatures if this file is re-run after earlier drafts in local trees.
do $$
begin
  execute 'revoke all on function public.claim_whatsapp_send_attempt(uuid, integer) from public, anon, authenticated';
exception when undefined_function then null;
end;
$$;
do $$
begin
  execute 'revoke all on function public.finalize_whatsapp_send_attempt(uuid, uuid, text, text, text) from public, anon, authenticated';
exception when undefined_function then null;
end;
$$;
do $$
begin
  execute 'revoke all on function public.retry_whatsapp_send_persist(uuid) from public, anon, authenticated';
exception when undefined_function then null;
end;
$$;

grant execute on function public.create_whatsapp_send_intent(text, uuid, text, text, text, integer)
  to authenticated;

do $$
begin
  grant execute on function public.claim_whatsapp_send_attempt(uuid, uuid, integer) to service_role;
  grant execute on function public.finalize_whatsapp_send_attempt(uuid, uuid, text, text, text, uuid) to service_role;
  grant execute on function public.retry_whatsapp_send_persist(uuid, uuid) to service_role;
  grant execute on function public.apply_whatsapp_delivery_status(uuid, text, text, text, text, timestamptz) to service_role;
  grant execute on function public.rebind_whatsapp_delivery_statuses(uuid, text, text) to service_role;
exception when undefined_object then null;
end;
$$;

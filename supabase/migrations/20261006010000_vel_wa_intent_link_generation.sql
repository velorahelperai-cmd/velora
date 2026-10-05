-- VEL-PRODUCT-INTEGRATION-01: persist send-intent link identity + generation.
-- Depends on 20261005120000 (intents) and 20261005140000 (link registry).
-- Do not apply in this package. Independent of 20261005160000 (separate approval).
-- Do not recreate 101500/103000/120000/140000.

alter table public.whatsapp_company_links
  add column if not exists generation bigint not null default 1;

comment on column public.whatsapp_company_links.generation is
  'Increments when verified identity/status changes. Stored on send intents for reuse.';

create or replace function private.whatsapp_company_link_bump_generation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (
       old.status is distinct from new.status
       or old.provider_phone_number_id is distinct from new.provider_phone_number_id
     ) then
    new.generation := coalesce(old.generation, 1) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_company_link_generation on public.whatsapp_company_links;
create trigger whatsapp_company_link_generation
before update on public.whatsapp_company_links
for each row execute function private.whatsapp_company_link_bump_generation();

alter table public.whatsapp_send_intents
  add column if not exists link_id uuid null references public.whatsapp_company_links (id) on delete set null,
  add column if not exists link_generation bigint null;

grant select (link_id, link_generation) on table public.whatsapp_send_intents to authenticated;

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
    'link_id', p_row.link_id,
    'link_generation', p_row.link_generation,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at
  );
$$;

drop function if exists private.whatsapp_send_intent_fields_match(
  public.whatsapp_send_intents, uuid, uuid, text, text, text, text, integer
);

create or replace function private.whatsapp_send_intent_fields_match(
  p_existing public.whatsapp_send_intents,
  p_company_id uuid,
  p_conversation_id uuid,
  p_phone_number_id text,
  p_recipient_wa_id text,
  p_body text,
  p_sender_kind text,
  p_expected_automation_generation integer,
  p_link_id uuid,
  p_link_generation bigint
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
    and p_existing.link_id is not distinct from p_link_id
    and p_existing.link_generation is not distinct from p_link_generation
    and (
      p_sender_kind is distinct from 'assistant'
      or p_existing.expected_automation_generation is not distinct from p_expected_automation_generation
    );
$$;

drop function if exists public.create_whatsapp_send_intent(text, uuid, text, text, text, integer);

create or replace function public.create_whatsapp_send_intent(
  p_client_op_id text,
  p_conversation_id uuid,
  p_body text,
  p_phone_number_id text,
  p_sender_kind text default 'staff',
  p_expected_automation_generation integer default null,
  p_link_id uuid default null,
  p_link_generation bigint default null
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
      return jsonb_build_object('ok', false, 'code', 'automation_blocked');
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
      v_existing, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id, v_body, v_sender, v_gen,
      p_link_id, p_link_generation
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
    body, sender_kind, actor_user_id, outcome, expected_automation_generation,
    link_id, link_generation
  ) values (
    v_op, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id,
    v_body, v_sender, uid, 'ready', v_gen,
    p_link_id, p_link_generation
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
    if not private.whatsapp_send_intent_fields_match(
      v_existing, v_conv.company_id, v_conv.id, v_phone, v_conv.customer_wa_id, v_body, v_sender, v_gen,
      p_link_id, p_link_generation
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

revoke all on function public.create_whatsapp_send_intent(text, uuid, text, text, text, integer, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.create_whatsapp_send_intent(text, uuid, text, text, text, integer, uuid, bigint)
  to authenticated;

create or replace function private.whatsapp_intent_link_current(p_row public.whatsapp_send_intents)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_link public.whatsapp_company_links%rowtype;
begin
  if p_row.link_id is null then
    return true;
  end if;
  select * into v_link from public.whatsapp_company_links where id = p_row.link_id;
  if not found then
    return false;
  end if;
  return v_link.status = 'verified'
    and v_link.company_id is not distinct from p_row.company_id
    and v_link.provider_phone_number_id is not distinct from p_row.phone_number_id
    and v_link.generation is not distinct from p_row.link_generation;
end;
$$;

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

  if v_conv.company_id is distinct from v_row.company_id
     or v_conv.phone_number_id is distinct from v_row.phone_number_id
     or v_conv.customer_wa_id is distinct from v_row.recipient_wa_id then
    return jsonb_build_object(
      'ok', false,
      'code', 'binding_mismatch',
      'intent', private.whatsapp_send_intent_public(v_row)
    );
  end if;

  if not private.whatsapp_intent_link_current(v_row) then
    return jsonb_build_object(
      'ok', false,
      'code', 'link_changed',
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

create or replace function public.resolve_whatsapp_company_by_provider_phone(
  p_provider_phone_number_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := pg_catalog.btrim(coalesce(p_provider_phone_number_id, ''));
  v_row public.whatsapp_company_links%rowtype;
  v_company_status text;
begin
  if v_phone = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'eligible', false);
  end if;

  select * into v_row
  from public.whatsapp_company_links
  where provider_phone_number_id = v_phone
    and status = 'verified';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_or_inactive', 'eligible', false);
  end if;

  select c.status into v_company_status
  from public.companies as c
  where c.id = v_row.company_id;

  if v_company_status is null or v_company_status = 'suspended' then
    return jsonb_build_object(
      'ok', false,
      'code', 'company_suspended',
      'company_id', v_row.company_id,
      'eligible', false
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'eligible', true,
    'company_id', v_row.company_id,
    'link_id', v_row.id,
    'generation', v_row.generation,
    'link_generation', v_row.generation,
    'provider_phone_number_id', v_row.provider_phone_number_id,
    'status', v_row.status
  );
end;
$$;


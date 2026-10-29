-- Exact Production catalog bodies read-only 2026-10-29; local QA only.
CREATE OR REPLACE FUNCTION public.control_whatsapp_conversation(p_conversation_id uuid, p_action text, p_expected_revision integer, p_assignee_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  v_action text := pg_catalog.btrim(coalesce(p_action, ''));
  v_conv public.whatsapp_conversations%rowtype;
  v_company public.companies%rowtype;
  v_needed text;
  v_updated public.whatsapp_conversations%rowtype;
  v_assignee_ok boolean;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_conversation_id is null
     or p_expected_revision is null
     or v_action not in ('take_over', 'resume', 'close', 'assign') then
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
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if not private.conversation_readable(v_conv.company_id, v_conv.assigned_to) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  v_needed := case v_action
    when 'take_over' then 'wa.conversations.take_over'
    when 'resume' then 'wa.conversations.resume'
    when 'close' then 'wa.conversations.close'
    when 'assign' then 'wa.conversations.assign'
  end;

  if not public.has_company_capability(v_conv.company_id, v_needed) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_conv.control_revision is distinct from p_expected_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'conflict',
      'conversation', jsonb_build_object(
        'id', v_conv.id,
        'status', v_conv.status,
        'automation_allowed', v_conv.automation_allowed,
        'automation_generation', v_conv.automation_generation,
        'control_revision', v_conv.control_revision,
        'assigned_to', v_conv.assigned_to,
        'control_actor_id', v_conv.control_actor_id,
        'control_acted_at', v_conv.control_acted_at
      )
    );
  end if;

  if v_action = 'assign' then
    if p_assignee_user_id is not null then
      select exists (
        select 1 from public.company_members as m
        where m.company_id = v_conv.company_id
          and m.user_id = p_assignee_user_id
          and m.status = 'active'
          and m.role in ('owner', 'staff')
      ) into v_assignee_ok;
      if not v_assignee_ok then
        return jsonb_build_object('ok', false, 'code', 'invalid_input');
      end if;
    end if;
  end if;

  perform pg_catalog.set_config('velora.conversation_control', '1', true);

  if v_action = 'take_over' then
    -- Do NOT set assigned_to = uid (assign is a separate capability).
    update public.whatsapp_conversations as c
    set
      status = 'handed_over',
      automation_allowed = false,
      automation_generation = c.automation_generation + 1,
      control_revision = c.control_revision + 1,
      control_actor_id = uid,
      control_acted_at = pg_catalog.now()
    where c.id = v_conv.id
      and c.control_revision = p_expected_revision
    returning * into v_updated;
  elsif v_action = 'resume' then
    update public.whatsapp_conversations as c
    set
      status = 'open',
      automation_allowed = true,
      control_revision = c.control_revision + 1,
      assigned_to = null,
      control_actor_id = uid,
      control_acted_at = pg_catalog.now()
    where c.id = v_conv.id
      and c.control_revision = p_expected_revision
    returning * into v_updated;
  elsif v_action = 'close' then
    update public.whatsapp_conversations as c
    set
      status = 'resolved',
      automation_allowed = false,
      automation_generation = c.automation_generation + 1,
      control_revision = c.control_revision + 1,
      control_actor_id = uid,
      control_acted_at = pg_catalog.now()
    where c.id = v_conv.id
      and c.control_revision = p_expected_revision
    returning * into v_updated;
  else
    -- assign
    update public.whatsapp_conversations as c
    set
      assigned_to = p_assignee_user_id,
      control_revision = c.control_revision + 1,
      control_actor_id = uid,
      control_acted_at = pg_catalog.now()
    where c.id = v_conv.id
      and c.control_revision = p_expected_revision
    returning * into v_updated;
  end if;

  if not found then
    select * into v_conv from public.whatsapp_conversations where id = p_conversation_id;
    return jsonb_build_object(
      'ok', false,
      'code', 'conflict',
      'conversation', jsonb_build_object(
        'id', v_conv.id,
        'status', v_conv.status,
        'automation_allowed', v_conv.automation_allowed,
        'automation_generation', v_conv.automation_generation,
        'control_revision', v_conv.control_revision,
        'assigned_to', v_conv.assigned_to,
        'control_actor_id', v_conv.control_actor_id,
        'control_acted_at', v_conv.control_acted_at
      )
    );
  end if;

  insert into public.whatsapp_conversation_events (
    company_id, conversation_id, actor_user_id, action, revision, automation_generation
  ) values (
    v_updated.company_id,
    v_updated.id,
    uid,
    v_action,
    v_updated.control_revision,
    v_updated.automation_generation
  );

  return jsonb_build_object(
    'ok', true,
    'action', v_action,
    'conversation', jsonb_build_object(
      'id', v_updated.id,
      'status', v_updated.status,
      'automation_allowed', v_updated.automation_allowed,
      'automation_generation', v_updated.automation_generation,
      'control_revision', v_updated.control_revision,
      'assigned_to', v_updated.assigned_to,
      'control_actor_id', v_updated.control_actor_id,
      'control_acted_at', v_updated.control_acted_at
    )
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.create_whatsapp_send_intent(p_client_op_id text, p_conversation_id uuid, p_body text, p_phone_number_id text, p_sender_kind text DEFAULT 'staff'::text, p_expected_automation_generation integer DEFAULT NULL::integer, p_link_id uuid DEFAULT NULL::uuid, p_link_generation bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  v_op text := pg_catalog.btrim(coalesce(p_client_op_id, ''));
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_phone text := pg_catalog.btrim(coalesce(p_phone_number_id, ''));
  v_sender text := pg_catalog.btrim(coalesce(p_sender_kind, 'staff'));
  v_conv public.whatsapp_conversations%rowtype;
  v_company public.companies%rowtype;
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
     or v_sender <> 'staff' then
    -- create_whatsapp_send_intent is staff-only for authenticated; assistant via service_role helper.
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

  if not public.has_company_capability(v_conv.company_id, 'wa.conversations.reply') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if not private.conversation_readable(v_conv.company_id, v_conv.assigned_to) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_conv.phone_number_id is distinct from v_phone then
    return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
  end if;

  v_gen := null;

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
$function$;

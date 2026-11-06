-- Connect the neutral ack ledger to the claimed job and the inbox SLA.
-- Scheduling and cancellation do not send. A closed service window is blocked
-- and does not create a template. Dispatch remains a separate guarded step.

create or replace function public.whatsapp_note_continuity(
  p_job_id uuid,
  p_claim_token uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.whatsapp_inbound_jobs%rowtype;
  conv public.whatsapp_conversations%rowtype;
  message public.whatsapp_messages%rowtype;
  intent public.whatsapp_response_intents%rowtype;
  window_ok boolean;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'server_role_required');
  end if;
  if p_action not in ('schedule', 'cancel') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  job := private.wa_worker_lock(p_job_id, p_claim_token);
  if job.id is null then
    return jsonb_build_object('ok', false, 'code', 'claim_or_automation_rejected');
  end if;
  select * into message from public.whatsapp_messages where id = job.message_id and company_id = job.company_id;
  select * into conv from public.whatsapp_conversations where id = message.conversation_id and company_id = job.company_id;
  if message.id is null or conv.id is null or message.wa_message_id is null then
    return jsonb_build_object('ok', false, 'code', 'claim_or_automation_rejected');
  end if;
  if not private.whatsapp_continuity_ai_claimable(conv) then
    update public.whatsapp_response_intents
    set phase = 'cancelled', claim_token = null, updated_at = pg_catalog.clock_timestamp()
    where company_id = job.company_id and channel = 'whatsapp' and provider_message_id = message.wa_message_id
      and response_kind = 'ack_v1' and phase in ('ack_due', 'persisted', 'queued', 'send_reserved', 'blocked');
    return jsonb_build_object('ok', true, 'action', 'cancel', 'reason', 'human_claimed');
  end if;
  select * into intent
  from public.whatsapp_response_intents
  where company_id = job.company_id and channel = 'whatsapp' and provider_message_id = message.wa_message_id and response_kind = 'ack_v1'
  for update;
  if intent.phase in ('unknown', 'attempting', 'provider_accepted', 'delivered', 'read') then
    return jsonb_build_object('ok', true, 'action', 'reconcile', 'phase', intent.phase);
  end if;
  if p_action = 'cancel' then
    if intent.id is not null then
      update public.whatsapp_response_intents
      set phase = 'cancelled', claim_token = null, updated_at = pg_catalog.clock_timestamp()
      where id = intent.id;
    end if;
    return jsonb_build_object('ok', true, 'action', 'cancel');
  end if;
  window_ok := private.whatsapp_service_window(job.company_id, conv.id, conv.phone_number_id, conv.customer_wa_id)->>'ok' = 'true';
  if not window_ok then
    insert into public.whatsapp_response_intents (
      company_id, channel, provider_message_id, response_kind, phase, conversation_id, inbound_job_id, automation_generation, authority
    ) values (
      job.company_id, 'whatsapp', message.wa_message_id, 'ack_v1', 'blocked', conv.id, job.id, conv.automation_generation, 'window_closed'
    )
    on conflict (company_id, channel, provider_message_id, response_kind) do update
      set phase = 'blocked', authority = 'window_closed', claim_token = null, updated_at = pg_catalog.clock_timestamp()
      where public.whatsapp_response_intents.phase not in ('unknown', 'attempting', 'provider_accepted', 'delivered', 'read');
    return jsonb_build_object('ok', true, 'action', 'blocked', 'freeform', false, 'template', false, 'code', 'service_window_closed');
  end if;
  insert into public.whatsapp_response_intents (
    company_id, channel, provider_message_id, response_kind, phase, conversation_id, inbound_job_id, automation_generation, authority, detail
  ) values (
    job.company_id, 'whatsapp', message.wa_message_id, 'ack_v1', 'ack_due', conv.id, job.id, conv.automation_generation, 'authorized',
    jsonb_build_object('body', 'استلمنا رسالتك. سنراجعها ونعود إليك من هنا.')
  )
  on conflict (company_id, channel, provider_message_id, response_kind) do update
    set phase = 'ack_due', authority = 'authorized', updated_at = pg_catalog.clock_timestamp()
    where public.whatsapp_response_intents.phase in ('persisted', 'queued', 'cancelled', 'blocked', 'ack_due');
  return jsonb_build_object('ok', true, 'action', 'schedule', 'response_kind', 'ack_v1', 'freeform', false);
end;
$$;

revoke all on function public.whatsapp_note_continuity(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_note_continuity(uuid, uuid, text) to service_role;

create or replace function public.whatsapp_authorize_continuity_ack(p_intent_id uuid, p_claim_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.whatsapp_response_intents%rowtype;
  conv public.whatsapp_conversations%rowtype;
  link public.whatsapp_company_links%rowtype;
  service_gate jsonb;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'server_role_required');
  end if;
  select * into intent from public.whatsapp_response_intents where id = p_intent_id for update;
  if intent.id is null or intent.claim_token is distinct from p_claim_token or intent.phase <> 'send_reserved' or intent.response_kind <> 'ack_v1' or intent.channel <> 'whatsapp' then
    return jsonb_build_object('ok', false, 'code', 'claim_mismatch');
  end if;
  if exists (
    select 1 from public.whatsapp_response_intents sibling
    where sibling.company_id = intent.company_id and sibling.channel = intent.channel
      and sibling.provider_message_id = intent.provider_message_id and sibling.phase in ('unknown', 'attempting')
  ) then
    return jsonb_build_object('ok', false, 'code', 'reconcile_only', 'template', false, 'freeform', false);
  end if;
  select * into conv from public.whatsapp_conversations where id = intent.conversation_id and company_id = intent.company_id;
  if conv.id is null or not private.whatsapp_continuity_ai_claimable(conv) then
    update public.whatsapp_response_intents set phase = 'cancelled', claim_token = null, updated_at = pg_catalog.clock_timestamp() where id = intent.id;
    return jsonb_build_object('ok', false, 'code', 'human_claimed', 'template', false, 'freeform', false);
  end if;
  service_gate := private.whatsapp_service_window(conv.company_id, conv.id, conv.phone_number_id, conv.customer_wa_id);
  if service_gate->>'ok' is distinct from 'true' then
    update public.whatsapp_response_intents
    set phase = 'blocked', authority = 'window_closed', claim_token = null, updated_at = pg_catalog.clock_timestamp()
    where id = intent.id;
    return jsonb_build_object('ok', false, 'code', 'service_window_closed', 'template', false, 'freeform', false);
  end if;
  select * into link from public.whatsapp_company_links
  where company_id = conv.company_id and provider_phone_number_id = conv.phone_number_id and status = 'verified'
  order by generation desc limit 1;
  if link.id is null then
    return jsonb_build_object('ok', false, 'code', 'link_unavailable', 'template', false, 'freeform', false);
  end if;
  update public.whatsapp_response_intents
  set phase = 'attempting', updated_at = pg_catalog.clock_timestamp()
  where id = intent.id;
  return jsonb_build_object(
    'ok', true, 'freeform', true, 'template', false,
    'body', 'استلمنا رسالتك. سنراجعها ونعود إليك من هنا.',
    'company_id', conv.company_id, 'conversation_id', conv.id,
    'phone_number_id', conv.phone_number_id, 'recipient_wa_id', conv.customer_wa_id,
    'link_id', link.id, 'link_generation', link.generation,
    'service_window_open', true, 'service_window_expires_at', service_gate->>'valid_until'
  );
end;
$$;

revoke all on function public.whatsapp_authorize_continuity_ack(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_authorize_continuity_ack(uuid, uuid) to service_role;

create or replace function public.whatsapp_finalize_continuity_ack(
  p_intent_id uuid,
  p_claim_token uuid,
  p_result text,
  p_wa_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.whatsapp_response_intents%rowtype;
  next_phase text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'server_role_required');
  end if;
  if p_result not in ('accepted', 'rejected', 'unknown') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  select * into intent from public.whatsapp_response_intents where id = p_intent_id for update;
  if intent.id is null or intent.claim_token is distinct from p_claim_token or intent.phase <> 'attempting' then
    return jsonb_build_object('ok', false, 'code', 'claim_mismatch');
  end if;
  next_phase := case p_result when 'accepted' then 'provider_accepted' when 'rejected' then 'rejected' else 'unknown' end;
  update public.whatsapp_response_intents
  set phase = next_phase, claim_token = null, updated_at = pg_catalog.clock_timestamp(),
      detail = detail || jsonb_build_object('provider_result', p_result, 'provider_message_id', p_wa_message_id)
  where id = intent.id;
  return jsonb_build_object('ok', true, 'phase', next_phase, 'delivered', false, 'retry', false);
end;
$$;

revoke all on function public.whatsapp_finalize_continuity_ack(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_finalize_continuity_ack(uuid, uuid, text, text) to service_role;

create or replace function private.whatsapp_continuity_sla(p_row public.whatsapp_conversations)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ack_after_seconds', coalesce(pol.ack_after_seconds, 20),
    'unclaimed_escalate_seconds', coalesce(pol.unclaimed_escalate_seconds, 60),
    'claimed_idle_seconds', coalesce(pol.claimed_idle_seconds, 120),
    'ack_due_at', inbound.inbound_at + make_interval(secs => coalesce(pol.ack_after_seconds, 20)),
    'unclaimed_escalate_at', inbound.inbound_at + make_interval(secs => coalesce(pol.unclaimed_escalate_seconds, 60)),
    'claimed_idle_at', inbound.inbound_at + make_interval(secs => coalesce(pol.claimed_idle_seconds, 120))
  )
  from (
    select max(m.received_at) as inbound_at
    from public.whatsapp_messages m
    where m.company_id = p_row.company_id and m.conversation_id = p_row.id
      and m.direction = 'inbound' and m.sender = 'customer'
  ) inbound
  left join public.whatsapp_continuity_policies pol on pol.company_id = p_row.company_id;
$$;

revoke all on function private.whatsapp_continuity_sla(public.whatsapp_conversations) from public, anon, authenticated, service_role;

alter function private.whatsapp_inbox_conversation_public(public.whatsapp_conversations, uuid)
  rename to continuity_pre_inbox_conversation_public;

create function private.whatsapp_inbox_conversation_public(p_row public.whatsapp_conversations, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.continuity_pre_inbox_conversation_public(p_row, p_user_id)
    || jsonb_build_object('continuity_sla', private.whatsapp_continuity_sla(p_row));
$$;

revoke all on function private.whatsapp_inbox_conversation_public(public.whatsapp_conversations, uuid) from public, anon, authenticated, service_role;

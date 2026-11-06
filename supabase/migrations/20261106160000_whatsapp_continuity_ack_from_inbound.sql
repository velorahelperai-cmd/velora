-- Break the zero-silence circular dependency: the continuity watchdog must be
-- able to create ack_v1 rows from persisted inbound messages after the SLA,
-- without waiting for an AI worker claim / whatsapp_note_continuity.
-- Historical pending rows before this cutover are never scheduled.
-- This migration does not send and does not change host flags.

create table if not exists private.whatsapp_continuity_cutover (
  singleton boolean primary key default true check (singleton),
  ack_schedule_from timestamptz not null
);

comment on table private.whatsapp_continuity_cutover is
  'Ack watchdog cutover. Messages received before ack_schedule_from are never auto-scheduled.';

revoke all on table private.whatsapp_continuity_cutover from public, anon, authenticated;
do $$
begin
  grant select on table private.whatsapp_continuity_cutover to service_role;
exception when undefined_object then null;
end $$;

insert into private.whatsapp_continuity_cutover (singleton, ack_schedule_from)
values (true, pg_catalog.clock_timestamp())
on conflict (singleton) do nothing;

create or replace function private.whatsapp_continuity_staff_replied_since(
  p_company_id uuid,
  p_conversation_id uuid,
  p_since timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.whatsapp_messages s
    where s.company_id = p_company_id
      and s.conversation_id = p_conversation_id
      and s.direction = 'outbound'
      and s.sender = 'staff'
      and s.received_at >= p_since
  );
$$;

revoke all on function private.whatsapp_continuity_staff_replied_since(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.whatsapp_schedule_due_continuity_acks(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutover timestamptz;
  scheduled integer := 0;
  item record;
  ack_after integer;
  coalesce_secs integer;
  window_ok boolean;
  job_id uuid;
  intent_id uuid;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'SERVER_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    return 0;
  end if;
  select c.ack_schedule_from into cutover
  from private.whatsapp_continuity_cutover c
  where c.singleton;
  if cutover is null then
    return 0;
  end if;

  for item in
    select
      m.id as message_id,
      m.company_id,
      m.conversation_id,
      m.wa_message_id,
      m.received_at,
      conv.automation_generation,
      conv.phone_number_id,
      conv.customer_wa_id,
      coalesce(pol.ack_after_seconds, 20) as ack_after_seconds,
      coalesce(pol.coalesce_seconds, 8) as coalesce_seconds
    from public.whatsapp_messages m
    join public.whatsapp_conversations conv
      on conv.id = m.conversation_id
     and conv.company_id = m.company_id
    left join public.whatsapp_continuity_policies pol
      on pol.company_id = m.company_id
    where m.direction = 'inbound'
      and m.sender = 'customer'
      and m.wa_message_id is not null
      and char_length(m.wa_message_id) between 1 and 256
      and m.received_at >= cutover
      and m.received_at <= pg_catalog.clock_timestamp()
        - make_interval(secs => coalesce(pol.ack_after_seconds, 20))
      and private.whatsapp_continuity_ai_claimable(conv)
      and not private.whatsapp_continuity_staff_replied_since(m.company_id, m.conversation_id, m.received_at)
      and not exists (
        select 1
        from public.whatsapp_response_intents existing
        where existing.company_id = m.company_id
          and existing.channel = 'whatsapp'
          and existing.provider_message_id = m.wa_message_id
          and existing.response_kind = 'ack_v1'
          and existing.phase in (
            'ack_due', 'send_reserved', 'attempting', 'provider_accepted',
            'delivered', 'read', 'unknown', 'blocked', 'rejected'
          )
      )
      and not exists (
        select 1
        from public.whatsapp_response_intents answer
        where answer.company_id = m.company_id
          and answer.channel = 'whatsapp'
          and answer.provider_message_id = m.wa_message_id
          and answer.response_kind = 'answer_v1'
          and answer.phase in (
            'answer_ready', 'send_reserved', 'attempting',
            'provider_accepted', 'delivered', 'read'
          )
      )
      -- Coalesce: a newer inbound in the same burst owns the ack slot.
      and not exists (
        select 1
        from public.whatsapp_messages newer
        where newer.company_id = m.company_id
          and newer.conversation_id = m.conversation_id
          and newer.direction = 'inbound'
          and newer.sender = 'customer'
          and newer.wa_message_id is not null
          and newer.received_at > m.received_at
          and newer.received_at < m.received_at
            + make_interval(secs => coalesce(pol.coalesce_seconds, 8))
      )
    order by m.received_at, m.id
    limit p_limit
  loop
    ack_after := item.ack_after_seconds;
    coalesce_secs := item.coalesce_seconds;
    intent_id := null;
    select j.id into job_id
    from public.whatsapp_inbound_jobs j
    where j.company_id = item.company_id
      and j.message_id = item.message_id
    order by j.created_at desc nulls last, j.id
    limit 1;

    window_ok := private.whatsapp_service_window(
      item.company_id, item.conversation_id, item.phone_number_id, item.customer_wa_id
    )->>'ok' = 'true';

    if not window_ok then
      insert into public.whatsapp_response_intents (
        company_id, channel, provider_message_id, response_kind, phase,
        conversation_id, inbound_job_id, automation_generation, authority, detail
      ) values (
        item.company_id, 'whatsapp', item.wa_message_id, 'ack_v1', 'blocked',
        item.conversation_id, job_id, item.automation_generation, 'window_closed',
        jsonb_build_object('reason', 'service_window_closed', 'source', 'watchdog_schedule')
      )
      on conflict (company_id, channel, provider_message_id, response_kind) do update
        set phase = 'blocked',
            authority = 'window_closed',
            claim_token = null,
            updated_at = pg_catalog.clock_timestamp()
        where public.whatsapp_response_intents.phase not in (
          'unknown', 'attempting', 'provider_accepted', 'delivered', 'read'
        );
      continue;
    end if;

    insert into public.whatsapp_response_intents (
      company_id, channel, provider_message_id, response_kind, phase,
      conversation_id, inbound_job_id, automation_generation, authority, detail
    ) values (
      item.company_id, 'whatsapp', item.wa_message_id, 'ack_v1', 'ack_due',
      item.conversation_id, job_id, item.automation_generation, 'authorized',
      jsonb_build_object(
        'body', 'استلمنا رسالتك. سنراجعها ونعود إليك من هنا.',
        'source', 'watchdog_schedule',
        'ack_after_seconds', ack_after
      )
    )
    on conflict (company_id, channel, provider_message_id, response_kind) do update
      set phase = 'ack_due',
          authority = 'authorized',
          automation_generation = excluded.automation_generation,
          inbound_job_id = coalesce(excluded.inbound_job_id, public.whatsapp_response_intents.inbound_job_id),
          detail = public.whatsapp_response_intents.detail || excluded.detail,
          updated_at = pg_catalog.clock_timestamp()
      where public.whatsapp_response_intents.phase in (
        'persisted', 'queued', 'cancelled', 'blocked', 'ack_due'
      )
    returning id into intent_id;

    if intent_id is null then
      continue;
    end if;

    -- Cancel older burst peers still waiting so the customer is not flooded.
    update public.whatsapp_response_intents older
    set phase = 'cancelled',
        claim_token = null,
        updated_at = pg_catalog.clock_timestamp(),
        detail = older.detail || jsonb_build_object('cancelled_by', 'coalesce', 'newer', item.wa_message_id)
    where older.company_id = item.company_id
      and older.conversation_id = item.conversation_id
      and older.channel = 'whatsapp'
      and older.response_kind = 'ack_v1'
      and older.phase = 'ack_due'
      and older.provider_message_id is distinct from item.wa_message_id
      and exists (
        select 1
        from public.whatsapp_messages peer
        where peer.company_id = older.company_id
          and peer.conversation_id = older.conversation_id
          and peer.wa_message_id = older.provider_message_id
          and peer.direction = 'inbound'
          and peer.sender = 'customer'
          and peer.received_at < item.received_at
          and peer.received_at >= item.received_at - make_interval(secs => coalesce_secs)
      );
    scheduled := scheduled + 1;
  end loop;

  return scheduled;
end;
$$;

revoke all on function private.whatsapp_schedule_due_continuity_acks(integer)
  from public, anon, authenticated, service_role;

comment on function private.whatsapp_schedule_due_continuity_acks(integer) is
  'Creates ack_v1/ack_due from persisted inbound after the SLA. No Meta call. Cutover excludes history. Coalesces burst peers.';

create or replace function public.whatsapp_claim_continuity_watchdog(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed jsonb := '[]'::jsonb;
  intent public.whatsapp_response_intents%rowtype;
  token uuid;
  scheduled integer := 0;
  claim_limit integer;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'server_role_required');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  -- Schedule first so a silent AI claim path cannot starve ack_v1 creation.
  scheduled := private.whatsapp_schedule_due_continuity_acks(least(p_limit * 2, 20));
  claim_limit := p_limit;

  for intent in
    select *
    from public.whatsapp_response_intents
    where channel = 'whatsapp'
      and response_kind = 'ack_v1'
      and phase = 'ack_due'
    order by updated_at, id
    limit claim_limit
    for update skip locked
  loop
    if exists (
      select 1 from public.whatsapp_response_intents sibling
      where sibling.company_id = intent.company_id
        and sibling.channel = intent.channel
        and sibling.provider_message_id = intent.provider_message_id
        and sibling.phase in ('unknown', 'attempting')
    ) then
      continue;
    end if;
    if exists (
      select 1 from public.whatsapp_response_intents answer
      where answer.company_id = intent.company_id
        and answer.channel = intent.channel
        and answer.provider_message_id = intent.provider_message_id
        and answer.response_kind = 'answer_v1'
        and answer.phase in ('answer_ready', 'send_reserved', 'attempting', 'provider_accepted', 'delivered', 'read')
    ) then
      update public.whatsapp_response_intents
      set phase = 'cancelled', claim_token = null, updated_at = pg_catalog.clock_timestamp()
      where id = intent.id and phase = 'ack_due';
      continue;
    end if;
    token := gen_random_uuid();
    update public.whatsapp_response_intents
    set phase = 'send_reserved',
        claim_token = token,
        claim_expires_at = pg_catalog.clock_timestamp() + interval '60 seconds',
        updated_at = pg_catalog.clock_timestamp()
    where id = intent.id and phase = 'ack_due';
    if not found then
      continue;
    end if;
    claimed := claimed || jsonb_build_array(jsonb_build_object(
      'id', intent.id,
      'company_id', intent.company_id,
      'provider_message_id', intent.provider_message_id,
      'response_kind', 'ack_v1',
      'claim_token', token,
      'automation_generation', intent.automation_generation
    ));
  end loop;
  return jsonb_build_object(
    'ok', true,
    'dispatch', false,
    'scheduled', scheduled,
    'claimed', claimed
  );
end;
$$;

comment on function public.whatsapp_claim_continuity_watchdog(integer) is
  'Schedules due ack_v1 from persisted inbound, then reserves send_reserved rows. dispatch stays false. Sender must still authorize and pass Meta/window gates.';

-- Generation fence: a staff claim that bumps automation_generation must void a reserved ack.
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
  if conv.id is null
     or not private.whatsapp_continuity_ai_claimable(conv)
     or (
       intent.automation_generation is not null
       and intent.automation_generation is distinct from conv.automation_generation
     ) then
    update public.whatsapp_response_intents set phase = 'cancelled', claim_token = null, updated_at = pg_catalog.clock_timestamp() where id = intent.id;
    return jsonb_build_object('ok', false, 'code', 'human_claimed', 'template', false, 'freeform', false);
  end if;
  if private.whatsapp_continuity_staff_replied_since(conv.company_id, conv.id, coalesce(
    (select m.received_at from public.whatsapp_messages m
     where m.company_id = intent.company_id and m.wa_message_id = intent.provider_message_id
     order by m.received_at desc limit 1),
    intent.created_at
  )) then
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

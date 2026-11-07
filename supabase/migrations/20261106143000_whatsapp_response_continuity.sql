-- Zero-silence continuity. Additive only: new columns, events, and tables.
-- Does not rewrite status, automation_allowed, or historical message rows.
-- handed_over is not backfilled as a staff claim. take_over is, except the
-- coexistence automation stop which uses that event without a human owner.
-- Nothing in this migration sends a WhatsApp message or enables a feature flag.

alter table public.whatsapp_conversations
  add column if not exists human_ownership text,
  add column if not exists handoff_reason text,
  add column if not exists handoff_requested_at timestamptz,
  add column if not exists human_claimed_by uuid,
  add column if not exists human_claimed_at timestamptz,
  add column if not exists last_staff_reply_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_conversations_human_ownership_chk'
      and conrelid = 'public.whatsapp_conversations'::regclass
  ) then
    alter table public.whatsapp_conversations
      add constraint whatsapp_conversations_human_ownership_chk
      check (human_ownership is null or human_ownership in (
        'none', 'requested_unclaimed', 'claimed_idle', 'claimed_active', 'released', 'resolved'
      ));
  end if;
end $$;

comment on column public.whatsapp_conversations.human_ownership is
  'Staff ownership cache. Null means not yet derived. handed_over alone is not claimed_active.';

-- Cache only. Existing status and automation flags stay as they were.
update public.whatsapp_conversations c
set last_staff_reply_at = staff.at
from (
  select m.company_id, m.conversation_id, max(m.received_at) as at
  from public.whatsapp_messages m
  where m.direction = 'outbound'
    and m.sender = 'staff'
    and m.delivery_state in ('accepted', 'sent', 'delivered', 'read')
  group by m.company_id, m.conversation_id
) staff
where c.id = staff.conversation_id
  and c.company_id = staff.company_id
  and c.last_staff_reply_at is null;

update public.whatsapp_conversations c
set
  human_ownership = case
    when e.action = 'close' then 'resolved'
    when e.action in ('resume', 'human_released') then 'released'
    when e.action = 'human_claimed' then 'claimed_active'
    when e.action = 'take_over' and coalesce(e.detail->>'reason', '') is distinct from 'coexistence_signup_ai_disabled' then 'claimed_active'
    when e.action in ('worker_escalation', 'handoff_requested', 'take_over') then 'requested_unclaimed'
    else c.human_ownership
  end,
  handoff_reason = case
    when e.action in ('worker_escalation', 'handoff_requested') then coalesce(c.handoff_reason, left(e.detail->>'reason', 120))
    else c.handoff_reason
  end,
  handoff_requested_at = case
    when e.action in ('worker_escalation', 'handoff_requested') then coalesce(c.handoff_requested_at, e.created_at)
    else c.handoff_requested_at
  end,
  human_claimed_by = case
    when e.action = 'human_claimed' or (e.action = 'take_over' and coalesce(e.detail->>'reason', '') is distinct from 'coexistence_signup_ai_disabled')
      then coalesce(c.human_claimed_by, e.actor_user_id)
    else c.human_claimed_by
  end,
  human_claimed_at = case
    when e.action = 'human_claimed' or (e.action = 'take_over' and coalesce(e.detail->>'reason', '') is distinct from 'coexistence_signup_ai_disabled')
      then coalesce(c.human_claimed_at, e.created_at)
    else c.human_claimed_at
  end
from (
  select distinct on (conversation_id) *
  from public.whatsapp_conversation_events
  where action in ('take_over', 'worker_escalation', 'resume', 'close', 'human_claimed', 'handoff_requested', 'human_released')
  order by conversation_id, event_sequence desc
) e
where c.id = e.conversation_id
  and c.company_id = e.company_id
  and c.human_ownership is null;

do $$
declare
  unexpected integer;
begin
  select count(*) into unexpected
  from public.whatsapp_conversation_events
  where action not in (
    'take_over', 'resume', 'close', 'reopen_inbound', 'assign', 'worker_escalation',
    'human_claimed', 'handoff_requested', 'human_released'
  );
  if unexpected > 0 then
    raise exception 'continuity_event_action_migration_blocked: % rows use an unlisted action', unexpected;
  end if;
  alter table public.whatsapp_conversation_events drop constraint if exists whatsapp_conversation_events_action_chk;
  alter table public.whatsapp_conversation_events
    add constraint whatsapp_conversation_events_action_chk
    check (action in (
      'take_over', 'resume', 'close', 'reopen_inbound', 'assign', 'worker_escalation',
      'human_claimed', 'handoff_requested', 'human_released'
    ));
end $$;

create or replace function private.whatsapp_apply_human_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('velora.conversation_control', '1', true);
  if new.action = 'human_claimed'
     or (new.action = 'take_over' and coalesce(new.detail->>'reason', '') is distinct from 'coexistence_signup_ai_disabled') then
    update public.whatsapp_conversations
    set human_ownership = 'claimed_active',
        human_claimed_by = coalesce(new.actor_user_id, human_claimed_by),
        human_claimed_at = coalesce(human_claimed_at, new.created_at)
    where id = new.conversation_id and company_id = new.company_id;
  elsif new.action = 'take_over' then
    update public.whatsapp_conversations
    set human_ownership = 'requested_unclaimed',
        handoff_reason = coalesce(handoff_reason, left(new.detail->>'reason', 120)),
        handoff_requested_at = coalesce(handoff_requested_at, new.created_at)
    where id = new.conversation_id and company_id = new.company_id
      and (human_ownership is null or human_ownership in ('none', 'released'));
  elsif new.action in ('worker_escalation', 'handoff_requested') then
    update public.whatsapp_conversations
    set human_ownership = 'requested_unclaimed',
        handoff_reason = coalesce(handoff_reason, left(new.detail->>'reason', 120)),
        handoff_requested_at = coalesce(handoff_requested_at, new.created_at)
    where id = new.conversation_id and company_id = new.company_id
      and (human_ownership is null or human_ownership in ('none', 'released', 'requested_unclaimed'));
  elsif new.action in ('resume', 'human_released') then
    update public.whatsapp_conversations
    set human_ownership = 'released'
    where id = new.conversation_id and company_id = new.company_id
      and human_ownership is distinct from 'resolved';
  elsif new.action = 'close' then
    update public.whatsapp_conversations
    set human_ownership = 'resolved'
    where id = new.conversation_id and company_id = new.company_id;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_apply_human_ownership on public.whatsapp_conversation_events;
create trigger whatsapp_apply_human_ownership
  after insert on public.whatsapp_conversation_events
  for each row
  execute function private.whatsapp_apply_human_ownership();

create or replace function private.whatsapp_conversations_guard_human_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(pg_catalog.current_setting('velora.conversation_control', true), '') is distinct from '1'
     and (
       new.human_ownership is distinct from old.human_ownership
       or new.handoff_reason is distinct from old.handoff_reason
       or new.handoff_requested_at is distinct from old.handoff_requested_at
       or new.human_claimed_by is distinct from old.human_claimed_by
       or new.human_claimed_at is distinct from old.human_claimed_at
       or new.last_staff_reply_at is distinct from old.last_staff_reply_at
     ) then
    raise exception 'human_ownership_columns_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_conversations_guard_human_ownership on public.whatsapp_conversations;
create trigger whatsapp_conversations_guard_human_ownership
  before update on public.whatsapp_conversations
  for each row
  execute function private.whatsapp_conversations_guard_human_ownership();

create table if not exists public.whatsapp_continuity_policies (
  company_id uuid primary key references public.companies (id) on delete cascade,
  ack_after_seconds integer not null default 20,
  unclaimed_escalate_seconds integer not null default 60,
  claimed_idle_seconds integer not null default 120,
  coalesce_seconds integer not null default 8,
  allow_safe_ai_after_claimed_idle boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint whatsapp_continuity_policies_ack_chk check (ack_after_seconds between 5 and 120),
  constraint whatsapp_continuity_policies_unclaimed_chk check (unclaimed_escalate_seconds between 30 and 600),
  constraint whatsapp_continuity_policies_idle_chk check (claimed_idle_seconds between 30 and 900),
  constraint whatsapp_continuity_policies_coalesce_chk check (coalesce_seconds between 5 and 10)
);

comment on table public.whatsapp_continuity_policies is
  'Per-business SLA overrides. No row means the code defaults. Safe AI after a claimed idle stays false until set explicitly.';

alter table public.whatsapp_continuity_policies enable row level security;
drop policy if exists whatsapp_continuity_policies_select_member on public.whatsapp_continuity_policies;
create policy whatsapp_continuity_policies_select_member
  on public.whatsapp_continuity_policies
  for select
  to authenticated
  using (private.is_active_company_member(company_id));
revoke all on table public.whatsapp_continuity_policies from public, anon, authenticated;
grant select on table public.whatsapp_continuity_policies to authenticated;

create table if not exists public.whatsapp_response_intents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  channel text not null,
  provider_message_id text not null,
  response_kind text not null,
  phase text not null default 'persisted',
  conversation_id uuid references public.whatsapp_conversations (id) on delete cascade,
  inbound_job_id uuid references public.whatsapp_inbound_jobs (id) on delete set null,
  send_intent_id uuid references public.whatsapp_send_intents (id) on delete set null,
  automation_generation integer,
  claim_token uuid,
  claim_expires_at timestamptz,
  authority text not null default 'temp_unavailable',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_response_intents_identity_uid unique (company_id, channel, provider_message_id, response_kind),
  constraint whatsapp_response_intents_channel_chk check (channel in ('whatsapp', 'instagram')),
  constraint whatsapp_response_intents_kind_chk check (response_kind in ('answer_v1', 'ack_v1')),
  constraint whatsapp_response_intents_phase_chk check (phase in (
    'received', 'persisted', 'queued', 'ai_running', 'answer_ready', 'ack_due', 'send_reserved',
    'attempting', 'provider_accepted', 'delivered', 'read', 'rejected', 'unknown', 'blocked', 'cancelled'
  )),
  constraint whatsapp_response_intents_authority_chk check (authority in (
    'authorized', 'temp_unavailable', 'revoked', 'channel_disabled', 'window_closed', 'budget_blocked'
  )),
  constraint whatsapp_response_intents_provider_len check (char_length(provider_message_id) between 1 and 256)
);

comment on table public.whatsapp_response_intents is
  'One answer_v1 and one ack_v1 per inbound provider message. accepted is provider_accepted, not delivered. UNKNOWN is reconcile-only. This table does not send.';

create index if not exists whatsapp_response_intents_due_idx
  on public.whatsapp_response_intents (phase, updated_at)
  where response_kind = 'ack_v1' and phase = 'ack_due';

alter table public.whatsapp_response_intents enable row level security;
drop policy if exists whatsapp_response_intents_select_member on public.whatsapp_response_intents;
create policy whatsapp_response_intents_select_member
  on public.whatsapp_response_intents
  for select
  to authenticated
  using (private.is_active_company_member(company_id));
revoke all on table public.whatsapp_response_intents from public, anon, authenticated;
grant select (
  id, company_id, channel, provider_message_id, response_kind, phase, conversation_id,
  inbound_job_id, send_intent_id, automation_generation, authority, created_at, updated_at
) on table public.whatsapp_response_intents to authenticated;

do $$
begin
  grant all on table public.whatsapp_continuity_policies to service_role;
  grant all on table public.whatsapp_response_intents to service_role;
exception when undefined_object then null;
end $$;

create or replace function public.whatsapp_record_human_claim(
  p_conversation_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  conv public.whatsapp_conversations%rowtype;
  company_status text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if p_conversation_id is null or p_expected_revision is null or p_expected_revision < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  select * into conv
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select c.status into company_status from public.companies c where c.id = conv.company_id;
  if company_status is null or company_status = 'suspended' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if not private.conversation_readable(conv.company_id, conv.assigned_to) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if not public.has_company_capability(conv.company_id, 'wa.conversations.take_over') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if conv.status = 'resolved' then
    return jsonb_build_object('ok', false, 'code', 'resolved');
  end if;
  if conv.control_revision is distinct from p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'conflict');
  end if;
  perform pg_catalog.set_config('velora.conversation_control', '1', true);
  update public.whatsapp_conversations
  set human_ownership = 'claimed_active',
      human_claimed_by = uid,
      human_claimed_at = pg_catalog.clock_timestamp(),
      automation_allowed = false,
      automation_generation = automation_generation + 1,
      control_revision = control_revision + 1,
      control_actor_id = uid,
      control_acted_at = pg_catalog.clock_timestamp()
  where id = conv.id
  returning * into conv;
  insert into public.whatsapp_conversation_events (
    company_id, conversation_id, actor_user_id, action, revision, automation_generation, detail
  ) values (
    conv.company_id, conv.id, uid, 'human_claimed', conv.control_revision, conv.automation_generation,
    jsonb_build_object('reason', 'staff_claim')
  );
  return jsonb_build_object(
    'ok', true,
    'human_ownership', conv.human_ownership,
    'automation_generation', conv.automation_generation,
    'control_revision', conv.control_revision,
    'status', conv.status
  );
end;
$$;

-- Read-only ownership snapshot. No message body, phone, or token.
-- billing_load_worker_frame is intentionally unchanged; callers opt in.
create or replace function public.whatsapp_continuity_snapshot(
  p_company_id uuid,
  p_conversation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  conv public.whatsapp_conversations%rowtype;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'server_role_required');
  end if;
  select * into conv
  from public.whatsapp_conversations
  where id = p_conversation_id and company_id = p_company_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'human_ownership', conv.human_ownership,
    'handoff_reason', conv.handoff_reason,
    'handoff_requested_at', conv.handoff_requested_at,
    'status', conv.status,
    'automation_allowed', conv.automation_allowed,
    'automation_generation', conv.automation_generation,
    'last_staff_reply_at', conv.last_staff_reply_at
  );
end;
$$;

revoke all on function public.whatsapp_continuity_snapshot(uuid, uuid) from public, anon, authenticated;
do $$
begin
  grant execute on function public.whatsapp_continuity_snapshot(uuid, uuid) to service_role;
exception when undefined_object then null;
end $$;

revoke all on function public.whatsapp_record_human_claim(uuid, integer) from public, anon, authenticated;
do $$
begin
  grant execute on function public.whatsapp_record_human_claim(uuid, integer) to authenticated;
exception when undefined_object then null;
end $$;

create or replace function public.whatsapp_reserve_response_intent(
  p_company_id uuid,
  p_channel text,
  p_provider_message_id text,
  p_response_kind text,
  p_conversation_id uuid,
  p_phase text,
  p_generation integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.whatsapp_response_intents%rowtype;
  created boolean := false;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'server_role_required');
  end if;
  if p_company_id is null or p_conversation_id is null
     or p_channel not in ('whatsapp', 'instagram')
     or p_response_kind not in ('answer_v1', 'ack_v1')
     or p_phase not in ('persisted', 'queued', 'ack_due', 'answer_ready', 'blocked')
     or p_provider_message_id is null or char_length(p_provider_message_id) < 1 or char_length(p_provider_message_id) > 256
     or p_generation is null or p_generation < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  insert into public.whatsapp_response_intents (
    company_id, channel, provider_message_id, response_kind, phase, conversation_id, automation_generation, authority
  ) values (
    p_company_id, p_channel, p_provider_message_id, p_response_kind, p_phase, p_conversation_id, p_generation, 'temp_unavailable'
  )
  on conflict (company_id, channel, provider_message_id, response_kind) do nothing
  returning * into row;
  if found then
    created := true;
  else
    select * into row
    from public.whatsapp_response_intents
    where company_id = p_company_id
      and channel = p_channel
      and provider_message_id = p_provider_message_id
      and response_kind = p_response_kind;
  end if;
  if row.phase = 'unknown' then
    return jsonb_build_object('ok', true, 'created', false, 'action', 'reconcile', 'phase', row.phase, 'id', row.id);
  end if;
  return jsonb_build_object('ok', true, 'created', created, 'phase', row.phase, 'id', row.id, 'response_kind', row.response_kind);
end;
$$;

revoke all on function public.whatsapp_reserve_response_intent(uuid, text, text, text, uuid, text, integer) from public, anon, authenticated;
do $$
begin
  grant execute on function public.whatsapp_reserve_response_intent(uuid, text, text, text, uuid, text, integer) to service_role;
exception when undefined_object then null;
end $$;

-- Claims due ack rows. It never calls Meta and never inserts a second ack or answer.
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
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'server_role_required');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  for intent in
    select *
    from public.whatsapp_response_intents
    where channel = 'whatsapp'
      and response_kind = 'ack_v1'
      and phase = 'ack_due'
    order by updated_at, id
    limit p_limit
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
    claimed := claimed || jsonb_build_array(jsonb_build_object(
      'id', intent.id,
      'company_id', intent.company_id,
      'provider_message_id', intent.provider_message_id,
      'response_kind', 'ack_v1',
      'claim_token', token,
      'automation_generation', intent.automation_generation
    ));
  end loop;
  return jsonb_build_object('ok', true, 'dispatch', false, 'claimed', claimed);
end;
$$;

comment on function public.whatsapp_claim_continuity_watchdog(integer) is
  'Atomic ack reservation only. dispatch is always false. A sender must still pass the existing send-intent claim, generation fence, and WHATSAPP_CONTINUITY_ACK_ENABLED.';

revoke all on function public.whatsapp_claim_continuity_watchdog(integer) from public, anon, authenticated;
do $$
begin
  grant execute on function public.whatsapp_claim_continuity_watchdog(integer) to service_role;
exception when undefined_object then null;
end $$;

create or replace function private.whatsapp_inbox_intervention(
  p_company_id uuid,
  p_conversation_id uuid,
  p_human_control boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('reasons', to_jsonb(array_remove(array[
    case when private.whatsapp_human_controlled(p_company_id, p_conversation_id) then 'human_control' end,
    case when exists (
      select 1 from public.whatsapp_inbound_jobs j
      join public.whatsapp_messages m on m.id = j.message_id and m.company_id = j.company_id
      where j.company_id = p_company_id and m.conversation_id = p_conversation_id and j.status = 'review_required'
    ) then 'worker_review' end,
    case when exists (
      select 1 from public.whatsapp_inbound_jobs j
      join public.whatsapp_messages m on m.id = j.message_id and m.company_id = j.company_id
      where j.company_id = p_company_id and m.conversation_id = p_conversation_id and j.status in ('failed', 'dead_letter')
    ) then 'worker_failed' end,
    case when exists (
      select 1 from public.whatsapp_send_intents
      where company_id = p_company_id and conversation_id = p_conversation_id and outcome = 'unknown'
    ) then 'send_unknown' end,
    case when exists (
      select 1 from public.whatsapp_send_intents
      where company_id = p_company_id and conversation_id = p_conversation_id and outcome = 'rejected'
    ) then 'send_rejected' end,
    case when exists (
      select 1 from public.whatsapp_messages
      where company_id = p_company_id and conversation_id = p_conversation_id
        and direction = 'outbound' and delivery_state = 'failed'
    ) then 'delivery_failed' end,
    case when exists (
      select 1 from public.whatsapp_response_intents
      where company_id = p_company_id and conversation_id = p_conversation_id
        and response_kind = 'ack_v1' and phase = 'provider_accepted'
    ) then 'ack_sent' end
  ]::text[], null)));
$$;

revoke all on function private.whatsapp_inbox_intervention(uuid, uuid, boolean) from public, anon, authenticated, service_role;

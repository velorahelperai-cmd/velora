-- VEL-WA-HANDOFF-01 (unapplied)
-- Durable conversation control: status, automation gate, revision, actor/time.
-- Default: automation off for existing and new rows (no auto-enable via migration).
-- Control transitions only via RPC (members). Platform admin read ≠ company actor.

alter table public.whatsapp_conversations
  add column if not exists status text not null default 'open',
  add column if not exists automation_allowed boolean not null default false,
  add column if not exists automation_generation integer not null default 0,
  add column if not exists control_revision integer not null default 1,
  add column if not exists control_actor_id uuid references auth.users (id),
  add column if not exists control_acted_at timestamptz,
  add column if not exists assigned_to uuid references auth.users (id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_conversations_status_chk'
      and conrelid = 'public.whatsapp_conversations'::regclass
  ) then
    alter table public.whatsapp_conversations
      add constraint whatsapp_conversations_status_chk
      check (status in ('open', 'handed_over', 'resolved'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_conversations_control_revision_chk'
      and conrelid = 'public.whatsapp_conversations'::regclass
  ) then
    alter table public.whatsapp_conversations
      add constraint whatsapp_conversations_control_revision_chk
      check (control_revision >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_conversations_automation_generation_chk'
      and conrelid = 'public.whatsapp_conversations'::regclass
  ) then
    alter table public.whatsapp_conversations
      add constraint whatsapp_conversations_automation_generation_chk
      check (automation_generation >= 0);
  end if;
end;
$$;

-- Existing rows stay non-automated.
update public.whatsapp_conversations
set automation_allowed = false
where automation_allowed is distinct from false;

comment on column public.whatsapp_conversations.automation_allowed is
  'Future automation permission for this conversation only. Does not enable a live AI provider or system send.';
comment on column public.whatsapp_conversations.automation_generation is
  'Bumped on take-over/close/reopen to invalidate stale automated results. Does not recall already-sent messages.';
comment on column public.whatsapp_conversations.control_revision is
  'Optimistic concurrency token for control transitions.';

-- Company-scoped control event log (not admin_audit_logs).
create table if not exists public.whatsapp_conversation_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations (id) on delete cascade,
  actor_user_id uuid references auth.users (id),
  action text not null,
  revision integer not null,
  automation_generation integer not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint whatsapp_conversation_events_action_chk
    check (action in ('take_over', 'resume', 'close', 'reopen_inbound'))
);

create index if not exists whatsapp_conversation_events_conversation_idx
  on public.whatsapp_conversation_events (conversation_id, created_at desc);

alter table public.whatsapp_conversation_events enable row level security;

drop policy if exists whatsapp_conversation_events_select_member on public.whatsapp_conversation_events;
create policy whatsapp_conversation_events_select_member
  on public.whatsapp_conversation_events
  for select
  to authenticated
  using (private.is_active_company_member(company_id));

revoke all on table public.whatsapp_conversation_events from public, anon, authenticated;
grant select on table public.whatsapp_conversation_events to authenticated;

-- Block direct client forgery of control columns (defense in depth).
create or replace function private.whatsapp_conversations_guard_control()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(pg_catalog.current_setting('velora.conversation_control', true), '') is distinct from '1'
  then
    if new.status is distinct from old.status
       or new.automation_allowed is distinct from old.automation_allowed
       or new.automation_generation is distinct from old.automation_generation
       or new.control_revision is distinct from old.control_revision
       or new.control_actor_id is distinct from old.control_actor_id
       or new.control_acted_at is distinct from old.control_acted_at
       or new.assigned_to is distinct from old.assigned_to
    then
      raise exception 'control_columns_locked' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_conversations_guard_control on public.whatsapp_conversations;
create trigger whatsapp_conversations_guard_control
  before update on public.whatsapp_conversations
  for each row
  execute function private.whatsapp_conversations_guard_control();

-- Reusable server gate for future automation workers (not a live provider switch).
create or replace function public.whatsapp_automation_gate(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.whatsapp_conversations%rowtype;
begin
  if p_conversation_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into r
  from public.whatsapp_conversations
  where id = p_conversation_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'conversation_id', r.id,
    'company_id', r.company_id,
    'status', r.status,
    'automation_allowed', r.automation_allowed,
    'automation_generation', r.automation_generation,
    'control_revision', r.control_revision,
    'eligible', (
      r.automation_allowed = true
      and r.status is distinct from 'resolved'
    )
  );
end;
$$;

revoke all on function public.whatsapp_automation_gate(uuid) from public, anon, authenticated;
do $$
begin
  grant execute on function public.whatsapp_automation_gate(uuid) to service_role;
exception when undefined_object then null;
end;
$$;

create or replace function public.control_whatsapp_conversation(
  p_conversation_id uuid,
  p_action text,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_action text := pg_catalog.btrim(coalesce(p_action, ''));
  v_conv public.whatsapp_conversations%rowtype;
  v_company public.companies%rowtype;
  v_role text;
  v_updated public.whatsapp_conversations%rowtype;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_conversation_id is null
     or p_expected_revision is null
     or v_action not in ('take_over', 'resume', 'close') then
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

  -- Active company owner/staff only. Platform admin without membership cannot act.
  select m.role into v_role
  from public.company_members as m
  where m.company_id = v_conv.company_id
    and m.user_id = uid
    and m.status = 'active'
    and m.role in ('owner', 'staff');

  if v_role is null then
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

  perform pg_catalog.set_config('velora.conversation_control', '1', true);

  if v_action = 'take_over' then
    update public.whatsapp_conversations as c
    set
      status = 'handed_over',
      automation_allowed = false,
      automation_generation = c.automation_generation + 1,
      control_revision = c.control_revision + 1,
      assigned_to = uid,
      control_actor_id = uid,
      control_acted_at = pg_catalog.now()
    where c.id = v_conv.id
      and c.control_revision = p_expected_revision
    returning * into v_updated;
  elsif v_action = 'resume' then
    -- Future automation permission only; does not enable a live provider/send path.
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
  else
    -- close
    update public.whatsapp_conversations as c
    set
      status = 'resolved',
      automation_allowed = false,
      automation_generation = c.automation_generation + 1,
      control_revision = c.control_revision + 1,
      assigned_to = coalesce(c.assigned_to, uid),
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
$$;

revoke all on function public.control_whatsapp_conversation(uuid, text, integer)
  from public, anon;
grant execute on function public.control_whatsapp_conversation(uuid, text, integer)
  to authenticated;

-- Integrate reopen-on-new-inbound into the atomic save path (unapplied inbound foundation).
create or replace function public.save_whatsapp_inbound(
  p_company_id uuid,
  p_phone_number_id text,
  p_customer_wa_id text,
  p_customer_name text,
  p_wa_message_id text,
  p_body text,
  p_message_type text,
  p_received_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_message_id uuid;
  v_job_id uuid;
  v_inserted boolean := false;
  v_existing public.whatsapp_messages%rowtype;
  v_conv public.whatsapp_conversations%rowtype;
  v_name text := coalesce(pg_catalog.btrim(p_customer_name), '');
  v_phone text := coalesce(pg_catalog.btrim(p_phone_number_id), '');
  v_customer text := coalesce(pg_catalog.btrim(p_customer_wa_id), '');
  v_wa_id text := coalesce(pg_catalog.btrim(p_wa_message_id), '');
  v_body text := coalesce(p_body, '');
  v_type text := pg_catalog.btrim(coalesce(p_message_type, ''));
  v_reopened boolean := false;
begin
  if v_type = '' then
    v_type := 'text';
  end if;

  if p_company_id is null
     or v_phone = ''
     or v_customer = ''
     or v_wa_id = ''
     or p_received_at is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    87420101,
    pg_catalog.hashtext(v_wa_id)
  );

  select m.*
  into v_existing
  from public.whatsapp_messages as m
  where m.wa_message_id = v_wa_id
  for update;

  if found then
    select c.*
    into v_conv
    from public.whatsapp_conversations as c
    where c.id = v_existing.conversation_id
    for update;

    if not found then
      raise exception 'conversation_missing' using errcode = 'P0002';
    end if;

    if v_existing.company_id is distinct from p_company_id
       or v_existing.direction is distinct from 'inbound'
       or v_existing.sender is distinct from 'customer'
       or v_conv.company_id is distinct from p_company_id
       or v_conv.phone_number_id is distinct from v_phone
       or v_conv.customer_wa_id is distinct from v_customer
       or v_existing.conversation_id is distinct from v_conv.id then
      raise exception 'inbound_identity_conflict' using errcode = '22023';
    end if;

    v_message_id := v_existing.id;
    v_conversation_id := v_existing.conversation_id;

    -- Duplicate: use stored timing only; do not reopen a conversation closed after this message.
    perform pg_catalog.set_config('velora.conversation_control', '1', true);
    update public.whatsapp_conversations as c
    set last_message_at = greatest(c.last_message_at, v_existing.received_at)
    where c.id = v_conversation_id
      and c.company_id = p_company_id;
  else
    insert into public.whatsapp_conversations as c (
      company_id,
      phone_number_id,
      customer_wa_id,
      customer_name,
      last_message_at,
      status,
      automation_allowed
    ) values (
      p_company_id,
      v_phone,
      v_customer,
      v_name,
      p_received_at,
      'open',
      false
    )
    on conflict (company_id, phone_number_id, customer_wa_id)
    do update set
      customer_name = case
        when excluded.customer_name <> '' then excluded.customer_name
        else c.customer_name
      end,
      last_message_at = greatest(c.last_message_at, excluded.last_message_at)
    returning c.id into v_conversation_id;

    insert into public.whatsapp_messages (
      company_id,
      conversation_id,
      wa_message_id,
      body,
      message_type,
      direction,
      sender,
      received_at
    ) values (
      p_company_id,
      v_conversation_id,
      v_wa_id,
      v_body,
      v_type,
      'inbound',
      'customer',
      p_received_at
    )
    returning id into v_message_id;

    v_inserted := true;

    -- New message only: reopen resolved for human follow-up; keep automation off.
    perform pg_catalog.set_config('velora.conversation_control', '1', true);
    update public.whatsapp_conversations as c
    set
      status = 'handed_over',
      automation_allowed = false,
      automation_generation = c.automation_generation + 1,
      control_revision = c.control_revision + 1,
      control_actor_id = null,
      control_acted_at = pg_catalog.now()
    where c.id = v_conversation_id
      and c.company_id = p_company_id
      and c.status = 'resolved';

    if found then
      v_reopened := true;
      insert into public.whatsapp_conversation_events (
        company_id, conversation_id, actor_user_id, action, revision, automation_generation, detail
      )
      select
        c.company_id,
        c.id,
        null,
        'reopen_inbound',
        c.control_revision,
        c.automation_generation,
        jsonb_build_object('wa_message_id', v_wa_id, 'message_id', v_message_id)
      from public.whatsapp_conversations as c
      where c.id = v_conversation_id;
    end if;
  end if;

  insert into public.whatsapp_inbound_jobs (
    company_id,
    message_id,
    wa_message_id,
    status
  ) values (
    p_company_id,
    v_message_id,
    v_wa_id,
    'pending'
  )
  on conflict (message_id) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select j.id into v_job_id
    from public.whatsapp_inbound_jobs as j
    where j.message_id = v_message_id;
  end if;

  if v_job_id is null then
    raise exception 'job_missing' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'reopened', v_reopened,
    'message_id', v_message_id,
    'conversation_id', v_conversation_id,
    'job_id', v_job_id,
    'job_status', (
      select j.status from public.whatsapp_inbound_jobs as j where j.id = v_job_id
    )
  );
end;
$$;

revoke all on function public.save_whatsapp_inbound(uuid, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
do $$
begin
  grant execute on function public.save_whatsapp_inbound(uuid, text, text, text, text, text, text, timestamptz)
    to service_role;
exception when undefined_object then null;
end;
$$;

-- VEL-LEADS-JOURNEY-01: lead stage / follow-up on conversations + company IANA timezone.
-- Does not modify ACCESS grants/matrix. Does not apply to cloud from this file alone.

-- ---------------------------------------------------------------------------
-- companies.timezone (IANA explicit; null => UTC announced in product)
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists timezone text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'companies_timezone_iana_chk'
      and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_timezone_iana_chk
      check (
        timezone is null
        or (
          char_length(btrim(timezone)) between 1 and 64
          and timezone = btrim(timezone)
          and timezone !~ '[[:space:]]'
        )
      );
  end if;
end;
$$;

comment on column public.companies.timezone is
  'Optional IANA timezone (e.g. Asia/Muscat). Null means calendar-day lists use UTC and UI must announce UTC. Never inferred from country.';

-- ---------------------------------------------------------------------------
-- Lead / follow-up columns on whatsapp_conversations
-- ---------------------------------------------------------------------------
alter table public.whatsapp_conversations
  add column if not exists lead_stage text not null default 'new',
  add column if not exists lead_stage_reason text not null default '',
  add column if not exists internal_note text not null default '',
  add column if not exists follow_up_status text not null default 'none',
  add column if not exists follow_up_at timestamptz,
  add column if not exists last_touch_at timestamptz,
  add column if not exists lead_revision integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_conversations_lead_stage_chk'
      and conrelid = 'public.whatsapp_conversations'::regclass
  ) then
    alter table public.whatsapp_conversations
      add constraint whatsapp_conversations_lead_stage_chk
      check (
        lead_stage in (
          'new',
          'exploring',
          'interested',
          'trial_or_quote_requested',
          'follow_up',
          'closed_no_subscribe'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_conversations_follow_up_status_chk'
      and conrelid = 'public.whatsapp_conversations'::regclass
  ) then
    alter table public.whatsapp_conversations
      add constraint whatsapp_conversations_follow_up_status_chk
      check (follow_up_status in ('none', 'scheduled', 'completed', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_conversations_follow_up_active_chk'
      and conrelid = 'public.whatsapp_conversations'::regclass
  ) then
    alter table public.whatsapp_conversations
      add constraint whatsapp_conversations_follow_up_active_chk
      check (
        (follow_up_status = 'scheduled' and follow_up_at is not null)
        or (follow_up_status = 'none' and follow_up_at is null)
        or (follow_up_status in ('completed', 'cancelled'))
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_conversations_lead_revision_chk'
      and conrelid = 'public.whatsapp_conversations'::regclass
  ) then
    alter table public.whatsapp_conversations
      add constraint whatsapp_conversations_lead_revision_chk
      check (lead_revision >= 1);
  end if;
end;
$$;

comment on column public.whatsapp_conversations.lead_stage is
  'Manual lead stage. subscribed is forbidden on the manual path (UI + RPC + check).';
comment on column public.whatsapp_conversations.follow_up_status is
  'Active follow-up only when scheduled with follow_up_at. completed/cancelled retain follow_up_at as history.';
comment on column public.whatsapp_conversations.last_touch_at is
  'Monotonic staff credited-touch watermark (message event time). Not used alone for awaiting-staff list.';
comment on column public.whatsapp_conversations.lead_revision is
  'Optimistic concurrency for lead fields only. Independent of control_revision.';

create index if not exists whatsapp_conversations_company_follow_up_idx
  on public.whatsapp_conversations (company_id, follow_up_status, follow_up_at)
  where follow_up_status = 'scheduled';

create index if not exists whatsapp_conversations_company_lead_stage_idx
  on public.whatsapp_conversations (company_id, lead_stage);

-- ---------------------------------------------------------------------------
-- Guard: lead columns only via RPC GUC (last_touch_at excluded for triggers)
-- ---------------------------------------------------------------------------
create or replace function private.whatsapp_conversations_guard_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(pg_catalog.current_setting('velora.conversation_lead', true), '') is distinct from '1'
  then
    if new.lead_stage is distinct from old.lead_stage
       or new.lead_stage_reason is distinct from old.lead_stage_reason
       or new.internal_note is distinct from old.internal_note
       or new.follow_up_status is distinct from old.follow_up_status
       or new.follow_up_at is distinct from old.follow_up_at
       or new.lead_revision is distinct from old.lead_revision
    then
      raise exception 'lead_columns_locked' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_conversations_guard_lead on public.whatsapp_conversations;
create trigger whatsapp_conversations_guard_lead
  before update on public.whatsapp_conversations
  for each row
  execute function private.whatsapp_conversations_guard_lead();

-- ---------------------------------------------------------------------------
-- last_touch_at: bump on credited staff delivery_state (message event time)
-- Does not rewrite send/claim/finalize; hook via message row changes only.
-- ---------------------------------------------------------------------------
create or replace function private.whatsapp_messages_bump_last_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_at timestamptz;
  v_new_credited boolean;
  v_old_credited boolean := false;
begin
  v_new_credited := new.sender = 'staff'
    and new.delivery_state in ('accepted', 'sent', 'delivered', 'read');

  if not v_new_credited then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_credited := old.sender = 'staff'
      and old.delivery_state in ('accepted', 'sent', 'delivered', 'read');
    -- Only first entry into the credited set bumps (failed later does not shrink).
    if v_old_credited then
      return new;
    end if;
  end if;

  -- Message event time — never wall-clock of this trigger/callback.
  v_event_at := coalesce(new.received_at, new.delivery_updated_at);
  if v_event_at is null then
    return new;
  end if;

  update public.whatsapp_conversations as c
  set last_touch_at = case
        when c.last_touch_at is null then v_event_at
        when v_event_at > c.last_touch_at then v_event_at
        else c.last_touch_at
      end
  where c.id = new.conversation_id
    and c.company_id = new.company_id;

  return new;
end;
$$;

drop trigger if exists whatsapp_messages_bump_last_touch on public.whatsapp_messages;
create trigger whatsapp_messages_bump_last_touch
  after insert or update of delivery_state, sender, received_at on public.whatsapp_messages
  for each row
  execute function private.whatsapp_messages_bump_last_touch();

-- ---------------------------------------------------------------------------
-- Manual lead RPC (read + reply). Never writes assigned_to / control_revision.
-- Rejects subscribed. Does not auto-change stage from follow-up scheduling.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_conversation_lead_state(
  p_conversation_id uuid,
  p_expected_revision integer,
  p_lead_stage text,
  p_lead_stage_reason text,
  p_internal_note text,
  p_follow_up_status text,
  p_follow_up_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_stage text := pg_catalog.btrim(coalesce(p_lead_stage, ''));
  v_reason text := coalesce(p_lead_stage_reason, '');
  v_note text := coalesce(p_internal_note, '');
  v_fu_status text := pg_catalog.btrim(coalesce(p_follow_up_status, ''));
  v_fu_at timestamptz := p_follow_up_at;
  v_conv public.whatsapp_conversations%rowtype;
  v_company public.companies%rowtype;
  v_updated public.whatsapp_conversations%rowtype;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_conversation_id is null or p_expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  -- Manual path hard-blocks subscribed (not only UI).
  if lower(v_stage) = 'subscribed' then
    return jsonb_build_object('ok', false, 'code', 'subscribed_forbidden');
  end if;

  if v_stage not in (
    'new', 'exploring', 'interested', 'trial_or_quote_requested', 'follow_up', 'closed_no_subscribe'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if v_fu_status not in ('none', 'scheduled', 'completed', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if char_length(v_reason) > 2000 or char_length(v_note) > 8000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if v_stage in ('trial_or_quote_requested', 'closed_no_subscribe')
     and pg_catalog.btrim(v_reason) = '' then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
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

  -- Capabilities + visibility in the same transaction as the write.
  if not public.has_company_capability(v_conv.company_id, 'wa.conversations.read') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if not public.has_company_capability(v_conv.company_id, 'wa.conversations.reply') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if not private.conversation_readable(v_conv.company_id, v_conv.assigned_to) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_conv.lead_revision is distinct from p_expected_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'conflict',
      'conversation', jsonb_build_object(
        'id', v_conv.id,
        'lead_stage', v_conv.lead_stage,
        'lead_stage_reason', v_conv.lead_stage_reason,
        'internal_note', v_conv.internal_note,
        'follow_up_status', v_conv.follow_up_status,
        'follow_up_at', v_conv.follow_up_at,
        'last_touch_at', v_conv.last_touch_at,
        'lead_revision', v_conv.lead_revision,
        'assigned_to', v_conv.assigned_to,
        'control_revision', v_conv.control_revision
      )
    );
  end if;

  if v_fu_status = 'none' then
    v_fu_at := null;
  elsif v_fu_status = 'scheduled' then
    if v_fu_at is null then
      return jsonb_build_object('ok', false, 'code', 'follow_up_at_required');
    end if;
  else
    -- completed / cancelled: retain historical timestamp
    v_fu_at := coalesce(v_fu_at, v_conv.follow_up_at);
  end if;

  perform pg_catalog.set_config('velora.conversation_lead', '1', true);

  update public.whatsapp_conversations as c
  set
    lead_stage = v_stage,
    lead_stage_reason = v_reason,
    internal_note = v_note,
    follow_up_status = v_fu_status,
    follow_up_at = v_fu_at,
    lead_revision = c.lead_revision + 1
  where c.id = v_conv.id
    and c.lead_revision = p_expected_revision
  returning * into v_updated;

  if not found then
    select * into v_conv from public.whatsapp_conversations where id = p_conversation_id;
    return jsonb_build_object(
      'ok', false,
      'code', 'conflict',
      'conversation', jsonb_build_object(
        'id', v_conv.id,
        'lead_stage', v_conv.lead_stage,
        'lead_stage_reason', v_conv.lead_stage_reason,
        'internal_note', v_conv.internal_note,
        'follow_up_status', v_conv.follow_up_status,
        'follow_up_at', v_conv.follow_up_at,
        'last_touch_at', v_conv.last_touch_at,
        'lead_revision', v_conv.lead_revision,
        'assigned_to', v_conv.assigned_to,
        'control_revision', v_conv.control_revision
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'conversation', jsonb_build_object(
      'id', v_updated.id,
      'lead_stage', v_updated.lead_stage,
      'lead_stage_reason', v_updated.lead_stage_reason,
      'internal_note', v_updated.internal_note,
      'follow_up_status', v_updated.follow_up_status,
      'follow_up_at', v_updated.follow_up_at,
      'last_touch_at', v_updated.last_touch_at,
      'lead_revision', v_updated.lead_revision,
      'assigned_to', v_updated.assigned_to,
      'control_revision', v_updated.control_revision
    )
  );
end;
$$;

revoke all on function public.upsert_conversation_lead_state(uuid, integer, text, text, text, text, timestamptz)
  from public, anon;
grant execute on function public.upsert_conversation_lead_state(uuid, integer, text, text, text, text, timestamptz)
  to authenticated;

comment on function public.upsert_conversation_lead_state(uuid, integer, text, text, text, text, timestamptz) is
  'VEL-LEADS-JOURNEY-01: atomic lead/follow-up update with read+reply + lead_revision. Never writes assigned_to.';

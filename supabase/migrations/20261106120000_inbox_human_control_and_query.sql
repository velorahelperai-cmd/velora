-- Human takeover is the latest take_over event, not every automation pause.
-- Resume refuses while an unknown send is unresolved. Staff sends require that takeover.
-- Search and assignment counts stay inside the existing inbox scope.

create or replace function private.whatsapp_human_controlled(p_company_id uuid, p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.whatsapp_conversations c
    where c.id = p_conversation_id
      and c.company_id = p_company_id
      and c.automation_allowed = false
      and c.status <> 'resolved'
      and (
        select e.action
        from public.whatsapp_conversation_events e
        where e.company_id = c.company_id
          and e.conversation_id = c.id
          and e.action in ('take_over', 'worker_escalation', 'resume')
        order by e.event_sequence desc
        limit 1
      ) = 'take_over'
  );
$$;

revoke all on function private.whatsapp_human_controlled(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.whatsapp_staff_send_gate(p_company_id uuid, p_conversation_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  conversation public.whatsapp_conversations%rowtype;
begin
  select * into conversation
  from public.whatsapp_conversations
  where id = p_conversation_id and company_id = p_company_id;
  if not found then
    return 'not_found';
  end if;
  if not private.whatsapp_human_controlled(p_company_id, p_conversation_id) then
    return 'human_control_required';
  end if;
  if exists (
    select 1 from public.whatsapp_send_intents
    where company_id = p_company_id and conversation_id = p_conversation_id and outcome = 'unknown'
  ) then
    return 'send_unknown';
  end if;
  return 'ok';
end;
$$;

revoke all on function private.whatsapp_staff_send_gate(uuid, uuid) from public, anon, authenticated, service_role;

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
    ) then 'delivery_failed' end
  ]::text[], null)));
$$;

revoke all on function private.whatsapp_inbox_intervention(uuid, uuid, boolean) from public, anon, authenticated, service_role;

comment on function private.whatsapp_inbox_intervention(uuid, uuid, boolean) is
  'p_human_control is retained for signature compatibility and is not an authority signal.';

create or replace function public.whatsapp_inbox_page(
  p_company_id uuid,
  p_limit integer default 50,
  p_before bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  scope text;
  items jsonb;
  more boolean;
  next_cursor bigint;
  total bigint;
  unread bigint;
  interventions bigint;
  unassigned bigint;
  mine bigint;
  fingerprint text;
begin
  scope := private.whatsapp_inbox_scope(p_company_id);
  if scope is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_before <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  with membership as materialized (
    select c
    from public.whatsapp_conversations c
    where c.company_id = p_company_id
      and private.billing_history_account_allowed(p_company_id, 'whatsapp', c.phone_number_id)
      and (scope = 'all_company' or c.assigned_to = auth.uid())
  ),
  eligible as (
    select c from membership
    where p_before is null or (c).inbox_sequence < p_before
    order by (c).inbox_sequence desc
    limit p_limit + 1
  ),
  page as (
    select c from eligible
    order by (c).inbox_sequence desc
    limit p_limit
  )
  select
    coalesce(jsonb_agg(private.whatsapp_inbox_conversation_public(c, auth.uid()) order by (c).inbox_sequence desc), '[]'::jsonb),
    (select count(*) > p_limit from eligible),
    min((c).inbox_sequence),
    (select count(*) from membership),
    (
      select count(*)
      from public.whatsapp_messages m
      join membership x on (x.c).id = m.conversation_id and (x.c).company_id = m.company_id
      left join private.whatsapp_inbox_read_markers r
        on r.company_id = m.company_id and r.conversation_id = m.conversation_id and r.user_id = auth.uid()
      where m.direction = 'inbound' and m.arrival_sequence > coalesce(r.last_read_sequence, 0)
    ),
    (
      select count(*)
      from membership x
      where jsonb_array_length(private.whatsapp_inbox_intervention((x.c).company_id, (x.c).id, false)->'reasons') > 0
    ),
    (select count(*) from membership x where (x.c).assigned_to is null),
    (select count(*) from membership x where (x.c).assigned_to = auth.uid()),
    (select pg_catalog.md5(coalesce(string_agg((x.c).id::text, ',' order by (x.c).id), '')) from membership x)
  into items, more, next_cursor, total, unread, interventions, unassigned, mine, fingerprint
  from page;
  return jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'conversation_scope', scope,
    'kind', 'partial',
    'ordering', 'newest_created',
    'conversations', items,
    'has_more', more,
    'next_cursor', case when more then next_cursor::text end,
    'total', total,
    'unread_total', unread,
    'intervention_total', interventions,
    'unassigned_total', unassigned,
    'mine_total', mine,
    'membership_fingerprint', fingerprint
  );
end;
$$;

create or replace function public.whatsapp_inbox_query(
  p_company_id uuid,
  p_limit integer default 40,
  p_before bigint default null,
  p_query text default null,
  p_assignment text default 'all',
  p_worklist text default 'all',
  p_stage text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  scope text;
  zone text;
  raw text;
  esc text;
  digits text;
  items jsonb;
  more boolean;
  next_cursor bigint;
  total bigint;
  unassigned bigint;
  mine bigint;
  worklists jsonb;
begin
  scope := private.whatsapp_inbox_scope(p_company_id);
  if scope is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_before <= 0
    or p_assignment not in ('all', 'unassigned', 'mine')
    or p_worklist not in ('all', 'unread', 'staff', 'noura', 'resolved', 'awaiting_staff', 'follow_up_today', 'overdue', 'trial_or_quote')
    or p_stage not in ('all', 'new', 'exploring', 'interested', 'trial_or_quote_requested', 'follow_up', 'closed_no_subscribe')
    or char_length(coalesce(p_query, '')) > 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  select case
    when timezone is not null and timezone ~ '^[A-Za-z0-9_+\-/]{1,64}$' then timezone
    else 'UTC'
  end into zone
  from public.companies where id = p_company_id;
  zone := coalesce(zone, 'UTC');
  begin
    perform clock_timestamp() at time zone zone;
  exception when others then
    zone := 'UTC';
  end;
  raw := btrim(coalesce(p_query, ''));
  esc := replace(replace(replace(raw, '\', '\\'), '%', '\%'), '_', '\_');
  digits := regexp_replace(raw, '[^0-9]', '', 'g');
  with membership as materialized (
    select c
    from public.whatsapp_conversations c
    where c.company_id = p_company_id
      and private.billing_history_account_allowed(p_company_id, 'whatsapp', c.phone_number_id)
      and (scope = 'all_company' or c.assigned_to = auth.uid())
  ),
  marked as (
    select
      c,
      (
        raw = ''
        or (c).customer_name ilike '%' || esc || '%' escape '\'
        or (digits <> '' and (c).customer_wa_id like '%' || digits || '%')
        or exists (
          select 1 from public.whatsapp_messages m
          where m.company_id = (c).company_id and m.conversation_id = (c).id
            and m.arrival_sequence = (
              select max(m2.arrival_sequence) from public.whatsapp_messages m2
              where m2.company_id = (c).company_id and m2.conversation_id = (c).id
            )
            and m.body ilike '%' || esc || '%' escape '\'
        )
      ) as query_match,
      (p_stage = 'all' or (c).lead_stage = p_stage) as stage_match,
      (
        select count(*)
        from public.whatsapp_messages m
        left join private.whatsapp_inbox_read_markers r
          on r.company_id = m.company_id and r.conversation_id = m.conversation_id and r.user_id = auth.uid()
        where m.company_id = (c).company_id and m.conversation_id = (c).id
          and m.direction = 'inbound' and m.arrival_sequence > coalesce(r.last_read_sequence, 0)
      ) as unread_count,
      ((c).status <> 'resolved' and (c).automation_allowed) as noura_match,
      ((c).status = 'resolved') as resolved_match,
      ((c).lead_stage = 'trial_or_quote_requested') as trial_match,
      ((c).follow_up_status = 'scheduled' and (c).follow_up_at is not null and (c).follow_up_at < clock_timestamp()) as overdue_match,
      (
        (c).follow_up_status = 'scheduled' and (c).follow_up_at is not null
        and ((c).follow_up_at at time zone zone)::date = (clock_timestamp() at time zone zone)::date
      ) as today_match,
      (
        (c).status <> 'resolved'
        and exists (
          select 1 from public.whatsapp_messages inbound
          where inbound.company_id = (c).company_id and inbound.conversation_id = (c).id and inbound.direction = 'inbound'
            and inbound.received_at > coalesce((
              select max(staff.received_at)
              from public.whatsapp_messages staff
              where staff.company_id = (c).company_id and staff.conversation_id = (c).id
                and staff.direction = 'outbound' and staff.sender = 'staff'
                and staff.delivery_state in ('accepted', 'sent', 'delivered', 'read')
            ), '-infinity'::timestamptz)
        )
      ) as awaiting_match,
      (jsonb_array_length(private.whatsapp_inbox_intervention((c).company_id, (c).id, false)->'reasons') > 0) as review_match
    from membership
  ),
  base as (
    select * from marked where query_match and stage_match
  ),
  listed as (
    select *
    from base
    where case p_worklist
      when 'all' then true
      when 'unread' then unread_count > 0
      when 'staff' then review_match
      when 'noura' then noura_match
      when 'resolved' then resolved_match
      when 'awaiting_staff' then awaiting_match
      when 'follow_up_today' then today_match
      when 'overdue' then overdue_match
      when 'trial_or_quote' then trial_match
      else false
    end
    and case p_assignment
      when 'unassigned' then (c).assigned_to is null
      when 'mine' then (c).assigned_to = auth.uid()
      else true
    end
  ),
  eligible as (
    select * from listed
    where p_before is null or (c).inbox_sequence < p_before
    order by (c).inbox_sequence desc
    limit p_limit + 1
  ),
  page as (
    select * from eligible
    order by (c).inbox_sequence desc
    limit p_limit
  )
  select
    coalesce((select jsonb_agg(private.whatsapp_inbox_conversation_public(c, auth.uid()) order by (c).inbox_sequence desc) from page), '[]'::jsonb),
    coalesce((select count(*) > p_limit from eligible), false),
    (select min((c).inbox_sequence) from page),
    coalesce((select count(*) from listed), 0),
    (select count(*) from base where (c).assigned_to is null and case p_worklist
      when 'all' then true when 'unread' then unread_count > 0 when 'staff' then review_match
      when 'noura' then noura_match when 'resolved' then resolved_match when 'awaiting_staff' then awaiting_match
      when 'follow_up_today' then today_match when 'overdue' then overdue_match when 'trial_or_quote' then trial_match
      else false end),
    (select count(*) from base where (c).assigned_to = auth.uid() and case p_worklist
      when 'all' then true when 'unread' then unread_count > 0 when 'staff' then review_match
      when 'noura' then noura_match when 'resolved' then resolved_match when 'awaiting_staff' then awaiting_match
      when 'follow_up_today' then today_match when 'overdue' then overdue_match when 'trial_or_quote' then trial_match
      else false end),
    (
      select jsonb_build_object(
        'all', count(*),
        'unread', count(*) filter (where unread_count > 0),
        'staff', count(*) filter (where review_match),
        'noura', count(*) filter (where noura_match),
        'resolved', count(*) filter (where resolved_match),
        'awaiting_staff', count(*) filter (where awaiting_match),
        'follow_up_today', count(*) filter (where today_match),
        'overdue', count(*) filter (where overdue_match),
        'trial_or_quote', count(*) filter (where trial_match)
      )
      from base
    )
  into items, more, next_cursor, total, unassigned, mine, worklists
  from (select 1) as inbox_query_seed;
  unassigned := coalesce(unassigned, 0);
  mine := coalesce(mine, 0);
  worklists := coalesce(worklists, '{}'::jsonb);
  return jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'conversation_scope', scope,
    'kind', 'partial',
    'ordering', 'newest_created',
    'conversations', items,
    'has_more', more,
    'next_cursor', case when more then next_cursor::text end,
    'total', total,
    'unassigned_total', unassigned,
    'mine_total', mine,
    'worklists', worklists
  );
end;
$$;

revoke all on function public.whatsapp_inbox_query(uuid, integer, bigint, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_inbox_query(uuid, integer, bigint, text, text, text, text) to authenticated;

do $$
declare
  definition text;
  newline text := E'\n';
  anchor text;
  insertion text;
begin
  definition := pg_get_functiondef('public.create_whatsapp_send_intent(text,uuid,text,text,text,integer,uuid,bigint)'::regprocedure);
  if position('whatsapp_staff_send_gate' in definition) > 0 then
    return;
  end if;
  if position(E'\r\n' in definition) > 0 then
    newline := E'\r\n';
  end if;
  anchor := 'if not private.conversation_readable(v_conv.company_id, v_conv.assigned_to) then' || newline ||
    '    return jsonb_build_object(''ok'', false, ''code'', ''forbidden'');' || newline ||
    '  end if;';
  insertion := anchor || newline ||
    '  if private.whatsapp_staff_send_gate(v_conv.company_id, v_conv.id) is distinct from ''ok'' then' || newline ||
    '    return jsonb_build_object(''ok'', false, ''code'', private.whatsapp_staff_send_gate(v_conv.company_id, v_conv.id));' || newline ||
    '  end if;';
  if position(anchor in definition) = 0 then
    raise exception 'INBOX_SEND_GATE_ANCHOR_MISSING';
  end if;
  execute replace(definition, anchor, insertion);
end;
$$;

do $$
declare
  definition text;
  newline text := E'\n';
  anchor text;
  insertion text;
begin
  definition := pg_get_functiondef('public.control_whatsapp_conversation(uuid,text,integer,uuid)'::regprocedure);
  if position('review_blocked' in definition) > 0 then
    return;
  end if;
  if position(E'\r\n' in definition) > 0 then
    newline := E'\r\n';
  end if;
  anchor := 'if v_action = ''resume'' then' || newline || '    update public.whatsapp_conversations as c';
  insertion := 'if v_action = ''resume'' then' || newline ||
    '    if exists (select 1 from public.whatsapp_send_intents i where i.company_id = v_conv.company_id and i.conversation_id = v_conv.id and i.outcome = ''unknown'') then' || newline ||
    '      return jsonb_build_object(''ok'', false, ''code'', ''review_blocked'');' || newline ||
    '    end if;' || newline ||
    '    update public.whatsapp_conversations as c';
  if position(anchor in definition) = 0 then
    raise exception 'INBOX_RESUME_GUARD_ANCHOR_MISSING';
  end if;
  execute replace(definition, anchor, insertion);
end;
$$;

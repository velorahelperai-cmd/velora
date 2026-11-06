-- Let the live inbound selector claim an unclaimed handoff for a safe answer.
-- handed_over / worker_escalation is not a staff claim. CLAIMED_ACTIVE and
-- CLAIMED_IDLE stay excluded. Generation fences, service-window checks, and
-- send-intent tokens are unchanged. This does not send and does not enable a flag.

create or replace function private.whatsapp_continuity_ai_claimable(p public.whatsapp_conversations)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id is not null
    and p.status is distinct from 'resolved'
    and p.human_ownership is distinct from 'claimed_active'
    and p.human_ownership is distinct from 'claimed_idle'
    and p.human_ownership is distinct from 'resolved'
    and not exists (
      select 1
      from public.whatsapp_conversation_events e
      where e.company_id = p.company_id
        and e.conversation_id = p.id
        and e.action in ('take_over', 'human_claimed', 'resume', 'human_released', 'worker_escalation', 'handoff_requested', 'close')
        and e.event_sequence = (
          select max(newer.event_sequence)
          from public.whatsapp_conversation_events newer
          where newer.company_id = p.company_id
            and newer.conversation_id = p.id
            and newer.action in ('take_over', 'human_claimed', 'resume', 'human_released', 'worker_escalation', 'handoff_requested', 'close')
        )
        and (
          e.action in ('human_claimed', 'close')
          or (
            e.action = 'take_over'
            and coalesce(e.detail->>'reason', '') is distinct from 'coexistence_signup_ai_disabled'
          )
        )
    )
    and (
      (p.status = 'open' and p.automation_allowed)
      or p.human_ownership = 'requested_unclaimed'
      or (
        p.status = 'handed_over'
        and coalesce(p.human_ownership, 'requested_unclaimed') in ('requested_unclaimed', 'none')
      )
    );
$$;

revoke all on function private.whatsapp_continuity_ai_claimable(public.whatsapp_conversations) from public, anon, authenticated, service_role;

comment on function private.whatsapp_continuity_ai_claimable(public.whatsapp_conversations) is
  'Batch and lock predicate. Open automation stays eligible. Unclaimed handoff is eligible. A staff claim is not.';

do $patch$
declare
  fn record;
  body text;
  occurrences integer;
  patched integer;
  targets oid[];
  target oid;
  item record;
begin
  for item in select * from (values
    ('c.status=''open'' and c.automation_allowed', 'private.whatsapp_continuity_ai_claimable(c)', 1),
    ('c.status<>''open'' or not c.automation_allowed', 'not private.whatsapp_continuity_ai_claimable(c)', 1),
    ('v_conv.automation_allowed is not true', 'not private.whatsapp_continuity_ai_claimable(v_conv)', 1)
  ) as replacements(old_expr, new_expr, minimum) loop
    select coalesce(array_agg(p.oid), '{}'::oid[]) into targets
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and position(item.old_expr in pg_get_functiondef(p.oid)) > 0;
    patched := 0;
    foreach target in array targets loop
      select n.nspname, p.proname into fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.oid = target;
      body := pg_get_functiondef(target);
      occurrences := (length(body) - length(replace(body, item.old_expr, ''))) / length(item.old_expr);
      if occurrences <> 1 then
        raise exception 'WA_CONTINUITY_CLAIM_SOURCE_DRIFT %.% count %', fn.nspname, fn.proname, occurrences;
      end if;
      execute replace(body, item.old_expr, item.new_expr);
      patched := patched + 1;
    end loop;
    if patched < item.minimum then
      raise exception 'WA_CONTINUITY_CLAIM_SOURCE_MISSING %', item.old_expr;
    end if;
  end loop;
end
$patch$;

alter function public.billing_load_worker_frame(uuid, uuid) set schema private;
alter function private.billing_load_worker_frame(uuid, uuid) rename to continuity_pre_load_worker_frame;
revoke all on function private.continuity_pre_load_worker_frame(uuid, uuid) from public, anon, authenticated, service_role;

create function public.billing_load_worker_frame(p_job_id uuid, p_claim_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  loaded jsonb;
  conv public.whatsapp_conversations%rowtype;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'SERVER_ROLE_REQUIRED' using errcode = '42501';
  end if;
  loaded := private.continuity_pre_load_worker_frame(p_job_id, p_claim_token);
  if loaded->>'ok' is distinct from 'true' or jsonb_typeof(loaded->'data') is distinct from 'object' then
    return loaded;
  end if;
  select c.* into conv
  from public.whatsapp_conversations c
  where c.id = (loaded->'data'->>'conversation_id')::uuid
    and c.company_id = (loaded->'data'->>'company_id')::uuid;
  if conv.id is null or not private.whatsapp_continuity_ai_claimable(conv) then
    return jsonb_build_object('ok', false, 'code', 'claim_or_automation_rejected');
  end if;
  return jsonb_set(
    loaded,
    '{data}',
    (loaded->'data') || jsonb_build_object(
      'human_ownership', conv.human_ownership,
      'handoff_reason', conv.handoff_reason,
      'conversation_status', conv.status
    )
  );
end;
$$;

alter function public.billing_load_worker_frame(uuid, uuid) owner to postgres;
revoke all on function public.billing_load_worker_frame(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.billing_load_worker_frame(uuid, uuid) to service_role;

comment on function public.billing_load_worker_frame(uuid, uuid) is
  'Existing frame plus ownership snapshot. A staff claim still returns claim_or_automation_rejected. A closed service window is still rejected by the wrapped gate.';

-- Restores the previous intervention meaning and removes the query/send/resume guards.
-- Does not delete conversations, messages, events, or send intents.

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
    case when p_human_control then 'human_control' end,
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

do $$
declare
  definition text;
  added text;
begin
  definition := pg_get_functiondef('public.create_whatsapp_send_intent(text,uuid,text,text,text,integer,uuid,bigint)'::regprocedure);
  added := E'\n  if private.whatsapp_staff_send_gate(v_conv.company_id, v_conv.id) is distinct from ''ok'' then\n    return jsonb_build_object(''ok'', false, ''code'', private.whatsapp_staff_send_gate(v_conv.company_id, v_conv.id));\n  end if;';
  if position(added in definition) > 0 then
    execute replace(definition, added, '');
  end if;
  definition := pg_get_functiondef('public.control_whatsapp_conversation(uuid,text,integer,uuid)'::regprocedure);
  added := E'\n    if exists (select 1 from public.whatsapp_send_intents i where i.company_id = v_conv.company_id and i.conversation_id = v_conv.id and i.outcome = ''unknown'') then\n      return jsonb_build_object(''ok'', false, ''code'', ''review_blocked'');\n    end if;';
  if position(added in definition) > 0 then
    execute replace(definition, added, '');
  end if;
end;
$$;

drop function if exists public.whatsapp_inbox_query(uuid, integer, bigint, text, text, text, text);
drop function if exists private.whatsapp_staff_send_gate(uuid, uuid);
drop function if exists private.whatsapp_human_controlled(uuid, uuid);

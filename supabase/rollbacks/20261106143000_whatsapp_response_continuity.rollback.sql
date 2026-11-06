-- Removes the continuity cache, policies, and intent ledger.
-- Does not delete conversations, messages, send intents, or control events.
-- The widened event-action check stays so human_claimed / handoff_requested /
-- human_released rows remain valid.

drop trigger if exists whatsapp_apply_human_ownership on public.whatsapp_conversation_events;
drop function if exists private.whatsapp_apply_human_ownership();
drop trigger if exists whatsapp_conversations_guard_human_ownership on public.whatsapp_conversations;
drop function if exists private.whatsapp_conversations_guard_human_ownership();

drop function if exists public.whatsapp_record_human_claim(uuid, integer);
drop function if exists public.whatsapp_continuity_snapshot(uuid, uuid);
drop function if exists public.whatsapp_reserve_response_intent(uuid, text, text, text, uuid, text, integer);
drop function if exists public.whatsapp_claim_continuity_watchdog(integer);

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

drop table if exists public.whatsapp_response_intents;
drop table if exists public.whatsapp_continuity_policies;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_human_ownership_chk,
  drop column if exists human_ownership,
  drop column if exists handoff_reason,
  drop column if exists handoff_requested_at,
  drop column if exists human_claimed_by,
  drop column if exists human_claimed_at,
  drop column if exists last_staff_reply_at;

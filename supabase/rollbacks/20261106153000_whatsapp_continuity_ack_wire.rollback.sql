-- Removes the ack note/authorize/finalize functions and the inbox SLA wrapper.
-- Does not delete conversations, messages, jobs, or events.

drop function if exists private.whatsapp_inbox_conversation_public(public.whatsapp_conversations, uuid);
alter function private.continuity_pre_inbox_conversation_public(public.whatsapp_conversations, uuid)
  rename to whatsapp_inbox_conversation_public;
revoke all on function private.whatsapp_inbox_conversation_public(public.whatsapp_conversations, uuid) from public, anon, authenticated, service_role;

drop function if exists private.whatsapp_continuity_sla(public.whatsapp_conversations);
drop function if exists public.whatsapp_note_continuity(uuid, uuid, text);
drop function if exists public.whatsapp_authorize_continuity_ack(uuid, uuid);
drop function if exists public.whatsapp_finalize_continuity_ack(uuid, uuid, text, text);

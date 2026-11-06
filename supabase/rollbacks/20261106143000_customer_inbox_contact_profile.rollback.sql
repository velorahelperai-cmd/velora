-- Removes the conversation contact profile added for the inbox customer column.
-- Does not delete conversations, messages, tags, notes, or assignments.

begin;

revoke all on function public.customer_inbox_contact(uuid, text, uuid, text, text, text)
  from public, anon, authenticated, service_role;
drop function if exists public.customer_inbox_contact(uuid, text, uuid, text, text, text);
drop table if exists private.customer_inbox_contacts;

commit;

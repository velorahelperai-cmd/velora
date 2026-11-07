-- Customer email and location for the conversation workspace.
-- Bound with the same company/conversation authority as inbox extensions.
-- Does not change WhatsApp identity, messages, or assignment.

begin;

create table private.customer_inbox_contacts (
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'instagram')),
  conversation_id uuid not null,
  binding jsonb not null,
  email text not null default '',
  location text not null default '',
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  primary key (company_id, channel, conversation_id, binding),
  constraint customer_inbox_contacts_email_len check (char_length(email) <= 254),
  constraint customer_inbox_contacts_location_len check (char_length(location) <= 120)
);

alter table private.customer_inbox_contacts enable row level security;
revoke all on table private.customer_inbox_contacts from public, anon, authenticated, service_role;

create function public.customer_inbox_contact(
  p_company_id uuid,
  p_channel text,
  p_conversation_id uuid,
  p_action text,
  p_email text default null,
  p_location text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  binding_key jsonb;
  actor uuid := auth.uid();
  stored_email text;
  stored_location text;
  next_email text;
  next_location text;
begin
  if p_channel not in ('whatsapp', 'instagram') or p_action not in ('read', 'save') then
    raise invalid_parameter_value;
  end if;
  binding_key := private.customer_inbox_extension_binding(p_company_id, p_conversation_id, p_channel);
  if binding_key is null then
    raise insufficient_privilege;
  end if;
  select c.email, c.location into stored_email, stored_location
  from private.customer_inbox_contacts c
  where c.company_id = p_company_id and c.channel = p_channel
    and c.conversation_id = p_conversation_id and c.binding = binding_key;
  if not found then
    stored_email := '';
    stored_location := '';
  end if;
  if p_action = 'read' then
    if private.customer_inbox_extension_binding(p_company_id, p_conversation_id, p_channel) is distinct from binding_key then
      raise insufficient_privilege;
    end if;
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('email', stored_email, 'location', stored_location));
  end if;
  if not coalesce(public.has_company_capability(
    p_company_id,
    case when p_channel = 'instagram' then 'ig.conversations.reply' else 'wa.conversations.reply' end
  ), false) then
    raise insufficient_privilege;
  end if;
  next_email := btrim(coalesce(p_email, ''));
  next_location := btrim(coalesce(p_location, ''));
  if char_length(next_email) > 254 or char_length(next_location) > 120
     or position(chr(0) in next_email) > 0 or position(chr(0) in next_location) > 0
     or (next_email <> '' and next_email !~ '^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$')
  then
    raise invalid_parameter_value;
  end if;
  if next_email = '' and next_location = '' then
    delete from private.customer_inbox_contacts c
    where c.company_id = p_company_id and c.channel = p_channel
      and c.conversation_id = p_conversation_id and c.binding = binding_key;
  else
    insert into private.customer_inbox_contacts
      (company_id, channel, conversation_id, binding, email, location, updated_by)
    values (p_company_id, p_channel, p_conversation_id, binding_key, next_email, next_location, actor)
    on conflict (company_id, channel, conversation_id, binding)
    do update set email = excluded.email, location = excluded.location,
      updated_at = clock_timestamp(), updated_by = excluded.updated_by;
  end if;
  if private.customer_inbox_extension_binding(p_company_id, p_conversation_id, p_channel) is distinct from binding_key then
    raise insufficient_privilege;
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('email', next_email, 'location', next_location));
exception
  when insufficient_privilege then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  when invalid_parameter_value then return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  when lock_not_available then return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

revoke all on function public.customer_inbox_contact(uuid, text, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.customer_inbox_contact(uuid, text, uuid, text, text, text) to authenticated;

commit;

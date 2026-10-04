alter table public.whatsapp_messages
  add column if not exists direction text not null default 'inbound',
  add column if not exists sender text not null default 'customer';

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_direction_check;

alter table public.whatsapp_messages
  add constraint whatsapp_messages_direction_check
  check (direction in ('inbound', 'outbound'));

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_sender_check;

alter table public.whatsapp_messages
  add constraint whatsapp_messages_sender_check
  check (sender in ('customer', 'staff', 'assistant'));

create index if not exists whatsapp_messages_company_direction_idx
  on public.whatsapp_messages (company_id, direction, received_at desc);

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  phone_number_id text not null,
  customer_wa_id text not null,
  customer_name text not null default '',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (company_id, phone_number_id, customer_wa_id)
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations (id) on delete cascade,
  wa_message_id text not null,
  body text not null,
  message_type text not null default 'text',
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (wa_message_id)
);

create table public.whatsapp_delivery_statuses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  phone_number_id text not null,
  wa_message_id text not null,
  status text not null,
  recipient_wa_id text not null default '',
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (wa_message_id, status, occurred_at)
);

create index whatsapp_messages_conversation_idx
  on public.whatsapp_messages (conversation_id, received_at);

create index whatsapp_conversations_company_idx
  on public.whatsapp_conversations (company_id, last_message_at desc);

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_delivery_statuses enable row level security;

create policy whatsapp_conversations_select
  on public.whatsapp_conversations
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or private.is_active_company_member(company_id)
  );

create policy whatsapp_messages_select
  on public.whatsapp_messages
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or private.is_active_company_member(company_id)
  );

create policy whatsapp_delivery_statuses_select
  on public.whatsapp_delivery_statuses
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or private.is_active_company_member(company_id)
  );

revoke all on public.whatsapp_conversations from anon;
revoke all on public.whatsapp_messages from anon;
revoke all on public.whatsapp_delivery_statuses from anon;
grant select on public.whatsapp_conversations to authenticated;
grant select on public.whatsapp_messages to authenticated;
grant select on public.whatsapp_delivery_statuses to authenticated;

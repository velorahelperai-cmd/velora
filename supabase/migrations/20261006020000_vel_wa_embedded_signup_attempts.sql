-- VEL next-gaps: durable Embedded Signup attempts (user+company+session).
-- Depends on companies + company_members. Independent of 20261005160000.
-- Apply after 20261006010000. Do not apply in this package. No OAuth codes stored.

create table if not exists public.whatsapp_embedded_signup_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null,
  nonce text not null,
  keep_on_phone boolean not null default false,
  status text not null default 'in_progress',
  created_at timestamptz not null default now(),
  consumed_at timestamptz null,
  constraint whatsapp_es_attempts_nonce_uid unique (nonce),
  constraint whatsapp_es_attempts_status_chk
    check (status in ('in_progress', 'cancelled', 'failed', 'code_received')),
  constraint whatsapp_es_attempts_nonce_len
    check (char_length(nonce) >= 16 and char_length(nonce) <= 200)
);

comment on table public.whatsapp_embedded_signup_attempts is
  'Server-owned Embedded Signup attempts. Window IDs/codes are not stored and are not proof of ownership.';

create index if not exists whatsapp_es_attempts_company_user_idx
  on public.whatsapp_embedded_signup_attempts (company_id, user_id, created_at desc);

alter table public.whatsapp_embedded_signup_attempts enable row level security;

revoke all on table public.whatsapp_embedded_signup_attempts from public, anon, authenticated;

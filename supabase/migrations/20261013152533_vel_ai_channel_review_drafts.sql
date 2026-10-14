-- Administrative trials only. No provider invocation, send intent, policy or budget activation.
begin;
create table public.ai_channel_review_drafts (
 execution_id uuid primary key,
 company_id uuid not null references public.companies(id),
 actor_id uuid not null references auth.users(id),
 channel text not null check(channel in ('whatsapp','instagram')),
 conversation_id uuid not null,
 message_id uuid not null,
 binding text not null check(length(binding) between 1 and 1024),
 status text not null default 'generating' check(status in ('generating','ready','failed')),
 response_text text,
 citations jsonb not null default '[]'::jsonb check(jsonb_typeof(citations)='array'),
 error_code text,
 created_at timestamptz not null default clock_timestamp(),
 check((status='ready') = (response_text is not null)),
 check(response_text is null or (length(btrim(response_text))>0 and
  case channel when 'instagram' then octet_length(response_text)<=1000 else length(response_text)<=4096 end)),
 unique(company_id,actor_id,channel,conversation_id,message_id)
);
create index ai_channel_review_drafts_lookup on public.ai_channel_review_drafts(company_id,actor_id,channel,conversation_id,created_at desc);
alter table public.ai_channel_review_drafts enable row level security;
revoke all on public.ai_channel_review_drafts from public,anon,authenticated;
grant select,insert,update on public.ai_channel_review_drafts to service_role;
comment on table public.ai_channel_review_drafts is 'Server-only owner trials, shared 1 OMR lifetime ledger. Durable one-request-per-inbound claims; no automatic retries or sends. Native inbox authorization is checked before reads and before returning a generated draft.';
commit;

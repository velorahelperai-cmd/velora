-- Durable verified Instagram evidence only. No sender, provider call, queue or UI.
-- Additive namespace; reviewed connection schema/ports/default ACLs unchanged.
begin;
create table private.instagram_conversations (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
 account_id text not null,counterparty_id text not null,
 message_count bigint not null default 0 check(message_count>=0),last_received_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),unique(company_id,account_id,counterparty_id)
);
create table private.instagram_messages (
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references private.instagram_conversations(id) on delete cascade,
 company_id uuid not null references public.companies(id) on delete cascade,
 link_id uuid not null references private.instagram_company_links(id),generation bigint not null,
 account_id text not null,provider_mid text not null,mid_hash text not null,
 sender_id text not null,recipient_id text not null,direction text not null check(direction in ('inbound','outbound')),
 is_echo boolean,content_kind text not null check(content_kind in ('text','non_text')),content_text text,
 raw_timestamp jsonb,raw_entry_timestamp jsonb,raw_body_sha256 text not null,
 received_at timestamptz not null default clock_timestamp(),ingress_reported_at timestamptz not null,
 read_observed_at timestamptz,unique(account_id,mid_hash),
 check((content_kind='text' and char_length(content_text)>0) or (content_kind='non_text' and content_text is null))
);
create index instagram_messages_conversation on private.instagram_messages(conversation_id,received_at,id);
create table private.instagram_webhook_receipts (
 id uuid primary key default gen_random_uuid(),account_id text not null,provider_mid text not null,mid_hash text not null,
 sender_id text not null,recipient_id text not null,
 -- NULL until exact historical outbound message/party identity proves attribution.
 message_id uuid references private.instagram_messages(id) on delete cascade,
 company_id uuid references public.companies(id) on delete cascade,link_id uuid references private.instagram_company_links(id),
 raw_timestamp jsonb,raw_entry_timestamp jsonb,raw_body_sha256 text not null,
 received_at timestamptz not null default clock_timestamp(),ingress_reported_at timestamptz not null,
 unique(account_id,mid_hash,sender_id,recipient_id),
 check((message_id is null and company_id is null and link_id is null) or (message_id is not null and company_id is not null and link_id is not null))
);
create table private.instagram_webhook_quarantine (
 fingerprint text primary key,event_kind text not null,reason text not null check(reason in ('NO_ACTIVE_BINDING','INACTIVE_BINDING','ACCOUNT_HISTORY_AMBIGUOUS','MESSAGE_ID_CONFLICT')),
 account_hash text not null,sender_hash text not null,recipient_hash text not null,message_hash text not null,
 raw_body_sha256 text not null,created_at timestamptz not null default clock_timestamp()
);
alter table private.instagram_conversations enable row level security;
alter table private.instagram_messages enable row level security;
alter table private.instagram_webhook_receipts enable row level security;
alter table private.instagram_webhook_quarantine enable row level security;
revoke all on private.instagram_conversations,private.instagram_messages,private.instagram_webhook_receipts,private.instagram_webhook_quarantine from public,anon,authenticated,service_role;

create function private.instagram_webhook_event_valid(e jsonb) returns boolean
language plpgsql immutable set search_path='' as $$declare k text;begin
 if jsonb_typeof(e) is distinct from 'object' then return false;end if;
 if exists(select 1 from jsonb_object_keys(e) x where x not in ('kind','professionalAccountId','senderId','recipientId','messageId','rawTimestamp','rawEntryTimestamp','direction','isEcho','content')) then return false;end if;
 foreach k in array array['professionalAccountId','senderId','recipientId'] loop
  if jsonb_typeof(e->k) is distinct from 'string' or (e->>k) !~ '^[0-9]{1,64}$' then return false;end if;
 end loop;
 if (e->>'senderId'=e->>'professionalAccountId')=(e->>'recipientId'=e->>'professionalAccountId') then return false;end if;
 if jsonb_typeof(e->'messageId') is distinct from 'string' or char_length(e->>'messageId')=0 or (e->>'messageId') ~ '[[:space:][:cntrl:]]' then return false;end if;
 foreach k in array array['rawTimestamp','rawEntryTimestamp'] loop
  if e ? k and jsonb_typeof(e->k) not in ('string','number','null') then return false;end if;
 end loop;
 if e->>'kind'='read' then return not (e ?| array['direction','isEcho','content']);end if;
 if e->>'kind' is distinct from 'message' or jsonb_typeof(e->'isEcho') not in ('boolean','null') or not(e ? 'isEcho') then return false;end if;
 if e->>'direction' is distinct from (case when e->>'recipientId'=e->>'professionalAccountId' then 'inbound' else 'outbound' end) then return false;end if;
 if e->>'isEcho'='true' and e->>'direction'<>'outbound' then return false;end if;
 if jsonb_typeof(e->'content') is distinct from 'object' then return false;end if;
 if e->'content'->>'kind'='non_text' then return (select count(*)=1 from jsonb_object_keys(e->'content'));end if;
 return coalesce(e->'content'->>'kind'='text' and jsonb_typeof(e->'content'->'text')='string' and char_length(e->'content'->>'text')>0
 and (select count(*)=2 from jsonb_object_keys(e->'content')),false);
end;$$;
create function private.instagram_webhook_quarantine_event(e jsonb,reason text,body_hash text) returns void
language sql volatile set search_path='' as $$
 insert into private.instagram_webhook_quarantine(fingerprint,event_kind,reason,account_hash,sender_hash,recipient_hash,message_hash,raw_body_sha256)
 values(encode(sha256(convert_to(jsonb_build_array(reason,e->>'kind',e->>'professionalAccountId',e->>'senderId',e->>'recipientId',e->>'messageId')::text,'UTF8')),'hex'),e->>'kind',reason,
 encode(sha256(convert_to(e->>'professionalAccountId','UTF8')),'hex'),encode(sha256(convert_to(e->>'senderId','UTF8')),'hex'),encode(sha256(convert_to(e->>'recipientId','UTF8')),'hex'),encode(sha256(convert_to(e->>'messageId','UTF8')),'hex'),body_hash)
 on conflict(fingerprint) do nothing
$$;

create function public.instagram_ingest_webhook(p_batch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb;account text;mid_digest text;counterparty text;body_hash text;reported timestamptz;
 l private.instagram_company_links%rowtype;m private.instagram_messages%rowtype;
 conversation uuid;receipt uuid;generation bigint;required text[];company_active boolean;valid_link boolean;used_deadline timestamptz;
begin
 if current_setting('role',true) is distinct from 'service_role' then return jsonb_build_object('status','retryable');end if;
 if jsonb_typeof(p_batch) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_batch))<>3
 or jsonb_typeof(p_batch->'events') is distinct from 'array' or jsonb_typeof(p_batch->'rawBodySha256') is distinct from 'string'
 or (p_batch->>'rawBodySha256') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_batch->'localReceivedAt') is distinct from 'string'
 or exists(select 1 from jsonb_array_elements(p_batch->'events') x where not private.instagram_webhook_event_valid(x)) then return jsonb_build_object('status','retryable');end if;
 body_hash:=p_batch->>'rawBodySha256';reported:=(p_batch->>'localReceivedAt')::timestamptz;
 if reported is null or not isfinite(reported) then return jsonb_build_object('status','retryable');end if;
 -- Exact same account lock as reviewed finalize; sorted accounts avoid batch inversion.
 for account in select distinct x->>'professionalAccountId' from jsonb_array_elements(p_batch->'events') x order by 1 loop
  perform pg_advisory_xact_lock(87420106,hashtext(account));
 end loop;
 for e in select x from jsonb_array_elements(p_batch->'events') x loop
  account:=e->>'professionalAccountId';mid_digest:=encode(sha256(convert_to(e->>'messageId','UTF8')),'hex');
  select * into m from private.instagram_messages where account_id=account and instagram_messages.mid_hash=mid_digest;
  if e->>'kind'='read' then
   -- Never route by current company/link. Only exact historical outbound evidence.
   valid_link:=found and m.provider_mid=e->>'messageId' and m.direction='outbound' and m.sender_id=e->>'recipientId' and m.recipient_id=e->>'senderId';
   insert into private.instagram_webhook_receipts(account_id,provider_mid,mid_hash,sender_id,recipient_id,message_id,company_id,link_id,raw_timestamp,raw_entry_timestamp,raw_body_sha256,ingress_reported_at)
   values(account,e->>'messageId',mid_digest,e->>'senderId',e->>'recipientId',case when valid_link then m.id end,case when valid_link then m.company_id end,case when valid_link then m.link_id end,e->'rawTimestamp',e->'rawEntryTimestamp',body_hash,reported)
   on conflict(account_id,mid_hash,sender_id,recipient_id) do nothing returning id into receipt;
   if valid_link then
    update private.instagram_webhook_receipts set message_id=m.id,company_id=m.company_id,link_id=m.link_id where account_id=account and instagram_webhook_receipts.mid_hash=mid_digest and provider_mid=e->>'messageId' and sender_id=m.recipient_id and recipient_id=m.sender_id and message_id is null;
    update private.instagram_messages set read_observed_at=coalesce(read_observed_at,(select min(received_at) from private.instagram_webhook_receipts where message_id=m.id)) where id=m.id;
   end if;
   continue;
  end if;
  if found then
   if m.provider_mid is distinct from e->>'messageId' or m.sender_id is distinct from e->>'senderId' or m.recipient_id is distinct from e->>'recipientId'
   or m.direction is distinct from e->>'direction' or m.content_kind is distinct from e->'content'->>'kind' or m.content_text is distinct from e->'content'->>'text' then
    perform private.instagram_webhook_quarantine_event(e,'MESSAGE_ID_CONFLICT',body_hash);
   end if;
   continue;
  end if;
  select * into l from private.instagram_company_links where account_id=account and status='active' for share nowait;
  if not found then perform private.instagram_webhook_quarantine_event(e,'NO_ACTIVE_BINDING',body_hash);continue;end if;
  if (select count(distinct (company_id,app_id)) from private.instagram_company_links where account_id=account)>1 then
   perform private.instagram_webhook_quarantine_event(e,'ACCOUNT_HISTORY_AMBIGUOUS',body_hash);continue;
  end if;
  select instagram_company_generations.generation into generation from private.instagram_company_generations where company_id=l.company_id for share nowait;
  valid_link:=found and generation=l.generation;
  select true into company_active from public.companies where id=l.company_id and status='active' for share nowait;
  select required_permissions into required from private.instagram_provider_contracts where contract_id=l.contract_id and app_id=l.app_id and enabled for share nowait;
  valid_link:=coalesce(valid_link and company_active and required<@l.permissions and l.authorization_expires_at>clock_timestamp()
   and exists(select 1 from private.instagram_oauth_attempts a where a.id=l.attempt_id and a.company_id=l.company_id and a.generation=l.generation and a.link_id=l.id and a.account_id=l.account_id and a.app_id=l.app_id and a.contract_id=l.contract_id and a.status='bound'),false);
  if not valid_link then perform private.instagram_webhook_quarantine_event(e,'INACTIVE_BINDING',body_hash);continue;end if;
  used_deadline:=least(used_deadline,l.authorization_expires_at);
  counterparty:=case when e->>'direction'='inbound' then e->>'senderId' else e->>'recipientId' end;
  insert into private.instagram_conversations(company_id,account_id,counterparty_id) values(l.company_id,account,counterparty)
   on conflict(company_id,account_id,counterparty_id) do nothing;
  select id into conversation from private.instagram_conversations where company_id=l.company_id and account_id=account and counterparty_id=counterparty;
  insert into private.instagram_messages(conversation_id,company_id,link_id,generation,account_id,provider_mid,mid_hash,sender_id,recipient_id,direction,is_echo,content_kind,content_text,raw_timestamp,raw_entry_timestamp,raw_body_sha256,ingress_reported_at)
  values(conversation,l.company_id,l.id,l.generation,account,e->>'messageId',mid_digest,e->>'senderId',e->>'recipientId',e->>'direction',(e->>'isEcho')::boolean,e->'content'->>'kind',e->'content'->>'text',e->'rawTimestamp',e->'rawEntryTimestamp',body_hash,reported) returning * into m;
  update private.instagram_conversations set message_count=message_count+1,last_received_at=m.received_at where id=conversation;
  if m.direction='outbound' then
   update private.instagram_webhook_receipts set message_id=m.id,company_id=m.company_id,link_id=m.link_id where account_id=account and instagram_webhook_receipts.mid_hash=mid_digest and provider_mid=m.provider_mid and sender_id=m.recipient_id and recipient_id=m.sender_id and message_id is null;
   update private.instagram_messages set read_observed_at=(select min(received_at) from private.instagram_webhook_receipts where message_id=m.id) where id=m.id;
  end if;
  -- Fail the complete batch if wall clock expiry crossed a storage/trigger wait.
  if l.authorization_expires_at<=clock_timestamp() then raise exception 'INSTAGRAM_INGEST_RETRY' using errcode='55P03';end if;
 end loop;
 -- An earlier account may expire while a later event is stored. The entire
 -- batch must cross this final gate together, inside the rollback block.
 if used_deadline<=clock_timestamp() then raise exception 'INSTAGRAM_INGEST_RETRY' using errcode='55P03';end if;
 return jsonb_build_object('status','committed');
exception when lock_not_available or invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('status','retryable');
end;$$;
revoke all on function private.instagram_webhook_event_valid(jsonb),private.instagram_webhook_quarantine_event(jsonb,text,text),public.instagram_ingest_webhook(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.instagram_ingest_webhook(jsonb) to service_role;
notify pgrst,'reload schema';
commit;

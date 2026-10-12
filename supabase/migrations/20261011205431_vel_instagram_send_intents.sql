-- Durable manual text send boundary. No rollout seed, capability registration,
-- entitlement producer, window normalizer, provider call or UI activation.
-- The empty proof tables require separately reviewed adapters to the actual
-- commercial reader and signed/normalized organic messaging window contract.
-- They MUST NOT be populated from browser claims, WA entitlement or local time.
begin;
create table private.instagram_send_policy(
 id text primary key check(id='manual_text'),enabled boolean not null default false,
 entitlement_contract text not null check(length(entitlement_contract) between 1 and 128),
 window_contract text not null check(length(window_contract) between 1 and 128)
);
create table private.instagram_send_entitlements(
 company_id uuid primary key references public.companies(id),proof_id uuid not null,
 revision bigint not null check(revision>0),allowed boolean not null default false,
 valid_from timestamptz not null,valid_until timestamptz not null,contract text not null,
 check(isfinite(valid_from) and isfinite(valid_until) and valid_from<valid_until)
);
create table private.instagram_send_windows(
 id uuid primary key,company_id uuid not null references public.companies(id),
 conversation_id uuid not null references private.instagram_conversations(id),
 message_id uuid not null references private.instagram_messages(id),
 link_id uuid not null references private.instagram_company_links(id),generation bigint not null,
 account_id text not null,counterparty_id text not null,
 proof_body_sha256 text not null check(proof_body_sha256 ~ '^[0-9a-f]{64}$'),
 provider_event_at timestamptz not null,closes_at timestamptz not null,contract text not null,
 revoked_at timestamptz,
 check(isfinite(provider_event_at) and isfinite(closes_at) and closes_at>provider_event_at
  and closes_at<=provider_event_at+interval '24 hours')
);
create index instagram_send_window_conversation on private.instagram_send_windows(conversation_id,closes_at desc);
create table private.instagram_send_intents(
 id uuid primary key,company_id uuid not null references public.companies(id),
 actor_id uuid not null references auth.users(id),session_id uuid not null,
 conversation_id uuid not null references private.instagram_conversations(id),
 link_id uuid not null references private.instagram_company_links(id),generation bigint not null check(generation between 1 and 9007199254740991),
 account_id text not null check(account_id ~ '^[0-9]{1,64}$'),recipient_id text not null check(recipient_id ~ '^[0-9]{1,64}$'),
 content_text text not null check(octet_length(content_text) between 1 and 1000),
 text_hash text not null check(text_hash ~ '^[0-9a-f]{64}$'),authority_fingerprint text not null,
 entitlement_proof uuid not null,entitlement_revision bigint not null,window_id uuid not null,
 expires_at timestamptz not null,state text not null default 'ready' check(state in ('ready','claimed','unknown','blocked','rejected','accepted')),
 claim_receipt uuid unique,claimed_at timestamptz,provider_mid text,provider_mid_hash text,accepted_at timestamptz,
 projected_message_id uuid references private.instagram_messages(id),created_at timestamptz not null default clock_timestamp(),
 check((state='ready' and claim_receipt is null and claimed_at is null) or (state<>'ready' and claim_receipt is not null and claimed_at is not null)),
 check((state='accepted' and provider_mid is not null and provider_mid_hash is not null and accepted_at is not null
  and provider_mid_hash=encode(sha256(convert_to(provider_mid,'UTF8')),'hex'))
  or (state<>'accepted' and provider_mid is null and provider_mid_hash is null and accepted_at is null)),
 check(projected_message_id is null or state='accepted')
);
-- Neither a new client ID nor elapsed time bypasses an unresolved dispatch.
create unique index instagram_send_unresolved on private.instagram_send_intents(conversation_id) where state in ('claimed','unknown');
-- Opaque IDs may be multibyte. Bound B-tree key size without truncating evidence.
create unique index instagram_send_provider_mid on private.instagram_send_intents(account_id,provider_mid_hash) where provider_mid_hash is not null;
alter table private.instagram_send_policy enable row level security;
alter table private.instagram_send_entitlements enable row level security;
alter table private.instagram_send_windows enable row level security;
alter table private.instagram_send_intents enable row level security;
revoke all on private.instagram_send_policy,private.instagram_send_entitlements,private.instagram_send_windows,private.instagram_send_intents from public,anon,authenticated,service_role;

-- API acceptance is server-observed evidence, never a fabricated signed body.
alter table private.instagram_messages add column evidence_source text not null default 'verified_webhook',
 add column send_intent_id uuid unique references private.instagram_send_intents(id),
 alter column raw_body_sha256 drop not null;
alter table private.instagram_messages add constraint instagram_message_evidence check(
 (evidence_source='verified_webhook' and raw_body_sha256 is not null) or
 (evidence_source='send_acceptance' and send_intent_id is not null and direction='outbound'
  and raw_body_sha256 is null and raw_timestamp is null and raw_entry_timestamp is null));

create function private.instagram_send_binding(i private.instagram_send_intents) returns jsonb
language sql immutable set search_path='' as $$select jsonb_build_object(
 'companyId',i.company_id,'actorId',i.actor_id,'sessionId',i.session_id,'intentId',i.id,
 'conversationId',i.conversation_id,'linkId',i.link_id,'generation',i.generation,
 'accountId',i.account_id,'recipientId',i.recipient_id,'textHash',i.text_hash)$$;
create function private.instagram_send_progress(i private.instagram_send_intents) returns jsonb
language sql immutable set search_path='' as $$select jsonb_build_object('ok',true,
 'binding',private.instagram_send_binding(i),'state',i.state,'providerMessageId',i.provider_mid,
 'projectedMessageId',i.projected_message_id,'delivery','unconfirmed')$$;
create function private.instagram_send_binding_valid(b jsonb) returns boolean
language plpgsql immutable set search_path='' as $$declare k text;begin
 if jsonb_typeof(b) is distinct from 'object' or (select count(*) from jsonb_object_keys(b))<>10 then return false;end if;
 foreach k in array array['companyId','actorId','sessionId','intentId','conversationId','linkId'] loop
  if jsonb_typeof(b->k) is distinct from 'string' or (b->>k) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
 end loop;
 return coalesce(jsonb_typeof(b->'generation')='number' and (b->>'generation') ~ '^[1-9][0-9]{0,15}$'
  and (b->>'generation')::numeric<=9007199254740991
  and jsonb_typeof(b->'accountId')='string' and (b->>'accountId') ~ '^[0-9]{1,64}$'
  and jsonb_typeof(b->'recipientId')='string' and (b->>'recipientId') ~ '^[0-9]{1,64}$'
  and jsonb_typeof(b->'textHash')='string' and (b->>'textHash') ~ '^[0-9a-f]{64}$',false);
end;$$;
create function private.instagram_send_actor(cid uuid,uid uuid,sid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare member jsonb;native_expiry timestamptz;activity private.app_session_activity%rowtype;begin
 if cid is null or uid is null or sid is null then raise insufficient_privilege;end if;
 member:=private.instagram_inbox_member(cid,uid);
 if member is null or not private.user_has_company_capability(uid,cid,'ig.conversations.reply') then raise insufficient_privilege;end if;
 perform 1 from auth.users where id=uid and (email_confirmed_at is not null or phone_confirmed_at is not null) for share nowait;
 if not found then raise insufficient_privilege;end if;
 select not_after into native_expiry from auth.sessions where id=sid and user_id=uid for share nowait;
 if not found or native_expiry<=clock_timestamp() then raise insufficient_privilege;end if;
 select * into activity from private.app_session_activity where session_id=sid and user_id=uid for share nowait;
 if not found or activity.expired_at is not null or activity.last_activity_at>clock_timestamp()
  or activity.last_activity_at<=clock_timestamp()-interval '2 hours' then raise insufficient_privilege;end if;
 return jsonb_build_object('scope',member->>'scope',
  'deadline',least(coalesce(native_expiry,'infinity'::timestamptz),activity.last_activity_at+interval '2 hours'),
  'fingerprint',encode(sha256(convert_to(jsonb_build_array(cid,uid,sid,member->'source')::text,'UTF8')),'hex'));
end;$$;
create function private.instagram_send_native() returns void language plpgsql stable set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'authenticated' or auth.jwt()->>'role' is distinct from 'authenticated' then raise insufficient_privilege;end if;
end;$$;
create function private.instagram_send_server() returns void language plpgsql stable set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' or auth.jwt()->>'role' is distinct from 'service_role' then raise insufficient_privilege;end if;
end;$$;
create function private.instagram_send_locked(b jsonb) returns private.instagram_send_intents
language plpgsql volatile set search_path='' as $$declare i private.instagram_send_intents%rowtype;begin
 if not private.instagram_send_binding_valid(b) then raise insufficient_privilege;end if;
 -- Match prepare/claim lock order. NOWAIT instead of guessing through transfer.
 perform 1 from private.instagram_conversations where id=(b->>'conversationId')::uuid for update nowait;
 select * into i from private.instagram_send_intents where id=(b->>'intentId')::uuid for update nowait;
 if not found or private.instagram_send_binding(i) is distinct from b then raise insufficient_privilege;end if;
 return i;
end;$$;
create function private.instagram_send_link(c private.instagram_conversations) returns private.instagram_company_links
language plpgsql volatile set search_path='' as $$declare l private.instagram_company_links%rowtype;a private.instagram_oauth_attempts%rowtype;required text[];g bigint;begin
 select generation into g from private.instagram_company_generations where company_id=c.company_id for share nowait;
 select * into l from private.instagram_company_links where company_id=c.company_id and account_id=c.account_id and generation=g and status='active' for share nowait;
 if not found then raise exception 'BINDING_CHANGED' using errcode='PIS03';end if;
 select required_permissions into required from private.instagram_provider_contracts where contract_id=l.contract_id and app_id=l.app_id and enabled for share nowait;
 if not found or not required<@l.permissions or l.authorization_expires_at<=clock_timestamp() then raise exception 'BINDING_CHANGED' using errcode='PIS03';end if;
 select * into a from private.instagram_oauth_attempts where id=l.attempt_id for share nowait;
 if not found or a.status<>'bound' or a.company_id<>l.company_id or a.generation<>l.generation or a.link_id<>l.id
  or a.account_id<>l.account_id or a.app_id<>l.app_id or a.contract_id<>l.contract_id or a.secret_id<>l.secret_id
  or a.permissions is distinct from l.permissions or a.authorization_expires_at is distinct from l.authorization_expires_at then
  raise exception 'BINDING_CHANGED' using errcode='PIS03';end if;
 return l;
end;$$;
create function private.instagram_send_evidence(c private.instagram_conversations,l private.instagram_company_links,
 expected_proof uuid default null,expected_revision bigint default null,expected_window uuid default null) returns jsonb
language plpgsql volatile set search_path='' as $$declare p private.instagram_send_policy%rowtype;e private.instagram_send_entitlements%rowtype;w private.instagram_send_windows%rowtype;begin
 select * into p from private.instagram_send_policy where id='manual_text' and enabled for share nowait;
 if not found then raise exception 'SEND_DISABLED' using errcode='PIS04';end if;
 select * into e from private.instagram_send_entitlements where company_id=c.company_id and allowed
  and contract=p.entitlement_contract and valid_from<=clock_timestamp() and valid_until>clock_timestamp() for share nowait;
 if not found or (expected_proof is not null and (e.proof_id<>expected_proof or e.revision<>expected_revision)) then
  raise exception 'ENTITLEMENT_DENIED' using errcode='PIS01';end if;
 select w0.* into w from private.instagram_send_windows w0 join private.instagram_messages m on m.id=w0.message_id
 where w0.company_id=c.company_id and w0.conversation_id=c.id and w0.link_id=l.id and w0.generation=l.generation
  and w0.account_id=l.account_id and w0.counterparty_id=c.counterparty_id and w0.contract=p.window_contract
  and w0.revoked_at is null and w0.provider_event_at<=clock_timestamp() and w0.closes_at>clock_timestamp()
  and (expected_window is null or w0.id=expected_window)
  and m.company_id=w0.company_id and m.conversation_id=w0.conversation_id and m.link_id=w0.link_id and m.generation=w0.generation
  and m.account_id=w0.account_id and m.sender_id=w0.counterparty_id and m.recipient_id=w0.account_id and m.direction='inbound'
  and m.evidence_source='verified_webhook' and m.raw_body_sha256=w0.proof_body_sha256
 order by w0.closes_at desc limit 1 for share of w0,m nowait;
 if not found then raise exception 'WINDOW_CLOSED' using errcode='PIS02';end if;
 return jsonb_build_object('proof',e.proof_id,'revision',e.revision,'window',w.id,'entitlement_deadline',e.valid_until,'window_deadline',w.closes_at);
end;$$;
create function private.instagram_send_finish(a jsonb,e jsonb,l private.instagram_company_links,expiry timestamptz) returns void
language plpgsql volatile set search_path='' as $$begin
 if (a->>'deadline')::timestamptz<=clock_timestamp() or expiry<=clock_timestamp() then raise insufficient_privilege;end if;
 if (e->>'entitlement_deadline')::timestamptz<=clock_timestamp() then raise exception 'ENTITLEMENT_DENIED' using errcode='PIS01';end if;
 if (e->>'window_deadline')::timestamptz<=clock_timestamp() then raise exception 'WINDOW_CLOSED' using errcode='PIS02';end if;
 if l.authorization_expires_at<=clock_timestamp() then raise exception 'BINDING_CHANGED' using errcode='PIS03';end if;
end;$$;

create function public.instagram_prepare_send(p_company_id uuid,p_conversation_id uuid,p_intent_id uuid,p_text text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid;sid uuid;a jsonb;e jsonb;c private.instagram_conversations%rowtype;
 l private.instagram_company_links%rowtype;i private.instagram_send_intents%rowtype;begin
 perform private.instagram_send_native();uid:=auth.uid();sid:=(auth.jwt()->>'session_id')::uuid;
 if p_company_id is null or p_conversation_id is null or p_intent_id is null or p_text is null
  or octet_length(p_text) not between 1 and 1000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 a:=private.instagram_send_actor(p_company_id,uid,sid);
 select * into c from private.instagram_conversations where id=p_conversation_id and company_id=p_company_id
  and (a->>'scope'='all_company' or assigned_to=uid) for update nowait;
 if not found then raise insufficient_privilege;end if;
 select * into i from private.instagram_send_intents where id=p_intent_id for update nowait;
 if found then
  if i.company_id<>p_company_id or i.conversation_id<>p_conversation_id or i.actor_id<>uid or i.session_id<>sid or i.content_text<>p_text then
   return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  if (a->>'deadline')::timestamptz<=clock_timestamp() then raise insufficient_privilege;end if;
  return private.instagram_send_progress(i);
 end if;
 if exists(select 1 from private.instagram_send_intents where conversation_id=c.id and state in ('claimed','unknown')) then
  return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
 l:=private.instagram_send_link(c);e:=private.instagram_send_evidence(c,l);
 insert into private.instagram_send_intents(id,company_id,actor_id,session_id,conversation_id,link_id,generation,account_id,recipient_id,
  content_text,text_hash,authority_fingerprint,entitlement_proof,entitlement_revision,window_id,expires_at)
 values(p_intent_id,p_company_id,uid,sid,c.id,l.id,l.generation,l.account_id,c.counterparty_id,p_text,
  encode(sha256(convert_to(p_text,'UTF8')),'hex'),a->>'fingerprint',(e->>'proof')::uuid,(e->>'revision')::bigint,(e->>'window')::uuid,
  least((a->>'deadline')::timestamptz,clock_timestamp()+interval '15 minutes')) returning * into i;
 perform private.instagram_send_finish(a,e,l,i.expires_at);
 return private.instagram_send_progress(i);
exception when insufficient_privilege or invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when sqlstate 'PIS01' then return jsonb_build_object('ok',false,'code','ENTITLEMENT_DENIED');
 when sqlstate 'PIS02' then return jsonb_build_object('ok',false,'code','WINDOW_CLOSED');
 when sqlstate 'PIS03' then return jsonb_build_object('ok',false,'code','BINDING_CHANGED');
 when sqlstate 'PIS04' then return jsonb_build_object('ok',false,'code','SEND_DISABLED');
 when unique_violation then return jsonb_build_object('ok',false,'code','CONFLICT');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;
create function public.instagram_read_send(p_binding jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare a jsonb;i private.instagram_send_intents%rowtype;begin
 perform private.instagram_send_native();i:=private.instagram_send_locked(p_binding);
 if i.actor_id is distinct from auth.uid() or i.session_id is distinct from (auth.jwt()->>'session_id')::uuid then raise insufficient_privilege;end if;
 a:=private.instagram_send_actor(i.company_id,i.actor_id,i.session_id);
 if not exists(select 1 from private.instagram_conversations where id=i.conversation_id and company_id=i.company_id
  and (a->>'scope'='all_company' or assigned_to=i.actor_id)) or (a->>'deadline')::timestamptz<=clock_timestamp() then raise insufficient_privilege;end if;
 return private.instagram_send_progress(i);
exception when insufficient_privilege or invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;
create function public.instagram_claim_send(p_binding jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i private.instagram_send_intents%rowtype;c private.instagram_conversations%rowtype;l private.instagram_company_links%rowtype;
 a jsonb;e jsonb;token text;deadline timestamptz;begin
 perform private.instagram_send_server();i:=private.instagram_send_locked(p_binding);
 if i.state<>'ready' then return jsonb_build_object('kind','existing','progress',private.instagram_send_progress(i));end if;
 a:=private.instagram_send_actor(i.company_id,i.actor_id,i.session_id);
 select * into c from private.instagram_conversations where id=i.conversation_id and company_id=i.company_id
  and (a->>'scope'='all_company' or assigned_to=i.actor_id);
 if not found or a->>'fingerprint'<>i.authority_fingerprint then raise insufficient_privilege;end if;
 l:=private.instagram_send_link(c);
 if l.id<>i.link_id or l.generation<>i.generation or l.account_id<>i.account_id or c.counterparty_id<>i.recipient_id then
  raise exception 'BINDING_CHANGED' using errcode='PIS03';end if;
 e:=private.instagram_send_evidence(c,l,i.entitlement_proof,i.entitlement_revision,i.window_id);
 if exists(select 1 from private.instagram_send_intents where conversation_id=c.id and id<>i.id and state in ('claimed','unknown')) then
  return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
 if not private.instagram_vault_ready() then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where id=$1' into token using l.secret_id;
 if token is null or length(token) not between 1 and 16384 or token ~ '[[:space:][:cntrl:]]' then
  return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 update private.instagram_send_intents set state='claimed',claim_receipt=gen_random_uuid(),claimed_at=clock_timestamp()
  where id=i.id returning * into i;
 -- Includes trigger/storage time. Expiry exceptions roll back the claim itself.
 perform private.instagram_send_finish(a,e,l,i.expires_at);
 deadline:=least((a->>'deadline')::timestamptz,(e->>'entitlement_deadline')::timestamptz,(e->>'window_deadline')::timestamptz,
  l.authorization_expires_at,i.expires_at,clock_timestamp()+interval '10 seconds');
 return jsonb_build_object('kind','fresh','committed',true,'binding',private.instagram_send_binding(i),
  'claimReceipt',i.claim_receipt,'text',i.content_text,'accessToken',token,'notAfter',deadline);
exception when insufficient_privilege or invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when sqlstate 'PIS01' then return jsonb_build_object('ok',false,'code','ENTITLEMENT_DENIED');
 when sqlstate 'PIS02' then return jsonb_build_object('ok',false,'code','WINDOW_CLOSED');
 when sqlstate 'PIS03' then return jsonb_build_object('ok',false,'code','BINDING_CHANGED');
 when sqlstate 'PIS04' then return jsonb_build_object('ok',false,'code','SEND_DISABLED');
 when unique_violation then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;

-- Outcome recording is NOT another dispatch. Preserve the historical tenant
-- even when authority is revoked or this account is retired after HTTP starts.
create function public.instagram_settle_send(p_binding jsonb,p_claim_receipt uuid,p_outcome jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare i private.instagram_send_intents%rowtype;s text;begin
 perform private.instagram_send_server();i:=private.instagram_send_locked(p_binding);
 if p_claim_receipt is null or i.claim_receipt is distinct from p_claim_receipt then raise insufficient_privilege;end if;
 s:=p_outcome->>'status';
 if jsonb_typeof(p_outcome) is distinct from 'object' or s is null or s not in ('accepted','unknown','blocked','rejected')
  or (select count(*) from jsonb_object_keys(p_outcome))<>(case when s='accepted' then 3 else 1 end) then
  return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if s='accepted' and (jsonb_typeof(p_outcome->'recipientId') is distinct from 'string' or p_outcome->>'recipientId' is distinct from i.recipient_id
  or jsonb_typeof(p_outcome->'messageId') is distinct from 'string' or length(p_outcome->>'messageId') not between 1 and 2048
  or (p_outcome->>'messageId') ~ '[[:space:][:cntrl:]]') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if i.state='accepted' then
  if s='accepted' and i.provider_mid<>p_outcome->>'messageId' then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  return private.instagram_send_progress(i);
 end if;
 if i.state not in ('claimed','unknown') then return private.instagram_send_progress(i);end if;
 update private.instagram_send_intents set state=s,provider_mid=case when s='accepted' then p_outcome->>'messageId' end,
  provider_mid_hash=case when s='accepted' then encode(sha256(convert_to(p_outcome->>'messageId','UTF8')),'hex') end,
  accepted_at=case when s='accepted' then clock_timestamp() end where id=i.id returning * into i;
 return private.instagram_send_progress(i);
exception when insufficient_privilege or invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when unique_violation then return jsonb_build_object('ok',false,'code','CONFLICT');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;
create function public.instagram_recover_send(p_binding jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare i private.instagram_send_intents%rowtype;begin
 perform private.instagram_send_server();i:=private.instagram_send_locked(p_binding);
 if i.state='claimed' then update private.instagram_send_intents set state='unknown' where id=i.id returning * into i;end if;
 return private.instagram_send_progress(i);
exception when insufficient_privilege or invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;
create function public.instagram_project_send(p_binding jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare i private.instagram_send_intents%rowtype;m private.instagram_messages%rowtype;digest text;begin
 perform private.instagram_send_server();i:=private.instagram_send_locked(p_binding);
 if i.state<>'accepted' or i.projected_message_id is not null then return private.instagram_send_progress(i);end if;
 -- Same account lock used by ingestion/finalize. Nonblocking avoids inversion
 -- with the pinned conversation; caller can repair without dispatching HTTP.
 if not pg_try_advisory_xact_lock(87420106,hashtext(i.account_id)) then
  return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 digest:=encode(sha256(convert_to(i.provider_mid,'UTF8')),'hex');
 select * into m from private.instagram_messages where account_id=i.account_id and mid_hash=digest for update nowait;
 if found then
  if m.provider_mid<>i.provider_mid or m.company_id<>i.company_id or m.conversation_id<>i.conversation_id or m.link_id<>i.link_id
   or m.generation<>i.generation or m.direction<>'outbound' or m.sender_id<>i.account_id or m.recipient_id<>i.recipient_id
   or m.content_kind<>'text' or m.content_text is distinct from i.content_text or (m.send_intent_id is not null and m.send_intent_id<>i.id) then
   return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  update private.instagram_messages set send_intent_id=i.id where id=m.id;
 else
  insert into private.instagram_messages(conversation_id,company_id,link_id,generation,account_id,provider_mid,mid_hash,
   sender_id,recipient_id,direction,is_echo,content_kind,content_text,raw_timestamp,raw_entry_timestamp,raw_body_sha256,
   received_at,ingress_reported_at,evidence_source,send_intent_id)
  values(i.conversation_id,i.company_id,i.link_id,i.generation,i.account_id,i.provider_mid,digest,i.account_id,i.recipient_id,
   'outbound',null,'text',i.content_text,null,null,null,i.accepted_at,i.accepted_at,'send_acceptance',i.id) returning * into m;
  update private.instagram_conversations set message_count=message_count+1,last_received_at=greatest(last_received_at,m.received_at) where id=i.conversation_id;
 end if;
 -- Exact provider read evidence may have arrived before the acceptance projection.
 update private.instagram_webhook_receipts set message_id=m.id,company_id=m.company_id,link_id=m.link_id
  where account_id=m.account_id and mid_hash=m.mid_hash and provider_mid=m.provider_mid
  and sender_id=m.recipient_id and recipient_id=m.sender_id and message_id is null;
 update private.instagram_messages set read_observed_at=coalesce(read_observed_at,
  (select min(received_at) from private.instagram_webhook_receipts where message_id=m.id)) where id=m.id;
 update private.instagram_send_intents set projected_message_id=m.id where id=i.id returning * into i;
 return private.instagram_send_progress(i);
exception when insufficient_privilege or invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when unique_violation then return jsonb_build_object('ok',false,'code','CONFLICT');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;

revoke all on function private.instagram_send_binding(private.instagram_send_intents),private.instagram_send_progress(private.instagram_send_intents),
 private.instagram_send_binding_valid(jsonb),private.instagram_send_actor(uuid,uuid,uuid),private.instagram_send_native(),private.instagram_send_server(),
 private.instagram_send_locked(jsonb),private.instagram_send_link(private.instagram_conversations),
 private.instagram_send_evidence(private.instagram_conversations,private.instagram_company_links,uuid,bigint,uuid),
 private.instagram_send_finish(jsonb,jsonb,private.instagram_company_links,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.instagram_prepare_send(uuid,uuid,uuid,text),public.instagram_read_send(jsonb),public.instagram_claim_send(jsonb),
 public.instagram_settle_send(jsonb,uuid,jsonb),public.instagram_project_send(jsonb),public.instagram_recover_send(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.instagram_prepare_send(uuid,uuid,uuid,text),public.instagram_read_send(jsonb) to authenticated;
grant execute on function public.instagram_claim_send(jsonb),public.instagram_settle_send(jsonb,uuid,jsonb),public.instagram_project_send(jsonb),public.instagram_recover_send(jsonb) to service_role;
notify pgrst,'reload schema';
commit;

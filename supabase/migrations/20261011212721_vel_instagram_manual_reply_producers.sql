-- Additive internal wiring. NO installation, contract, rollout or grant seed.
-- Manual paid eligibility uses the existing Live financial proof. No AI service
-- capability/knowledge requirement, synthetic entitlement producer or local-time window.
begin;
create or replace function private.access_company_capabilities() returns text[]
language sql immutable set search_path='' as $$select array[
 'wa.conversations.read','wa.conversations.reply','wa.conversations.take_over','wa.conversations.resume','wa.conversations.close','wa.conversations.assign',
 'knowledge.read','knowledge.write','knowledge.delete','company.profile.read','company.profile.write','company.staff.manage',
 'ig.conversations.read','ig.conversations.assign','ig.conversations.reply']::text[]$$;
-- Existing grants/defaults remain unchanged. Saving is not dispatch authority.
alter table private.instagram_send_intents alter column entitlement_proof drop not null,
 alter column entitlement_revision drop not null,alter column window_id drop not null;
create table private.instagram_manual_contracts(
 id text primary key check(id='manual_text'),parent_app_id text not null check(parent_app_id ~ '^[0-9]{1,64}$'),
 secret_fingerprint text not null check(secret_fingerprint ~ '^[0-9a-f]{64}$'),
 installation_proof_ref text not null check(length(installation_proof_ref) between 1 and 256),
 provider_fixture_proof_ref text not null check(length(provider_fixture_proof_ref) between 1 and 256),
 timestamp_unit text check(timestamp_unit in ('unix_ms','unix_seconds')),
 timestamp_proof_ref text check(length(timestamp_proof_ref) between 1 and 256),
 verified_at timestamptz not null check(isfinite(verified_at)),
 check((timestamp_unit is null)=(timestamp_proof_ref is null))
);
create table private.instagram_inbound_signatures(
 message_id uuid primary key references private.instagram_messages(id),
 raw_body_sha256 text not null check(raw_body_sha256 ~ '^[0-9a-f]{64}$'),
 parent_app_id text not null,secret_fingerprint text not null,
 installation_proof_ref text not null,provider_fixture_proof_ref text not null,
 verified_at timestamptz not null default clock_timestamp()
);
alter table private.instagram_manual_contracts enable row level security;
alter table private.instagram_inbound_signatures enable row level security;
revoke all on private.instagram_manual_contracts,private.instagram_inbound_signatures from public,anon,authenticated,service_role;

-- Same exact Live subscription/proven-receipt eligibility as the generic manual
-- dispatcher, including unsettled lifecycle reversals. Locks pin financial proof
-- through final claim commit; never spoof service_role to call the owner reader.
create function private.instagram_manual_paid(cid uuid,expected_proof uuid default null) returns jsonb
language plpgsql volatile set search_path='' as $$
declare s public.billing_subscriptions%rowtype;g private.billing_proven_entitlement_grants%rowtype;begin
 perform 1 from public.companies where id=cid and status='active' for share nowait;
 if not found then raise exception 'ENTITLEMENT_DENIED' using errcode='PIS01';end if;
 select * into s from public.billing_subscriptions where company_id=cid and environment='live' for share nowait;
 if not found or s.status not in ('active','cancel_at_period_end') or s.paid_through is null or s.paid_through<=clock_timestamp() then
  raise exception 'ENTITLEMENT_DENIED' using errcode='PIS01';end if;
 select * into g from private.billing_proven_entitlement_grants where company_id=cid and subscription_id=s.id
  and provider_environment='live' and applied_paid_through=s.paid_through and plan_version_id=s.plan_version_id
  and (expected_proof is null or id=expected_proof) order by id limit 1;
 if not found then raise exception 'ENTITLEMENT_DENIED' using errcode='PIS01';end if;
 perform 1 from public.billing_entitlement_applications where id=g.id for share nowait;
 perform 1 from public.billing_orders where id=g.order_id for share nowait;
 perform 1 from public.billing_payment_attempts where id=g.payment_attempt_id for share nowait;
 perform 1 from public.billing_provider_events where id=g.provider_event_id for share nowait;
 perform 1 from public.billing_settlement_outcomes where entitlement_application_id=g.id for share nowait;
 if not private.billing_service_receipt_eligible(g.id) or not exists(
  select 1 from private.billing_proven_entitlement_grants current_proof where current_proof.id=g.id
   and current_proof.subscription_id=s.id and current_proof.company_id=cid and current_proof.provider_environment='live'
   and current_proof.applied_paid_through=s.paid_through and current_proof.plan_version_id=s.plan_version_id)
  or s.paid_through<=clock_timestamp() then raise exception 'ENTITLEMENT_DENIED' using errcode='PIS01';end if;
 return jsonb_build_object('proof',g.id,'entitlement_deadline',s.paid_through);
end;$$;

-- Window evidence must be persisted inbound and attested by this installed parent
-- application, not merely marked verified_webhook by historical/default rows.
create function private.instagram_manual_window(c private.instagram_conversations,l private.instagram_company_links,expected_window uuid default null) returns jsonb
language plpgsql volatile set search_path='' as $$
declare contract private.instagram_manual_contracts%rowtype;w private.instagram_send_windows%rowtype;begin
 select * into contract from private.instagram_manual_contracts where id='manual_text' and verified_at<=clock_timestamp() for share nowait;
 if not found or contract.timestamp_unit is null then raise exception 'WINDOW_CLOSED' using errcode='PIS02';end if;
 select w0.* into w from private.instagram_send_windows w0
 join private.instagram_messages m on m.id=w0.message_id
 join private.instagram_inbound_signatures sig on sig.message_id=m.id
 where w0.company_id=c.company_id and w0.conversation_id=c.id and w0.link_id=l.id and w0.generation=l.generation
  and w0.account_id=l.account_id and w0.counterparty_id=c.counterparty_id and w0.revoked_at is null
  and w0.contract=contract.timestamp_proof_ref and w0.provider_event_at<=clock_timestamp() and w0.closes_at>clock_timestamp()
  and (expected_window is null or w0.id=expected_window)
  and m.company_id=w0.company_id and m.conversation_id=w0.conversation_id and m.link_id=w0.link_id and m.generation=w0.generation
  and m.account_id=w0.account_id and m.sender_id=w0.counterparty_id and m.recipient_id=w0.account_id and m.direction='inbound'
  and m.evidence_source='verified_webhook' and m.raw_body_sha256=w0.proof_body_sha256 and sig.raw_body_sha256=m.raw_body_sha256
  and sig.parent_app_id=contract.parent_app_id and sig.secret_fingerprint=contract.secret_fingerprint
  and sig.installation_proof_ref=contract.installation_proof_ref and sig.provider_fixture_proof_ref=contract.provider_fixture_proof_ref
 order by w0.closes_at desc limit 1 for share of w0,m,sig nowait;
 if not found then raise exception 'WINDOW_CLOSED' using errcode='PIS02';end if;
 return jsonb_build_object('window',w.id,'window_deadline',w.closes_at);
end;$$;
create or replace function private.instagram_send_evidence(c private.instagram_conversations,l private.instagram_company_links,
 expected_proof uuid default null,expected_revision bigint default null,expected_window uuid default null) returns jsonb
language plpgsql volatile set search_path='' as $$declare paid jsonb;begin
 perform 1 from private.instagram_send_policy where id='manual_text' and enabled for share nowait;
 if not found then raise exception 'SEND_DISABLED' using errcode='PIS04';end if;
 -- Revision is deliberately absent: the existing immutable financial receipt is
 -- the proof. Historical synthetic receipt IDs cannot match the actual paid view.
 paid:=private.instagram_manual_paid(c.company_id,expected_proof);
 return paid||private.instagram_manual_window(c,l,expected_window);
end;$$;

create function public.instagram_save_reply(p_company_id uuid,p_conversation_id uuid,p_intent_id uuid,p_text text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid;sid uuid;a jsonb;c private.instagram_conversations%rowtype;l private.instagram_company_links%rowtype;i private.instagram_send_intents%rowtype;begin
 perform private.instagram_send_native();uid:=auth.uid();sid:=(auth.jwt()->>'session_id')::uuid;
 if p_company_id is null or p_conversation_id is null or p_intent_id is null or p_text is null or octet_length(p_text) not between 1 and 1000 then
  return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 a:=private.instagram_send_actor(p_company_id,uid,sid);
 select * into c from private.instagram_conversations where id=p_conversation_id and company_id=p_company_id
  and (a->>'scope'='all_company' or assigned_to=uid) for update nowait;
 if not found then raise insufficient_privilege;end if;
 select * into i from private.instagram_send_intents where id=p_intent_id for update nowait;
 if found then
  if i.company_id<>p_company_id or i.conversation_id<>c.id or i.actor_id<>uid or i.session_id<>sid or i.content_text<>p_text then
   return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 else
  if exists(select 1 from private.instagram_send_intents where conversation_id=c.id and state in ('claimed','unknown')) then
   return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
  l:=private.instagram_send_link(c);
  insert into private.instagram_send_intents(id,company_id,actor_id,session_id,conversation_id,link_id,generation,account_id,recipient_id,
   content_text,text_hash,authority_fingerprint,expires_at)
  values(p_intent_id,p_company_id,uid,sid,c.id,l.id,l.generation,l.account_id,c.counterparty_id,p_text,
   encode(sha256(convert_to(p_text,'UTF8')),'hex'),a->>'fingerprint',least((a->>'deadline')::timestamptz,clock_timestamp()+interval '15 minutes')) returning * into i;
 end if;
 if (a->>'deadline')::timestamptz<=clock_timestamp() then raise insufficient_privilege;end if;
 return private.instagram_send_progress(i)||jsonb_build_object('text',i.content_text);
exception when insufficient_privilege or invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when sqlstate 'PIS03' then return jsonb_build_object('ok',false,'code','BINDING_CHANGED');
 when unique_violation then return jsonb_build_object('ok',false,'code','CONFLICT');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;
create function public.instagram_get_reply(p_company_id uuid,p_conversation_id uuid,p_intent_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare i private.instagram_send_intents%rowtype;r jsonb;begin
 perform private.instagram_send_native();
 select * into i from private.instagram_send_intents where id=p_intent_id and company_id=p_company_id and conversation_id=p_conversation_id;
 if not found then raise insufficient_privilege;end if;
 r:=public.instagram_read_send(private.instagram_send_binding(i));
 if r->>'ok'<>'true' then return r;end if;
 return r||jsonb_build_object('text',i.content_text);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;$$;

create function public.instagram_send_readiness(p_company_id uuid,p_conversation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a jsonb;c private.instagram_conversations%rowtype;l private.instagram_company_links%rowtype;
 contract private.instagram_manual_contracts%rowtype;blockers jsonb:='[]';begin
 a:=private.instagram_inbox_authority(p_company_id);if a is null then raise insufficient_privilege;end if;
 select * into c from private.instagram_conversations where company_id=p_company_id and id=p_conversation_id
  and (a->>'conversation_scope'='all_company' or assigned_to=auth.uid()) for share nowait;
 if not found then raise insufficient_privilege;end if;
 if not private.user_has_company_capability(auth.uid(),p_company_id,'ig.conversations.reply') then blockers:=blockers||'"REPLY_PERMISSION_REQUIRED"'::jsonb;end if;
 begin perform private.instagram_manual_paid(p_company_id);
 exception when sqlstate 'PIS01' then blockers:=blockers||'"ENTITLEMENT_DENIED"'::jsonb;end;
 select * into contract from private.instagram_manual_contracts where id='manual_text' and verified_at<=clock_timestamp() for share nowait;
 if not found then blockers:=blockers||'"INSTALLED_SECRET_UNVERIFIED"'::jsonb;
 elsif contract.timestamp_unit is null then blockers:=blockers||'"TIMESTAMP_CONTRACT_UNVERIFIED"'::jsonb;end if;
 begin
  l:=private.instagram_send_link(c);
  if contract.id is not null and contract.timestamp_unit is not null then
   begin perform private.instagram_manual_window(c,l);
   exception when sqlstate 'PIS02' then blockers:=blockers||'"WINDOW_CLOSED"'::jsonb;end;
  end if;
 exception when sqlstate 'PIS03' then blockers:=blockers||'"BINDING_CHANGED"'::jsonb;end;
 if not exists(select 1 from private.instagram_send_policy where id='manual_text' and enabled) then blockers:=blockers||'"ROLLOUT_DISABLED"'::jsonb;end if;
 perform private.instagram_inbox_finish(a);
 return jsonb_build_object('ok',true,'blockers',blockers);
exception when insufficient_privilege or invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;

create function public.instagram_ingest_signed_webhook(p_batch jsonb,p_parent_app_id text,p_secret_fingerprint text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare contract private.instagram_manual_contracts%rowtype;r jsonb;event jsonb;m private.instagram_messages%rowtype;provider_at timestamptz;begin
 perform private.instagram_send_server();
 select * into contract from private.instagram_manual_contracts where id='manual_text' and parent_app_id=p_parent_app_id
  and secret_fingerprint=p_secret_fingerprint and verified_at<=clock_timestamp() for share nowait;
 if not found then return jsonb_build_object('status','retryable');end if;
 r:=public.instagram_ingest_webhook(p_batch);if r is distinct from '{"status":"committed"}'::jsonb then return r;end if;
 for event in select value from jsonb_array_elements(p_batch->'events') loop
  if event->>'kind'<>'message' or event->>'direction'<>'inbound' or event->'isEcho'='true'::jsonb then continue;end if;
  select * into m from private.instagram_messages where account_id=event->>'professionalAccountId'
   and mid_hash=encode(sha256(convert_to(event->>'messageId','UTF8')),'hex') and provider_mid=event->>'messageId'
   and sender_id=event->>'senderId' and recipient_id=event->>'recipientId' and direction='inbound'
   and evidence_source='verified_webhook' and raw_body_sha256=p_batch->>'rawBodySha256'
   and raw_timestamp is not distinct from event->'rawTimestamp' for share nowait;
  if not found then continue;end if;
  insert into private.instagram_inbound_signatures(message_id,raw_body_sha256,parent_app_id,secret_fingerprint,installation_proof_ref,provider_fixture_proof_ref)
   values(m.id,m.raw_body_sha256,contract.parent_app_id,contract.secret_fingerprint,contract.installation_proof_ref,contract.provider_fixture_proof_ref)
   on conflict(message_id) do nothing;
  -- Exact installed unit only. Raw entry timestamp and local receipt are never authority.
  if contract.timestamp_unit is null or jsonb_typeof(m.raw_timestamp) is distinct from 'number'
   or m.raw_timestamp::text !~ '^[0-9]{1,16}$' then continue;end if;
  begin
   provider_at:=to_timestamp((m.raw_timestamp::text)::numeric/(case when contract.timestamp_unit='unix_ms' then 1000 else 1 end));
  exception when datetime_field_overflow or numeric_value_out_of_range then continue;end;
  if not isfinite(provider_at) or provider_at>clock_timestamp() or provider_at+interval '24 hours'<=clock_timestamp() then continue;end if;
  if not exists(select 1 from private.instagram_inbound_signatures sig where sig.message_id=m.id
   and sig.secret_fingerprint=contract.secret_fingerprint and sig.parent_app_id=contract.parent_app_id
   and sig.installation_proof_ref=contract.installation_proof_ref and sig.provider_fixture_proof_ref=contract.provider_fixture_proof_ref) then continue;end if;
  insert into private.instagram_send_windows(id,company_id,conversation_id,message_id,link_id,generation,account_id,counterparty_id,
   proof_body_sha256,provider_event_at,closes_at,contract)
  select gen_random_uuid(),m.company_id,m.conversation_id,m.id,m.link_id,m.generation,m.account_id,m.sender_id,
   m.raw_body_sha256,provider_at,provider_at+interval '24 hours',contract.timestamp_proof_ref
  where not exists(select 1 from private.instagram_send_windows where message_id=m.id and instagram_send_windows.contract=contract.timestamp_proof_ref);
 end loop;
 return jsonb_build_object('status','committed');
end;$$;

create or replace function public.instagram_claim_send(p_binding jsonb) returns jsonb
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
 update private.instagram_send_intents set state='claimed',claim_receipt=gen_random_uuid(),claimed_at=clock_timestamp(),
  entitlement_proof=(e->>'proof')::uuid,entitlement_revision=null,window_id=(e->>'window')::uuid
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

revoke all on function private.instagram_manual_paid(uuid,uuid),private.instagram_manual_window(private.instagram_conversations,private.instagram_company_links,uuid) from public,anon,authenticated,service_role;
revoke all on function public.instagram_save_reply(uuid,uuid,uuid,text),public.instagram_get_reply(uuid,uuid,uuid),public.instagram_send_readiness(uuid,uuid),public.instagram_ingest_signed_webhook(jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.instagram_save_reply(uuid,uuid,uuid,text),public.instagram_get_reply(uuid,uuid,uuid),public.instagram_send_readiness(uuid,uuid) to authenticated;
grant execute on function public.instagram_ingest_signed_webhook(jsonb,text,text) to service_role;
notify pgrst,'reload schema';
commit;

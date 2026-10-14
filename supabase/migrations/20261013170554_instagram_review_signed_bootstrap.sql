begin;
create table private.instagram_review_bootstrap(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 link_id uuid not null references private.instagram_company_links(id),generation bigint not null,owner_id uuid not null references auth.users(id),
 account_id text not null,app_id text not null,parent_app_id text not null,secret_fingerprint text not null,nonce_sha256 text not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null,expires_at timestamptz not null,
 review_valid_until timestamptz not null,observed_at timestamptz,observed_body_sha256 text,observed_sender_id text,
 check(secret_fingerprint ~ '^[0-9a-f]{64}$' and nonce_sha256 ~ '^[0-9a-f]{64}$'),
 check(expires_at>created_at and expires_at<=created_at+interval '30 minutes'),
 check(review_valid_until>created_at and review_valid_until<=created_at+interval '7 days')
);
alter table private.instagram_review_bootstrap enable row level security;
revoke all on private.instagram_review_bootstrap from public,anon,authenticated,service_role;

create function public.admin_begin_instagram_review_bootstrap(p_company_id uuid,p_app_id text,p_parent_app_id text,p_secret_fingerprint text,p_nonce_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$declare actor uuid;l private.instagram_company_links%rowtype;owner_uid uuid;started timestamptz;begin
 if current_setting('role',true) is distinct from 'authenticated' or (public.check_app_session(false)->>'ok') is distinct from 'true' then raise insufficient_privilege;end if;
 actor:=private.require_platform_admin();if not private.can_admin_company(p_company_id,'platform.manage_companies') then raise insufficient_privilege;end if;
 if p_app_id is null or p_app_id !~ '^[0-9]{1,64}$' or p_parent_app_id is null or p_parent_app_id !~ '^[0-9]{1,64}$'
 or p_secret_fingerprint is null or p_secret_fingerprint !~ '^[0-9a-f]{64}$' or p_nonce_sha256 is null or p_nonce_sha256 !~ '^[0-9a-f]{64}$' then raise insufficient_privilege;end if;
 select * into l from private.instagram_company_links where company_id=p_company_id and app_id=p_app_id and status='active' and authorization_expires_at>clock_timestamp() for share nowait;
 if not found or not exists(select 1 from public.companies where id=p_company_id and status='active') then raise insufficient_privilege;end if;
 if (select count(*) from public.company_members where company_id=p_company_id and role='owner' and status='active')<>1 then raise insufficient_privilege;end if;
 select user_id into owner_uid from public.company_members where company_id=p_company_id and role='owner' and status='active' for share nowait;
 started:=clock_timestamp();
 insert into private.instagram_review_bootstrap(company_id,link_id,generation,owner_id,account_id,app_id,parent_app_id,secret_fingerprint,nonce_sha256,created_by,created_at,expires_at,review_valid_until)
 values(p_company_id,l.id,l.generation,owner_uid,l.account_id,l.app_id,p_parent_app_id,p_secret_fingerprint,p_nonce_sha256,actor,started,started+interval '30 minutes',started+interval '7 days');
 perform private.write_admin_audit(actor,p_company_id,'instagram.review_bootstrap_started',null,jsonb_build_object('account_id',l.account_id,'expires_at',started+interval '30 minutes'));
 return jsonb_build_object('ok',true,'account_id',l.account_id,'expires_at',started+interval '30 minutes');end;$$;

create function public.instagram_read_review_bootstrap(p_company_id uuid,p_parent_app_id text,p_secret_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$declare b private.instagram_review_bootstrap%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into b from private.instagram_review_bootstrap where company_id=p_company_id and parent_app_id=p_parent_app_id and secret_fingerprint=p_secret_fingerprint
 and observed_at is null and expires_at>clock_timestamp() order by created_at desc limit 1;
 if not found then return jsonb_build_object('ok',false);end if;
 return jsonb_build_object('ok',true,'account_id',b.account_id,'nonce_sha256',b.nonce_sha256,'expires_at',b.expires_at);end;$$;

create function public.instagram_observe_review_bootstrap(p_company_id uuid,p_parent_app_id text,p_secret_fingerprint text,p_batch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b private.instagram_review_bootstrap%rowtype;e jsonb;l private.instagram_company_links%rowtype;r jsonb;provider_at timestamptz;begin
 perform private.instagram_send_server();
 if jsonb_typeof(p_batch->'events') is distinct from 'array' or jsonb_array_length(p_batch->'events')<1 or p_batch->>'rawBodySha256' !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status','retryable');end if;
 select * into b from private.instagram_review_bootstrap where company_id=p_company_id and parent_app_id=p_parent_app_id and secret_fingerprint=p_secret_fingerprint
 and observed_at is null and expires_at>clock_timestamp() order by created_at desc limit 1 for update nowait;
 if not found then return jsonb_build_object('status','retryable');end if;
 if exists(select 1 from jsonb_array_elements(p_batch->'events') v where v->>'professionalAccountId' is distinct from b.account_id)
 or (select count(*) from jsonb_array_elements(p_batch->'events') v where v->>'kind'='message' and v->>'direction'='inbound'
 and v->'content'->>'kind'='text' and encode(sha256(convert_to(v->'content'->>'text','UTF8')),'hex')=b.nonce_sha256)<>1
 then return jsonb_build_object('status','retryable');end if;
 select v into e from jsonb_array_elements(p_batch->'events') v where v->>'kind'='message' and v->>'direction'='inbound'
 and v->'content'->>'kind'='text' and encode(sha256(convert_to(v->'content'->>'text','UTF8')),'hex')=b.nonce_sha256;
 if e->>'kind'<>'message' or e->>'direction'<>'inbound' or e->>'professionalAccountId' is distinct from b.account_id
 or e->>'recipientId' is distinct from b.account_id or e->>'senderId' !~ '^[0-9]{1,64}$'
 or e->'content'->>'kind'<>'text' or encode(sha256(convert_to(e->'content'->>'text','UTF8')),'hex') is distinct from b.nonce_sha256
 or jsonb_typeof(e->'rawTimestamp') is distinct from 'number' or (e->'rawTimestamp')::text !~ '^[0-9]{1,16}$'
 then return jsonb_build_object('status','retryable');end if;
 select * into l from private.instagram_company_links where id=b.link_id and company_id=b.company_id and generation=b.generation and account_id=b.account_id and app_id=b.app_id and status='active' and authorization_expires_at>clock_timestamp() for share nowait;
 if not found or not exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id
 where m.company_id=b.company_id and m.user_id=b.owner_id and m.role='owner' and m.status='active' and c.status='active') then return jsonb_build_object('status','retryable');end if;
 provider_at:=to_timestamp((e->'rawTimestamp')::text::numeric/1000);
 if provider_at>clock_timestamp() or provider_at<=clock_timestamp()-interval '30 minutes' then return jsonb_build_object('status','retryable');end if;
 if exists(select 1 from private.instagram_manual_contracts where id='manual_text' and (parent_app_id<>b.parent_app_id or secret_fingerprint<>b.secret_fingerprint or timestamp_unit is distinct from 'unix_ms'))
 then return jsonb_build_object('status','retryable');end if;
 insert into private.instagram_manual_contracts(id,parent_app_id,secret_fingerprint,installation_proof_ref,provider_fixture_proof_ref,timestamp_unit,timestamp_proof_ref,verified_at)
 values('manual_text',b.parent_app_id,b.secret_fingerprint,'signed-review:'||(p_batch->>'rawBodySha256'),'meta-v26-observed:'||(p_batch->>'rawBodySha256'),'unix_ms','meta-v26-unix-ms:'||(p_batch->>'rawBodySha256'),clock_timestamp()) on conflict(id) do nothing;
 r:=public.instagram_ingest_signed_webhook(p_batch,b.parent_app_id,b.secret_fingerprint);
 if r is distinct from '{"status":"committed"}'::jsonb then raise exception 'BOOTSTRAP_INGEST_UNAVAILABLE';end if;
 if not exists(select 1 from private.instagram_messages m join private.instagram_inbound_signatures sig on sig.message_id=m.id
 join private.instagram_send_windows w on w.message_id=m.id
 where m.company_id=b.company_id and m.link_id=b.link_id and m.generation=b.generation and m.account_id=b.account_id
 and m.provider_mid=e->>'messageId' and m.sender_id=e->>'senderId' and m.recipient_id=b.account_id
 and m.direction='inbound' and m.is_echo is distinct from true and m.content_kind='text' and m.content_text=e->'content'->>'text'
 and m.evidence_source='verified_webhook' and m.raw_timestamp=e->'rawTimestamp' and m.raw_body_sha256=p_batch->>'rawBodySha256'
 and sig.raw_body_sha256=m.raw_body_sha256 and sig.parent_app_id=b.parent_app_id and sig.secret_fingerprint=b.secret_fingerprint
 and w.company_id=m.company_id and w.link_id=m.link_id and w.generation=m.generation and w.account_id=m.account_id
 and w.counterparty_id=m.sender_id and w.proof_body_sha256=m.raw_body_sha256 and w.provider_event_at=provider_at
 and w.revoked_at is null and w.closes_at>clock_timestamp()) then raise exception 'BOOTSTRAP_MESSAGE_NOT_PROVEN';end if;
 update private.instagram_review_bootstrap set observed_at=clock_timestamp(),observed_body_sha256=p_batch->>'rawBodySha256',observed_sender_id=e->>'senderId' where id=b.id;
 return r;
exception when lock_not_available or invalid_text_representation or numeric_value_out_of_range or raise_exception then return jsonb_build_object('status','retryable');end;$$;

create function public.admin_read_instagram_review_bootstrap(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare actor uuid;b private.instagram_review_bootstrap%rowtype;begin
 if current_setting('role',true) is distinct from 'authenticated' or (public.check_app_session(false)->>'ok') is distinct from 'true' then raise insufficient_privilege;end if;
 actor:=private.require_platform_admin();if not private.can_admin_company(p_company_id,'platform.manage_companies') then raise insufficient_privilege;end if;
 select * into b from private.instagram_review_bootstrap where company_id=p_company_id order by created_at desc limit 1;
 return jsonb_build_object('ok',true,'account_id',b.account_id,'sender_id',b.observed_sender_id,'observed',b.observed_at is not null,'expires_at',b.expires_at);end;$$;

create function public.instagram_ingest_review_webhook(p_company_id uuid,p_parent_app_id text,p_secret_fingerprint text,p_batch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform private.instagram_send_server();
 if not exists(select 1 from private.instagram_review_bootstrap b where b.company_id=p_company_id and b.parent_app_id=p_parent_app_id and b.secret_fingerprint=p_secret_fingerprint and b.observed_at is not null and b.review_valid_until>clock_timestamp())
 or jsonb_typeof(p_batch->'events') is distinct from 'array'
 or exists(select 1 from jsonb_array_elements(p_batch->'events') e where not exists(select 1 from private.instagram_company_links l where l.company_id=p_company_id and l.account_id=e->>'professionalAccountId' and l.status='active'))
 then return jsonb_build_object('status','retryable');end if;
 return public.instagram_ingest_signed_webhook(p_batch,p_parent_app_id,p_secret_fingerprint);end;$$;

revoke all on function public.admin_begin_instagram_review_bootstrap(uuid,text,text,text,text),public.instagram_read_review_bootstrap(uuid,text,text),public.instagram_observe_review_bootstrap(uuid,text,text,jsonb),public.admin_read_instagram_review_bootstrap(uuid),public.instagram_ingest_review_webhook(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_begin_instagram_review_bootstrap(uuid,text,text,text,text),public.admin_read_instagram_review_bootstrap(uuid) to authenticated;
grant execute on function public.instagram_read_review_bootstrap(uuid,text,text),public.instagram_observe_review_bootstrap(uuid,text,text,jsonb),public.instagram_ingest_review_webhook(uuid,text,text,jsonb) to service_role;
-- Scoped review grants are a separate manual rollout authority; commercial policy remains unchanged.
create or replace function public.instagram_review_send_readiness(p_company_id uuid,p_conversation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare r jsonb;begin
 r:=public.instagram_send_readiness(p_company_id,p_conversation_id);if r->>'ok' is distinct from 'true' then return r;end if;
 if exists(select 1 from private.channel_review_grants g join private.instagram_conversations c on c.company_id=g.company_id
 join private.instagram_company_links l on l.company_id=c.company_id and l.account_id=c.account_id and l.status='active'
 where g.company_id=p_company_id and c.id=p_conversation_id and g.channel='instagram' and g.owner_id=auth.uid()
 and g.asset_id=c.account_id and g.source_account_id=c.account_id and g.app_id=l.app_id
 and c.counterparty_id=any(g.recipient_ids) and g.revoked_at is null and g.expires_at>clock_timestamp() and g.used_count<g.send_limit)
 then r:=jsonb_set(r,'{blockers}',(r->'blockers')-'ENTITLEMENT_DENIED'-'ROLLOUT_DISABLED');end if;
 return r;end;$$;
create or replace function public.instagram_claim_review_send(p_binding jsonb,p_grant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i private.instagram_send_intents%rowtype;c private.instagram_conversations%rowtype;l private.instagram_company_links%rowtype;
 g private.channel_review_grants%rowtype;a jsonb;e jsonb;token text;deadline timestamptz;begin
 perform private.instagram_send_server();i:=private.instagram_send_locked(p_binding);
 if i.state<>'ready' then return jsonb_build_object('kind','existing','progress',private.instagram_send_progress(i));end if;
 a:=private.instagram_send_actor(i.company_id,i.actor_id,i.session_id);
 select * into c from private.instagram_conversations where id=i.conversation_id and company_id=i.company_id and (a->>'scope'='all_company' or assigned_to=i.actor_id);
 if not found or a->>'fingerprint'<>i.authority_fingerprint then raise insufficient_privilege;end if;
 l:=private.instagram_send_link(c);
 if (l.id,l.generation,l.account_id,c.counterparty_id) is distinct from (i.link_id,i.generation,i.account_id,i.recipient_id) then raise exception 'BINDING_CHANGED' using errcode='PIS03';end if;
 select * into g from private.channel_review_grants where id=p_grant_id and company_id=i.company_id and owner_id=i.actor_id
 and channel='instagram' and app_id=l.app_id and asset_id=l.account_id and source_account_id=l.account_id
 and i.recipient_id=any(recipient_ids) and revoked_at is null and expires_at>clock_timestamp() for update nowait;
 if not found then raise exception 'REVIEW_DENIED' using errcode='PRV01';end if;
 perform 1 from private.instagram_manual_contracts where id='manual_text' and secret_fingerprint=g.webhook_secret_sha256 for share nowait;
 if not found then raise exception 'WINDOW_CLOSED' using errcode='PIS02';end if;
 e:=private.instagram_manual_window(c,l,i.window_id)||jsonb_build_object('entitlement_deadline',g.expires_at);
 if exists(select 1 from private.instagram_send_intents where conversation_id=c.id and id<>i.id and state in ('claimed','unknown')) then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
 if not private.instagram_vault_ready() then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where id=$1' into token using l.secret_id;
 if token is null or length(token) not between 1 and 16384 or token ~ '[[:space:][:cntrl:]]' then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 update private.instagram_send_intents set state='claimed',claim_receipt=gen_random_uuid(),claimed_at=clock_timestamp(),
 entitlement_proof=null,entitlement_revision=null,review_grant_id=g.id,window_id=(e->>'window')::uuid where id=i.id returning * into i;
 perform private.reserve_channel_review(g.id,i.company_id,i.actor_id,'instagram',i.account_id,i.recipient_id,i.id,i.claim_receipt);
 perform private.instagram_send_finish(a,e,l,i.expires_at);
 deadline:=least((a->>'deadline')::timestamptz,g.expires_at,(e->>'window_deadline')::timestamptz,l.authorization_expires_at,i.expires_at,clock_timestamp()+interval '10 seconds');
 return jsonb_build_object('kind','fresh','committed',true,'binding',private.instagram_send_binding(i),'claimReceipt',i.claim_receipt,'text',i.content_text,'accessToken',token,'notAfter',deadline);
exception when insufficient_privilege or invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when sqlstate 'PRV01' then return jsonb_build_object('ok',false,'code','ENTITLEMENT_DENIED');
 when sqlstate 'PIS02' then return jsonb_build_object('ok',false,'code','WINDOW_CLOSED');
 when sqlstate 'PIS03' then return jsonb_build_object('ok',false,'code','BINDING_CHANGED');
 when sqlstate 'PIS04' then return jsonb_build_object('ok',false,'code','SEND_DISABLED');
 when unique_violation then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;
notify pgrst,'reload schema';
commit;

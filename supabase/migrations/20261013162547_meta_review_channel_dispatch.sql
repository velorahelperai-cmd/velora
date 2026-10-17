-- Replace nonexistent legacy kernel reference with the exact canonical private core (same853cf body).
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.wa_claim_send_pre_integration(uuid,uuid,integer)')) is distinct from '853cf92ee5ab3e4fae74e0b4c5f4ef0e'
 or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.wa_staff_session_authority(uuid,uuid,uuid,uuid)')) is distinct from 'fbb2385d31deacab2f65535b1b32da59'
 or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.wa_staff_dispatch_provenance()')) is distinct from '6a606d8cb57d1e9d504b6cc7b5b0755d'
 or not exists(select 1 from pg_proc where oid=to_regprocedure('private.wa_claim_send_pre_integration(uuid,uuid,integer)')
  and prosecdef and pg_get_userbyid(proowner)='postgres' and array_to_string(proconfig,',')='search_path=""')
 or has_function_privilege('anon','private.wa_claim_send_pre_integration(uuid,uuid,integer)','EXECUTE')
 or has_function_privilege('authenticated','private.wa_claim_send_pre_integration(uuid,uuid,integer)','EXECUTE')
 or has_function_privilege('service_role','private.wa_claim_send_pre_integration(uuid,uuid,integer)','EXECUTE')
 or not exists(select 1 from pg_trigger where tgrelid='public.whatsapp_send_intents'::regclass
  and tgfoid='private.wa_staff_dispatch_provenance()'::regprocedure and not tgisinternal and tgenabled in ('O','A'))
 then raise exception 'REVIEW_DISPATCH_KERNEL_MISMATCH' using errcode='55000';end if;
end;$$;
-- Separate reviewer evidence and RPCs. The paid dispatch APIs and billing ledger are untouched.
create table private.review_whatsapp_inbound(
 message_id uuid primary key,company_id uuid not null references public.companies(id),conversation_id uuid not null,
 waba_id text not null,phone_number_id text not null,recipient_id text not null,provider_message_id text not null,
 received_at timestamptz not null,secret_sha256 text not null check(secret_sha256 ~ '^[0-9a-f]{64}$')
);
alter table private.review_whatsapp_inbound enable row level security;
revoke all on private.review_whatsapp_inbound from public,anon,authenticated,service_role;
alter table private.instagram_send_intents add column review_grant_id uuid references private.channel_review_grants(id);
alter table public.whatsapp_send_intents add column staff_review_grant_id uuid references private.channel_review_grants(id),
 add constraint wa_staff_review_excludes_billing check(staff_review_grant_id is null or (staff_claim_plan_version_id is null and staff_claim_paid_through is null));
alter table public.whatsapp_send_intents drop constraint wa_staff_dispatch_binding_complete;
alter table public.whatsapp_send_intents add constraint wa_staff_dispatch_binding_complete check(
 (staff_dispatch_token is null and staff_dispatch_authorized_at is null)
 or (staff_dispatch_token is not null and staff_dispatch_authorized_at is not null and sender_kind='staff'
 and staff_actor_session_id is not null and
 ((staff_claim_plan_version_id is not null and staff_review_grant_id is null)
 or (staff_review_grant_id is not null and staff_claim_plan_version_id is null and staff_claim_paid_through is null))));
create function private.whatsapp_review_provenance() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' and new.staff_review_grant_id is not null then raise insufficient_privilege;end if;
 if tg_op='UPDATE' and new.staff_review_grant_id is distinct from old.staff_review_grant_id then
  if old.staff_review_grant_id is not null or new.staff_review_grant_id is null or current_setting('role',true) is distinct from 'service_role'
   or coalesce(current_setting('velora.review_claim_binding',true),'')<>'1' or new.outcome<>'attempting'
   or not exists(select 1 from private.channel_review_uses u join private.channel_review_grants g on g.id=u.grant_id
    where u.channel='whatsapp' and u.intent_id=new.id and u.claim_receipt=new.attempt_token and g.id=new.staff_review_grant_id
    and g.company_id=new.company_id and g.owner_id=new.actor_user_id and g.asset_id=new.phone_number_id
    and new.recipient_wa_id=any(g.recipient_ids) and g.revoked_at is null and g.expires_at>clock_timestamp())
   then raise insufficient_privilege;end if;
 end if;
 if tg_op='UPDATE' and new.staff_review_grant_id is not null and new.staff_dispatch_token is distinct from old.staff_dispatch_token then
  if current_setting('role',true) is distinct from 'authenticated' or new.actor_user_id is distinct from auth.uid()
  or not exists(select 1 from private.channel_review_uses u join private.channel_review_grants g on g.id=u.grant_id
   where u.channel='whatsapp' and u.intent_id=new.id and u.claim_receipt=new.staff_dispatch_token and g.id=new.staff_review_grant_id
   and g.owner_id=new.actor_user_id and g.company_id=new.company_id and g.asset_id=new.phone_number_id
   and new.recipient_wa_id=any(g.recipient_ids) and g.revoked_at is null and g.expires_at>clock_timestamp())
   then raise insufficient_privilege;end if;
 end if;return new;
end;$$;
revoke all on function private.whatsapp_review_provenance() from public,anon,authenticated,service_role;
create trigger whatsapp_review_provenance before insert or update on public.whatsapp_send_intents for each row execute function private.whatsapp_review_provenance();

create function public.review_store_whatsapp_inbound(p_company_id uuid,p_waba_id text,p_phone_number_id text,
 p_customer_wa_id text,p_customer_name text,p_wa_message_id text,p_body text,p_message_type text,
 p_received_at timestamptz,p_secret_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$declare g private.channel_review_grants%rowtype;r jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into g from private.channel_review_grants where company_id=p_company_id and channel='whatsapp'
 and source_account_id=p_waba_id and asset_id=p_phone_number_id and webhook_secret_sha256=p_secret_sha256
 and p_customer_wa_id=any(recipient_ids) and revoked_at is null and expires_at>clock_timestamp() for share nowait;
 if not found or p_received_at is null or not isfinite(p_received_at) or p_received_at>clock_timestamp()
 then return jsonb_build_object('ok',false,'code','review_binding_mismatch');end if;
 r:=public.save_whatsapp_inbound(p_company_id,p_phone_number_id,p_customer_wa_id,p_customer_name,p_wa_message_id,p_body,p_message_type,p_received_at);
 if r->>'ok' is distinct from 'true' then return r;end if;
 insert into private.review_whatsapp_inbound(message_id,company_id,conversation_id,waba_id,phone_number_id,recipient_id,provider_message_id,received_at,secret_sha256)
 values((r->>'message_id')::uuid,p_company_id,(r->>'conversation_id')::uuid,p_waba_id,p_phone_number_id,p_customer_wa_id,p_wa_message_id,p_received_at,p_secret_sha256)
 on conflict(message_id) do nothing;
 return r;
end;$$;

create function private.review_whatsapp_window(p_grant_id uuid,p_conversation_id uuid) returns timestamptz
language plpgsql volatile set search_path='' as $$declare g private.channel_review_grants%rowtype;last_inbound timestamptz;begin
 select * into g from private.channel_review_grants where id=p_grant_id and channel='whatsapp'
 and revoked_at is null and expires_at>clock_timestamp() for share nowait;
 if not found then raise exception 'REVIEW_DENIED' using errcode='PRV01';end if;
 select max(e.received_at) into last_inbound from private.review_whatsapp_inbound e
 join public.whatsapp_messages m on m.id=e.message_id and m.company_id=e.company_id and m.conversation_id=e.conversation_id
 and m.wa_message_id=e.provider_message_id and m.received_at=e.received_at and m.direction='inbound' and m.sender='customer'
 join public.whatsapp_conversations c on c.id=e.conversation_id and c.company_id=e.company_id
 and c.phone_number_id=e.phone_number_id and c.customer_wa_id=e.recipient_id
 where e.company_id=g.company_id and e.conversation_id=p_conversation_id and e.waba_id=g.source_account_id
 and e.phone_number_id=g.asset_id and e.recipient_id=any(g.recipient_ids) and e.secret_sha256=g.webhook_secret_sha256
 and e.received_at<=clock_timestamp() and e.received_at>clock_timestamp()-interval '24 hours';
 if last_inbound is null then raise exception 'WINDOW_CLOSED' using errcode='PIS02';end if;
 return least(last_inbound+interval '24 hours',g.expires_at);
end;$$;

create function public.claim_whatsapp_review_send(p_intent_id uuid,p_actor_user_id uuid,p_grant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.whatsapp_send_intents%rowtype;g private.channel_review_grants%rowtype;r jsonb;proof jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id for update nowait;
 if not found or i.sender_kind<>'staff' or i.actor_user_id is distinct from p_actor_user_id or i.staff_actor_session_id is null
 or i.link_id is not null or i.staff_claim_plan_version_id is not null or i.staff_claim_paid_through is not null then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if i.outcome<>'ready' then return private.wa_claim_send_pre_integration(p_intent_id,p_actor_user_id,90);end if;
 select * into g from private.channel_review_grants where id=p_grant_id and channel='whatsapp' and owner_id=p_actor_user_id
 and company_id=i.company_id and asset_id=i.phone_number_id and i.recipient_wa_id=any(recipient_ids)
 and revoked_at is null and expires_at>clock_timestamp() for update nowait;
 if not found then return jsonb_build_object('ok',false,'code','subscription_inactive');end if;
 perform private.review_whatsapp_window(g.id,i.conversation_id);
 -- The established provider-free core retains conversation/link/capability/attempt/replay guards.
 r:=private.wa_claim_send_pre_integration(p_intent_id,p_actor_user_id,90);
 if r->>'ok'='true' and r->>'claimed'='true' then
  proof:=private.reserve_channel_review(g.id,i.company_id,p_actor_user_id,'whatsapp',i.phone_number_id,i.recipient_wa_id,i.id,(r->>'attempt_token')::uuid);
  perform set_config('velora.review_claim_binding','1',true);
  update public.whatsapp_send_intents set staff_review_grant_id=g.id where id=i.id and attempt_token=(r->>'attempt_token')::uuid;
  perform set_config('velora.review_claim_binding','',true);
  return r||jsonb_build_object('review_entitlement',proof);
 end if;return r;
exception when sqlstate 'PRV01' then return jsonb_build_object('ok',false,'code','subscription_inactive');
 when sqlstate 'PIS02' then return jsonb_build_object('ok',false,'code','service_window_closed');
 when lock_not_available then return jsonb_build_object('ok',false,'code','in_progress');end;$$;

create function public.whatsapp_authorize_review_dispatch(p_intent_id uuid,p_attempt_token uuid,p_grant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.whatsapp_send_intents%rowtype;c public.whatsapp_conversations%rowtype;deadline timestamptz;begin
 if current_setting('role',true) is distinct from 'authenticated' then raise insufficient_privilege;end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id for update nowait;
 if not found or i.sender_kind<>'staff' or i.outcome<>'attempting' or i.actor_user_id is distinct from auth.uid()
 or i.staff_actor_session_id::text is distinct from auth.jwt()->>'session_id' or i.attempt_token is distinct from p_attempt_token
 or p_attempt_token is null or i.staff_dispatch_token is not null or i.link_id is not null or i.staff_review_grant_id is distinct from p_grant_id
 then return jsonb_build_object('ok',false,'code','dispatch_binding_mismatch');end if;
 select * into c from public.whatsapp_conversations where id=i.conversation_id and company_id=i.company_id for share nowait;
 if not found or c.phone_number_id is distinct from i.phone_number_id or c.customer_wa_id is distinct from i.recipient_wa_id
 or not private.wa_staff_session_authority(i.actor_user_id,i.staff_actor_session_id,i.company_id,c.assigned_to)
 then return jsonb_build_object('ok',false,'code','staff_authority_revoked');end if;
 if not exists(select 1 from private.channel_review_uses where channel='whatsapp' and intent_id=i.id and grant_id=p_grant_id and claim_receipt=p_attempt_token)
 then return jsonb_build_object('ok',false,'code','forbidden');end if;
 perform private.reserve_channel_review(p_grant_id,i.company_id,i.actor_user_id,'whatsapp',i.phone_number_id,i.recipient_wa_id,i.id,p_attempt_token);
 deadline:=least(private.review_whatsapp_window(p_grant_id,i.conversation_id),i.attempt_expires_at,clock_timestamp()+interval '10 seconds');
 if deadline is null or deadline<=clock_timestamp() then return jsonb_build_object('ok',false,'code','staff_authority_expired');end if;
 perform set_config('velora.staff_dispatch_binding','1',true);
 update public.whatsapp_send_intents set staff_dispatch_token=p_attempt_token,staff_dispatch_authorized_at=clock_timestamp() where id=i.id;
 perform set_config('velora.staff_dispatch_binding','',true);
 return jsonb_build_object('ok',true,'authorized',true,'intent_id',i.id,'not_after',deadline);
exception when sqlstate 'PRV01' then return jsonb_build_object('ok',false,'code','paid_entitlement_unconfirmed');
 when sqlstate 'PIS02' then return jsonb_build_object('ok',false,'code','service_window_closed');
 when lock_not_available then return jsonb_build_object('ok',false,'code','dispatch_authority_busy');end;$$;

create function public.instagram_review_send_readiness(p_company_id uuid,p_conversation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare r jsonb;begin
 r:=public.instagram_send_readiness(p_company_id,p_conversation_id);if r->>'ok' is distinct from 'true' then return r;end if;
 if exists(select 1 from private.channel_review_grants g join private.instagram_conversations c on c.company_id=g.company_id
 join private.instagram_company_links l on l.company_id=c.company_id and l.account_id=c.account_id and l.status='active'
 where g.company_id=p_company_id and c.id=p_conversation_id and g.channel='instagram' and g.owner_id=auth.uid()
 and g.asset_id=c.account_id and g.source_account_id=c.account_id and g.app_id=l.app_id
 and c.counterparty_id=any(g.recipient_ids) and g.revoked_at is null and g.expires_at>clock_timestamp() and g.used_count<g.send_limit)
 then r:=jsonb_set(r,'{blockers}',(r->'blockers')-'ENTITLEMENT_DENIED');end if;
 return r;end;$$;

create function public.instagram_claim_review_send(p_binding jsonb,p_grant_id uuid) returns jsonb
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
 perform 1 from private.instagram_send_policy where id='manual_text' and enabled for share nowait;if not found then raise exception 'SEND_DISABLED' using errcode='PIS04';end if;
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

revoke all on function private.review_whatsapp_window(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.review_store_whatsapp_inbound(uuid,text,text,text,text,text,text,text,timestamptz,text),public.claim_whatsapp_review_send(uuid,uuid,uuid),public.whatsapp_authorize_review_dispatch(uuid,uuid,uuid),public.instagram_review_send_readiness(uuid,uuid),public.instagram_claim_review_send(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.review_store_whatsapp_inbound(uuid,text,text,text,text,text,text,text,timestamptz,text),public.claim_whatsapp_review_send(uuid,uuid,uuid),public.instagram_claim_review_send(jsonb,uuid) to service_role;
grant execute on function public.whatsapp_authorize_review_dispatch(uuid,uuid,uuid),public.instagram_review_send_readiness(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

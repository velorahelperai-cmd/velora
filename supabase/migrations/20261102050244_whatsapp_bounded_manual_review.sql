begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table private.channel_review_grants drop constraint channel_review_grants_send_limit_check;
alter table private.channel_review_grants add constraint channel_review_grants_send_limit_check check(send_limit in (1,50));
-- Registry-bound review uses the existing signed inbound evidence, not the legacy test-secret ledger.
alter table private.channel_review_grants alter column webhook_secret_sha256 drop not null;
alter table private.channel_review_grants add column review_conversation_id uuid references public.whatsapp_conversations(id),
 add column review_link_id uuid references public.whatsapp_company_links(id),
 add column review_link_generation bigint,
 add column review_body_sha256 text;
alter table private.channel_review_grants add constraint channel_review_single_binding check(
 (send_limit=50 and webhook_secret_sha256 is not null and review_conversation_id is null and review_link_id is null and review_link_generation is null and review_body_sha256 is null)
 or (send_limit=1 and webhook_secret_sha256 is null and channel='whatsapp' and cardinality(recipient_ids)=1 and used_count<=1
 and review_conversation_id is not null and review_link_id is not null and review_link_generation is not null
 and review_body_sha256 ~ '^[0-9a-f]{64}$' and review_body_sha256 is not null
 and expires_at<=created_at+interval '1 hour'));
create function private.wa_review_binding_current(g private.channel_review_grants,i public.whatsapp_send_intents) returns boolean
language sql stable set search_path='' as $$
 select g.send_limit=1 and i.sender_kind='staff' and g.company_id=i.company_id and g.owner_id=i.actor_user_id
 and g.channel='whatsapp' and g.asset_id=i.phone_number_id and i.recipient_wa_id=any(g.recipient_ids)
 and (g.review_conversation_id,g.review_link_id,g.review_link_generation)=(i.conversation_id,i.link_id,i.link_generation)
 and g.review_body_sha256=encode(sha256(convert_to(i.body,'UTF8')),'hex')
 and g.revoked_at is null and g.expires_at>clock_timestamp()
 and private.whatsapp_intent_link_current(i)
 and not private.wa_f5_number_unconfirmed(i.link_id,i.link_generation)
 and exists(select 1 from public.whatsapp_company_links l where l.id=i.link_id and l.provider_waba_id=g.source_account_id)
$$;
revoke all on function private.wa_review_binding_current(private.channel_review_grants,public.whatsapp_send_intents) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.channel_review_public(g private.channel_review_grants)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$select jsonb_build_object('id',g.id,'channel',g.channel,
 'app_id',g.app_id,'asset_id',g.asset_id,'source_account_id',g.source_account_id,'recipient_ids',g.recipient_ids,
 'send_limit',g.send_limit,'used_count',g.used_count,'expires_at',g.expires_at,'revoked_at',g.revoked_at,'review_conversation_id',g.review_conversation_id,'review_link_id',g.review_link_id,'review_link_generation',g.review_link_generation,'review_body_sha256',g.review_body_sha256)$function$;

CREATE OR REPLACE FUNCTION private.review_whatsapp_window(p_grant_id uuid, p_conversation_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare g private.channel_review_grants%rowtype;last_inbound timestamptz;w jsonb;begin
 select * into g from private.channel_review_grants where id=p_grant_id and channel='whatsapp'
 and revoked_at is null and expires_at>clock_timestamp() for share nowait;
 if not found then raise exception 'REVIEW_DENIED' using errcode='PRV01';end if;
 if g.send_limit=1 then
  if g.review_conversation_id is distinct from p_conversation_id then raise exception 'REVIEW_DENIED' using errcode='PRV01';end if;
  w:=private.whatsapp_service_window(g.company_id,p_conversation_id,g.asset_id,g.recipient_ids[1]);
  if w->>'ok' is distinct from 'true' then raise exception 'WINDOW_CLOSED' using errcode='PIS02';end if;
  return least((w->>'valid_until')::timestamptz,g.expires_at);
 end if;
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
end;$function$;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_review_send(p_intent_id uuid, p_actor_user_id uuid, p_grant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.whatsapp_send_intents%rowtype;g private.channel_review_grants%rowtype;r jsonb;proof jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id for update nowait;
 if not found or i.sender_kind<>'staff' or i.actor_user_id is distinct from p_actor_user_id or i.staff_actor_session_id is null
 or i.staff_claim_plan_version_id is not null or i.staff_claim_paid_through is not null then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if i.outcome<>'ready' then
  if to_regprocedure('private.wa_claim_pre_fixed_ack(uuid,uuid,integer)') is not null then return private.wa_claim_pre_fixed_ack(p_intent_id,p_actor_user_id,90);
  else return private.wa_claim_send_pre_integration(p_intent_id,p_actor_user_id,90);end if;
 end if;
 select * into g from private.channel_review_grants where id=p_grant_id and channel='whatsapp' and owner_id=p_actor_user_id
 and company_id=i.company_id and asset_id=i.phone_number_id and i.recipient_wa_id=any(recipient_ids)
 and revoked_at is null and expires_at>clock_timestamp() for update nowait;
 if not found then return jsonb_build_object('ok',false,'code','subscription_inactive');end if;
 if (i.link_id is not null or g.send_limit=1) and not coalesce(private.wa_review_binding_current(g,i),false)
 then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if private.wa_f5_number_unconfirmed(i.link_id,i.link_generation) then return jsonb_build_object('ok',false,'code','number_unconfirmed');end if;
 perform private.review_whatsapp_window(g.id,i.conversation_id);
 -- The established provider-free core retains conversation/link/capability/attempt/replay guards.
 if to_regprocedure('private.wa_claim_pre_fixed_ack(uuid,uuid,integer)') is not null then r:=private.wa_claim_pre_fixed_ack(p_intent_id,p_actor_user_id,90);
 else r:=private.wa_claim_send_pre_integration(p_intent_id,p_actor_user_id,90);end if;
 if r->>'ok'='true' and r->>'claimed'='true' then
  proof:=private.reserve_channel_review(g.id,i.company_id,p_actor_user_id,'whatsapp',i.phone_number_id,i.recipient_wa_id,i.id,(r->>'attempt_token')::uuid);
  perform set_config('velora.review_claim_binding','1',true);
  update public.whatsapp_send_intents set staff_review_grant_id=g.id where id=i.id and attempt_token=(r->>'attempt_token')::uuid;
  perform set_config('velora.review_claim_binding','',true);
  return r||jsonb_build_object('review_entitlement',proof);
 end if;return r;
exception when sqlstate 'PRV01' then return jsonb_build_object('ok',false,'code','subscription_inactive');
 when sqlstate 'PIS02' then return jsonb_build_object('ok',false,'code','service_window_closed');
 when lock_not_available then return jsonb_build_object('ok',false,'code','in_progress');end;$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_authorize_review_dispatch(p_intent_id uuid, p_attempt_token uuid, p_grant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.whatsapp_send_intents%rowtype;c public.whatsapp_conversations%rowtype;deadline timestamptz;g private.channel_review_grants%rowtype;begin
 if current_setting('role',true) is distinct from 'authenticated' then raise insufficient_privilege;end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id for update nowait;
 if not found or i.sender_kind<>'staff' or i.outcome<>'attempting' or i.actor_user_id is distinct from auth.uid()
 or i.staff_actor_session_id::text is distinct from auth.jwt()->>'session_id' or i.attempt_token is distinct from p_attempt_token
 or p_attempt_token is null or i.staff_dispatch_token is not null or i.staff_review_grant_id is distinct from p_grant_id
 then return jsonb_build_object('ok',false,'code','dispatch_binding_mismatch');end if;
 select * into g from private.channel_review_grants where id=p_grant_id for share nowait;
 if not found or ((i.link_id is not null or g.send_limit=1) and not coalesce(private.wa_review_binding_current(g,i),false))
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
 when lock_not_available then return jsonb_build_object('ok',false,'code','dispatch_authority_busy');end;$function$;
notify pgrst,'reload schema';
commit;

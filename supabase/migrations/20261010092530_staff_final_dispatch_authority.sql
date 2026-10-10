-- Final staff dispatch authority. No history backfill and no provider execution.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ declare dep record;begin
 for dep in select * from (values
 ('public.claim_whatsapp_send_attempt(uuid,uuid,integer)','e28d52bfcd28f27b2c66f9716f6d3b6e',true),
 ('public.create_whatsapp_send_intent(text,uuid,text,text,text,integer,uuid,bigint)','98492951acc1aaa450edbed744f844d2',true),
 ('private.whatsapp_intent_link_current(public.whatsapp_send_intents)','e557d989aab6179bd94187b6793f7c85',false),
 ('private.whatsapp_meta_asset_binding(text,text)','d41fd2cd01f12c9f9e1c74b0b5836854',true),
 ('private.whatsapp_service_window(uuid,uuid,text,text)','5cc2de8943bfc95fa5ac64153f94c094',true),
 ('public.check_app_session(boolean)','f69c473d94466a93d1d793bbd447478e',true),
 ('private.user_has_company_capability(uuid,uuid,text)','6c80dd4bc189be45e8f8d19a65618816',true),
 ('private.user_conversation_readable(uuid,uuid,uuid)','3510e656e96864d5ef4d8aad9ba58aba',true),
 ('private.manager_delegation_covers(uuid,uuid,text)','e40560405951958297adb06ff0b97bc3',true),
 ('private.billing_service_receipt_eligible(uuid)','b7d82e7e8fefc05c22f876f1ac00b7c2',false)
 ) dependencies(signature,body_hash,definer) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(dep.signature)
   and md5(replace(prosrc,chr(13),''))=dep.body_hash and prosecdef=dep.definer and array_to_string(proconfig,',')='search_path=""') then
   raise exception 'STAFF_DISPATCH_PREREQUISITE_MISMATCH: %',dep.signature using errcode='55000';end if;
 end loop;
 if current_user<>(select pg_get_userbyid(relowner) from pg_class where oid='public.whatsapp_send_intents'::regclass) then raise exception 'STAFF_DISPATCH_TABLE_OWNER_MISMATCH' using errcode='55000';end if;
 if to_regprocedure('public.claim_whatsapp_send_attempt(uuid,uuid,integer)') is null
 or to_regprocedure('private.whatsapp_service_window(uuid,uuid,text,text)') is null
 or to_regprocedure('public.check_app_session(boolean)') is null
 or md5(replace(pg_get_viewdef('private.billing_proven_entitlement_grants'::regclass,true),chr(13),''))<>'6c6d6a29a1dfae3e667948901044a7b1'
 then raise exception 'STAFF_DISPATCH_PREREQUISITE_MISMATCH' using errcode='55000';end if;
 if has_function_privilege('authenticated','public.claim_whatsapp_send_attempt(uuid,uuid,integer)','EXECUTE')
 or has_function_privilege('anon','public.claim_whatsapp_send_attempt(uuid,uuid,integer)','EXECUTE')
 or not has_function_privilege('service_role','public.claim_whatsapp_send_attempt(uuid,uuid,integer)','EXECUTE')
 then raise exception 'STAFF_DISPATCH_CLAIM_ACL_MISMATCH' using errcode='55000';end if;
 if md5(replace(pg_get_viewdef('private.billing_verified_collection_history'::regclass,true),chr(13),''))<>'cdda398ed1d2f6bf1b0a4db89fcced9f'
 or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.billing_financial_receipt_immutability()'::regprocedure)<>'968854ccf1b251404062386ea9f2fe2f'
 or (select count(*) from pg_trigger where tgfoid='private.billing_financial_receipt_immutability()'::regprocedure
 and not tgisinternal and tgenabled in ('O','A') and (tgrelid,tgname) in (
 ('public.billing_provider_events'::regclass,'billing_provider_receipt_immutability'),
 ('public.billing_entitlement_applications'::regclass,'billing_entitlement_receipt_immutability'),
 ('public.billing_settlement_outcomes'::regclass,'billing_settlement_receipt_immutability'),
 ('public.billing_provider_events'::regclass,'billing_provider_receipt_no_truncate'),
 ('public.billing_entitlement_applications'::regclass,'billing_entitlement_receipt_no_truncate'),
 ('public.billing_settlement_outcomes'::regclass,'billing_settlement_receipt_no_truncate')))<>6
 then raise exception 'STAFF_DISPATCH_RECEIPT_GUARD_MISMATCH' using errcode='55000';end if;
end; $$;
alter table public.whatsapp_send_intents
 add column staff_actor_session_id uuid,
 add column staff_claim_plan_version_id uuid,
 add column staff_claim_paid_through timestamptz,
 add column staff_dispatch_token uuid,
 add column staff_dispatch_authorized_at timestamptz,
 add constraint wa_staff_payment_binding_complete check ((staff_claim_plan_version_id is null and staff_claim_paid_through is null)
 or (staff_claim_plan_version_id is not null and staff_claim_paid_through is not null)),
 add constraint wa_staff_dispatch_binding_complete check ((staff_dispatch_token is null and staff_dispatch_authorized_at is null)
 or (staff_dispatch_token is not null and staff_dispatch_authorized_at is not null and sender_kind='staff'
 and staff_actor_session_id is not null and staff_claim_plan_version_id is not null));

create function private.wa_staff_session_authority(p_actor uuid,p_session uuid,p_company uuid,p_assigned uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare manager uuid; member_role text; session_deadline timestamptz; now_at timestamptz;begin
 if current_setting('role',true)<>'authenticated' or auth.uid() is distinct from p_actor
 or p_actor is null or p_session is null or (auth.jwt()->>'session_id') is distinct from p_session::text then return false;end if;
 -- Business locks come first. NOWAIT avoids cycles with session deletion,
 -- profile edits and multi-statement membership/delegation revocation.
 perform 1 from auth.users where id=p_actor for share nowait;if not found then return false;end if;
 select (to_jsonb(s)->>'not_after')::timestamptz into session_deadline from auth.sessions s
 where s.id=p_session and s.user_id=p_actor for share nowait;if not found then return false;end if;
 -- Activity was initialized by the existing authenticated access path.
 -- Missing history fails closed; never wait on it before the NOWAIT lock.
 perform 1 from private.app_session_activity where session_id=p_session and user_id=p_actor for update nowait;
 if not found then return false;end if;
 select role into member_role from public.company_members where company_id=p_company and user_id=p_actor for share nowait;
 if not found then return false;end if;
 if member_role='staff' then
  select manager_user_id into manager from public.company_member_grants where company_id=p_company and user_id=p_actor for share nowait;
  if not found then return false;end if;
  if manager is not null then
   perform 1 from public.platform_admins where user_id=manager for share nowait;if not found then return false;end if;
   perform 1 from public.platform_admin_scopes where admin_user_id=manager and company_id=p_company for share nowait;
   if not found then return false;end if;
  end if;
 end if;
 now_at:=clock_timestamp();
 return (public.check_app_session(false)->>'ok')='true'
 and coalesce((auth.jwt()->>'exp')::numeric,0)>extract(epoch from now_at)
 and (session_deadline is null or session_deadline>now_at)
 and exists(select 1 from auth.users u where id=p_actor and (email_confirmed_at is not null or phone_confirmed_at is not null)
 and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity'::timestamptz)<=clock_timestamp())
 and exists(select 1 from public.company_members where company_id=p_company and user_id=p_actor and status='active' and role in ('owner','staff'))
 and private.user_has_company_capability(p_actor,p_company,'wa.conversations.reply')
 and private.user_conversation_readable(p_actor,p_company,p_assigned);
 exception when lock_not_available or invalid_text_representation or numeric_value_out_of_range then return false;
end; $$;
revoke all on function private.wa_staff_session_authority(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.wa_staff_dispatch_provenance() returns trigger
language plpgsql set search_path='' as $$
declare sid uuid;assigned uuid;begin
 if tg_op='INSERT' then
  if new.staff_actor_session_id is not null or new.staff_claim_plan_version_id is not null
  or new.staff_claim_paid_through is not null or new.staff_dispatch_token is not null or new.staff_dispatch_authorized_at is not null
  then raise exception 'STAFF_PROVENANCE_SERVER_ONLY' using errcode='23514';end if;
  if new.sender_kind='staff' and current_setting('role',true)='authenticated' then
   begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then sid:=null;end;
   perform 1 from public.companies where id=new.company_id and status='active' for share nowait;
   if not found then raise exception 'STAFF_ACTOR_UNAUTHORIZED' using errcode='42501';end if;
   select assigned_to into assigned from public.whatsapp_conversations where id=new.conversation_id and company_id=new.company_id;
   if not found or not private.wa_staff_session_authority(new.actor_user_id,sid,new.company_id,assigned)
   then raise exception 'STAFF_ACTOR_UNAUTHORIZED' using errcode='42501';end if;
   new.staff_actor_session_id:=sid;
  end if;
 else
  if row(new.actor_user_id,new.staff_actor_session_id,new.company_id,new.conversation_id,new.phone_number_id,new.recipient_wa_id,new.body,new.sender_kind,new.link_id,new.link_generation)
  is distinct from row(old.actor_user_id,old.staff_actor_session_id,old.company_id,old.conversation_id,old.phone_number_id,old.recipient_wa_id,old.body,old.sender_kind,old.link_id,old.link_generation)
  then raise exception 'STAFF_PROVENANCE_IMMUTABLE' using errcode='23514';end if;
  if row(new.staff_claim_plan_version_id,new.staff_claim_paid_through) is distinct from row(old.staff_claim_plan_version_id,old.staff_claim_paid_through) then
   if current_user<>(select pg_get_userbyid(relowner) from pg_class where oid='public.whatsapp_send_intents'::regclass)
   or old.staff_claim_plan_version_id is not null or new.staff_claim_plan_version_id is null
   or old.outcome<>'attempting' or new.outcome<>'attempting' or old.attempt_token is null
   or new.staff_actor_session_id is null or coalesce(current_setting('velora.staff_claim_binding',true),'')<>'1'
   then raise exception 'STAFF_PAYMENT_BINDING_IMMUTABLE' using errcode='23514';end if;
  end if;
  if row(new.staff_dispatch_token,new.staff_dispatch_authorized_at) is distinct from row(old.staff_dispatch_token,old.staff_dispatch_authorized_at) then
   if current_user<>(select pg_get_userbyid(relowner) from pg_class where oid='public.whatsapp_send_intents'::regclass)
   or old.staff_dispatch_token is not null or new.staff_dispatch_token is null or old.outcome<>'attempting'
   or new.outcome<>'attempting' or new.staff_dispatch_token is distinct from old.attempt_token
   or coalesce(current_setting('velora.staff_dispatch_binding',true),'')<>'1'
   then raise exception 'STAFF_DISPATCH_BINDING_IMMUTABLE' using errcode='23514';end if;
  end if;
 end if;return new;
end; $$;
revoke all on function private.wa_staff_dispatch_provenance() from public,anon,authenticated,service_role;
create trigger whatsapp_staff_dispatch_provenance before insert or update on public.whatsapp_send_intents
for each row execute function private.wa_staff_dispatch_provenance();

alter function public.claim_whatsapp_send_attempt(uuid,uuid,integer) set schema private;
alter function private.claim_whatsapp_send_attempt(uuid,uuid,integer) rename to wa_claim_staff_pre_dispatch_authority;
revoke all on function private.wa_claim_staff_pre_dispatch_authority(uuid,uuid,integer) from public,anon,authenticated,service_role;
create function public.claim_whatsapp_send_attempt(p_intent_id uuid,p_actor_user_id uuid,p_lease_seconds integer default 90)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.whatsapp_send_intents%rowtype;r jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id;
 if i.staff_actor_session_id is not null and i.actor_user_id is distinct from p_actor_user_id then
  return jsonb_build_object('ok',false,'code','forbidden');end if;
 r:=private.wa_claim_staff_pre_dispatch_authority(p_intent_id,p_actor_user_id,p_lease_seconds);
 if r->>'ok'='true' and r->>'claimed'='true' and i.staff_actor_session_id is not null then
  perform set_config('velora.staff_claim_binding','1',true);
  update public.whatsapp_send_intents set staff_claim_plan_version_id=(r->'manual_paid_entitlement'->>'plan_version_id')::uuid,
   staff_claim_paid_through=(r->'manual_paid_entitlement'->>'paid_through')::timestamptz
  where id=p_intent_id and outcome='attempting' and attempt_token=(r->>'attempt_token')::uuid;
  perform set_config('velora.staff_claim_binding','',true);
 end if;return r;
end; $$;
revoke all on function public.claim_whatsapp_send_attempt(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_send_attempt(uuid,uuid,integer) to service_role;

create function public.whatsapp_authorize_staff_dispatch(p_intent_id uuid,p_attempt_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.whatsapp_send_intents%rowtype;c public.whatsapp_conversations%rowtype;
 s public.billing_subscriptions%rowtype;g record;window_gate jsonb;now_at timestamptz;begin
 if current_setting('role',true)<>'authenticated' or auth.uid() is null then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id;
 if not found or i.sender_kind<>'staff' or i.actor_user_id is distinct from auth.uid()
 or i.staff_actor_session_id is null or i.staff_actor_session_id::text is distinct from auth.jwt()->>'session_id'
 or p_attempt_token is null or i.attempt_token is distinct from p_attempt_token
 then return jsonb_build_object('ok',false,'code','dispatch_binding_mismatch');end if;
 -- Same business lock order as claim, payment settlement and recovery.
 perform 1 from public.companies where id=i.company_id for no key update;
 select * into s from public.billing_subscriptions where company_id=i.company_id and environment='live' for no key update;
 select * into c from public.whatsapp_conversations where id=i.conversation_id and company_id=i.company_id for update;
 select * into i from public.whatsapp_send_intents where id=p_intent_id for update;
 if i.staff_dispatch_token is not null then return jsonb_build_object('ok',false,'code','dispatch_already_authorized');end if;
 if i.outcome<>'attempting' or i.attempt_token is distinct from p_attempt_token
 or i.actor_user_id is distinct from auth.uid() or i.staff_actor_session_id::text is distinct from auth.jwt()->>'session_id'
 or c.id is null or c.phone_number_id is distinct from i.phone_number_id or c.customer_wa_id is distinct from i.recipient_wa_id
 then return jsonb_build_object('ok',false,'code','dispatch_binding_mismatch');end if;
 if not exists(select 1 from public.companies where id=i.company_id and status='active')
 or not private.wa_staff_session_authority(i.actor_user_id,i.staff_actor_session_id,i.company_id,c.assigned_to)
 then return jsonb_build_object('ok',false,'code','staff_authority_revoked');end if;
 -- Lock the exact receipt read set. NOWAIT also covers reverse-order administrative edits.
 select * into g from private.billing_proven_entitlement_grants where subscription_id=s.id and company_id=i.company_id
 and provider_environment='live' and plan_version_id=s.plan_version_id and applied_paid_through=s.paid_through order by id limit 1;
 if g.id is null then return jsonb_build_object('ok',false,'code','paid_entitlement_unconfirmed');end if;
 perform 1 from public.billing_entitlement_applications where id=g.id for share nowait;
 perform 1 from public.billing_orders where id=g.order_id for share nowait;
 perform 1 from public.billing_payment_attempts where id=g.payment_attempt_id for share nowait;
 perform 1 from public.billing_provider_events where id=g.provider_event_id for share nowait;
 perform 1 from public.billing_settlement_outcomes where entitlement_application_id=g.id for share nowait;
 if i.link_id is not null then perform 1 from public.whatsapp_company_links where id=i.link_id for share nowait;end if;
 if not private.whatsapp_intent_link_current(i) then return jsonb_build_object('ok',false,'code','link_changed');end if;
 window_gate:=private.whatsapp_service_window(i.company_id,i.conversation_id,i.phone_number_id,i.recipient_wa_id);
 now_at:=clock_timestamp();
 if window_gate->>'ok' is distinct from 'true' or (window_gate->>'valid_until')::timestamptz<=now_at
 then return jsonb_build_object('ok',false,'code','service_window_closed');end if;
 -- Final time and proof checks after all locks/window work; retain immutable evidence.
 if i.attempt_expires_at is null or i.attempt_expires_at<=now_at
 or not private.wa_staff_session_authority(i.actor_user_id,i.staff_actor_session_id,i.company_id,c.assigned_to)
 then return jsonb_build_object('ok',false,'code','staff_authority_expired');end if;
 if s.status not in ('active','cancel_at_period_end') or s.paid_through<=clock_timestamp()
 or i.staff_claim_plan_version_id is distinct from s.plan_version_id or i.staff_claim_paid_through is distinct from s.paid_through
 or not exists(select 1 from private.billing_proven_entitlement_grants where id=g.id and subscription_id=s.id
 and company_id=i.company_id and provider_environment='live' and plan_version_id=s.plan_version_id and applied_paid_through=s.paid_through)
 or not private.billing_service_receipt_eligible(g.id)
 then return jsonb_build_object('ok',false,'code','paid_entitlement_unconfirmed');end if;
 perform set_config('velora.staff_dispatch_binding','1',true);
 update public.whatsapp_send_intents set staff_dispatch_token=p_attempt_token,staff_dispatch_authorized_at=clock_timestamp() where id=i.id;
 perform set_config('velora.staff_dispatch_binding','',true);
 return jsonb_build_object('ok',true,'authorized',true,'intent_id',i.id);
 exception when lock_not_available then return jsonb_build_object('ok',false,'code','dispatch_authority_busy');
end; $$;
revoke all on function public.whatsapp_authorize_staff_dispatch(uuid,uuid) from public,anon,service_role;
grant execute on function public.whatsapp_authorize_staff_dispatch(uuid,uuid) to authenticated;
comment on function public.whatsapp_authorize_staff_dispatch(uuid,uuid) is
 'One-use staff dispatch authorization after Vault/window preparation. JWT actor/session, stored claim, current RBAC/tenant/Meta and exact proven Live receipt. Never recalls an already initiated provider request; replay/uncertainty never authorizes another send.';
notify pgrst,'reload schema';
commit;

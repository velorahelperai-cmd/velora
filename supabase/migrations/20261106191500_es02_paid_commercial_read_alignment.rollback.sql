-- Rollback companion for 20261106191500_es02_paid_commercial_read_alignment.sql
-- Restores commercial-only send/display proof (pre-ES02 alignment). Reply fence
-- from 20261106180000 is left in place; roll that migration separately if needed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $display$
declare
  source text;
  patched text;
  new_paid text := $n$paid:=exists(select 1 from private.billing_proven_entitlement_grants g where g.company_id=p_company_id and g.provider_environment='live' and private.billing_service_receipt_eligible(g.id)) or private.billing_es02_live_paid_through(p_company_id) is not null;$n$;
  old_paid text := $n$paid:=exists(select 1 from private.billing_proven_entitlement_grants g where g.company_id=p_company_id and g.provider_environment='live' and private.billing_service_receipt_eligible(g.id));$n$;
  new_branch text := $n$if s.id is null or s.paid_through is null then
  current_proof:=false;
  bound:=false;
 elsif s.plan_version_id is null then
  current_proof:=private.billing_es02_live_paid_through(p_company_id) is not distinct from s.paid_through;
  bound:=current_proof;
  paid:=paid or current_proof;
 else$n$;
  old_branch text := $n$if s.id is null or s.plan_version_id is null or s.paid_through is null then
  current_proof:=false;
  bound:=false;
 else$n$;
begin
  select pg_get_functiondef('public.billing_read_company_display_evidence(uuid)'::regprocedure)
    into source;
  if position('billing_es02_live_paid_through(p_company_id)' in source) = 0 then
    return;
  end if;
  patched := replace(source, new_paid, old_paid);
  patched := replace(patched, new_branch, old_branch);
  if patched = source then
    raise exception 'ES02_DISPLAY_ROLLBACK_NO_CHANGE';
  end if;
  execute patched;
end;
$display$;

do $send$
declare
  p record;
begin
  select prosrc, proowner, proacl, proconfig, prosecdef, provolatile
    into strict p
  from pg_proc
  where oid = to_regprocedure('private.billing_chat_send(uuid)');
  if position('ES02_PAID_COMMERCIAL_SEND' in p.prosrc) = 0 then
    return;
  end if;
  execute $definition$
create or replace function private.billing_chat_send(cid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $body$
begin /* F40_LAZY_SEND_PROOF */
  if private.billing_lifecycle_receipt(cid) is null then
    return not exists (
      select 1
      from public.billing_subscriptions
      where company_id = cid
        and environment = 'live'
        and paid_through is not null
    );
  end if;
  return exists (
    select 1
    from public.billing_subscriptions s
    join private.billing_proven_entitlement_grants g
      on g.subscription_id = s.id
     and g.company_id = s.company_id
     and g.plan_version_id = s.plan_version_id
    where s.company_id = cid
      and s.environment = 'live'
      and g.provider_environment = 'live'
      and s.paid_through = g.applied_paid_through
      and s.status in ('active', 'cancel_at_period_end')
      and g.applied_paid_through > statement_timestamp()
      and private.billing_service_receipt_eligible(g.id)
  );
end;
$body$
$definition$;
end;
$send$;

do $policy$
declare
  p record;
begin
  select prosrc, proowner, proacl, proconfig, prosecdef, provolatile
    into strict p
  from pg_proc
  where oid = to_regprocedure('private.billing_chat_policy(uuid,text)');
  if position('ES02_PAID_COMMERCIAL_POLICY' in p.prosrc) = 0 then
    return;
  end if;
  execute $definition$
create or replace function private.billing_chat_policy(cid uuid, channel text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare r jsonb;e timestamptz;begin
 r:=private.billing_lifecycle_receipt(cid);if r is null then return not exists(select 1 from public.billing_subscriptions where company_id=cid and environment='live' and paid_through is not null);end if;
 e:=(r->>'expiredAt')::timestamptz;
 if statement_timestamp()>=e+interval '720 hours' then return false;end if;
 if statement_timestamp()<e and exists(select 1 from private.billing_expiry_episodes where company_id=cid and disconnected_at is not null) then
  if channel='instagram' then return exists(select 1 from private.instagram_company_links l join private.instagram_company_generations g on g.company_id=l.company_id and g.bound_account_id=l.account_id and g.generation=l.generation where l.company_id=cid and l.status='active' and l.authorization_expires_at>statement_timestamp());end if;
  if channel='whatsapp' then return exists(select 1 from public.whatsapp_company_links where company_id=cid and status='verified' and authorization_status='active' and (authorization_expires_at>statement_timestamp() or (authorization_expires_at is null and authorization_non_expiring)));end if;
 end if;return true;
end;$function$;
$definition$;
end;
$policy$;

drop function if exists private.billing_es02_live_paid_through(uuid);


-- Restore original constraints and functions
alter table public.whatsapp_send_intents
  drop constraint if exists wa_staff_payment_binding_complete;
alter table public.whatsapp_send_intents
  add constraint wa_staff_payment_binding_complete
  check ((((staff_claim_plan_version_id is null) and (staff_claim_paid_through is null)) or ((staff_claim_plan_version_id is not null) and (staff_claim_paid_through is not null))));

alter table public.whatsapp_send_intents
  drop constraint if exists wa_staff_dispatch_binding_complete;
alter table public.whatsapp_send_intents
  add constraint wa_staff_dispatch_binding_complete
  check ((((staff_dispatch_token is null) and (staff_dispatch_authorized_at is null)) or ((staff_dispatch_token is not null) and (staff_dispatch_authorized_at is not null) and (sender_kind = 'staff'::text) and (staff_actor_session_id is not null) and (((staff_claim_plan_version_id is not null) and (staff_review_grant_id is null)) or ((staff_review_grant_id is not null) and (staff_claim_plan_version_id is null) and (staff_claim_paid_through is null))))));

create or replace function private.wa_staff_dispatch_provenance()
returns trigger
language plpgsql
security definer
set search_path to ''
as $body$
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
   if current_user is distinct from (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid='public.whatsapp_send_intents'::regclass)
   or old.staff_claim_plan_version_id is not null or new.staff_claim_plan_version_id is null
   or old.outcome<>'attempting' or new.outcome<>'attempting' or old.attempt_token is null
   or new.staff_actor_session_id is null or coalesce(current_setting('velora.staff_claim_binding',true),'')<>'1'
   then raise exception 'STAFF_PAYMENT_BINDING_IMMUTABLE' using errcode='23514';end if;
  end if;
  if row(new.staff_dispatch_token,new.staff_dispatch_authorized_at) is distinct from row(old.staff_dispatch_token,old.staff_dispatch_authorized_at) then
   if current_user is distinct from (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid='public.whatsapp_send_intents'::regclass)
   or old.staff_dispatch_token is not null or new.staff_dispatch_token is null or old.outcome<>'attempting'
   or new.outcome<>'attempting' or new.staff_dispatch_token is distinct from old.attempt_token
   or coalesce(current_setting('velora.staff_dispatch_binding',true),'')<>'1'
   then raise exception 'STAFF_DISPATCH_BINDING_IMMUTABLE' using errcode='23514';end if;
  end if;
 end if;return new;
end;
$body$;

create or replace function public.billing_read_company_operational_entitlement(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare s public.billing_subscriptions%rowtype; trusted boolean;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
  and current_setting('role',true) is distinct from 'service_role'
  and not private.billing_ui_company_owner(p_company_id) then
  return jsonb_build_object('ok',false,'code','forbidden');
 end if;
 select * into s from public.billing_subscriptions where company_id=p_company_id and environment='live';
 if not found then return jsonb_build_object('ok',true,'active',false,'environment','live','status','none',
  'paid_through',null,'plan_version_id',null,'cancel_at_period_end',false);end if;
 trusted:=exists(select 1 from private.billing_proven_entitlement_grants g where g.subscription_id=s.id
  and g.company_id=p_company_id and g.provider_environment='live' and g.applied_paid_through=s.paid_through
  and g.plan_version_id=s.plan_version_id);
 return jsonb_build_object('ok',true,'active',trusted and s.status in ('active','cancel_at_period_end')
  and s.paid_through>statement_timestamp()
  and exists(select 1 from public.companies c where c.id=p_company_id and c.status<>'suspended'),
  'environment','live','status',s.status,
  'paid_through',case when trusted then s.paid_through else null end,
  'plan_version_id',case when trusted then s.plan_version_id else null end,'cancel_at_period_end',s.cancel_at_period_end);
end;
$body$;

revoke all on function public.billing_read_company_operational_entitlement(uuid) from public, anon;
grant execute on function public.billing_read_company_operational_entitlement(uuid) to authenticated, service_role;

create or replace function private.wa_f5_pre_number_gate_claim_staff(p_intent_id uuid, p_actor_user_id uuid, p_lease_seconds integer default 90)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
declare i public.whatsapp_send_intents%rowtype;r jsonb;proof jsonb;g record;s public.billing_subscriptions%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id;
 if found and i.sender_kind='assistant' then return jsonb_build_object('ok',false,'code','assistant_job_required');end if;
 if found then
  perform 1 from public.companies where id=i.company_id for no key update;
  perform 1 from public.billing_subscriptions where company_id=i.company_id and environment='live' for no key update;
  perform 1 from public.whatsapp_conversations where id=i.conversation_id and company_id=i.company_id for update;
  select * into i from public.whatsapp_send_intents where id=p_intent_id for update;
  if i.sender_kind='staff' and i.outcome='ready' and (i.staff_actor_session_id is null or i.actor_user_id is distinct from p_actor_user_id) then
   return jsonb_build_object('ok',false,'code','forbidden');end if;
 end if;
 begin
  r:=private.wa_claim_pre_fixed_ack(p_intent_id,p_actor_user_id,p_lease_seconds);
  if r->'ok'='true'::jsonb and r->'claimed'='true'::jsonb and i.sender_kind='staff' and i.outcome='ready' then
   proof:=public.billing_read_company_operational_entitlement(i.company_id);
   if proof->'ok' is distinct from 'true'::jsonb or proof->'active' is distinct from 'true'::jsonb
    or proof->>'environment' is distinct from 'live' or proof->>'plan_version_id' is null
    or proof->>'paid_through' is null or (proof->>'paid_through')::timestamptz<=clock_timestamp() then
    r:=jsonb_build_object('ok',false,'code','subscription_inactive','intent',private.whatsapp_send_intent_public(i));
    raise exception 'STAFF_PAID_DISPATCH_DENIED' using errcode='PWA03';end if;
   select * into s from public.billing_subscriptions where company_id=i.company_id and environment='live';
   select * into g from private.billing_proven_entitlement_grants where subscription_id=s.id and company_id=i.company_id
    and provider_environment='live' and plan_version_id=s.plan_version_id and applied_paid_through=s.paid_through order by id limit 1;
   if g.id is not null then
    perform 1 from public.billing_entitlement_applications where id=g.id for share nowait;
    perform 1 from public.billing_orders where id=g.order_id for share nowait;
    perform 1 from public.billing_payment_attempts where id=g.payment_attempt_id for share nowait;
    perform 1 from public.billing_provider_events where id=g.provider_event_id for share nowait;
    perform 1 from public.billing_settlement_outcomes where entitlement_application_id=g.id for share nowait;
   end if;
   if g.id is null or not private.billing_service_receipt_eligible(g.id) then
    r:=jsonb_build_object('ok',false,'code','subscription_inactive','intent',private.whatsapp_send_intent_public(i));
    raise exception 'STAFF_PAID_DISPATCH_DENIED' using errcode='PWA03';end if;
   perform set_config('velora.staff_claim_binding','1',true);
   update public.whatsapp_send_intents set staff_claim_plan_version_id=(proof->>'plan_version_id')::uuid,
    staff_claim_paid_through=(proof->>'paid_through')::timestamptz
   where id=i.id and outcome='attempting' and attempt_token=(r->>'attempt_token')::uuid;
   perform set_config('velora.staff_claim_binding','',true);
   return r||jsonb_build_object('manual_paid_entitlement',jsonb_build_object('company_id',i.company_id,
    'environment','live','plan_version_id',proof->'plan_version_id','paid_through',proof->'paid_through'));
  end if;return r;
 exception when sqlstate 'PWA03' then return r;
 when lock_not_available then return jsonb_build_object('ok',false,'code','subscription_inactive','intent',private.whatsapp_send_intent_public(i));
 end;
end;
$body$;

revoke all on function private.wa_f5_pre_number_gate_claim_staff(uuid, uuid, integer) from public, anon, authenticated, service_role;

create or replace function public.whatsapp_authorize_staff_dispatch(p_intent_id uuid, p_attempt_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
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
end;
$body$;

revoke all on function public.whatsapp_authorize_staff_dispatch(uuid, uuid) from public, anon, service_role;
grant execute on function public.whatsapp_authorize_staff_dispatch(uuid, uuid) to authenticated;

commit;

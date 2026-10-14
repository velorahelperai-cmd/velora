-- Initial personal phone enrollment only. SMS execution requires external approval.
-- Auth remains canonical; these rows contain orchestration state, never OTPs/tokens.
begin;
create function private.master_native_phone(p_phone text) returns text
language sql immutable set search_path='' as $$
 select case when btrim(coalesce(p_phone,'')) ~ '^\+?[1-9][0-9]{6,14}$'
 then '+' || ltrim(btrim(p_phone),'+') else null end;
$$;
revoke all on function private.master_native_phone(text) from public,anon,authenticated,service_role;
-- Index expressions execute as the native Auth writer. This pure normalizer
-- reads no account data and is the only private function that role may execute.
grant execute on function private.master_native_phone(text) to supabase_auth_admin;
-- Abort on conflicting existing ownership rather than mutate or merge accounts.
do $$ begin
 if exists(select 1 from auth.users where phone_confirmed_at is not null and phone is not null and phone<>''
   and private.master_native_phone(phone) is null) then raise exception 'MASTER_EXISTING_PHONE_FORMAT_REVIEW_REQUIRED'; end if;
 if exists(select 1 from auth.users where phone_confirmed_at is not null and private.master_native_phone(phone) is not null
   group by private.master_native_phone(phone) having count(*)>1) then raise exception 'MASTER_EXISTING_PHONE_OWNERSHIP_REVIEW_REQUIRED'; end if;
end; $$;
create unique index master_native_confirmed_phone_unique on auth.users(private.master_native_phone(phone))
 where phone_confirmed_at is not null and private.master_native_phone(phone) is not null;

create table private.master_personal_phone_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false,pre_send_hook_attested boolean not null default false);
insert into private.master_personal_phone_settings values(true,false,false);
create table private.master_personal_phone_intents(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 session_id uuid not null,request_key uuid not null,phone text not null check(phone ~ '^\+[1-9][0-9]{6,14}$'),
 state text not null default 'reserved' check(state in ('reserved','sent','verifying','verified','failed','expired')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '10 minutes',
 resend_at timestamptz not null default clock_timestamp()+interval '60 seconds',
 attempts integer not null default 0 check(attempts between 0 and 5),lease_id uuid,lease_until timestamptz,
 verification_started_at timestamptz,verified_at timestamptz,verified_session_id uuid,
 hook_event_id text unique,send_consumed_at timestamptz,delivery_receipt uuid,
 hook_delivery_state text check(hook_delivery_state in ('claimed','accepted','unknown')),unique(user_id,request_key)
);
create unique index master_one_active_personal_phone_intent on private.master_personal_phone_intents(user_id) where state in ('reserved','sent','verifying');
create index master_phone_intent_sender_time on private.master_personal_phone_intents(user_id,created_at);
create index master_phone_intent_target_time on private.master_personal_phone_intents(phone,created_at);
create table private.master_personal_phone_events(
 id bigint generated always as identity primary key,intent_id uuid references private.master_personal_phone_intents(id),
 user_id uuid not null references auth.users(id),session_id uuid not null,outcome text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.master_personal_phone_settings enable row level security;
alter table private.master_personal_phone_intents enable row level security;
alter table private.master_personal_phone_events enable row level security;
revoke all on private.master_personal_phone_settings,private.master_personal_phone_intents,private.master_personal_phone_events from public,anon,authenticated,service_role;
create function private.master_phone_sms_configured() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and pre_send_hook_attested from private.master_personal_phone_settings where singleton),false);
$$;
revoke all on function private.master_phone_sms_configured() from public,anon,authenticated,service_role;

create function private.master_phone_session_valid(p_user_id uuid,p_session_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select p_user_id is not null and p_session_id is not null and exists(
  select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=p_session_id and s.user_id=p_user_id and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and (s.not_after is null or s.not_after>clock_timestamp())
 ) and (not coalesce((select enabled from private.app_session_settings where singleton),true)
  or exists(select 1 from private.app_session_activity a where a.session_id=p_session_id and a.user_id=p_user_id
   and a.expired_at is null and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours'));
$$;
create function private.master_phone_current_session(p_user_id uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare sid uuid;
begin
 if p_user_id is null or p_user_id is distinct from auth.uid() then return null; end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then return null; end;
 if private.master_phone_session_valid(p_user_id,sid) then return sid; end if;
 return null;
end; $$;
create function private.master_account_can_create_company(p_user_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select private.master_phone_current_session(p_user_id) is not null and exists(select 1 from auth.users u
 where u.id=p_user_id and u.email_confirmed_at is not null and u.phone_confirmed_at is not null
  and private.master_native_phone(u.phone) is not null
  and not exists(select 1 from auth.users other where other.id<>u.id and other.phone_confirmed_at is not null
   and private.master_native_phone(other.phone)=private.master_native_phone(u.phone)));
$$;
create function public.master_personal_phone_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid; u auth.users; intent private.master_personal_phone_intents; phone text;
begin
 sid:=private.master_phone_current_session(uid);
 if sid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 select * into u from auth.users where id=uid; phone:=private.master_native_phone(u.phone);
 select * into intent from private.master_personal_phone_intents where user_id=uid and (session_id=sid or verified_session_id=sid) order by created_at desc limit 1;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('userId',uid,'emailVerified',u.email_confirmed_at is not null,
  'phoneVerified',u.phone_confirmed_at is not null and phone is not null,'phoneMasked',case when u.phone_confirmed_at is not null and phone is not null then '••••' || right(phone,4) else null end,
  'configuration',case when private.master_phone_sms_configured() then 'CONFIGURED' else 'UNCONFIGURED' end,
  'intent',case when intent.id is not null then jsonb_build_object('id',intent.id,'phoneMasked','••••' || right(intent.phone,4),'state',case when intent.state in ('reserved','sent','verifying') and intent.expires_at<=clock_timestamp() then 'expired' else intent.state end,'expiresAt',intent.expires_at,'resendAt',intent.resend_at) else null end));
end; $$;

create function public.master_reserve_personal_phone(p_expected_user_id uuid,p_phone text,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid; u auth.users; intent private.master_personal_phone_intents; recent private.master_personal_phone_intents;
begin
 sid:=private.master_phone_current_session(uid);
 if sid is null or p_expected_user_id is distinct from uid then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if p_request_key is null or p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 if not private.master_phone_sms_configured() then return jsonb_build_object('ok',false,'code','UNCONFIGURED'); end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text || ':personal-phone',0));
 perform pg_advisory_xact_lock(hashtextextended(p_phone || ':personal-phone-target',0));
 if private.master_phone_current_session(uid) is distinct from sid then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 select * into u from auth.users where id=uid;
 if u.email_confirmed_at is null then return jsonb_build_object('ok',false,'code','EMAIL_REQUIRED'); end if;
 if u.phone_confirmed_at is not null and private.master_native_phone(u.phone) is not null then
  if private.master_native_phone(u.phone)=p_phone then return jsonb_build_object('ok',true,'data',jsonb_build_object('verified',true,'executeProvider',false)); end if;
  return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');
 end if;
 if exists(select 1 from auth.users where id<>uid and phone_confirmed_at is not null and private.master_native_phone(phone)=p_phone) then return jsonb_build_object('ok',false,'code','PHONE_IN_USE'); end if;
 select * into intent from private.master_personal_phone_intents where user_id=uid and request_key=p_request_key;
 if intent.id is not null then
  if intent.phone<>p_phone or intent.session_id<>sid then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('intentId',intent.id,'phone',intent.phone,'executeProvider',false,'state',intent.state,'expiresAt',intent.expires_at,'resendAt',intent.resend_at));
 end if;
 select * into recent from private.master_personal_phone_intents where user_id=uid order by created_at desc limit 1;
 if recent.state='verifying' and recent.lease_until>clock_timestamp() then return jsonb_build_object('ok',false,'code','BUSY'); end if;
 if recent.resend_at>clock_timestamp() then return jsonb_build_object('ok',false,'code','COOLDOWN'); end if;
 -- These are security budgets, not commercial quotas: account AND target, including unknown sends.
 if (select count(*) from private.master_personal_phone_intents where (user_id=uid or phone=p_phone) and created_at>clock_timestamp()-interval '1 hour')>=5
  or (select count(*) from private.master_personal_phone_intents where (user_id=uid or phone=p_phone) and created_at>clock_timestamp()-interval '24 hours')>=10 then return jsonb_build_object('ok',false,'code','RATE_LIMITED'); end if;
 update private.master_personal_phone_intents set state='expired',lease_id=null,lease_until=null where user_id=uid and state in ('reserved','sent','verifying');
 insert into private.master_personal_phone_intents(user_id,session_id,request_key,phone) values(uid,sid,p_request_key,p_phone) returning * into intent;
 insert into private.master_personal_phone_events(intent_id,user_id,session_id,outcome) values(intent.id,uid,sid,'send_reserved');
 return jsonb_build_object('ok',true,'data',jsonb_build_object('intentId',intent.id,'phone',intent.phone,'executeProvider',true,'expiresAt',intent.expires_at,'resendAt',intent.resend_at));
end; $$;

create function public.master_personal_phone_send_result(p_expected_user_id uuid,p_intent_id uuid,p_sent boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid; intent private.master_personal_phone_intents;
begin
 sid:=private.master_phone_current_session(uid);
 if sid is null or p_expected_user_id is distinct from uid then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text || ':personal-phone',0));
 if private.master_phone_current_session(uid) is distinct from sid then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 select * into intent from private.master_personal_phone_intents where id=p_intent_id and user_id=uid and session_id=sid for update;
 if intent.id is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if intent.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','EXPIRED'); end if;
 if p_sent is true and intent.hook_delivery_state is distinct from 'accepted' then return jsonb_build_object('ok',false,'code','VERIFICATION_INCOMPLETE'); end if;
 if intent.state='reserved' then
  update private.master_personal_phone_intents set state=case when p_sent is true then 'sent' else 'failed' end where id=intent.id returning * into intent;
  insert into private.master_personal_phone_events(intent_id,user_id,session_id,outcome) values(intent.id,uid,sid,case when p_sent is true then 'send_accepted' else 'send_unknown_or_failed' end);
 end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('intentId',intent.id,'state',intent.state,'expiresAt',intent.expires_at,'resendAt',intent.resend_at));
end; $$;

create function public.master_claim_personal_phone_verify(p_expected_user_id uuid,p_intent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid; intent private.master_personal_phone_intents;
begin
 sid:=private.master_phone_current_session(uid);
 if sid is null or p_expected_user_id is distinct from uid then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if not private.master_phone_sms_configured() then return jsonb_build_object('ok',false,'code','UNCONFIGURED'); end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text || ':personal-phone',0));
 if private.master_phone_current_session(uid) is distinct from sid then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then return jsonb_build_object('ok',false,'code','EMAIL_REQUIRED'); end if;
 select * into intent from private.master_personal_phone_intents where id=p_intent_id and user_id=uid and session_id=sid for update;
 if intent.id is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if intent.state='verified' and exists(select 1 from auth.users where id=uid and phone_confirmed_at is not null and private.master_native_phone(phone)=intent.phone) then return jsonb_build_object('ok',true,'data',jsonb_build_object('verified',true)); end if;
 if intent.expires_at<=clock_timestamp() or intent.state='expired' then return jsonb_build_object('ok',false,'code','EXPIRED'); end if;
 if intent.state='verifying' and intent.lease_until>clock_timestamp() then return jsonb_build_object('ok',false,'code','BUSY'); end if;
 if intent.attempts>=5 then return jsonb_build_object('ok',false,'code','ATTEMPTS_EXHAUSTED'); end if;
 if intent.state not in ('sent','verifying') then return jsonb_build_object('ok',false,'code','VERIFICATION_INCOMPLETE'); end if;
 if intent.hook_delivery_state is distinct from 'accepted' then return jsonb_build_object('ok',false,'code','VERIFICATION_INCOMPLETE'); end if;
 update private.master_personal_phone_intents set state='verifying',attempts=attempts+1,lease_id=gen_random_uuid(),verification_started_at=clock_timestamp(),lease_until=clock_timestamp()+interval '60 seconds' where id=intent.id returning * into intent;
 insert into private.master_personal_phone_events(intent_id,user_id,session_id,outcome) values(intent.id,uid,sid,'verify_reserved');
 return jsonb_build_object('ok',true,'data',jsonb_build_object('intentId',intent.id,'leaseId',intent.lease_id,'phone',intent.phone));
end; $$;

create function public.master_finish_personal_phone_verify(p_expected_user_id uuid,p_intent_id uuid,p_lease_id uuid,p_verified boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid; intent private.master_personal_phone_intents; native_verified boolean;
begin
 sid:=private.master_phone_current_session(uid);
 if sid is null or p_expected_user_id is distinct from uid then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text || ':personal-phone',0));
 if private.master_phone_current_session(uid) is distinct from sid then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 select * into intent from private.master_personal_phone_intents where id=p_intent_id and user_id=uid for update;
 if intent.id is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if not private.master_phone_session_valid(uid,intent.session_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 select exists(select 1 from auth.users where id=uid and email_confirmed_at is not null and phone_confirmed_at is not null and private.master_native_phone(phone)=intent.phone) into native_verified;
 if intent.state='verified' and native_verified and sid in (intent.session_id,intent.verified_session_id) then return jsonb_build_object('ok',true,'data',jsonb_build_object('verified',true)); end if;
 if intent.state<>'verifying' or intent.lease_id is distinct from p_lease_id then return jsonb_build_object('ok',false,'code','VERIFICATION_INCOMPLETE'); end if;
 -- phone_change verification issues a new native session. Permit only a fresh
 -- same-user session created inside this leased verification window, with the
 -- original session still valid and independently confirmed native phone proof.
 if sid<>intent.session_id and (not native_verified or not exists(select 1 from auth.sessions where id=sid and user_id=uid
  and created_at>=intent.verification_started_at and created_at<=intent.lease_until)
  or not exists(select 1 from auth.users where id=uid and phone_confirmed_at>=intent.verification_started_at and phone_confirmed_at<=intent.lease_until))
 then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if native_verified then
  update private.master_personal_phone_intents set state='verified',verified_at=clock_timestamp(),verified_session_id=sid,lease_until=null where id=intent.id;
  insert into private.master_personal_phone_events(intent_id,user_id,session_id,outcome) values(intent.id,uid,sid,'native_phone_verified');
  return jsonb_build_object('ok',true,'data',jsonb_build_object('verified',true));
 end if;
 if intent.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','EXPIRED'); end if;
 update private.master_personal_phone_intents set state=case when attempts>=5 then 'failed' else 'sent' end,lease_id=null,lease_until=null where id=intent.id;
 insert into private.master_personal_phone_events(intent_id,user_id,session_id,outcome) values(intent.id,uid,sid,'verify_not_confirmed');
 return jsonb_build_object('ok',false,'code',case when intent.attempts>=5 then 'ATTEMPTS_EXHAUSTED' when p_verified is true then 'VERIFICATION_INCOMPLETE' else 'CODE_INVALID' end);
end; $$;

-- The authenticated HTTP Send SMS hook calls these via a server service client
-- BEFORE the provider port. No OTP, OTP hash, signed payload or provider text is
-- persisted. One reservation and hook event authorize at most one invocation.
create function public.master_consume_personal_phone_sms(p_user_id uuid,p_phone text,p_hook_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare intent private.master_personal_phone_intents;
begin
 if not private.master_phone_sms_configured() then return jsonb_build_object('ok',false,'code','UNCONFIGURED'); end if;
 if p_user_id is null or p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$' or p_hook_id is null or p_hook_id !~ '^[-A-Za-z0-9_]{1,128}$'
 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':personal-phone',0));
 if not private.master_phone_sms_configured() then return jsonb_build_object('ok',false,'code','UNCONFIGURED'); end if;
 select * into intent from private.master_personal_phone_intents where hook_event_id=p_hook_id for update;
 if intent.id is not null then
  if intent.user_id<>p_user_id or intent.phone<>p_phone then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('dispatch',false,'accepted',intent.hook_delivery_state='accepted'));
 end if;
 select * into intent from private.master_personal_phone_intents where user_id=p_user_id and phone=p_phone and state='reserved' and send_consumed_at is null for update;
 if intent.id is null or intent.expires_at<=clock_timestamp() or not private.master_phone_session_valid(p_user_id,intent.session_id)
  or not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null
   and (phone_confirmed_at is null or private.master_native_phone(phone) is null))
 then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 update private.master_personal_phone_intents set hook_event_id=p_hook_id,send_consumed_at=clock_timestamp(),delivery_receipt=gen_random_uuid(),hook_delivery_state='claimed'
  where id=intent.id returning * into intent;
 insert into private.master_personal_phone_events(intent_id,user_id,session_id,outcome) values(intent.id,intent.user_id,intent.session_id,'sms_hook_consumed');
 return jsonb_build_object('ok',true,'data',jsonb_build_object('dispatch',true,'intentId',intent.id,'deliveryReceipt',intent.delivery_receipt));
exception when unique_violation then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');
end; $$;
create function public.master_settle_personal_phone_sms(p_intent_id uuid,p_delivery_receipt uuid,p_accepted boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare intent private.master_personal_phone_intents;
begin
 select * into intent from private.master_personal_phone_intents where id=p_intent_id and delivery_receipt=p_delivery_receipt for update;
 if intent.id is null or intent.send_consumed_at is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if intent.hook_delivery_state='claimed' then
  update private.master_personal_phone_intents set hook_delivery_state=case when p_accepted is true then 'accepted' else 'unknown' end where id=intent.id returning * into intent;
  insert into private.master_personal_phone_events(intent_id,user_id,session_id,outcome) values(intent.id,intent.user_id,intent.session_id,case when p_accepted is true then 'sms_hook_accepted' else 'sms_hook_unknown' end);
 end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('accepted',intent.hook_delivery_state='accepted'));
end; $$;
revoke all on function public.master_consume_personal_phone_sms(uuid,text,text),public.master_settle_personal_phone_sms(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.master_consume_personal_phone_sms(uuid,text,text),public.master_settle_personal_phone_sms(uuid,uuid,boolean) to service_role;

-- GoTrue uses its own DB connection without the application JWT. Inspect durable
-- intent/native session here; never accept JWT metadata or a client verified flag.
create function private.master_guard_native_phone() returns trigger
language plpgsql security definer set search_path='' as $$
declare target text; confirming boolean; pending boolean; enrollment_session uuid;
begin
 if tg_op='INSERT' then
  if new.phone_confirmed_at is not null or nullif(new.phone,'') is not null or nullif(new.phone_change,'') is not null then raise exception 'MASTER_PHONE_ENROLLMENT_REQUIRED' using errcode='42501'; end if;
  return new;
 end if;
 if new.phone is not distinct from old.phone and new.phone_confirmed_at is not distinct from old.phone_confirmed_at and new.phone_change is not distinct from old.phone_change then return new; end if;
 if old.phone_confirmed_at is not null and private.master_native_phone(old.phone) is not null then
  if new.phone is distinct from old.phone or new.phone_confirmed_at is null or nullif(new.phone_change,'') is not null then raise exception 'MASTER_PHONE_CHANGE_REVIEW_REQUIRED' using errcode='42501'; end if;
  return new;
 end if;
 -- Clearing a stale pending change is safe; it can never confer verification.
 if nullif(new.phone,'') is null and new.phone_confirmed_at is null and nullif(new.phone_change,'') is null then return new; end if;
 confirming:=new.phone_confirmed_at is not null and private.master_native_phone(new.phone) is not null;
 pending:=nullif(new.phone_change,'') is not null;
 if not confirming and new.phone is distinct from old.phone then raise exception 'MASTER_PHONE_ENROLLMENT_REQUIRED' using errcode='42501'; end if;
 target:=case when confirming then private.master_native_phone(new.phone) else private.master_native_phone(new.phone_change) end;
 -- Native session row first, then account lock. Do not lock idle-activity here:
 -- the Data API pre-request already locks it before checked RPCs take account
 -- locks; reversing that order would deadlock concurrent verification requests.
 select i.session_id into enrollment_session from private.master_personal_phone_intents i where i.user_id=new.id and i.phone=target
  and i.expires_at>clock_timestamp() and ((confirming and i.state='verifying' and i.lease_until>clock_timestamp()) or (not confirming and i.state='reserved'));
 perform 1 from auth.sessions where id=enrollment_session and user_id=new.id for share;
 if not found then raise exception 'MASTER_PHONE_ENROLLMENT_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.id::text || ':personal-phone',0));
 if not private.master_phone_sms_configured() or new.email_confirmed_at is null or target is null
  or (not confirming and not pending) or not exists(select 1 from private.master_personal_phone_intents i where i.user_id=new.id and i.phone=target
   and i.expires_at>clock_timestamp() and i.send_consumed_at is not null and i.hook_delivery_state='accepted' and private.master_phone_session_valid(i.user_id,i.session_id)
   and ((confirming and i.state='verifying' and i.lease_until>clock_timestamp()) or (not confirming and i.state='reserved')))
 then raise exception 'MASTER_PHONE_ENROLLMENT_REQUIRED' using errcode='42501'; end if;
 if confirming and pending and private.master_native_phone(new.phone_change)<>target then raise exception 'MASTER_PHONE_ENROLLMENT_REQUIRED' using errcode='42501'; end if;
 -- Fresh clock/native state after all lock waits; session deletion remains
 -- fenced by the shared session-row lock until the Auth update commits.
 if not private.master_phone_session_valid(new.id,enrollment_session) then raise exception 'MASTER_PHONE_ENROLLMENT_REQUIRED' using errcode='42501'; end if;
 return new;
end; $$;
create trigger master_guard_native_phone before insert or update of phone,phone_confirmed_at,phone_change on auth.users for each row execute function private.master_guard_native_phone();

revoke all on function private.master_phone_session_valid(uuid,uuid),private.master_phone_current_session(uuid),private.master_account_can_create_company(uuid),private.master_guard_native_phone() from public,anon,authenticated,service_role;
revoke all on function public.master_personal_phone_status(),public.master_reserve_personal_phone(uuid,text,uuid),public.master_personal_phone_send_result(uuid,uuid,boolean),public.master_claim_personal_phone_verify(uuid,uuid),public.master_finish_personal_phone_verify(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.master_personal_phone_status(),public.master_reserve_personal_phone(uuid,text,uuid),public.master_personal_phone_send_result(uuid,uuid,boolean),public.master_claim_personal_phone_verify(uuid,uuid),public.master_finish_personal_phone_verify(uuid,uuid,uuid,boolean) to authenticated;
commit;

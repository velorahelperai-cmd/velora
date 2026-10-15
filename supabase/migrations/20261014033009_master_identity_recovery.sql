-- Local extension of canonical Auth phone authority. No OTP/token storage,
-- recovery criteria, provider selection or automatic ownership/account mutation.
begin;
create table private.master_personal_phone_changes(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),session_id uuid not null,request_key uuid not null,
 old_phone text not null,new_phone text not null,step text not null default 'old_pending' check(step in('old_pending','old_verified','new_pending','complete','expired')),
 old_verified_session_id uuid,old_verified_at timestamptz,completed_session_id uuid,completed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '20 minutes',
 unique(user_id,request_key),check(old_phone~'^\+[1-9][0-9]{6,14}$' and new_phone~'^\+[1-9][0-9]{6,14}$' and old_phone<>new_phone),
 check((old_verified_at is null)=(old_verified_session_id is null)),check((completed_at is null)=(completed_session_id is null)));
create unique index master_one_live_phone_change on private.master_personal_phone_changes(user_id) where step in('old_pending','old_verified','new_pending');
alter table private.master_personal_phone_intents add column purpose text not null default 'enrollment' check(purpose in('enrollment','change_old','change_new')),add column change_id uuid references private.master_personal_phone_changes(id);
alter table private.master_personal_phone_intents add constraint master_phone_change_purpose check((purpose='enrollment')=(change_id is null));
create table private.master_identity_session_boundaries(user_id uuid primary key references auth.users(id),survivor_session_id uuid not null,revoked_before timestamptz not null);
alter table private.master_personal_phone_changes enable row level security;alter table private.master_identity_session_boundaries enable row level security;
revoke all on private.master_personal_phone_changes,private.master_identity_session_boundaries from public,anon,authenticated,service_role;

create function private.master_identity_session_current(uid uuid,sid uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s where s.id=sid and s.user_id=uid
  and not exists(select 1 from private.master_account_session_revocations r where r.user_id=uid and s.created_at<=r.revoked_before)
  and not exists(select 1 from private.master_identity_session_boundaries b where b.user_id=uid and s.id<>b.survivor_session_id and s.created_at<=b.revoked_before));
$$;
-- Preserve existing function OIDs used by RLS and Auth triggers, including the
-- password-revocation layer installed in033007. Never touch native Auth sessions.
do $$declare d text;begin
 d:=pg_get_functiondef('private.master_phone_session_valid(uuid,uuid)'::regprocedure);execute replace(d,'FUNCTION private.master_phone_session_valid','FUNCTION private.master_phone_pre_change_session_valid');
 d:=pg_get_functiondef('public.app_session_is_valid()'::regprocedure);execute replace(d,'FUNCTION public.app_session_is_valid','FUNCTION private.master_identity_pre_session_is_valid');
 d:=pg_get_functiondef('public.check_app_session(boolean)'::regprocedure);execute replace(d,'FUNCTION public.check_app_session','FUNCTION private.master_identity_pre_check_app_session');
end;$$;
create or replace function private.master_phone_session_valid(p_user_id uuid,p_session_id uuid) returns boolean language sql volatile security definer set search_path='' as $$select private.master_phone_pre_change_session_valid(p_user_id,p_session_id) and private.master_identity_session_current(p_user_id,p_session_id)$$;
create or replace function public.app_session_is_valid() returns boolean language sql volatile security definer set search_path='' as $$select private.master_identity_pre_session_is_valid() and exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid() and private.master_identity_session_current(user_id,id))$$;
create or replace function public.check_app_session(p_touch boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid() and private.master_identity_session_current(user_id,id)) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 return private.master_identity_pre_check_app_session(p_touch);
end;$$;

create function private.master_phone_change_chain_valid(c private.master_personal_phone_changes) returns boolean language sql volatile security definer set search_path='' as $$
 select c.id is not null and c.expires_at>clock_timestamp() and private.master_phone_session_valid(c.user_id,c.session_id)
 and c.old_verified_at is not null and private.master_phone_session_valid(c.user_id,c.old_verified_session_id)
 and exists(select 1 from private.master_personal_phone_intents i where i.change_id=c.id and i.purpose='change_old' and i.state='verified'
  and i.verified_session_id=c.old_verified_session_id and i.verification_started_at<=c.old_verified_at and i.phone=c.old_phone);
$$;
create function private.master_reserve_phone_change_sms(c private.master_personal_phone_changes,sid uuid,phase text,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.master_personal_phone_intents;latest private.master_personal_phone_intents;target text;begin
 target:=case when phase='change_old' then c.old_phone else c.new_phone end;
 select * into i from private.master_personal_phone_intents where user_id=c.user_id and master_personal_phone_intents.request_key=master_reserve_phone_change_sms.request_key;
 if i.id is not null then
  if i.change_id is distinct from c.id or i.session_id<>sid or i.purpose<>phase then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('changeId',c.id,'intentId',i.id,'phone',target,'executeProvider',false));end if;
 select * into latest from private.master_personal_phone_intents where user_id=c.user_id order by created_at desc limit 1;
 if latest.state='verifying' and latest.lease_until>clock_timestamp() then return jsonb_build_object('ok',false,'code','BUSY');end if;
 if latest.phone=target and latest.resend_at>clock_timestamp() then return jsonb_build_object('ok',false,'code','COOLDOWN');end if;
 if (select count(*) from private.master_personal_phone_intents where (user_id=c.user_id or phone=target) and created_at>clock_timestamp()-interval '1 hour')>=5
  or (select count(*) from private.master_personal_phone_intents where (user_id=c.user_id or phone=target) and created_at>clock_timestamp()-interval '24 hours')>=10 then return jsonb_build_object('ok',false,'code','RATE_LIMITED');end if;
 update private.master_personal_phone_intents set state='expired',lease_until=null where user_id=c.user_id and state in('reserved','sent','verifying');
 insert into private.master_personal_phone_intents(user_id,session_id,request_key,phone,purpose,change_id,expires_at) values(c.user_id,sid,request_key,target,phase,c.id,least(c.expires_at,clock_timestamp()+interval '10 minutes')) returning * into i;
 insert into private.master_personal_phone_events(intent_id,user_id,session_id,outcome) values(i.id,c.user_id,sid,phase||'_send_reserved');
 return jsonb_build_object('ok',true,'data',jsonb_build_object('changeId',c.id,'intentId',i.id,'phone',target,'executeProvider',true));
end;$$;
create function public.master_begin_phone_change(p_expected_user_id uuid,p_new_phone text,p_request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;c private.master_personal_phone_changes;u auth.users;begin
 if not private.master_phone_sms_configured() then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 sid:=private.master_phone_current_session(uid);if sid is null or uid is distinct from p_expected_user_id then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if p_new_phone is null or p_new_phone!~'^\+[1-9][0-9]{6,14}$' or p_request_key is null then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform 1 from auth.sessions where id=sid and user_id=uid for share;perform pg_advisory_xact_lock_shared(hashtextextended(uid::text||':session-revocation',0));perform pg_advisory_xact_lock(hashtextextended(uid::text||':personal-phone',0));perform pg_advisory_xact_lock(hashtextextended(p_new_phone||':personal-phone-target',0));
 if private.master_phone_current_session(uid) is distinct from sid then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 select * into u from auth.users where id=uid;if u.email_confirmed_at is null then return jsonb_build_object('ok',false,'code','EMAIL_REQUIRED');end if;
 if u.phone_confirmed_at is null or private.master_native_phone(u.phone) is null or private.master_native_phone(u.phone)=p_new_phone then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if exists(select 1 from auth.users where id<>uid and phone_confirmed_at is not null and private.master_native_phone(phone)=p_new_phone) then return jsonb_build_object('ok',false,'code','PHONE_IN_USE');end if;
 select * into c from private.master_personal_phone_changes where user_id=uid and request_key=p_request_key;
 if c.id is not null and (c.session_id<>sid or c.new_phone<>p_new_phone) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 update private.master_personal_phone_changes set step='expired' where user_id=uid and expires_at<=clock_timestamp() and step in('old_pending','old_verified','new_pending');
 if c.id is null then select * into c from private.master_personal_phone_changes where user_id=uid and step in('old_pending','old_verified','new_pending');end if;
 if c.id is not null and (c.step<>'old_pending' or c.session_id<>sid or c.new_phone<>p_new_phone or c.old_phone<>private.master_native_phone(u.phone) or c.expires_at<=clock_timestamp()) then return jsonb_build_object('ok',false,'code','BUSY');end if;
 if c.id is null then insert into private.master_personal_phone_changes(user_id,session_id,request_key,old_phone,new_phone) values(uid,sid,p_request_key,private.master_native_phone(u.phone),p_new_phone) returning * into c;end if;
 return private.master_reserve_phone_change_sms(c,sid,'change_old',p_request_key);
end;$$;
create function public.master_resend_current_phone(p_expected_user_id uuid,p_change_id uuid,p_request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;c private.master_personal_phone_changes;begin
 if not private.master_phone_sms_configured() then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 sid:=private.master_phone_current_session(uid);if sid is null or uid is distinct from p_expected_user_id or p_request_key is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 perform 1 from auth.sessions where id=sid and user_id=uid for share;perform pg_advisory_xact_lock_shared(hashtextextended(uid::text||':session-revocation',0));perform pg_advisory_xact_lock(hashtextextended(uid::text||':personal-phone',0));
 select * into c from private.master_personal_phone_changes where id=p_change_id and user_id=uid for update;
 if c.id is null or c.step<>'old_pending' or c.session_id<>sid or c.expires_at<=clock_timestamp() or private.master_phone_current_session(uid) is distinct from sid
 or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null and phone_confirmed_at is not null and private.master_native_phone(phone)=c.old_phone) then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');end if;
 return private.master_reserve_phone_change_sms(c,sid,'change_old',p_request_key);
end;$$;
create function public.master_send_replacement_phone(p_expected_user_id uuid,p_change_id uuid,p_request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;c private.master_personal_phone_changes;begin
 if not private.master_phone_sms_configured() then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 sid:=private.master_phone_current_session(uid);if sid is null or uid is distinct from p_expected_user_id then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 perform 1 from auth.sessions where id=sid and user_id=uid for share;perform pg_advisory_xact_lock_shared(hashtextextended(uid::text||':session-revocation',0));perform pg_advisory_xact_lock(hashtextextended(uid::text||':personal-phone',0));
 select * into c from private.master_personal_phone_changes where id=p_change_id and user_id=uid for update;
 if c.id is null or c.step not in('old_verified','new_pending') or c.old_verified_session_id<>sid or not private.master_phone_change_chain_valid(c) or private.master_phone_current_session(uid) is distinct from sid then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');end if;
 if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null and phone_confirmed_at is not null and private.master_native_phone(phone)=c.old_phone) then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');end if;
 perform pg_advisory_xact_lock(hashtextextended(c.new_phone||':personal-phone-target',0));
 if exists(select 1 from auth.users where id<>uid and phone_confirmed_at is not null and private.master_native_phone(phone)=c.new_phone) then return jsonb_build_object('ok',false,'code','PHONE_IN_USE');end if;
 update private.master_personal_phone_changes set step='new_pending' where id=c.id;c.step:='new_pending';return private.master_reserve_phone_change_sms(c,sid,'change_new',p_request_key);
end;$$;
create function public.master_claim_phone_change_verify(p_expected_user_id uuid,p_intent_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;i private.master_personal_phone_intents;c private.master_personal_phone_changes;r jsonb;begin
 sid:=private.master_phone_current_session(uid);if sid is null or uid is distinct from p_expected_user_id then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 perform 1 from auth.sessions where id=sid and user_id=uid for share;perform pg_advisory_xact_lock_shared(hashtextextended(uid::text||':session-revocation',0));perform pg_advisory_xact_lock(hashtextextended(uid::text||':personal-phone',0));
 select * into i from private.master_personal_phone_intents where id=p_intent_id and user_id=uid and session_id=sid;select * into c from private.master_personal_phone_changes where id=i.change_id and user_id=uid;
 if c.id is null or c.expires_at<=clock_timestamp() or private.master_phone_current_session(uid) is distinct from sid
  or not private.master_phone_session_valid(uid,c.session_id) or i.purpose not in('change_old','change_new')
  or i.purpose='change_old' and (c.step<>'old_pending' or c.session_id<>sid)
  or i.purpose='change_new' and (c.step<>'new_pending' or c.old_verified_session_id<>sid or not private.master_phone_change_chain_valid(c))
  or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null and phone_confirmed_at is not null and private.master_native_phone(phone)=c.old_phone)
 then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');end if;
 r:=public.master_claim_personal_phone_verify(uid,i.id);if r->>'ok' is distinct from 'true' then return r;end if;
 return jsonb_build_object('ok',true,'data',(r->'data')||jsonb_build_object('step',case when i.purpose='change_old' then 'old' else 'new' end));
end;$$;
create function public.master_finish_phone_change_verify(p_user_id uuid,p_intent_id uuid,p_lease_id uuid,p_verified_session_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.master_personal_phone_intents;c private.master_personal_phone_changes;s auth.sessions;target text;begin
 if current_setting('role',true)<>'service_role' then raise insufficient_privilege;end if;
 perform 1 from auth.sessions where user_id=p_user_id and id=p_verified_session_id for share;perform pg_advisory_xact_lock_shared(hashtextextended(p_user_id::text||':session-revocation',0));perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':personal-phone',0));
 select * into i from private.master_personal_phone_intents where id=p_intent_id and user_id=p_user_id for update;select * into c from private.master_personal_phone_changes where id=i.change_id and user_id=p_user_id for update;
 if c.id is null or i.purpose not in('change_old','change_new') or i.lease_id is distinct from p_lease_id then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 target:=case when i.purpose='change_old' then c.old_phone else c.new_phone end;
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null and phone_confirmed_at is not null and private.master_native_phone(phone)=target) then return jsonb_build_object('ok',false,'code','VERIFICATION_INCOMPLETE');end if;
 if i.state='verified' and i.verified_session_id=p_verified_session_id and private.master_phone_session_valid(p_user_id,p_verified_session_id) then return jsonb_build_object('ok',true,'data',jsonb_build_object('step',case when i.purpose='change_old' then 'old_verified' else 'complete' end,'changeId',c.id));end if;
 select * into s from auth.sessions where id=p_verified_session_id and user_id=p_user_id;
 if not private.master_phone_sms_configured() or i.state<>'verifying' or i.hook_delivery_state is distinct from 'accepted' or i.lease_until<=clock_timestamp() or i.expires_at<=clock_timestamp() or c.expires_at<=clock_timestamp()
  or p_verified_session_id=i.session_id or s.created_at<i.verification_started_at or s.created_at>i.lease_until or not private.master_phone_session_valid(p_user_id,i.session_id)
  or not private.master_phone_session_valid(p_user_id,p_verified_session_id) or not private.master_phone_session_valid(p_user_id,c.session_id)
  or i.purpose='change_old' and c.step<>'old_pending' or i.purpose='change_new' and (c.step<>'new_pending' or not private.master_phone_change_chain_valid(c))
 then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if i.purpose='change_new' and not exists(select 1 from auth.users where id=p_user_id and phone_confirmed_at>=i.verification_started_at and phone_confirmed_at<=i.lease_until) then return jsonb_build_object('ok',false,'code','VERIFICATION_INCOMPLETE');end if;
 update private.master_personal_phone_intents set state='verified',verified_at=clock_timestamp(),verified_session_id=p_verified_session_id,lease_until=null where id=i.id;
 if i.purpose='change_old' then update private.master_personal_phone_changes set old_verified_at=clock_timestamp(),old_verified_session_id=p_verified_session_id,step='old_verified' where id=c.id;
 else
  update private.master_personal_phone_changes set completed_at=clock_timestamp(),completed_session_id=p_verified_session_id,step='complete' where id=c.id;
  insert into private.master_identity_session_boundaries values(p_user_id,p_verified_session_id,clock_timestamp()) on conflict(user_id) do update set survivor_session_id=excluded.survivor_session_id,revoked_before=excluded.revoked_before;
  insert into private.app_session_activity(session_id,user_id,last_activity_at,expired_at) select id,user_id,created_at,clock_timestamp() from auth.sessions where user_id=p_user_id and id<>p_verified_session_id on conflict(session_id) do update set expired_at=coalesce(private.app_session_activity.expired_at,excluded.expired_at);
 end if;
 insert into private.master_personal_phone_events(intent_id,user_id,session_id,outcome) values(i.id,p_user_id,p_verified_session_id,case when i.purpose='change_old' then 'old_phone_native_sms_verified' else 'personal_phone_changed_both_proofs' end);
 return jsonb_build_object('ok',true,'data',jsonb_build_object('step',case when i.purpose='change_old' then 'old_verified' else 'complete' end,'changeId',c.id));
end;$$;
-- Browser-callable initial-enrollment completion cannot vouch for an old phone
-- A saved NEW confirmation is recoverable only via trusted server getClaims +
-- getUser and the exact fresh session/lease/native phone transition. An old
-- already-confirmed phone is never reconstructed from a generic OTP AMR.
create function public.master_reconcile_phone_change_native(p_user_id uuid,p_verified_session_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.master_personal_phone_intents;begin
 if current_setting('role',true)<>'service_role' then raise insufficient_privilege;end if;
 if not private.master_phone_sms_configured() or not private.master_phone_session_valid(p_user_id,p_verified_session_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 select i2.* into i from private.master_personal_phone_intents i2 join private.master_personal_phone_changes c on c.id=i2.change_id
 join auth.users u on u.id=c.user_id join auth.sessions s on s.id=p_verified_session_id and s.user_id=u.id
 where c.user_id=p_user_id and c.step='new_pending' and i2.purpose='change_new' and i2.state='verifying'
 and i2.session_id<>s.id and s.created_at>=i2.verification_started_at and s.created_at<=i2.lease_until
 and private.master_native_phone(u.phone)=c.new_phone and u.phone_confirmed_at>=i2.verification_started_at and u.phone_confirmed_at<=i2.lease_until
 order by i2.created_at desc limit 1;
 if i.id is null then return jsonb_build_object('ok',true,'data',jsonb_build_object('reconciled',false));end if;
 return public.master_finish_phone_change_verify(p_user_id,i.id,i.lease_id,p_verified_session_id);
end;$$;
-- Browser-callable initial-enrollment completion cannot vouch for an old phone
-- already confirmed before the challenge. AMR=otp is deliberately insufficient.
alter function public.master_finish_personal_phone_verify(uuid,uuid,uuid,boolean) set schema private;alter function private.master_finish_personal_phone_verify(uuid,uuid,uuid,boolean) rename to master_finish_enrollment_only;
create function public.master_finish_personal_phone_verify(p_expected_user_id uuid,p_intent_id uuid,p_lease_id uuid,p_verified boolean) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from private.master_personal_phone_intents where id=p_intent_id and user_id=auth.uid() and purpose='enrollment') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 return private.master_finish_enrollment_only(p_expected_user_id,p_intent_id,p_lease_id,p_verified);end;$$;

create function private.master_native_phone_change_allowed(old_user auth.users,new_user auth.users) returns boolean language plpgsql security definer set search_path='' as $$
declare c private.master_personal_phone_changes;i private.master_personal_phone_intents;confirming boolean;target text;begin
 -- GoTrue ConfirmPhone for an existing-number SMS login updates its timestamp
 -- while preserving an approved pending replacement. No ownership/pending
 -- change is authorized here; every send still passes the reservation hook.
 if new_user.phone is not distinct from old_user.phone and new_user.phone_confirmed_at is not null and new_user.phone_change is not distinct from old_user.phone_change then return true;end if;
 confirming:=new_user.phone is distinct from old_user.phone;target:=case when confirming then private.master_native_phone(new_user.phone) else private.master_native_phone(new_user.phone_change) end;
 if new_user.phone_confirmed_at is null or target is null then return false;end if;
 select * into c from private.master_personal_phone_changes where user_id=old_user.id and old_phone=private.master_native_phone(old_user.phone) and new_phone=target and step='new_pending' and expires_at>clock_timestamp();
 if c.id is null then return false;end if;
 perform 1 from auth.sessions where user_id=c.user_id and id in(c.session_id,c.old_verified_session_id) order by id for share;
 perform pg_advisory_xact_lock_shared(hashtextextended(c.user_id::text||':session-revocation',0));perform pg_advisory_xact_lock(hashtextextended(c.user_id::text||':personal-phone',0));perform pg_advisory_xact_lock(hashtextextended(target||':personal-phone-target',0));
 select * into c from private.master_personal_phone_changes where id=c.id;
 if not private.master_phone_sms_configured() or new_user.email_confirmed_at is null or not private.master_phone_change_chain_valid(c) or c.step<>'new_pending' then return false;end if;
 select * into i from private.master_personal_phone_intents where change_id=c.id and purpose='change_new' and phone=target and session_id=c.old_verified_session_id and expires_at>clock_timestamp() and send_consumed_at is not null and hook_delivery_state='accepted'
  and ((confirming and state='verifying' and lease_until>clock_timestamp()) or (not confirming and state='reserved'));
 if i.id is null then return false;end if;
 if confirming and (private.master_native_phone(old_user.phone_change) is distinct from target or nullif(new_user.phone_change,'') is not null or new_user.phone_confirmed_at<i.verification_started_at or new_user.phone_confirmed_at>i.lease_until) then return false;end if;
 return private.master_phone_session_valid(c.user_id,c.session_id) and private.master_phone_session_valid(c.user_id,c.old_verified_session_id);
end;$$;
do $$declare d text;anchor text;begin
 d:=pg_get_functiondef('private.master_guard_native_phone()'::regprocedure);
 -- Enrollment shares the same commit boundary as replacement proof. The
 -- existing native session-row lock precedes this fence; no activity-row lock
 -- is introduced. Global/password revocation waits until Auth commits.
 anchor:='perform pg_advisory_xact_lock(hashtextextended(new.id::text || '':personal-phone'',0));';
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'PHONE_ENROLLMENT_REVOCATION_FENCE_DRIFT';end if;
 d:=replace(d,anchor,'perform pg_advisory_xact_lock_shared(hashtextextended(new.id::text || '':session-revocation'',0));'||anchor);
 anchor:='if new.phone is distinct from old.phone or new.phone_confirmed_at is null or nullif(new.phone_change,'''') is not null then raise exception ''MASTER_PHONE_CHANGE_REVIEW_REQUIRED'' using errcode=''42501''; end if;';
 if strpos(d,anchor)=0 then raise exception 'PHONE_CHANGE_NATIVE_GUARD_DRIFT';end if;
 execute replace(d,anchor,'if (new.phone is distinct from old.phone or new.phone_confirmed_at is null or nullif(new.phone_change,'''') is not null) and not private.master_native_phone_change_allowed(old,new) then raise exception ''MASTER_PHONE_CHANGE_REVIEW_REQUIRED'' using errcode=''42501'';end if;');
end;$$;

alter function public.master_consume_personal_phone_sms(uuid,text,text) set schema private;alter function private.master_consume_personal_phone_sms(uuid,text,text) rename to master_consume_enrollment_sms;
create function public.master_consume_personal_phone_sms(p_user_id uuid,p_phone text,p_hook_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.master_personal_phone_intents;c private.master_personal_phone_changes;begin
 if current_setting('role',true)<>'service_role' then raise insufficient_privilege;end if;
 if not private.master_phone_sms_configured() then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 if p_hook_id is null or p_hook_id!~'^[-A-Za-z0-9_]{1,128}$' or p_phone is null or p_phone!~'^\+[1-9][0-9]{6,14}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock_shared(hashtextextended(p_user_id::text||':session-revocation',0));perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':personal-phone',0));
 select * into i from private.master_personal_phone_intents where hook_event_id=p_hook_id;
 if i.id is not null then
  if i.user_id is distinct from p_user_id or i.phone<>p_phone then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('dispatch',false,'accepted',i.hook_delivery_state='accepted'));end if;
 select * into i from private.master_personal_phone_intents where user_id=p_user_id and phone=p_phone and state='reserved' and send_consumed_at is null for update;
 if i.purpose='enrollment' then return private.master_consume_enrollment_sms(p_user_id,p_phone,p_hook_id);end if;
 select * into c from private.master_personal_phone_changes where id=i.change_id and user_id=p_user_id;
 if i.id is null or c.id is null or i.expires_at<=clock_timestamp() or c.expires_at<=clock_timestamp() or not private.master_phone_session_valid(p_user_id,i.session_id)
  or not private.master_phone_session_valid(p_user_id,c.session_id) or not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null and phone_confirmed_at is not null and private.master_native_phone(phone)=c.old_phone)
  or i.purpose='change_old' and c.step<>'old_pending' or i.purpose='change_new' and (c.step<>'new_pending' or not private.master_phone_change_chain_valid(c))
 then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 update private.master_personal_phone_intents set hook_event_id=p_hook_id,send_consumed_at=clock_timestamp(),delivery_receipt=gen_random_uuid(),hook_delivery_state='claimed' where id=i.id returning * into i;
 insert into private.master_personal_phone_events(intent_id,user_id,session_id,outcome) values(i.id,p_user_id,i.session_id,i.purpose||'_sms_hook_consumed');
 return jsonb_build_object('ok',true,'data',jsonb_build_object('dispatch',true,'intentId',i.id,'deliveryReceipt',i.delivery_receipt));
exception when unique_violation then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end;$$;
create function public.master_phone_change_status() returns jsonb language plpgsql security definer set search_path='' as $$declare uid uuid:=auth.uid();sid uuid;c private.master_personal_phone_changes;i private.master_personal_phone_intents;begin
 sid:=private.master_phone_current_session(uid);if sid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 select * into c from private.master_personal_phone_changes where user_id=uid and sid in(session_id,old_verified_session_id,completed_session_id) order by created_at desc,id desc limit 1;
 select * into i from private.master_personal_phone_intents where change_id=c.id order by created_at desc,id desc limit 1;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('userId',uid,'configuration',case when private.master_phone_sms_configured() then 'CONFIGURED' else 'UNCONFIGURED' end,'change',case when c.id is null then null else jsonb_build_object('id',c.id,'step',case when c.step<>'complete' and c.expires_at<=clock_timestamp() then 'expired' else c.step end,'oldPhoneMasked','••••'||right(c.old_phone,4),'newPhoneMasked','••••'||right(c.new_phone,4),'expiresAt',c.expires_at,'intent',case when i.id is null then null else jsonb_build_object('id',i.id,'state',case when i.state<>'verified' and i.expires_at<=clock_timestamp() then 'expired' else i.state end,'expiresAt',i.expires_at,'resendAt',i.resend_at) end) end));end;$$;

-- Recovery review is durable, but deliberately confers NO native account,
-- phone, email, session or company-ownership mutation. Criteria/producers empty.
create table private.master_identity_recovery_policy(singleton boolean primary key default true check(singleton),enabled boolean not null default false,criteria_version text,approval_reference text,check(not enabled or nullif(btrim(criteria_version),'') is not null and nullif(btrim(approval_reference),'') is not null));
insert into private.master_identity_recovery_policy(singleton) values(true);
create table private.master_identity_recovery_cases(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),opened_by uuid not null references auth.users(id),open_session_id uuid not null,request_key uuid not null,
 reason text not null check(reason in('lost_phone','lost_email_and_phone')),state text not null default 'review' check(state in('review','needs_evidence','rejected','approved_for_manual_recovery')),created_at timestamptz not null default clock_timestamp(),unique(opened_by,request_key));
create index master_recovery_subject_created on private.master_identity_recovery_cases(user_id,created_at desc);
create unique index master_one_open_identity_review on private.master_identity_recovery_cases(user_id) where state in('review','needs_evidence');
create table private.master_identity_recovery_sources(source text primary key,independence_group text not null,criteria_version text not null,approval_reference text not null,enabled boolean not null default false,check(length(btrim(source)) between 1 and 100 and length(btrim(independence_group)) between 1 and 100 and length(btrim(criteria_version))>0 and length(btrim(approval_reference))>0));
create table private.master_identity_recovery_evidence(id uuid primary key default gen_random_uuid(),case_id uuid not null references private.master_identity_recovery_cases(id),user_id uuid not null references auth.users(id),source text not null references private.master_identity_recovery_sources(source),evidence_reference text not null check(length(btrim(evidence_reference)) between 1 and 200),independence_group text not null,criteria_version text not null,verified_at timestamptz not null default clock_timestamp(),unique(source,evidence_reference));
create table private.master_identity_recovery_decisions(case_id uuid not null references private.master_identity_recovery_cases(id),request_key uuid not null,actor_user_id uuid not null references auth.users(id),actor_session_id uuid not null,decision text not null,state text not null,criteria_version text,created_at timestamptz not null default clock_timestamp(),primary key(case_id,request_key));
create table private.master_identity_recovery_events(id bigint generated always as identity primary key,case_id uuid not null references private.master_identity_recovery_cases(id),actor_user_id uuid references auth.users(id),actor_session_id uuid,event text not null,created_at timestamptz not null default clock_timestamp());
do $$declare t text;begin foreach t in array array['master_identity_recovery_policy','master_identity_recovery_cases','master_identity_recovery_sources','master_identity_recovery_evidence','master_identity_recovery_decisions','master_identity_recovery_events'] loop execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);end loop;end;$$;
create function private.master_recovery_platform_owner() returns boolean language plpgsql security definer set search_path='' as $$declare sid uuid;begin
 sid:=private.master_phone_current_session(auth.uid());if sid is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then return false;end if;
 perform pg_advisory_xact_lock_shared(hashtextextended(auth.uid()::text||':session-revocation',0));perform 1 from auth.sessions where id=sid and user_id=auth.uid() for share;
 perform 1 from public.platform_admins where user_id=auth.uid() and role='owner' and status='active' for share;
 return found and private.master_phone_current_session(auth.uid())=sid;
end;$$;
create function private.master_identity_recovery_case_json(cid uuid) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('id',c.id,'userId',c.user_id,'reason',c.reason,'state',c.state,'createdAt',c.created_at,'verifiedEvidence',(select count(distinct independence_group) from private.master_identity_recovery_evidence where case_id=c.id)) from private.master_identity_recovery_cases c where c.id=cid$$;
create function private.master_open_recovery_case(uid uuid,why text,key uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare c private.master_identity_recovery_cases;actor uuid:=auth.uid();sid uuid;begin
 sid:=private.master_phone_current_session(actor);
 if sid is null or uid is null or key is null or why is null or why not in('lost_phone','lost_email_and_phone') or not exists(select 1 from auth.users where id=uid) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform 1 from auth.sessions where id=sid and user_id=actor for share;perform pg_advisory_xact_lock(hashtextextended(actor::text||':identity-recovery-intake',0));
 if private.master_phone_current_session(actor) is distinct from sid or actor<>uid and not private.master_recovery_platform_owner() then raise insufficient_privilege;end if;
 select * into c from private.master_identity_recovery_cases where opened_by=actor and request_key=key;
 if c.id is not null then if c.user_id<>uid or c.reason<>why then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;return jsonb_build_object('ok',true,'data',private.master_identity_recovery_case_json(c.id));end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||':identity-recovery-subject',0));
 select * into c from private.master_identity_recovery_cases where user_id=uid and state in('review','needs_evidence');
 if c.id is not null then return jsonb_build_object('ok',true,'data',private.master_identity_recovery_case_json(c.id));end if;
 insert into private.master_identity_recovery_cases(user_id,opened_by,open_session_id,request_key,reason) values(uid,actor,sid,key,why) returning * into c;
 insert into private.master_identity_recovery_events(case_id,actor_user_id,actor_session_id,event) values(c.id,actor,sid,'review_opened_no_identity_authority');
 return jsonb_build_object('ok',true,'data',private.master_identity_recovery_case_json(c.id));
end;$$;
create function public.master_open_identity_recovery_review(p_expected_user_id uuid,p_reason text,p_request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is distinct from p_expected_user_id or private.master_phone_current_session(auth.uid()) is null then raise insufficient_privilege;end if;
 return private.master_open_recovery_case(auth.uid(),p_reason,p_request_key);
end;$$;
create function public.admin_open_identity_recovery_review(p_user_id uuid,p_reason text,p_request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not private.master_recovery_platform_owner() then raise insufficient_privilege;end if;return private.master_open_recovery_case(p_user_id,p_reason,p_request_key);end;$$;
create function public.master_read_identity_recovery_reviews() returns jsonb language plpgsql security definer set search_path='' as $$begin
 if private.master_phone_current_session(auth.uid()) is null then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('userId',auth.uid(),'configuration',case when(select enabled from private.master_identity_recovery_policy where singleton) then 'CONFIGURED' else 'UNCONFIGURED' end,'cases',coalesce((select jsonb_agg(private.master_identity_recovery_case_json(id) order by created_at desc) from private.master_identity_recovery_cases where user_id=auth.uid()),'[]'::jsonb)));end;$$;
create function public.admin_read_identity_recovery_reviews() returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not private.master_recovery_platform_owner() then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('actorUserId',auth.uid(),'configuration',case when(select enabled from private.master_identity_recovery_policy where singleton) then 'CONFIGURED' else 'UNCONFIGURED' end,'cases',coalesce((select jsonb_agg(private.master_identity_recovery_case_json(id) order by created_at desc) from(select id,created_at from private.master_identity_recovery_cases order by created_at desc,id limit 100)c),'[]'::jsonb)));end;$$;
create function public.master_attest_identity_recovery_evidence(p_case_id uuid,p_source text,p_evidence_reference text,p_subject_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.master_identity_recovery_cases;s private.master_identity_recovery_sources;e private.master_identity_recovery_evidence;v text;begin
 if current_setting('role',true)<>'service_role' then raise insufficient_privilege;end if;
 select criteria_version into v from private.master_identity_recovery_policy where singleton and enabled;
 select * into s from private.master_identity_recovery_sources where source=p_source and enabled and criteria_version=v;
 if s.source is null then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 if p_evidence_reference is null or length(btrim(p_evidence_reference)) not between 1 and 200 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into c from private.master_identity_recovery_cases where id=p_case_id and user_id=p_subject_user_id for update;
 if c.id is null or c.state not in('review','needs_evidence') then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');end if;
 select * into e from private.master_identity_recovery_evidence where source=p_source and evidence_reference=p_evidence_reference;
 if e.id is not null then if e.case_id<>c.id or e.user_id<>c.user_id then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');end if;return jsonb_build_object('ok',true,'data',jsonb_build_object('replayed',true));end if;
 insert into private.master_identity_recovery_evidence(case_id,user_id,source,evidence_reference,independence_group,criteria_version) values(c.id,c.user_id,s.source,p_evidence_reference,s.independence_group,v);
 insert into private.master_identity_recovery_events(case_id,event) values(c.id,'independent_source_verified_server_only');return jsonb_build_object('ok',true,'data',jsonb_build_object('recorded',true));
end;$$;
create function public.admin_decide_identity_recovery(p_case_id uuid,p_decision text,p_request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.master_identity_recovery_cases;d private.master_identity_recovery_decisions;v text;next_state text;n integer;sid uuid;begin
 if not private.master_recovery_platform_owner() then raise insufficient_privilege;end if;sid:=private.master_phone_current_session(auth.uid());
 if p_request_key is null or p_decision is null or p_decision not in('request_evidence','reject','approve_review') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into c from private.master_identity_recovery_cases where id=p_case_id for update;if c.id is null then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');end if;
 if not private.master_recovery_platform_owner() or private.master_phone_current_session(auth.uid()) is distinct from sid then raise insufficient_privilege;end if;
 select * into d from private.master_identity_recovery_decisions where case_id=c.id and request_key=p_request_key;
 if d.case_id is not null then if d.decision<>p_decision or d.actor_user_id<>auth.uid() then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;return jsonb_build_object('ok',true,'data',jsonb_build_object('state',d.state,'replayed',true));end if;
 if c.state in('rejected','approved_for_manual_recovery') then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');end if;
 if p_decision='approve_review' then
  select criteria_version into v from private.master_identity_recovery_policy where singleton and enabled;
  if v is null then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
  select count(distinct e.independence_group) into n from private.master_identity_recovery_evidence e join private.master_identity_recovery_sources s on s.source=e.source and s.enabled and s.criteria_version=e.criteria_version and s.independence_group=e.independence_group where e.case_id=c.id and e.user_id=c.user_id and e.criteria_version=v;
  if n<2 or not exists(select 1 from auth.users where id=c.user_id and deleted_at is null and(banned_until is null or banned_until<=clock_timestamp())) then return jsonb_build_object('ok',false,'code','INDEPENDENT_EVIDENCE_REQUIRED');end if;
 end if;
 next_state:=case p_decision when 'approve_review' then 'approved_for_manual_recovery' when 'reject' then 'rejected' else 'needs_evidence' end;
 update private.master_identity_recovery_cases set state=next_state where id=c.id;
 insert into private.master_identity_recovery_decisions(case_id,request_key,actor_user_id,actor_session_id,decision,state,criteria_version) values(c.id,p_request_key,auth.uid(),sid,p_decision,next_state,v);
 insert into private.master_identity_recovery_events(case_id,actor_user_id,actor_session_id,event) values(c.id,auth.uid(),sid,p_decision||'_no_account_mutation');return jsonb_build_object('ok',true,'data',jsonb_build_object('state',next_state));end;$$;
-- Audit/verified evidence is append-only. Approval never bypasses this review.
create function private.master_recovery_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'IDENTITY_RECOVERY_EVIDENCE_IMMUTABLE' using errcode='23514';end;$$;
do $$declare t text;begin foreach t in array array['master_identity_recovery_evidence','master_identity_recovery_decisions','master_identity_recovery_events'] loop execute format('create trigger recovery_immutable before update or delete on private.%I for each row execute function private.master_recovery_immutable()',t);execute format('create trigger recovery_no_truncate before truncate on private.%I for each statement execute function private.master_recovery_immutable()',t);end loop;end;$$;

do $$declare f record;begin for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'master_%change%' or p.proname like 'master_identity_%' or p.proname like 'master_%recovery%' or p.proname in('master_consume_enrollment_sms','master_finish_enrollment_only')) loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);end loop;end;$$;
revoke all on function public.master_resend_current_phone(uuid,uuid,uuid),public.master_begin_phone_change(uuid,text,uuid),public.master_send_replacement_phone(uuid,uuid,uuid),public.master_claim_phone_change_verify(uuid,uuid),public.master_finish_phone_change_verify(uuid,uuid,uuid,uuid),public.master_finish_personal_phone_verify(uuid,uuid,uuid,boolean),public.master_consume_personal_phone_sms(uuid,text,text),public.master_phone_change_status() from public,anon,authenticated,service_role;
grant execute on function public.master_resend_current_phone(uuid,uuid,uuid),public.master_begin_phone_change(uuid,text,uuid),public.master_send_replacement_phone(uuid,uuid,uuid),public.master_claim_phone_change_verify(uuid,uuid),public.master_finish_personal_phone_verify(uuid,uuid,uuid,boolean),public.master_phone_change_status() to authenticated;
revoke all on function public.master_reconcile_phone_change_native(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.master_reconcile_phone_change_native(uuid,uuid),public.master_finish_phone_change_verify(uuid,uuid,uuid,uuid),public.master_consume_personal_phone_sms(uuid,text,text) to service_role;
revoke all on function public.master_open_identity_recovery_review(uuid,text,uuid),public.master_read_identity_recovery_reviews(),public.admin_open_identity_recovery_review(uuid,text,uuid),public.admin_read_identity_recovery_reviews(),public.admin_decide_identity_recovery(uuid,text,uuid),public.master_attest_identity_recovery_evidence(uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.master_open_identity_recovery_review(uuid,text,uuid),public.master_read_identity_recovery_reviews(),public.admin_open_identity_recovery_review(uuid,text,uuid),public.admin_read_identity_recovery_reviews(),public.admin_decide_identity_recovery(uuid,text,uuid) to authenticated;
grant execute on function public.master_attest_identity_recovery_evidence(uuid,text,text,uuid) to service_role;
commit;

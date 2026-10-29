-- Production catalog bodies captured read-only 2026-10-29. No customer data.
CREATE OR REPLACE FUNCTION public.es02_read_branch_inbox(p_company_id uuid, p_branch_id uuid, p_channel text, p_conversation_id uuid DEFAULT NULL::uuid, p_before bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid;account_key text;items jsonb;messages jsonb;conv jsonb;next_seq bigint;more boolean;
begin
 uid:=private.staff_invitation_actor(false);
 if p_channel is null or p_channel not in ('whatsapp','instagram') or p_limit is null or p_limit not between 1 and 100 or p_before<=0 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 -- Hold membership and grant authority through projection so revocation is ordered with reads.
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid and ((es02_branch_only and status='branch_active') or (role='owner' and status='active')) for share;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from private.es02_branch_member_grants where company_id=p_company_id and user_id=uid and branch_id=p_branch_id for share;
 if not public.es02_has_branch_capability(p_company_id,p_branch_id,case when p_channel='whatsapp' then 'wa.conversations.read' else 'ig.conversations.read' end)
 or not private.billing_chat_access(p_company_id,p_channel) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_channel='whatsapp' then
  select l.provider_phone_number_id into account_key from private.es02_b3_connection_links b join public.whatsapp_company_links l on l.id=b.legacy_link_id and l.company_id=b.company_id and l.generation=b.legacy_generation
  where b.company_id=p_company_id and b.branch_id=p_branch_id and b.channel=p_channel and b.verified and b.status='active' and b.revoked_at is null and l.status='verified' and l.authorization_status='active' and (l.authorization_expires_at is null or l.authorization_expires_at>clock_timestamp()) for share of b,l;
 else
  select l.account_id into account_key from private.es02_b3_connection_links b join private.instagram_company_links l on l.id=b.legacy_link_id and l.company_id=b.company_id and l.generation=b.legacy_generation
  where b.company_id=p_company_id and b.branch_id=p_branch_id and b.channel=p_channel and b.verified and b.status='active' and b.revoked_at is null and l.status='active' and l.authorization_expires_at>clock_timestamp() for share of b,l;
 end if;
 if account_key is null or not private.billing_history_account_allowed(p_company_id,p_channel,account_key) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_channel='whatsapp' then
  if p_conversation_id is null then
   with eligible as (select c from public.whatsapp_conversations c where c.company_id=p_company_id and c.phone_number_id=account_key and (p_before is null or c.inbox_sequence<p_before) order by c.inbox_sequence desc limit p_limit+1),
   page as (select c from eligible order by (c).inbox_sequence desc limit p_limit)
   select coalesce(jsonb_agg(private.whatsapp_inbox_conversation_public(c,uid) order by (c).inbox_sequence desc),'[]'),min((c).inbox_sequence),(select count(*)>p_limit from eligible) into items,next_seq,more from page;
  else
   select private.whatsapp_inbox_conversation_public(c,uid) into conv from public.whatsapp_conversations c where c.company_id=p_company_id and c.id=p_conversation_id and c.phone_number_id=account_key;
   if conv is null then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
   with eligible as (select m from public.whatsapp_messages m where m.company_id=p_company_id and m.conversation_id=p_conversation_id and (p_before is null or m.arrival_sequence<p_before) order by m.arrival_sequence desc limit p_limit+1),
   page as (select m from eligible order by (m).arrival_sequence desc limit p_limit)
   select coalesce(jsonb_agg(private.whatsapp_inbox_message_public(m) order by (m).arrival_sequence),'[]'),min((m).arrival_sequence),(select count(*)>p_limit from eligible) into messages,next_seq,more from page;
  end if;
 else
  if p_conversation_id is null then
   with eligible as (select c from private.instagram_conversations c where c.company_id=p_company_id and c.account_id=account_key and (p_before is null or c.inbox_sequence<p_before) order by c.inbox_sequence desc limit p_limit+1),
   page as (select c from eligible order by (c).inbox_sequence desc limit p_limit)
   select coalesce(jsonb_agg(private.instagram_inbox_item(c,uid) order by (c).inbox_sequence desc),'[]'),min((c).inbox_sequence),(select count(*)>p_limit from eligible) into items,next_seq,more from page;
  else
   select private.instagram_inbox_item(c,uid) into conv from private.instagram_conversations c where c.company_id=p_company_id and c.id=p_conversation_id and c.account_id=account_key;
   if conv is null then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
   with eligible as (select m from private.instagram_messages m where m.company_id=p_company_id and m.conversation_id=p_conversation_id and (p_before is null or m.arrival_sequence<p_before) order by m.arrival_sequence desc limit p_limit+1),
   page as (select m from eligible order by (m).arrival_sequence desc limit p_limit)
   select coalesce(jsonb_agg(private.instagram_inbox_message(m) order by (m).arrival_sequence),'[]'),min((m).arrival_sequence),(select count(*)>p_limit from eligible) into messages,next_seq,more from page;
  end if;
 end if;
 return jsonb_build_object('ok',true,'companyId',p_company_id,'branchId',p_branch_id,'channel',p_channel,'conversations',items,'conversation',conv,'messages',messages,'has_more',more,'next_cursor',case when more then next_seq::text end);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',sqlerrm);
end;$function$;
CREATE OR REPLACE FUNCTION private.billing_history_account_allowed(cid uuid, channel text, account text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare expected text;begin
 if current_setting('role',true)='authenticated' and not public.has_company_capability(cid,case when channel='instagram' then 'ig.conversations.read' else 'wa.conversations.read' end) then return false;end if;
 if channel='instagram' then select bound_account_id into expected from private.instagram_company_generations where company_id=cid;
 elsif channel='whatsapp' then select provider_phone_number_id into expected from public.whatsapp_company_links where company_id=cid;else return false;end if;
 return expected is null or expected=account;
end;$function$;
CREATE OR REPLACE FUNCTION private.staff_invitation_actor(p_touch boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := auth.uid(); checked jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  checked := public.check_app_session(p_touch);
  if not coalesce((checked->>'ok')::boolean, false) then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if not exists(select 1 from auth.users where id = uid and email_confirmed_at is not null and email is not null) then
    raise exception 'UNVERIFIED' using errcode = '42501';
  end if;
  return uid;
end; $function$;
CREATE OR REPLACE FUNCTION public.check_app_session(p_touch boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
   if not private.ad_not_deleting(auth.uid()) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
   return private.ad_native_check_session(p_touch);end$function$;
CREATE OR REPLACE FUNCTION private.ad_native_check_session(p_touch boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if not exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid() and private.master_identity_session_current(user_id,id)) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 return private.master_identity_pre_check_app_session(p_touch);
end;$function$;
CREATE OR REPLACE FUNCTION private.master_identity_pre_check_app_session(p_touch boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;begin
 -- Check epoch/native expiry before the old kernel can create or touch activity.
 if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  left join private.master_account_session_revocations x on x.user_id=u.id
  where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid()
  and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp())
  and (x.revoked_before is null or s.created_at>x.revoked_before)) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 r:=private.master_password_native_check_app_session(p_touch);
 if r->>'code'='MASTER_IDLE_ACTIVITY_ADVANCED' then r:=private.master_password_native_check_app_session(p_touch);end if;
 if r->>'code'='MASTER_IDLE_ACTIVITY_ADVANCED' then return jsonb_build_object('ok',false,'code','SESSION_EXPIRED');end if;
 if coalesce((r->>'ok')::boolean,false) and not public.app_session_is_valid() then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 return r;
end;$function$;
CREATE OR REPLACE FUNCTION private.master_password_native_check_app_session(p_touch boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); sid uuid; created timestamptz; activity private.app_session_activity%rowtype; current_time_at timestamptz:=clock_timestamp();
begin
 if uid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end;
 if sid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 select created_at into created from auth.sessions where id=sid and user_id=uid;
 if not found then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 insert into private.app_session_activity(session_id,user_id,last_activity_at) values(sid,uid,least(created,clock_timestamp())) on conflict do nothing;
 if p_touch then select * into activity from private.app_session_activity where session_id=sid and user_id=uid for update; else select * into activity from private.app_session_activity where session_id=sid and user_id=uid;end if;
 -- Read the clock after the lock: a concurrent touch may have advanced last_activity_at.
 current_time_at:=clock_timestamp();
 if not found or activity.expired_at is not null or activity.last_activity_at>current_time_at or current_time_at-activity.last_activity_at>=interval '2 hours' then
  update private.app_session_activity set expired_at=coalesce(expired_at,current_time_at) where session_id=sid and user_id=uid and last_activity_at=activity.last_activity_at and expired_at is not distinct from activity.expired_at; if not found then return jsonb_build_object('ok',false,'code','MASTER_IDLE_ACTIVITY_ADVANCED');end if;
  return jsonb_build_object('ok',false,'code','SESSION_EXPIRED');
 end if;
 if p_touch then
  update private.app_session_activity set last_activity_at=current_time_at where session_id=sid;
  activity.last_activity_at:=current_time_at;
 end if;
 return jsonb_build_object('ok',true,'expires_at',activity.last_activity_at+interval '2 hours');
end;$function$;

-- Actual post-migration Production branch inbox/billing bodies, 2026-10-29.
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
 or not private.billing_chat_access(p_company_id,p_channel,p_branch_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_channel='whatsapp' then
  select l.provider_phone_number_id into account_key from private.es02_b3_connection_links b join public.whatsapp_company_links l on l.id=b.legacy_link_id and l.company_id=b.company_id and l.generation=b.legacy_generation
  where b.company_id=p_company_id and b.branch_id=p_branch_id and b.channel=p_channel and b.verified and b.status='active' and b.revoked_at is null and l.status='verified' and l.authorization_status='active' and (l.authorization_expires_at is null or l.authorization_expires_at>clock_timestamp()) for share of b,l;
 else
  select l.account_id into account_key from private.es02_b3_connection_links b join private.instagram_company_links l on l.id=b.legacy_link_id and l.company_id=b.company_id and l.generation=b.legacy_generation
  where b.company_id=p_company_id and b.branch_id=p_branch_id and b.channel=p_channel and b.verified and b.status='active' and b.revoked_at is null and l.status='active' and l.authorization_expires_at>clock_timestamp() for share of b,l;
 end if;
 if account_key is null or not private.billing_history_account_allowed(p_company_id,p_channel,account_key,p_branch_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
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
CREATE OR REPLACE FUNCTION private.billing_chat_access(cid uuid, channel text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if current_setting('role',true)='authenticated' and not exists(select 1 from public.company_members where company_id=cid and user_id=auth.uid() and status='active') then return false;end if;
 return private.billing_chat_policy(cid,channel);
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
CREATE OR REPLACE FUNCTION private.billing_chat_policy(cid uuid, channel text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare r jsonb;e timestamptz;begin

 r:=private.billing_lifecycle_receipt(cid);if r is null then return not exists(select 1 from public.billing_subscriptions where company_id=cid and environment='live' and paid_through is not null);end if;
 e:=(r->>'expiredAt')::timestamptz;
 if statement_timestamp()>=e+interval '720 hours' then return false;end if;
 if statement_timestamp()<e and exists(select 1 from private.billing_expiry_episodes where company_id=cid and disconnected_at is not null) then
  if channel='instagram' then return exists(select 1 from private.instagram_company_links l join private.instagram_company_generations g on g.company_id=l.company_id and g.bound_account_id=l.account_id and g.generation=l.generation where l.company_id=cid and l.status='active' and l.authorization_expires_at>statement_timestamp());end if;
  if channel='whatsapp' then return exists(select 1 from public.whatsapp_company_links where company_id=cid and status='verified' and authorization_status='active' and (authorization_expires_at>statement_timestamp() or (authorization_expires_at is null and authorization_non_expiring)));end if;
 end if;return true;
end;$function$;
CREATE OR REPLACE FUNCTION private.billing_chat_access(cid uuid, channel text, bid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if channel is null or channel not in ('whatsapp','instagram') or bid is null
 or not public.es02_has_branch_capability(cid,bid,case when channel='whatsapp' then 'wa.conversations.read' else 'ig.conversations.read' end) then return false;end if;
 return private.billing_chat_policy(cid,channel);
end;$function$;
CREATE OR REPLACE FUNCTION private.billing_history_account_allowed(cid uuid, channel text, account text, bid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare expected text;begin
 if not private.billing_chat_access(cid,channel,bid) then return false;end if;
 if channel='instagram' then select bound_account_id into expected from private.instagram_company_generations where company_id=cid;
 elsif channel='whatsapp' then select provider_phone_number_id into expected from public.whatsapp_company_links where company_id=cid;else return false;end if;
 return expected is null or expected=account;
end;$function$;

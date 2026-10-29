-- Production catalog policies/authority captured 2026-10-29; no customer rows.
-- branch_chat_readable pg_get_functiondef MD5:624fa0e2842a7602a49c37e5d169f370
alter table auth.users add phone_confirmed_at timestamptz;
CREATE OR REPLACE FUNCTION private.branch_chat_readable(cid uuid, channel text, account text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE bid uuid;
BEGIN
 IF account IS NULL OR channel IS NULL OR channel NOT IN ('whatsapp','instagram') THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.company_members m WHERE m.company_id=cid AND m.user_id=auth.uid() AND m.role='staff' AND m.es02_branch_only AND m.status='branch_active') THEN RETURN false;END IF;
 IF channel='whatsapp' THEN
  SELECT b.branch_id INTO bid FROM private.es02_b3_connection_links b
  JOIN public.whatsapp_company_links l ON l.id=b.legacy_link_id AND l.company_id=b.company_id AND l.generation=b.legacy_generation
  WHERE b.company_id=cid AND b.channel=$2 AND b.verified AND b.status='active' AND b.revoked_at IS NULL
   AND l.provider_phone_number_id=$3 AND l.status='verified' AND l.authorization_status='active'
   AND (l.authorization_expires_at IS NULL OR l.authorization_expires_at>statement_timestamp());
 ELSE
  SELECT b.branch_id INTO bid FROM private.es02_b3_connection_links b
  JOIN private.instagram_company_links l ON l.id=b.legacy_link_id AND l.company_id=b.company_id AND l.generation=b.legacy_generation
  WHERE b.company_id=cid AND b.channel=$2 AND b.verified AND b.status='active' AND b.revoked_at IS NULL
   AND l.account_id=$3 AND l.status='active' AND l.authorization_expires_at>statement_timestamp();
 END IF;
 RETURN bid IS NOT NULL AND private.billing_chat_access(cid,channel,bid)
  AND private.billing_history_account_allowed(cid,channel,account,bid);
END;$function$;
CREATE OR REPLACE FUNCTION public.app_identity_is_verified()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from auth.users u where u.id=auth.uid()
   and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null));
$function$;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
CREATE POLICY ad_account_access_fence ON public.whatsapp_conversations AS RESTRICTIVE FOR ALL TO authenticated USING (private.ad_not_deleting(( SELECT auth.uid() AS uid))) WITH CHECK (private.ad_not_deleting(( SELECT auth.uid() AS uid)));
CREATE POLICY velora_active_session ON public.whatsapp_conversations AS RESTRICTIVE FOR ALL TO authenticated USING (( SELECT app_session_is_valid() AS app_session_is_valid)) WITH CHECK (( SELECT app_session_is_valid() AS app_session_is_valid));
CREATE POLICY velora_verified_identity ON public.whatsapp_conversations AS RESTRICTIVE FOR ALL TO authenticated USING (( SELECT app_identity_is_verified() AS app_identity_is_verified)) WITH CHECK (( SELECT app_identity_is_verified() AS app_identity_is_verified));
CREATE POLICY whatsapp_conversations_select ON public.whatsapp_conversations AS PERMISSIVE FOR SELECT TO authenticated USING (((private.conversation_readable(company_id, assigned_to) AND private.billing_chat_access(company_id, 'whatsapp'::text) AND private.billing_history_account_allowed(company_id, 'whatsapp'::text, phone_number_id)) OR private.branch_chat_readable(company_id, 'whatsapp'::text, phone_number_id)));
CREATE POLICY ad_account_access_fence ON public.whatsapp_messages AS RESTRICTIVE FOR ALL TO authenticated USING (private.ad_not_deleting(( SELECT auth.uid() AS uid))) WITH CHECK (private.ad_not_deleting(( SELECT auth.uid() AS uid)));
CREATE POLICY velora_active_session ON public.whatsapp_messages AS RESTRICTIVE FOR ALL TO authenticated USING (( SELECT app_session_is_valid() AS app_session_is_valid)) WITH CHECK (( SELECT app_session_is_valid() AS app_session_is_valid));
CREATE POLICY velora_verified_identity ON public.whatsapp_messages AS RESTRICTIVE FOR ALL TO authenticated USING (( SELECT app_identity_is_verified() AS app_identity_is_verified)) WITH CHECK (( SELECT app_identity_is_verified() AS app_identity_is_verified));
CREATE POLICY whatsapp_messages_select ON public.whatsapp_messages AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM whatsapp_conversations c
  WHERE ((c.id = whatsapp_messages.conversation_id) AND (c.company_id = whatsapp_messages.company_id) AND (private.conversation_readable(c.company_id, c.assigned_to) OR private.branch_chat_readable(c.company_id, 'whatsapp'::text, c.phone_number_id))))));
revoke all on all functions in schema public,private,auth from public;
grant execute on function public.control_whatsapp_conversation(uuid,text,integer,uuid),public.create_whatsapp_send_intent(text,uuid,text,text,text,integer,uuid,bigint),public.es02_read_branch_inbox(uuid,uuid,text,uuid,bigint,integer),private.conversation_readable(uuid,uuid),private.billing_chat_access(uuid,text),private.billing_history_account_allowed(uuid,text,text),private.branch_chat_readable(uuid,text,text),private.ad_not_deleting(uuid),auth.uid(),public.app_session_is_valid(),public.app_identity_is_verified() to authenticated;
grant usage on schema auth to authenticated;
grant select on public.whatsapp_conversations,public.whatsapp_messages to authenticated;

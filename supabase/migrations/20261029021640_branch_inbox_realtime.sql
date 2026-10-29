-- Invalidation metadata only. No chat payload publication or customer backfill.
CREATE TABLE public.branch_inbox_invalidations (
 company_id uuid NOT NULL,
 branch_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel IN ('whatsapp','instagram')),
 revision uuid NOT NULL DEFAULT gen_random_uuid(),
 PRIMARY KEY(company_id,branch_id,channel)
);
ALTER TABLE public.branch_inbox_invalidations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.branch_inbox_invalidations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.branch_inbox_invalidations TO authenticated;

CREATE FUNCTION public.es02_can_watch_branch_inbox(cid uuid,bid uuid,ch text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE account_key text;
BEGIN
 IF ch IS NULL OR ch NOT IN ('whatsapp','instagram') OR cid IS NULL OR bid IS NULL
 OR NOT public.app_session_is_valid() OR NOT public.app_identity_is_verified()
 OR NOT private.ad_not_deleting(auth.uid())
 OR NOT private.billing_chat_access(cid,ch,bid) THEN RETURN false; END IF;
 IF ch='whatsapp' THEN
  SELECT l.provider_phone_number_id INTO account_key
  FROM private.es02_b3_connection_links b JOIN public.whatsapp_company_links l
   ON l.id=b.legacy_link_id AND l.company_id=b.company_id AND l.generation=b.legacy_generation
  WHERE b.company_id=cid AND b.branch_id=bid AND b.channel=ch AND b.verified
   AND b.status='active' AND b.revoked_at IS NULL AND l.status='verified'
   AND l.authorization_status='active'
   AND (l.authorization_expires_at IS NULL OR l.authorization_expires_at>statement_timestamp());
 ELSE
  SELECT l.account_id INTO account_key
  FROM private.es02_b3_connection_links b JOIN private.instagram_company_links l
   ON l.id=b.legacy_link_id AND l.company_id=b.company_id AND l.generation=b.legacy_generation
  WHERE b.company_id=cid AND b.branch_id=bid AND b.channel=ch AND b.verified
   AND b.status='active' AND b.revoked_at IS NULL AND l.status='active'
   AND l.authorization_expires_at>statement_timestamp();
 END IF;
 RETURN account_key IS NOT NULL AND private.billing_history_account_allowed(cid,ch,account_key,bid);
END; $$;
REVOKE ALL ON FUNCTION public.es02_can_watch_branch_inbox(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.es02_can_watch_branch_inbox(uuid,uuid,text) TO authenticated;
CREATE POLICY branch_inbox_read ON public.branch_inbox_invalidations FOR SELECT TO authenticated
 USING(public.es02_can_watch_branch_inbox(company_id,branch_id,channel));

CREATE FUNCTION private.invalidate_branch_inbox(cid uuid,ch text,account_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.branch_inbox_invalidations(company_id,branch_id,channel)
 SELECT b.company_id,b.branch_id,b.channel FROM private.es02_b3_connection_links b
 WHERE b.company_id=cid AND b.channel=ch AND b.verified AND b.status='active' AND b.revoked_at IS NULL
 AND ((ch='whatsapp' AND EXISTS(SELECT 1 FROM public.whatsapp_company_links l
  WHERE l.id=b.legacy_link_id AND l.company_id=cid AND l.generation=b.legacy_generation
   AND l.provider_phone_number_id=account_key AND l.status='verified' AND l.authorization_status='active'
   AND (l.authorization_expires_at IS NULL OR l.authorization_expires_at>statement_timestamp())))
 OR (ch='instagram' AND EXISTS(SELECT 1 FROM private.instagram_company_links l
  WHERE l.id=b.legacy_link_id AND l.company_id=cid AND l.generation=b.legacy_generation
   AND l.account_id=account_key AND l.status='active' AND l.authorization_expires_at>statement_timestamp())))
 ON CONFLICT(company_id,branch_id,channel) DO UPDATE SET revision=gen_random_uuid();
END; $$;
REVOKE ALL ON FUNCTION private.invalidate_branch_inbox(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.notify_branch_inbox_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE account_key text; cid uuid; ch text; old_cid uuid; old_account text;
BEGIN
 ch:=CASE WHEN TG_TABLE_SCHEMA='private' THEN 'instagram' ELSE 'whatsapp' END;
 -- Notify both scopes on moves; DELETE carries no customer data to subscribers.
 IF TG_OP<>'INSERT' THEN
  cid:=OLD.company_id;
  IF TG_TABLE_NAME='whatsapp_messages' THEN
   SELECT phone_number_id INTO account_key FROM public.whatsapp_conversations WHERE id=OLD.conversation_id AND company_id=cid;
  ELSIF ch='whatsapp' THEN account_key:=OLD.phone_number_id;
  ELSE account_key:=OLD.account_id; END IF;
  PERFORM private.invalidate_branch_inbox(cid,ch,account_key);
  old_cid:=cid;old_account:=account_key;
 END IF;
 IF TG_OP<>'DELETE' THEN
  cid:=NEW.company_id;
  IF TG_TABLE_NAME='whatsapp_messages' THEN
   SELECT phone_number_id INTO account_key FROM public.whatsapp_conversations WHERE id=NEW.conversation_id AND company_id=cid;
  ELSIF ch='whatsapp' THEN account_key:=NEW.phone_number_id;
  ELSE account_key:=NEW.account_id; END IF;
  IF TG_OP='INSERT' OR cid IS DISTINCT FROM old_cid OR account_key IS DISTINCT FROM old_account THEN
   PERFORM private.invalidate_branch_inbox(cid,ch,account_key);
  END IF;
 END IF;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 -- Notification is optional: preserve the original worker/webhook/control write.
 RAISE LOG 'BRANCH_INBOX_NOTIFICATION_FAILED sqlstate=%',SQLSTATE;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION private.notify_branch_inbox_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER branch_inbox_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.whatsapp_conversations
 FOR EACH ROW EXECUTE FUNCTION private.notify_branch_inbox_change();
CREATE TRIGGER branch_inbox_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.whatsapp_messages
 FOR EACH ROW EXECUTE FUNCTION private.notify_branch_inbox_change();
CREATE TRIGGER branch_inbox_invalidate AFTER INSERT OR UPDATE OR DELETE ON private.instagram_conversations
 FOR EACH ROW EXECUTE FUNCTION private.notify_branch_inbox_change();
CREATE TRIGGER branch_inbox_invalidate AFTER INSERT OR UPDATE OR DELETE ON private.instagram_messages
 FOR EACH ROW EXECUTE FUNCTION private.notify_branch_inbox_change();

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  RAISE EXCEPTION 'REALTIME_PUBLICATION_REQUIRED';
 END IF;
 ALTER PUBLICATION supabase_realtime ADD TABLE public.branch_inbox_invalidations;
END; $$;

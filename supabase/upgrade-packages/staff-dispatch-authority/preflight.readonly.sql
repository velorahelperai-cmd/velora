-- Metadata only. Installation remains separately approved; no customer contents.
select n.nspname||'.'||p.proname as function_name,md5(replace(p.prosrc,chr(13),'')) as body_hash,p.prosecdef,p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid in (
 to_regprocedure('public.claim_whatsapp_send_attempt(uuid,uuid,integer)'),to_regprocedure('public.create_whatsapp_send_intent(text,uuid,text,text,text,integer,uuid,bigint)'),
 to_regprocedure('private.whatsapp_intent_link_current(public.whatsapp_send_intents)'),to_regprocedure('private.whatsapp_meta_asset_binding(text,text)'),
 to_regprocedure('private.whatsapp_service_window(uuid,uuid,text,text)'),to_regprocedure('public.check_app_session(boolean)'),
 to_regprocedure('private.user_has_company_capability(uuid,uuid,text)'),to_regprocedure('private.user_conversation_readable(uuid,uuid,uuid)'),
 to_regprocedure('private.manager_delegation_covers(uuid,uuid,text)'),to_regprocedure('private.billing_service_receipt_eligible(uuid)')) order by function_name;
select c.oid::regclass as proof_view,md5(replace(pg_get_viewdef(c.oid,true),chr(13),'')) as definition_hash from pg_class c
where c.oid in (to_regclass('private.billing_proven_entitlement_grants'),to_regclass('private.billing_verified_collection_history'));
select tgrelid::regclass,tgname,tgenabled from pg_trigger where tgfoid=to_regprocedure('private.billing_financial_receipt_immutability()') and not tgisinternal order by tgrelid,tgname;
select r.role_name,has_function_privilege(r.role_name,'public.claim_whatsapp_send_attempt(uuid,uuid,integer)','EXECUTE') as may_claim
from (values('anon'),('authenticated'),('service_role')) r(role_name);
select current_user as installer,pg_get_userbyid(relowner) as intent_table_owner from pg_class where oid='public.whatsapp_send_intents'::regclass;

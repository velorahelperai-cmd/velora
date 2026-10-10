-- Read-only metadata and aggregate counts; no IDs, provider payloads or content.
select n.nspname||'.'||p.proname as function_name,md5(replace(prosrc,chr(13),'')) as body_hash,prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.oid in (to_regprocedure('public.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid)'),to_regprocedure('public.retry_whatsapp_send_persist(uuid,uuid)'),
 to_regprocedure('public.billing_finalize_automated_usage(uuid,uuid)'),to_regprocedure('public.billing_read_company_usage(uuid)'),to_regprocedure('public.whatsapp_repair_accepted_jobs(integer)'),
 to_regprocedure('public.whatsapp_retry_inbound_job(uuid,uuid,text,boolean,boolean)'),to_regprocedure('public.claim_whatsapp_inbound_job(uuid,integer)')) order by function_name;
select count(*) as duplicate_provider_identity_groups from (select 1 from public.whatsapp_send_intents where wa_message_id is not null group by wa_message_id having count(*)>1) duplicate_groups;
select count(*) as accepted_binding_review_count from public.whatsapp_inbound_jobs j left join public.whatsapp_send_intents i on i.id=j.send_intent_id and i.company_id=j.company_id and i.original_job_id=j.id
where j.usage_status='accepted' and (i.id is null or i.outcome<>'accepted' or nullif(btrim(i.wa_message_id),'') is null or j.usage_subscription_id is null or j.usage_period_start is null);
select oid::regclass as table_name,pg_get_userbyid(relowner) as owner,current_user as installer from pg_class where oid in ('public.whatsapp_send_intents'::regclass,'public.whatsapp_inbound_jobs'::regclass);
select to_regprocedure('public.whatsapp_authorize_staff_dispatch(uuid,uuid)') is not null as staff_dispatch_dependency_present;
select md5(replace(prosrc,chr(13),'')) as identity_guard_body_hash from pg_proc where oid=to_regprocedure('private.whatsapp_guard_persisted_identity()');
select tgrelid::regclass as guarded_table,tgname,tgenabled from pg_trigger where tgfoid=to_regprocedure('private.whatsapp_guard_persisted_identity()') and tgrelid in ('public.whatsapp_send_intents'::regclass,'public.whatsapp_inbound_jobs'::regclass) and not tgisinternal;

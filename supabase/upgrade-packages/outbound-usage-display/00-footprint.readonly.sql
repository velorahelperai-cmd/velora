-- Metadata only. Never invokes the display RPC or reads tenant records.
begin read only;
set local search_path='';
select jsonb_build_object(
 'signature',p.oid::regprocedure::text,
 'body_md5',md5(replace(p.prosrc,chr(13),'')),
 'owner',pg_get_userbyid(p.proowner),
 'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,
 'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
 'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
 'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
 'observation_column_present',exists(select 1 from information_schema.columns where table_schema='public' and table_name='whatsapp_send_intents' and column_name='acceptance_observed_at')
) as metadata
from pg_catalog.pg_proc p where p.oid=to_regprocedure('public.billing_read_company_display_evidence(uuid)');
rollback;

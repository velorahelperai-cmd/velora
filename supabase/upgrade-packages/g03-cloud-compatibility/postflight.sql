-- Catalog-only assertions, within the upgrade transaction; no customer data read.
do $$ declare sig text; r text; server_only boolean; begin
 if not exists(select 1 from pg_attribute where attrelid='public.knowledge_sources'::regclass and attname='usage_role' and atttypid='text'::regtype and attnotnull and not attisdropped)
 then raise exception 'USAGE_ROLE_NOT_INSTALLED';end if;
 foreach sig in array array['public.g03_begin_review_check(text,uuid,integer,text,text,boolean,text)',
  'public.g03_read_review_request(uuid)','public.list_owner_company_review_events_for_company(uuid)',
  'public.transition_company_review(text,uuid,integer,text,text,boolean,text)',
  'public.g03_complete_review_check(uuid,jsonb)',
  'public.g03_publish_prepared_file(uuid,uuid,uuid,uuid,integer,text,text,text,bigint,uuid,timestamp with time zone)'] loop
  if to_regprocedure(sig) is null then raise exception 'RPC_MISSING: %',sig;end if;
  server_only:=sig like '%g03_complete%' or sig like '%g03_publish%';
  if has_function_privilege('anon',sig,'EXECUTE') or has_function_privilege('authenticated',sig,'EXECUTE')=server_only
    or has_function_privilege('service_role',sig,'EXECUTE')<>server_only then raise exception 'RPC_ACL_INVALID: %',sig;end if;
 end loop;
 foreach r in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(r,'private.g03_review_checks','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege(r,'private.g03_company_inputs','SELECT,INSERT,UPDATE,DELETE')
    or has_function_privilege(r,'private.company_review_request_json_pre_g03(uuid)','EXECUTE')
    then raise exception 'PRIVATE_PROOF_ACCESS: %',r;end if;
 end loop;
 if has_column_privilege('authenticated','public.knowledge_sources','prepared_file_sha256','UPDATE')
  or has_column_privilege('authenticated','public.knowledge_sources','approved_for_answers','UPDATE')
  or not has_column_privilege('authenticated','public.knowledge_sources','usage_role','UPDATE') then raise exception 'KNOWLEDGE_COLUMN_ACL_INVALID';end if;
 if (select count(*) from pg_trigger where not tgisinternal and tgenabled='O' and tgname in
  ('g03_company_input_epoch','g03_knowledge_input_epoch','g03_owner_input_epoch','knowledge_sources_zz_g03_prepared_file','knowledge_sources_z_usage_role_approval'))<>5 then raise exception 'G03_TRIGGERS_MISSING';end if;
end $$;

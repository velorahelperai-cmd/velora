-- Local review candidate. Run in the same transaction BEFORE any passage DDL.
-- Hosted fingerprints re-read 2026-11-02; no implicit acceptance of changed code.
do $guard$
declare expected record; actual record; new_signature text;
begin
 for expected in select * from (values
  ('private.es02_whatsapp_citations_current(uuid,uuid,jsonb)','a33431d2834dc67cf095533380ab493b','{postgres=X/postgres}'),
  ('public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text)','3305a1267985ba312c45039c0f084e94','{postgres=X/postgres,service_role=X/postgres}')
 ) x(signature,body_md5,acl) loop
  select md5(replace(p.prosrc,chr(13),'')) body_md5,pg_get_userbyid(p.proowner) owner,
   p.prosecdef,p.proconfig,p.proacl::text acl,l.lanname
  into actual from pg_proc p join pg_language l on l.oid=p.prolang
  where p.oid=to_regprocedure(expected.signature);
  if not found or actual.body_md5 is distinct from expected.body_md5
   or actual.owner is distinct from 'postgres' or actual.prosecdef is distinct from true
   or actual.proconfig is distinct from array['search_path=""']::text[]
   or actual.acl is distinct from expected.acl or actual.lanname is distinct from 'plpgsql'
  then raise exception 'PASSAGE_PREREQUISITE_DRIFT: %',expected.signature;end if;
 end loop;
 if to_regclass('private.knowledge_source_passages') is not null
  or to_regclass('private.branch_website_passages') is not null
 then raise exception 'PASSAGE_INDEX_ALREADY_EXISTS';end if;
 foreach new_signature in array array[
  'private.knowledge_search_text(text)','private.split_knowledge_passages(text)',
  'private.refresh_website_passages(uuid)','private.website_passages_changed()',
  'private.refresh_knowledge_passages(uuid)','private.knowledge_passages_changed()',
  'private.knowledge_context_chars(text)','private.es02_select_knowledge_passages(uuid,uuid,text)'
 ] loop
  if to_regprocedure(new_signature) is not null then
   raise exception 'PASSAGE_HELPER_ALREADY_EXISTS: %',new_signature;
  end if;
 end loop;
end;$guard$;

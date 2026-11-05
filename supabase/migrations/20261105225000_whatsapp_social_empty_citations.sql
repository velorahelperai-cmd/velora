-- Allow empty citations for pure social small-talk replies in WhatsApp assistant worker

CREATE OR REPLACE FUNCTION private.es02_whatsapp_citations_current(p_company_id uuid, p_branch_id uuid, p_citations jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x jsonb;sid text;v numeric;k public.knowledge_sources;page private.es02_branch_website_pages;hours private.es02_branch_hours;
begin
 if p_company_id is null or p_branch_id is null or jsonb_typeof(p_citations) is distinct from 'array'
 then return false;end if;
 if not exists(select 1 from public.company_branches where id=p_branch_id and company_id=p_company_id) then return false;end if;
 if jsonb_array_length(p_citations) = 0 then return true; end if;
 if jsonb_array_length(p_citations) > 40 then return false;end if;
 for x in select value from jsonb_array_elements(p_citations) loop
  if jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'sourceId') is distinct from 'string'
   or jsonb_typeof(x->'contentVersion') is distinct from 'number' then return false;end if;
  sid:=x->>'sourceId';v:=(x->>'contentVersion')::numeric;
  if v<1 or v>2147483647 or v<>trunc(v) then return false;end if;
  if sid='hours-'||p_branch_id::text then
   select * into hours from private.es02_branch_hours where company_id=p_company_id and branch_id=p_branch_id for share;
   if not found or hours.revision is distinct from v::bigint or (x ? 'title' and x->>'title' is distinct from 'Working Hours') then return false;end if;
  elsif left(sid,5)='page-' then
   select * into page from private.es02_branch_website_pages where id=substring(sid from 6)::uuid
    and company_id=p_company_id and branch_id=p_branch_id for share;
   if not found or page.status<>'indexed' or length(btrim(page.extracted_text))=0 or page.version is distinct from v::integer
    or (x ? 'title' and x->>'title' is distinct from coalesce(nullif(page.title,''),page.url)) then return false;end if;
  else
   perform 1 from private.es02_branch_knowledge_sources b
    where b.source_id=sid::uuid and b.company_id=p_company_id and b.branch_id=p_branch_id for share;
   if not found then return false;end if;
   select * into k from public.knowledge_sources where id=sid::uuid and company_id=p_company_id for share;
   if not found or k.status<>'ready' or not k.approved_for_answers or k.approved_version is distinct from k.content_version
    or k.content_version is distinct from v::integer or length(btrim(k.content))=0
    or (x ? 'title' and x->>'title' is distinct from k.title) then return false;end if;
  end if;
 end loop;
 if (select count(distinct value->>'sourceId') from jsonb_array_elements(p_citations))<>jsonb_array_length(p_citations) then return false;end if;
 return not exists (
  select 1 from public.knowledge_sources s
  join private.es02_branch_knowledge_sources b on b.source_id=s.id and b.company_id=s.company_id
  where s.company_id=p_company_id and b.branch_id=p_branch_id
   and s.usage_role='business_instructions' and s.status='ready' and s.approved_for_answers
   and s.approved_version=s.content_version and length(btrim(s.content))>0
   and not exists(select 1 from jsonb_array_elements(p_citations) c
    where c->>'sourceId'=s.id::text and c->>'contentVersion'=s.content_version::text and c->>'title'=s.title)
 );
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;$function$;

CREATE OR REPLACE FUNCTION private.wa_worker_citations(p_company uuid, p_citations jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x jsonb;k public.knowledge_sources%rowtype;begin
 if jsonb_typeof(p_citations) is distinct from 'array' or jsonb_array_length(p_citations)>40 then return false;end if;
 if jsonb_array_length(p_citations) = 0 then return true; end if;
 for x in select value from jsonb_array_elements(p_citations) loop
 select * into k from public.knowledge_sources where id=(x->>'sourceId')::uuid and company_id=p_company for share;
 if not found or k.status<>'ready' or not k.approved_for_answers or k.approved_version is distinct from k.content_version
 or k.content_version is distinct from (x->>'contentVersion')::integer or length(btrim(k.content))=0 then return false;end if;
 end loop;return true;
 exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;$function$;

CREATE OR REPLACE FUNCTION private.ai_whatsapp_citations_current(p_company_id uuid, p_citations jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare x jsonb; k public.knowledge_sources%rowtype; version_value numeric;
begin
 if jsonb_typeof(p_citations) is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_citations) = 0 then return true; end if;
 if jsonb_array_length(p_citations) > 40 then return false; end if;
 for x in select value from jsonb_array_elements(p_citations) loop
  if jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'sourceId') is distinct from 'string'
   or jsonb_typeof(x->'contentVersion') is distinct from 'number' then return false; end if;
  version_value:=(x->>'contentVersion')::numeric;
  if version_value<1 or version_value>2147483647 or version_value<>trunc(version_value) then return false; end if;
  select * into k from public.knowledge_sources where id=(x->>'sourceId')::uuid and company_id=p_company_id for share;
  if not found or k.status<>'ready' or not k.approved_for_answers or k.approved_version is distinct from k.content_version
   or k.content_version is distinct from version_value::integer or length(btrim(k.content))=0
   or (x ? 'title' and x->>'title' is distinct from k.title) then return false; end if;
 end loop;
 return (select count(distinct value->>'sourceId')=jsonb_array_length(p_citations) from jsonb_array_elements(p_citations));
 exception when invalid_text_representation or numeric_value_out_of_range then return false;
end; $function$;

ALTER TABLE public.ai_usage_ledger DROP CONSTRAINT IF EXISTS ai_attempt_authorization_binding;
ALTER TABLE public.ai_usage_ledger ADD CONSTRAINT ai_attempt_authorization_binding
CHECK ((((worker_job_id IS NULL) AND (worker_claim_token IS NULL) AND (automation_generation IS NULL) AND (actor_user_id IS NOT NULL) AND (actor_session_id IS NOT NULL)) OR ((worker_job_id IS NOT NULL) AND (worker_claim_token IS NOT NULL) AND (automation_generation >= 0) AND (automation_generation IS NOT NULL) AND (usage_mode = 'company_live'::text) AND (actor_user_id IS NULL) AND (actor_session_id IS NULL) AND
CASE
    WHEN (jsonb_typeof(source_citations) = 'array'::text) THEN ((jsonb_array_length(source_citations) >= 0) AND (jsonb_array_length(source_citations) <= 40))
    ELSE false
END)));

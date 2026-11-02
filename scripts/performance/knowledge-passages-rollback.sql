-- Restore original read/citation functions; retain unused derived indexes.
-- Does not delete customer content, approval history or derived data.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
create or replace function private.es02_whatsapp_citations_current(p_company_id uuid,p_branch_id uuid,p_citations jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare x jsonb;sid text;v numeric;k public.knowledge_sources;page private.es02_branch_website_pages;hours private.es02_branch_hours;
begin
 if p_company_id is null or p_branch_id is null or jsonb_typeof(p_citations) is distinct from 'array'
 then return false;end if;
 if jsonb_array_length(p_citations) not between 1 and 40 then return false;end if;
 if not exists(select 1 from public.company_branches where id=p_branch_id and company_id=p_company_id) then return false;end if;
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
   select * into k from public.knowledge_sources where id=sid::uuid and company_id=p_company_id for share;
   if not found or k.status<>'ready' or not k.approved_for_answers or k.approved_version is distinct from k.content_version
    or k.content_version is distinct from v::integer or length(btrim(k.content))=0
    or (x ? 'title' and x->>'title' is distinct from k.title) then return false;end if;
  end if;
 end loop;
 if (select count(distinct value->>'sourceId') from jsonb_array_elements(p_citations))<>jsonb_array_length(p_citations) then return false;end if;
 -- Preserve the existing mandatory business-instruction inclusion rule.
 return private.whatsapp_citations_include_current_instructions(p_company_id,p_citations);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;$$;
create or replace function public.whatsapp_retrieve_approved_knowledge(p_company_id uuid,p_job_id uuid,p_claim_token uuid,p_question text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g jsonb;f jsonb;query_text text;q tsquery;rows jsonb;citations jsonb;n integer;chars bigint;knowledge_count integer;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_retrieve_approved_knowledge(p_company_id,p_job_id,p_claim_token,p_question);end if;
 if p_company_id is null or p_question is null or length(btrim(p_question)) not between 1 and 1000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);if g->>'ok' is distinct from 'true' then return g;end if;
 if g->>'company_id' is distinct from p_company_id::text then return jsonb_build_object('ok',false,'code','company_binding_rejected');end if;
 if not exists(select 1 from public.whatsapp_inbound_jobs j join public.whatsapp_messages m on m.id=j.message_id and m.company_id=j.company_id
  where j.id=p_job_id and j.company_id=p_company_id and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer'
   and m.body=p_question) then return jsonb_build_object('ok',false,'code','question_binding_rejected');end if;
 select string_agg(quote_literal(word),' | ' order by word) into query_text
 from unnest(tsvector_to_array(to_tsvector('simple'::regconfig,p_question))) tokens(word) where length(word)>1;
 if query_text is null then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 q:=to_tsquery('simple'::regconfig,query_text);
 with candidates as (
  select k.id::text as id,k.company_id,k.title,btrim(k.content) as content,k.content_version,k.approved_version,k.approved_for_answers,
   k.status,k.kind,k.storage_path,k.byte_size,k.updated_at,k.usage_role
  from public.knowledge_sources k where k.company_id=p_company_id and k.status='ready' and k.approved_for_answers
   and k.approved_version=k.content_version and length(btrim(k.content))>0
   and (k.usage_role='business_instructions' or to_tsvector('simple'::regconfig,k.title||' '||k.content)@@q)
  union all
  select 'page-'||p.id,p.company_id,coalesce(nullif(p.title,''),p.url),btrim(p.extracted_text),p.version,p.version,true,'ready','text',null,null,p.updated_at,'knowledge'
  from private.es02_branch_website_pages p where p.company_id=p_company_id and p.branch_id=(g->>'branch_id')::uuid
   and p.status='indexed' and length(btrim(p.extracted_text))>0 and to_tsvector('simple'::regconfig,coalesce(p.title,p.url)||' '||p.extracted_text)@@q
  union all
  select 'hours-'||h.branch_id,h.company_id,'Working Hours',
   'Branch hours ('||b.name||', timezone: '||b.timezone||'): '||h.schedule::text,h.revision::integer,h.revision::integer,true,'ready','text',null,null,h.updated_at,'business_instructions'
  from private.es02_branch_hours h join public.company_branches b on b.id=h.branch_id and b.company_id=h.company_id
  where h.company_id=p_company_id and h.branch_id=(g->>'branch_id')::uuid and h.revision between 1 and 2147483647
 ), selected as materialized (
  select * from candidates order by usage_role,id limit 41
 ) select coalesce(jsonb_agg(to_jsonb(s) order by s.usage_role,s.id),'[]'::jsonb),count(*),
  coalesce(sum(length(s.title)+length(s.content)+5),0)+greatest(count(*)-1,0)*2,count(*) filter(where s.usage_role='knowledge')
 into rows,n,chars,knowledge_count from selected s;
 if n>40 or chars>12000 then return jsonb_build_object('ok',false,'code','CONTEXT_OVERFLOW');end if;
 if knowledge_count=0 then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 select jsonb_agg(jsonb_build_object('sourceId',x->>'id','title',x->>'title','contentVersion',x->'content_version')) into citations from jsonb_array_elements(rows)x;
 if not private.es02_whatsapp_citations_current(p_company_id,(g->>'branch_id')::uuid,citations) then return jsonb_build_object('ok',false,'code','APPROVAL_INCOMPLETE');end if;
 f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if f->>'ok' is distinct from 'true' or f is distinct from g then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'job_id',p_job_id,'sources',rows,'context_chars',chars);
end;$$;
notify pgrst,'reload schema';
commit;

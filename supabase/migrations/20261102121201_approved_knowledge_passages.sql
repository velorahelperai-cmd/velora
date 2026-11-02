-- Approved-parent authority and native claim fences are retained.
-- Deployment requires compatible passage-envelope application code.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
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

-- LOCAL CANDIDATE: durable lexical passages, not yet wired to the worker reader.
-- The approved parent remains authority; this index never grants access/approval.
create or replace function private.knowledge_search_text(p_text text) returns text
language sql immutable strict parallel safe set search_path='' as $$
 select lower(translate(regexp_replace(p_text,'[ـًٌٍَُِّْٰ]','','g'),'أإآٱ','اااا'));
$$;
alter function private.knowledge_search_text(text) owner to postgres;
revoke all on function private.knowledge_search_text(text) from public,anon,authenticated,service_role;

-- Offsets are PostgreSQL Unicode characters, one-based [start,end). Original
-- text is preserved, including punctuation/diacritics/prices. Search is normalized.
create or replace function private.split_knowledge_passages(p_text text)
returns table(ordinal integer,start_char integer,end_char integer,body text)
language plpgsql immutable strict parallel safe set search_path='' as $$
declare cursor_pos integer:=1; stop_pos integer; total integer:=length(p_text);
 window_text text; boundary integer; reverse_offset integer;
begin
 ordinal:=0;
 while cursor_pos<=total loop
  stop_pos:=least(cursor_pos+1800,total+1);
  if stop_pos<=total then
   window_text:=substring(p_text from stop_pos-600 for 600);
   -- Prefer a paragraph, then a line, then a word boundary near the end.
   reverse_offset:=strpos(reverse(window_text),E'\n\n');
   if reverse_offset>0 then stop_pos:=stop_pos-reverse_offset+1;
   else
    reverse_offset:=strpos(reverse(window_text),E'\n');
    if reverse_offset=0 then reverse_offset:=strpos(reverse(window_text),' ');end if;
    if reverse_offset>0 then stop_pos:=stop_pos-reverse_offset+1;end if;
   end if;
  end if;
  ordinal:=ordinal+1;start_char:=cursor_pos;end_char:=stop_pos;
  body:=substring(p_text from start_char for end_char-start_char);
  return next;
  exit when stop_pos>total;
  -- Up to 200 characters of overlap, aligned to the next word when possible.
  boundary:=greatest(cursor_pos+1,stop_pos-200);
  window_text:=substring(p_text from boundary for least(200,stop_pos-boundary));
  reverse_offset:=strpos(window_text,' ');
  cursor_pos:=case when reverse_offset>0 then boundary+reverse_offset else boundary end;
 end loop;
end;$$;

-- Website passages use the existing indexed-page version and native branch scope.
create table private.branch_website_passages (
 source_id uuid not null references private.es02_branch_website_pages(id) on delete cascade,
 company_id uuid not null references public.companies(id),
 branch_id uuid not null,
 content_version integer not null check(content_version>0),
 ordinal integer not null check(ordinal>0),
 start_char integer not null check(start_char>0),
 end_char integer not null,
 body text not null,
 search_vector tsvector not null,
 primary key(source_id,ordinal),
 foreign key(company_id,branch_id) references public.company_branches(company_id,id),
 check(end_char>start_char and end_char-start_char=length(body) and length(body)<=1800)
);
alter table private.branch_website_passages owner to postgres;
alter table private.branch_website_passages enable row level security;
revoke all on table private.branch_website_passages from public,anon,authenticated,service_role;
create index branch_website_passages_search on private.branch_website_passages using gin(search_vector);
create index branch_website_passages_scope on private.branch_website_passages(company_id,branch_id,source_id,content_version);

create or replace function private.refresh_website_passages(p_source_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare source private.es02_branch_website_pages;
begin
 select * into source from private.es02_branch_website_pages where id=p_source_id for update;
 delete from private.branch_website_passages where source_id=p_source_id;
 if source.id is null or source.status<>'indexed' or length(btrim(source.extracted_text))=0 then return;end if;
 insert into private.branch_website_passages(source_id,company_id,branch_id,content_version,ordinal,start_char,end_char,body,search_vector)
 select source.id,source.company_id,source.branch_id,source.version,p.ordinal,p.start_char,p.end_char,p.body,
  setweight(to_tsvector('simple'::regconfig,private.knowledge_search_text(coalesce(nullif(source.title,''),source.url))),'A')
  ||setweight(to_tsvector('simple'::regconfig,private.knowledge_search_text(p.body)),'B')
 from private.split_knowledge_passages(source.extracted_text) p;
end;$$;
alter function private.refresh_website_passages(uuid) owner to postgres;
revoke all on function private.refresh_website_passages(uuid) from public,anon,authenticated,service_role;
create or replace function private.website_passages_changed() returns trigger
language plpgsql security definer set search_path='' as $$begin
 perform private.refresh_website_passages(new.id);return null;
end;$$;
alter function private.website_passages_changed() owner to postgres;
revoke all on function private.website_passages_changed() from public,anon,authenticated,service_role;
create trigger website_passages_inserted after insert on private.es02_branch_website_pages
 for each row execute function private.website_passages_changed();
create trigger website_passages_updated after update on private.es02_branch_website_pages
 for each row when ((old.company_id,old.branch_id,old.title,old.url,old.extracted_text,old.version,old.status)
 is distinct from (new.company_id,new.branch_id,new.title,new.url,new.extracted_text,new.version,new.status))
 execute function private.website_passages_changed();
do $$declare source_id uuid;begin
 for source_id in select id from private.es02_branch_website_pages where status='indexed'
 loop perform private.refresh_website_passages(source_id);end loop;
end;$$;
alter function private.split_knowledge_passages(text) owner to postgres;
revoke all on function private.split_knowledge_passages(text) from public,anon,authenticated,service_role;

create table private.knowledge_source_passages (
 source_id uuid not null references public.knowledge_sources(id) on delete cascade,
 company_id uuid not null references public.companies(id),
 content_version integer not null check(content_version>0),
 ordinal integer not null check(ordinal>0),
 start_char integer not null check(start_char>0),
 end_char integer not null,
 body text not null,
 search_vector tsvector not null,
 primary key(source_id,ordinal),
 check(end_char>start_char and end_char-start_char=length(body) and length(body)<=1800)
);
alter table private.knowledge_source_passages owner to postgres;
alter table private.knowledge_source_passages enable row level security;
revoke all on table private.knowledge_source_passages from public,anon,authenticated,service_role;
create index knowledge_source_passages_search on private.knowledge_source_passages using gin(search_vector);
create index knowledge_source_passages_company on private.knowledge_source_passages(company_id,source_id,content_version);

create or replace function private.refresh_knowledge_passages(p_source_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare source public.knowledge_sources;
begin
 -- Serialize with edits/revocations. Replacement and approval are one transaction.
 select * into source from public.knowledge_sources where id=p_source_id for update;
 delete from private.knowledge_source_passages where source_id=p_source_id;
 if source.id is null or source.status<>'ready' or not source.approved_for_answers
  or source.approved_version is distinct from source.content_version
  or source.usage_role<>'knowledge' or length(btrim(source.content))=0 then return;end if;
 insert into private.knowledge_source_passages(source_id,company_id,content_version,ordinal,start_char,end_char,body,search_vector)
 select source.id,source.company_id,source.content_version,p.ordinal,p.start_char,p.end_char,p.body,
  setweight(to_tsvector('simple'::regconfig,private.knowledge_search_text(source.title)),'A')
  ||setweight(to_tsvector('simple'::regconfig,private.knowledge_search_text(p.body)),'B')
 from private.split_knowledge_passages(source.content) p;
end;$$;
alter function private.refresh_knowledge_passages(uuid) owner to postgres;
revoke all on function private.refresh_knowledge_passages(uuid) from public,anon,authenticated,service_role;

create or replace function private.knowledge_passages_changed() returns trigger
language plpgsql security definer set search_path='' as $$begin
 perform private.refresh_knowledge_passages(new.id);return null;
end;$$;
alter function private.knowledge_passages_changed() owner to postgres;
revoke all on function private.knowledge_passages_changed() from public,anon,authenticated,service_role;
create trigger knowledge_passages_inserted after insert on public.knowledge_sources
 for each row execute function private.knowledge_passages_changed();
create trigger knowledge_passages_updated after update on public.knowledge_sources
 for each row when ((old.company_id,old.title,old.content,old.content_version,old.approved_version,old.approved_for_answers,old.status,old.usage_role)
 is distinct from (new.company_id,new.title,new.content,new.content_version,new.approved_version,new.approved_for_answers,new.status,new.usage_role))
 execute function private.knowledge_passages_changed();

-- Backfill only current approved knowledge. Mandatory instructions stay complete
-- in the reader and are deliberately never converted into selected passages.
do $$declare source_id uuid;begin
 for source_id in select id from public.knowledge_sources where status='ready'
  and approved_for_answers and approved_version=content_version and usage_role='knowledge'
 loop perform private.refresh_knowledge_passages(source_id);end loop;
end;$$;

-- Private selector only. A public worker wrapper must validate the native claim
-- before this call and revalidate authority + citations after it.
create or replace function private.knowledge_context_chars(p_text text) returns integer
language sql immutable strict parallel safe set search_path='' as $$
 select length(p_text)+length(regexp_replace(p_text,U&'[^\+010000-\+10FFFF]','','g'));
$$;
alter function private.knowledge_context_chars(text) owner to postgres;
revoke all on function private.knowledge_context_chars(text) from public,anon,authenticated,service_role;

create or replace function private.es02_select_knowledge_passages(p_company_id uuid,p_branch_id uuid,p_question text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q tsquery; query_text text; item record; entry jsonb; selected jsonb:='{}'; sources jsonb;
 instructions jsonb; instruction_count integer; chars integer:=0; added integer; count_passages integer:=0; matched integer:=0;
 separator constant text:=E'\n\n[...]\n\n';
begin
 if p_company_id is null or p_branch_id is null or length(btrim(coalesce(p_question,''))) not between 1 and 1000
  or not exists(select 1 from public.company_branches where id=p_branch_id and company_id=p_company_id)
 then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 select string_agg(quote_literal(word),' | ' order by word) into query_text
 from unnest(tsvector_to_array(to_tsvector('simple'::regconfig,private.knowledge_search_text(p_question)))) tokens(word)
 where length(word)>1;
 if query_text is null then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 q:=to_tsquery('simple'::regconfig,query_text);
 -- Instructions are complete and mandatory; overflow is never silently clipped.
 with mandatory as (
  select k.id::text id,k.company_id,k.title,btrim(k.content) content,k.content_version,k.approved_version,
   k.approved_for_answers,k.status,k.kind,k.storage_path,k.byte_size,k.updated_at,k.usage_role
  from public.knowledge_sources k join private.es02_branch_knowledge_sources b
   on b.source_id=k.id and b.company_id=k.company_id and b.branch_id=p_branch_id
  where k.company_id=p_company_id and k.usage_role='business_instructions' and k.status='ready'
   and k.approved_for_answers and k.approved_version=k.content_version and length(btrim(k.content))>0
  union all
  select 'hours-'||h.branch_id,h.company_id,'Working Hours',
   'Branch hours ('||b.name||', timezone: '||b.timezone||'): '||h.schedule::text,
   h.revision::integer,h.revision::integer,true,'ready','text',null,null,h.updated_at,'business_instructions'
  from private.es02_branch_hours h join public.company_branches b on b.id=h.branch_id and b.company_id=h.company_id
  where h.company_id=p_company_id and h.branch_id=p_branch_id and h.revision between 1 and 2147483647
 ), limited as (select * from mandatory order by id limit 41)
 select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]'),count(*),
  coalesce(sum(private.knowledge_context_chars('### '||title||E'\n'||content)+2),0)
 into instructions,instruction_count,chars from limited m;
 if instruction_count>=40 or chars>=12000 then return jsonb_build_object('ok',false,'code','CONTEXT_OVERFLOW');end if;

 for item in
  with candidates as (
   select k.id::text id,k.company_id,k.title,k.content_version,k.approved_version,k.approved_for_answers,
    k.status,k.kind,k.storage_path,k.byte_size,k.updated_at,k.usage_role,
    p.start_char,p.end_char,p.body,ts_rank_cd(p.search_vector,q) score
   from private.knowledge_source_passages p
   join public.knowledge_sources k on k.id=p.source_id and k.company_id=p.company_id and k.content_version=p.content_version
   join private.es02_branch_knowledge_sources b on b.source_id=k.id and b.company_id=k.company_id and b.branch_id=p_branch_id
   where p.company_id=p_company_id and p.search_vector@@q and k.status='ready' and k.approved_for_answers
    and k.approved_version=k.content_version and k.usage_role='knowledge'
   union all
   select 'page-'||w.id,w.company_id,coalesce(nullif(w.title,''),w.url),w.version,w.version,true,
    'ready','text',null,null,w.updated_at,'knowledge',p.start_char,p.end_char,p.body,ts_rank_cd(p.search_vector,q)
   from private.branch_website_passages p join private.es02_branch_website_pages w
    on w.id=p.source_id and w.company_id=p.company_id and w.branch_id=p.branch_id and w.version=p.content_version
   where p.company_id=p_company_id and p.branch_id=p_branch_id and p.search_vector@@q and w.status='indexed'
  ) select * from candidates order by score desc,id,start_char limit 96
 loop
  exit when count_passages>=6;
  matched:=matched+1;
  entry:=selected->item.id;
  if entry is null and (select count(*) from jsonb_object_keys(selected))+instruction_count>=40 then continue;end if;
  added:=private.knowledge_context_chars(item.body)+case when entry is null
   then private.knowledge_context_chars('### '||item.title||E'\n')+2 else private.knowledge_context_chars(separator) end;
  if chars+added>12000 then continue;end if;
  if entry is null then
   entry:=(to_jsonb(item)-'start_char'-'end_char'-'body'-'score')
    ||jsonb_build_object('retrieval_mode','passages_v1','passages','[]'::jsonb);
  end if;
  entry:=jsonb_set(entry,'{passages}',(entry->'passages')||jsonb_build_array(
   jsonb_build_object('start_char',item.start_char,'end_char',item.end_char,'text',item.body)));
  selected:=jsonb_set(selected,array[item.id],entry);
  chars:=chars+added;count_passages:=count_passages+1;
 end loop;
 if count_passages=0 then return jsonb_build_object('ok',false,'code',case when matched>0 then 'CONTEXT_OVERFLOW' else 'NO_KNOWLEDGE' end);end if;
 -- Stable source order; excerpts within each source are in original document order.
 select jsonb_agg((e.value-'passages')||jsonb_build_object('passages',p.passages,'content',p.content) order by e.key)
 into sources from jsonb_each(selected) e cross join lateral (
  select jsonb_agg(value order by (value->>'start_char')::integer) passages,
   string_agg(value->>'text',separator order by (value->>'start_char')::integer) content
  from jsonb_array_elements(e.value->'passages')
 ) p;
 return jsonb_build_object('ok',true,'sources',instructions||sources,'context_chars',greatest(chars-2,0));
end;$$;
alter function private.es02_select_knowledge_passages(uuid,uuid,text) owner to postgres;
revoke all on function private.es02_select_knowledge_passages(uuid,uuid,text) from public,anon,authenticated,service_role;

-- Candidate: ES02 worker retrieval and final citation checks use the same branch
-- bindings as /setup. No changes to legacy native-plan scope or claim authority.
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
   -- Lock the live branch binding as well as the current approved parent.
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
 -- Every current instruction for THIS branch is mandatory, including instructions
 -- approved after retrieval. Another branch must neither leak nor block a reply.
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
-- LOCAL ONLY: retains claimed authority, original question binding, native citation
-- revalidation, and final unchanged authority. Apply with passage/scope candidates.
CREATE OR REPLACE FUNCTION public.whatsapp_retrieve_approved_knowledge(p_company_id uuid, p_job_id uuid, p_claim_token uuid, p_question text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g jsonb;f jsonb;selected_context jsonb;rows jsonb;citations jsonb;n integer;chars bigint;knowledge_count integer;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_retrieve_approved_knowledge(p_company_id,p_job_id,p_claim_token,p_question);end if;
 if p_company_id is null or p_question is null or length(btrim(p_question)) not between 1 and 1000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);if g->>'ok' is distinct from 'true' then return g;end if;
 if g->>'company_id' is distinct from p_company_id::text then return jsonb_build_object('ok',false,'code','company_binding_rejected');end if;
 if not exists(select 1 from public.whatsapp_inbound_jobs j join public.whatsapp_messages m on m.id=j.message_id and m.company_id=j.company_id
  where j.id=p_job_id and j.company_id=p_company_id and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer'
   and m.body=p_question) then return jsonb_build_object('ok',false,'code','question_binding_rejected');end if;
 selected_context:=private.es02_select_knowledge_passages(p_company_id,(g->>'branch_id')::uuid,p_question);
 if selected_context->>'ok' is distinct from 'true' then return selected_context;end if;
 rows:=selected_context->'sources';chars:=(selected_context->>'context_chars')::integer;
 n:=jsonb_array_length(rows);
 select count(*) into knowledge_count from jsonb_array_elements(rows) x where x->>'usage_role'='knowledge';
 if n>40 or chars>12000 then return jsonb_build_object('ok',false,'code','CONTEXT_OVERFLOW');end if;
 if knowledge_count=0 then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 select jsonb_agg(jsonb_build_object('sourceId',x->>'id','title',x->>'title','contentVersion',x->'content_version')) into citations from jsonb_array_elements(rows)x;
 if not private.es02_whatsapp_citations_current(p_company_id,(g->>'branch_id')::uuid,citations) then return jsonb_build_object('ok',false,'code','APPROVAL_INCOMPLETE');end if;
 f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if f->>'ok' is distinct from 'true' or f is distinct from g then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'job_id',p_job_id,'sources',rows,'context_chars',chars);
end;$function$;

notify pgrst,'reload schema';
commit;

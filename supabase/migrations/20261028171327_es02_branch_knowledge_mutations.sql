-- Local candidate only. Removal unlinks branch sources; original storage is retained.
begin;
create or replace function private.es02_branch_knowledge_revision(p_company_id uuid,p_branch_id uuid)
returns text language sql stable security definer set search_path='' as $$
 with tokens as (
 select 'page:'||p.id::text||':'||p.version::text||':'||md5(coalesce(p.title,'')||':'||p.url||':'||p.extracted_text) token
 from private.es02_branch_website_pages p where p.company_id=p_company_id and p.branch_id=p_branch_id and p.status='indexed' and btrim(p.extracted_text)<>''
 union all
 select 'source:'||k.id::text||':'||k.content_version::text||':'||md5(to_jsonb(k)::text)
 from public.knowledge_sources k join private.es02_branch_knowledge_sources b on b.source_id=k.id and b.company_id=k.company_id
 where k.company_id=p_company_id and b.branch_id=p_branch_id and k.status='ready' and k.approved_for_answers=true and k.approved_version=k.content_version and btrim(k.content)<>''
 ) select coalesce(md5(string_agg(token,',' order by token)),'no_knowledge') from tokens;
$$;
revoke all on function private.es02_branch_knowledge_revision(uuid,uuid) from public,anon,authenticated,service_role;

create function public.es02_mutate_owned_branch_knowledge_source(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_source_id uuid,p_content_version integer,p_action text,p_title text default null,p_content text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority jsonb; source public.knowledge_sources;
begin
 authority:=public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 if p_action is null or p_action not in ('edit','remove') or p_content_version is null or p_content_version<1 or p_content_version>=2147483647 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_branch_id::text||':knowledge',0));
 select k.* into source from public.knowledge_sources k join private.es02_branch_knowledge_sources b on b.source_id=k.id and b.company_id=k.company_id
 where k.id=p_source_id and k.company_id=p_company_id and b.branch_id=p_branch_id for update of k,b;
 if source.id is null or source.content_version is distinct from p_content_version then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if p_action='edit' then
  if source.kind<>'text' or coalesce(length(btrim(p_title)),0) not between 1 and 200 or coalesce(length(btrim(p_content)),0) not between 1 and 20000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if exists(select 1 from private.es02_branch_knowledge_sources where source_id=p_source_id and (branch_id<>p_branch_id or company_id<>p_company_id)) then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  -- Canonical trigger increments version and clears answer approval on content/title change.
  update public.knowledge_sources set title=btrim(p_title),content=btrim(p_content) where id=source.id;
 else
  -- Never delete storage or a company source shared by another branch.
  delete from private.es02_branch_knowledge_sources where source_id=p_source_id and company_id=p_company_id and branch_id=p_branch_id;
 end if;
 return public.es02_read_owned_branch_knowledge(p_expected_account_id,p_company_id,p_branch_id);
end $$;

create function public.es02_remove_owned_branch_knowledge_page(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_page_id uuid,p_page_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority jsonb;
begin
 authority:=public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 if p_page_version is null or p_page_version<1 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_branch_id::text||':knowledge',0));
 delete from private.es02_branch_website_pages where id=p_page_id and company_id=p_company_id and branch_id=p_branch_id and version=p_page_version;
 if not found then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 return public.es02_read_owned_branch_knowledge(p_expected_account_id,p_company_id,p_branch_id);
end $$;
revoke all on function public.es02_mutate_owned_branch_knowledge_source(uuid,uuid,uuid,uuid,integer,text,text,text),public.es02_remove_owned_branch_knowledge_page(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.es02_mutate_owned_branch_knowledge_source(uuid,uuid,uuid,uuid,integer,text,text,text),public.es02_remove_owned_branch_knowledge_page(uuid,uuid,uuid,uuid,integer) to authenticated;
commit;

-- REVIEW CANDIDATE. Branch-bound knowledge commands, no hosted apply.
begin;
set local role postgres;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Recorded2026-10-24 plan pricing must remain usable in the existing B1 read
-- authority. Preserve its owner/session/branch/rights checks and every non-Live path.
create function private.es02_verified_live_catalog_order(o private.es02_account_orders)
returns boolean language sql stable security definer set search_path='' as $$
 select o.environment='live' and private.es02_test_order_catalog_consistent(o) and exists(
  select 1 from private.es02_thawani_live_checkouts c join private.es02_thawani_live_grants g on g.id=c.grant_id and g.account_id=c.account_id and g.order_id=c.order_id
  join private.es02_account_settlement_events e on e.order_id=c.order_id and e.account_id=c.account_id and e.evidence_marker='thawani_api_verified_live' and e.provider_transaction_id='thawani-live:'||c.invoice and e.amount_baisa=c.collected_baisa and e.currency='OMR' and e.outcome='applied'
  where c.order_id=o.id and c.account_id=o.account_id and c.state='paid' and c.paid_at is not null and c.catalog_amount_baisa=o.amount_baisa and c.collected_baisa=100);
$$;
revoke all on function private.es02_verified_live_catalog_order(private.es02_account_orders) from public,anon,authenticated,service_role;
do $bridge$
declare target regprocedure:='public.es02_read_owned_branch_setup(uuid,uuid,uuid)'::regprocedure; definition text; prior_acl aclitem[];
 old_gate text:='if private.es02_order_catalog_consistent(ord) is distinct from true then';
 old_catalog text:='catalog := private.es02_catalog_slot(rights.persona, rights.package, rights.term);';
begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) is distinct from 'e27b69808a1f9e0b8f3a36e400b3a35c' then raise exception 'LIVE_B1_BASELINE_DRIFT';end if;
 select proacl into prior_acl from pg_proc where oid=target;definition:=replace(pg_get_functiondef(target),chr(13),'');
 if length(definition)-length(replace(definition,old_gate,''))<>length(old_gate) or length(definition)-length(replace(definition,old_catalog,''))<>length(old_catalog) then raise exception 'LIVE_B1_PATCH_AMBIGUOUS';end if;
 definition:=replace(definition,old_gate,'if (private.es02_order_catalog_consistent(ord) or private.es02_verified_live_catalog_order(ord)) is distinct from true then');
 definition:=replace(definition,old_catalog,old_catalog||$catalog$
  if private.es02_verified_live_catalog_order(ord) then
    catalog:=jsonb_set(catalog,'{amount_baisa}',ord.slots->rights.slot_index->'amountBaisa');
  end if;$catalog$);
 execute definition;
 if (select proacl from pg_proc where oid=target) is distinct from prior_acl then raise exception 'LIVE_B1_ACL_DRIFT';end if;
end $bridge$;
do $channel_bridge$
declare target regprocedure:='private.es02_b3_current_binding(uuid,uuid,uuid,text)'::regprocedure; definition text; prior_acl aclitem[];
 old_gate text:='if private.es02_order_catalog_consistent(ord) is distinct from true then';
 old_catalog text:='catalog := private.es02_catalog_slot(rights.persona, rights.package, rights.term);';
begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) is distinct from 'f823ca2420e388d4d03f88d0f650169e' then raise exception 'LIVE_B3_BASELINE_DRIFT';end if;
 select proacl into prior_acl from pg_proc where oid=target;definition:=replace(pg_get_functiondef(target),chr(13),'');
 if length(definition)-length(replace(definition,old_gate,''))<>length(old_gate) or length(definition)-length(replace(definition,old_catalog,''))<>length(old_catalog) then raise exception 'LIVE_B3_PATCH_AMBIGUOUS';end if;
 definition:=replace(definition,old_gate,'if (private.es02_order_catalog_consistent(ord) or private.es02_verified_live_catalog_order(ord)) is distinct from true then');
 definition:=replace(definition,old_catalog,old_catalog||$catalog$
  if private.es02_verified_live_catalog_order(ord) then
    catalog:=jsonb_set(catalog,'{amount_baisa}',ord.slots->rights.slot_index->'amountBaisa');
  end if;$catalog$);
 execute definition;
 if (select proacl from pg_proc where oid=target) is distinct from prior_acl then raise exception 'LIVE_B3_ACL_DRIFT';end if;
end $channel_bridge$;
create function public.es02_save_owned_branch_knowledge_text(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_expected_version integer,p_title text,p_content text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority jsonb; source public.knowledge_sources;
begin
 authority:=public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 if p_expected_version is distinct from 1 or coalesce(length(btrim(p_title)),0) not between 1 and 200 or coalesce(length(btrim(p_content)),0) not between 1 and 20000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_branch_id::text||':knowledge',0));
 select k.* into source from public.knowledge_sources k join private.es02_branch_knowledge_sources b on b.source_id=k.id and b.company_id=k.company_id
 where b.branch_id=p_branch_id and k.company_id=p_company_id and k.kind='text' and k.created_by=p_expected_account_id and k.title=btrim(p_title) and k.content=btrim(p_content) order by k.created_at limit 1;
 if source.id is null then
  insert into public.knowledge_sources(company_id,kind,title,content,status,created_by,usage_role)
  values(p_company_id,'text',btrim(p_title),btrim(p_content),'ready',p_expected_account_id,'knowledge') returning * into source;
  insert into private.es02_branch_knowledge_sources(company_id,branch_id,source_id) values(p_company_id,p_branch_id,source.id);
 end if;
 return public.es02_read_owned_branch_knowledge(p_expected_account_id,p_company_id,p_branch_id);
end $$;

create function public.es02_bind_owned_branch_knowledge_source(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_source_id uuid,p_content_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority jsonb; source public.knowledge_sources;
begin
 authority:=public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_branch_id::text||':knowledge',0));
 select * into source from public.knowledge_sources where id=p_source_id and company_id=p_company_id for update;
 if source.id is null or source.content_version is distinct from p_content_version or p_content_version<1 or source.kind not in ('text','file')
  or exists(select 1 from private.es02_branch_knowledge_sources where source_id=source.id and (company_id<>p_company_id or branch_id<>p_branch_id))
 then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 insert into private.es02_branch_knowledge_sources(company_id,branch_id,source_id) values(p_company_id,p_branch_id,source.id) on conflict do nothing;
 return public.es02_read_owned_branch_knowledge(p_expected_account_id,p_company_id,p_branch_id);
end $$;

create function public.es02_approve_owned_branch_knowledge_source(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_source_id uuid,p_content_version integer,p_approved boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority jsonb; source public.knowledge_sources;
begin
 authority:=public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 if p_approved is null then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_branch_id::text||':knowledge',0));
 select k.* into source from public.knowledge_sources k join private.es02_branch_knowledge_sources b on b.source_id=k.id and b.company_id=k.company_id
 where k.id=p_source_id and k.company_id=p_company_id and b.branch_id=p_branch_id for update of k;
 if source.id is null or source.content_version is distinct from p_content_version then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 -- Existing approval procedure validates ready state and prepared file generation.
 perform public.set_knowledge_source_approval(source.id,p_approved);
 return public.es02_read_owned_branch_knowledge(p_expected_account_id,p_company_id,p_branch_id);
end $$;
revoke all on function public.es02_save_owned_branch_knowledge_text(uuid,uuid,uuid,integer,text,text),public.es02_bind_owned_branch_knowledge_source(uuid,uuid,uuid,uuid,integer),public.es02_approve_owned_branch_knowledge_source(uuid,uuid,uuid,uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.es02_save_owned_branch_knowledge_text(uuid,uuid,uuid,integer,text,text),public.es02_bind_owned_branch_knowledge_source(uuid,uuid,uuid,uuid,integer),public.es02_approve_owned_branch_knowledge_source(uuid,uuid,uuid,uuid,integer,boolean) to authenticated;
commit;

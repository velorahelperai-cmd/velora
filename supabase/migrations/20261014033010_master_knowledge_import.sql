-- Public-page imports are reviewed additions. No fetching, AI, overwrite or approval in SQL.
begin;
create table private.master_knowledge_import_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into private.master_knowledge_import_settings default values;
create table private.master_knowledge_import_previews(
 id uuid primary key default gen_random_uuid(),attempt_id uuid not null,user_id uuid not null,session_id uuid not null,
 company_id uuid not null references public.companies(id) on delete restrict,company_version bigint not null,catalog_hash text not null,
 source_url text not null,text_content text not null,content_hash text not null,extracted_at timestamptz not null default clock_timestamp(),
 rights_attested_at timestamptz not null default clock_timestamp(),confidence text not null default 'unverified' check(confidence='unverified'),
 changes jsonb not null default '["Creates a new unapproved source; existing knowledge stays unchanged"]',conflicts jsonb not null default '[]',
 revision bigint not null default 1,state text not null default 'preview' check(state in('preview','applied')),applied_source_id uuid,applied_at timestamptz,
 unique(user_id,attempt_id)
);
alter table private.master_knowledge_import_settings enable row level security;
alter table private.master_knowledge_import_previews enable row level security;
revoke all on private.master_knowledge_import_settings,private.master_knowledge_import_previews from public,anon,authenticated,service_role;
create function private.master_import_writer(uid uuid,cid uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select private.master_setup_draft_session(uid) and exists(select 1 from public.companies c join public.company_members m on m.company_id=c.id
 where c.id=cid and m.user_id=uid and m.status='active' and c.status<>'suspended' and c.setup_file_destruction_at is null
 and nullif(to_jsonb(c)->>'archived_at','') is null and (m.role='owner' or exists(select 1 from public.company_member_grants g where g.company_id=cid and g.user_id=uid and g.status='active' and 'knowledge.write'=any(g.capabilities))))
 and public.has_company_capability(cid,'knowledge.write')
$$;
create function private.master_import_catalog(cid uuid) returns text language sql volatile security definer set search_path='' as $$
 select encode(sha256(convert_to(coalesce(string_agg(id::text||':'||content_version::text||':'||coalesce(status,'')||':'||approved_for_answers::text,'|' order by id),''),'UTF8')),'hex') from public.knowledge_sources where company_id=cid
$$;
-- Native grant changes lock the grant row. Hold the same membership and grant
-- rows until this transaction ends so a concurrent revocation has a defined
-- order relative to an import. Company -> membership -> grant -> preview.
create function private.master_import_lock_writer(uid uuid,cid uuid) returns boolean language plpgsql volatile security definer set search_path='' as $$begin
 perform 1 from public.company_members where company_id=cid and user_id=uid and status='active' for share;
 if not found then return false;end if;
 perform 1 from public.company_member_grants where company_id=cid and user_id=uid for share;
 return private.master_import_writer(uid,cid);
end;$$;
create function private.master_import_receipt(p private.master_knowledge_import_previews) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('ok',true,'data',jsonb_build_object('id',p.id,'revision',p.revision,'sourceUrl',p.source_url,'extractedAt',p.extracted_at,'contentHash',p.content_hash,'confidence',p.confidence,'text',p.text_content,'changes',p.changes,'conflicts',p.conflicts,'sourceId',p.applied_source_id,'state',p.state))
$$;
create function public.master_import_context(p_expected_user_id uuid,p_company_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$begin
 if not (select enabled from private.master_knowledge_import_settings where singleton) then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not private.master_import_writer(p_expected_user_id,p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('companyVersion',(select version from public.companies where id=p_company_id)));
end;$$;
create function public.master_stage_knowledge_import(p_expected_user_id uuid,p_company_id uuid,p_attempt_id uuid,p_source_url text,p_text text,p_rights_attested boolean,p_expected_company_version bigint) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare c public.companies;p private.master_knowledge_import_previews;sid uuid;conflicts jsonb:='[]';begin
 if not (select enabled from private.master_knowledge_import_settings where singleton) then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if p_attempt_id is null or p_rights_attested is distinct from true or p_expected_company_version is null or p_expected_company_version<1 or p_source_url is null or length(p_source_url)>2048 or p_source_url !~ '^https://[^/@?#[:space:]]+(/[^?#[:space:]]*)?$' or p_text is null or length(btrim(p_text))=0 or length(p_text)>12000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into c from public.companies where id=p_company_id for update;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not private.master_import_lock_writer(p_expected_user_id,p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 sid:=(auth.jwt()->>'session_id')::uuid;
 select * into p from private.master_knowledge_import_previews where user_id=p_expected_user_id and attempt_id=p_attempt_id;
 if found then
  if p.company_id<>p_company_id or p.session_id<>sid or p.source_url<>p_source_url or p.text_content<>p_text then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  return private.master_import_receipt(p);
 end if;
 if c.version<>p_expected_company_version then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if exists(select 1 from public.knowledge_sources where company_id=p_company_id and content=p_text) then conflicts:=conflicts||jsonb_build_array('Exact text duplicates an existing source');end if;
 if exists(select 1 from private.master_knowledge_import_previews where company_id=p_company_id and source_url=p_source_url and state='applied' and text_content<>p_text) then conflicts:=conflicts||jsonb_build_array('Content differs from an earlier confirmed import of this page');end if;
 insert into private.master_knowledge_import_previews(attempt_id,user_id,session_id,company_id,company_version,catalog_hash,source_url,text_content,content_hash,conflicts)
 values(p_attempt_id,p_expected_user_id,sid,p_company_id,c.version,private.master_import_catalog(p_company_id),p_source_url,p_text,encode(sha256(convert_to(p_text,'UTF8')),'hex'),conflicts) returning * into p;
 return private.master_import_receipt(p);
end;$$;
create function public.master_confirm_knowledge_import(p_expected_user_id uuid,p_company_id uuid,p_preview_id uuid,p_expected_revision bigint,p_content_hash text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare p private.master_knowledge_import_previews;c public.companies;source_id uuid;begin
 if not (select enabled from private.master_knowledge_import_settings where singleton) then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 select * into c from public.companies where id=p_company_id for update;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not private.master_import_lock_writer(p_expected_user_id,p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into p from private.master_knowledge_import_previews where id=p_preview_id for update;
 -- Auth/session revocation can commit while waiting for the preview lock.
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not private.master_import_writer(p_expected_user_id,p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not found or p.user_id<>p_expected_user_id or p.company_id<>p_company_id or p.session_id::text<>auth.jwt()->>'session_id' then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_expected_revision is distinct from p.revision or p_content_hash is distinct from p.content_hash then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if p.state='applied' then
  if not exists(select 1 from public.knowledge_sources where id=p.applied_source_id and company_id=p_company_id) then return jsonb_build_object('ok',false,'code','APPLIED_SOURCE_UNAVAILABLE');end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('sourceId',p.applied_source_id,'approved',false));
 end if;
 if c.version<>p.company_version or private.master_import_catalog(p_company_id)<>p.catalog_hash then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 insert into public.knowledge_sources(company_id,kind,title,content,status,created_by,approved_for_answers)
 values(p_company_id,'text',left('Public page: '||p.source_url,200),'Source URL: '||p.source_url||E'\nExtracted: '||p.extracted_at::text||E'\nConfidence: unverified; permission attested by importing user\n\n'||p.text_content,'ready',p_expected_user_id,false) returning id into source_id;
 update private.master_knowledge_import_previews set state='applied',applied_source_id=source_id,applied_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('sourceId',source_id,'approved',false));
end;$$;
create function public.master_read_knowledge_import(p_expected_user_id uuid,p_company_id uuid,p_preview_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$declare p private.master_knowledge_import_previews;ctx jsonb;begin
 ctx:=public.master_import_context(p_expected_user_id,p_company_id);if (ctx->>'ok')::boolean is distinct from true then return ctx;end if;
 select * into p from private.master_knowledge_import_previews where id=p_preview_id and user_id=p_expected_user_id and company_id=p_company_id and session_id::text=auth.jwt()->>'session_id';
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;return private.master_import_receipt(p);
end;$$;
revoke all on function private.master_import_writer(uuid,uuid),private.master_import_lock_writer(uuid,uuid),private.master_import_catalog(uuid),private.master_import_receipt(private.master_knowledge_import_previews) from public,anon,authenticated,service_role;
revoke all on function public.master_import_context(uuid,uuid),public.master_stage_knowledge_import(uuid,uuid,uuid,text,text,boolean,bigint),public.master_confirm_knowledge_import(uuid,uuid,uuid,bigint,text),public.master_read_knowledge_import(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.master_import_context(uuid,uuid),public.master_stage_knowledge_import(uuid,uuid,uuid,text,text,boolean,bigint),public.master_confirm_knowledge_import(uuid,uuid,uuid,bigint,text),public.master_read_knowledge_import(uuid,uuid,uuid) to authenticated;
commit;

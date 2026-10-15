-- Reviewed rollout is separate. G03 file generation, actor locks and proof CAS remain intact.
begin;
set local lock_timeout='3s';
create table private.smart_review_policy (
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 approval_reference text,check(not enabled or (approval_reference is not null and length(btrim(approval_reference))>0))
);
insert into private.smart_review_policy(singleton) values(true);
alter table private.smart_review_policy enable row level security;
revoke all on private.smart_review_policy from public,anon,authenticated,service_role;

create function private.smart_review_enabled(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from private.smart_review_policy where singleton),false)
 and exists(select 1 from private.smart_branch_setup where company_id=cid);
$$;
create function private.smart_review_scope(cid uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare contract jsonb;selection jsonb;channels jsonb;slots integer;
begin
 if not private.smart_review_enabled(cid) then return null;end if;
 contract:=private.company_channel_contract(cid);selection:=contract->'selected_channels';channels:=selection->'channels';
 if contract->>'companyId' is distinct from cid::text or contract->'plan_entitlements'->>'status' is distinct from 'approved' or contract->>'planVersionId' is null
 or selection->>'planVersionId' is distinct from contract->>'planVersionId' or jsonb_typeof(channels) is distinct from 'array' then return null;end if;
 slots:=(contract->'plan_entitlements'->>'channelCount')::integer;
 if slots is null or slots not in (1,2) or jsonb_array_length(channels)<>slots or exists(select 1 from jsonb_array_elements_text(channels) c where c not in ('whatsapp','instagram'))
 or (slots=2 and not channels @> '["whatsapp","instagram"]'::jsonb) then return null;end if;
 return jsonb_build_object('planVersionId',contract->'planVersionId','selection',selection,'channelCount',slots,
 'branches',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'primary',is_primary) order by id) from public.company_branches where company_id=cid),
 'branchRevision',(select revision from private.smart_branch_setup where company_id=cid));
end;$$;
create function private.smart_review_ownership_allowed(cid uuid,ownership text,number text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare scope jsonb;
begin
 if not private.smart_review_enabled(cid) then return coalesce(ownership in ('own','new'),false);end if;
 scope:=private.smart_review_scope(cid);if scope is null then return false;end if;
 if scope->'selection'->'channels' @> '["whatsapp"]'::jsonb then return coalesce(ownership in ('own','new'),false);end if;
 return ownership='not_applicable' and btrim(coalesce(number,''))='';
end;$$;
revoke all on function private.smart_review_enabled(uuid),private.smart_review_scope(uuid),private.smart_review_ownership_allowed(uuid,text,text) from public,anon,authenticated,service_role;

alter function private.g03_readiness(uuid) rename to g03_readiness_before_smart;
create function private.g03_readiness(p_company_id uuid) returns text language plpgsql volatile security definer set search_path='' as $$
declare n integer;
begin
 if not private.smart_review_enabled(p_company_id) then return private.g03_readiness_before_smart(p_company_id);end if;
 if not exists(select 1 from public.companies where id=p_company_id and status<>'suspended'
  and btrim(display_name)<>'' and btrim(business_type)<>'' and btrim(country)<>'') then return 'PROFILE_INCOMPLETE';end if;
 if private.smart_review_scope(p_company_id) is null then return 'CHANNEL_SELECTION_REQUIRED';end if;
 select count(*) into n from public.knowledge_sources where company_id=p_company_id
  and status='ready' and approved_for_answers and approved_version=content_version and btrim(content)<>'';
 if n>40 then return 'SOURCE_LIMIT';end if;
 if not exists(select 1 from public.knowledge_sources where company_id=p_company_id and usage_role='knowledge'
  and status='ready' and approved_for_answers and approved_version=content_version and btrim(content)<>'') then return 'KNOWLEDGE_INCOMPLETE';end if;
 if exists(select 1 from public.knowledge_sources where company_id=p_company_id and kind='file'
  and status='ready' and approved_for_answers and approved_version=content_version and btrim(content)<>''
  and (prepared_file_sha256 is null or prepared_content_version is distinct from content_version
   or prepared_text_sha256 is distinct from private.g03_sha(content))) then return 'FILE_REPREPARE_REQUIRED';end if;
 return 'OK';
end;$$;
alter function private.g03_manifest(uuid,uuid) rename to g03_manifest_before_smart;
create function private.g03_manifest(p_company_id uuid,p_requester uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare manifest jsonb:=private.g03_manifest_before_smart(p_company_id,p_requester);
begin
 if private.smart_review_enabled(p_company_id) then manifest:=manifest||jsonb_build_object('selected_channel_scope',private.smart_review_scope(p_company_id));end if;
 return manifest;
end;$$;
revoke all on function private.g03_readiness(uuid),private.g03_manifest(uuid,uuid) from public,anon,authenticated,service_role;

-- Preserve the existing proof/intent/epoch/file checks; change only channel ownership
-- validation and add scoped authorization at entry and commit for customer actions.
do $$ declare signature text;definition text;needle text;replacement text; begin
 foreach signature in array array['public.g03_begin_review_check(text,uuid,integer,text,text,boolean,text)','public.transition_company_review(text,uuid,integer,text,text,boolean,text)'] loop
  definition:=pg_get_functiondef(to_regprocedure(signature));
  needle:=$m$p_number_ownership not in ('own','new')$m$;
  if strpos(definition,needle)=0 or strpos(substr(definition,strpos(definition,needle)+length(needle)),needle)>0 then raise exception 'SMART_REVIEW_OWNERSHIP_PREREQUISITE_MISMATCH';end if;
  definition:=replace(definition,needle,'not private.smart_review_ownership_allowed(p_company_id,p_number_ownership,wa)');
  needle:='  select input_epoch into epoch from private.g03_company_inputs';
  if strpos(definition,needle)=0 then raise exception 'SMART_REVIEW_ACTOR_PREREQUISITE_MISMATCH';end if;
  replacement:=E'  if private.smart_review_enabled(p_company_id) and p_action in (''submit'',''resubmit'') and private.enterprise_authorize(p_company_id) is distinct from actor then raise exception ''AUTHORITY_CHANGED'' using errcode=''42501'';end if;\n'||needle;
  definition:=replace(definition,needle,replacement);
  if signature like 'public.transition%' then
   needle:=$m$      return jsonb_build_object('ok',true,'code','EXISTING','request',before_row);$m$;
   if strpos(definition,needle)=0 then raise exception 'SMART_REVIEW_REPLAY_PREREQUISITE_MISMATCH';end if;
   definition:=replace(definition,needle,E'      if private.smart_review_enabled(p_company_id) then perform private.enterprise_commit(p_company_id,actor);end if;\n'||needle);
   needle:=$m$  return jsonb_build_object('ok',true,'code','OK','request',after_row);$m$;
   if strpos(definition,needle)=0 then raise exception 'SMART_REVIEW_COMMIT_PREREQUISITE_MISMATCH';end if;
   definition:=replace(definition,needle,E'  if private.smart_review_enabled(p_company_id) and p_action in (''submit'',''resubmit'') then perform private.enterprise_commit(p_company_id,actor);end if;\n'||needle);
  else
   needle:=$m$  return jsonb_build_object('ok',true,'check_id',check_id$m$;
   if strpos(definition,needle)=0 then raise exception 'SMART_REVIEW_CHECK_COMMIT_PREREQUISITE_MISMATCH';end if;
   definition:=replace(definition,needle,E'  if private.smart_review_enabled(p_company_id) and p_action in (''submit'',''resubmit'') then perform private.enterprise_commit(p_company_id,actor);end if;\n'||needle);
  end if;
  execute definition;
 end loop;
 -- Recompile the unchanged current-proof expression against the new manifest/readiness.
 execute pg_get_functiondef('private.g03_proof_current(uuid)'::regprocedure);
end;$$;

alter table public.company_review_requests drop constraint company_review_requests_number_ownership_check;
alter table public.company_review_requests add constraint company_review_requests_number_ownership_check check(number_ownership in ('own','new','not_applicable'));

-- The owner sees whether this reviewed native rollout is available; no browser setter.
create function public.smart_review_configuration(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);
begin
 if uid is null or not private.enterprise_owner(p_company_id,uid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 return jsonb_build_object('ok',true,'companyId',p_company_id,'enabled',private.smart_review_enabled(p_company_id));
end;$$;
revoke all on function public.smart_review_configuration(uuid) from public,anon,authenticated,service_role;
grant execute on function public.smart_review_configuration(uuid) to authenticated;
notify pgrst,'reload schema';
commit;

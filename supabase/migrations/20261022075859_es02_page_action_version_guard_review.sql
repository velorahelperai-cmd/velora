-- REVIEW ONLY / NOT APPLIED. Replaces unsafe legacy dispatch with version-required dispatch.
begin;
do $$
begin
  if (select md5(pg_get_functiondef(oid)) from pg_proc where oid = to_regprocedure('public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text)'))
      is distinct from 'a603d893224730a13332e005a174cc7e' then
    raise exception 'ES02_PAGE_ACTION_BASELINE_CHANGED';
  end if;
  if to_regprocedure('public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text,integer)') is not null then
    raise exception 'ES02_VERSIONED_ACTION_ALREADY_EXISTS';
  end if;
end $$;

create or replace function public.es02_page_action_owned_branch_knowledge(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_page_id uuid, p_action text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  auth_check jsonb;
  v_current_version integer;
begin
  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then return auth_check; end if;

  select version into v_current_version from private.es02_branch_website_pages
    where id=p_page_id and company_id=p_company_id and branch_id=p_branch_id;
  if not found or v_current_version is null then
    return jsonb_build_object('ok',false,'code','NOT_FOUND');
  end if;

  return public.es02_page_action_owned_branch_knowledge(
    p_expected_account_id, p_company_id, p_branch_id, p_page_id, p_action, v_current_version
  );
end $$;

create function public.es02_page_action_owned_branch_knowledge(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_page_id uuid,
  p_action text, p_expected_page_version integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  auth_check jsonb;
  page private.es02_branch_website_pages%rowtype;
  changed bigint;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_page_id is null
     or p_action is null or p_action not in ('retry','retrain')
     or p_expected_page_version is null or p_expected_page_version < 1 or p_expected_page_version >= 2147483647 then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then return auth_check; end if;
  -- Same lock order as launch confirmation and indexing.
  perform 1 from public.company_branches where id=p_branch_id and company_id=p_company_id for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  select * into page from private.es02_branch_website_pages
    where id=p_page_id and company_id=p_company_id and branch_id=p_branch_id for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  if page.version is distinct from p_expected_page_version then
    return jsonb_build_object('ok',false,'code','CONFLICT');
  end if;
  if (p_action='retry' and page.status is distinct from 'failed')
     or (p_action='retrain' and page.status is distinct from 'indexed') then
    return jsonb_build_object('ok',false,'code','INVALID_STATE');
  end if;
  update private.es02_branch_website_pages
    set status='pending',error=null,updated_at=clock_timestamp(),version=version+1
    where id=p_page_id and company_id=p_company_id and branch_id=p_branch_id and version=p_expected_page_version;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'ES02_PAGE_UPDATE_COUNT'; end if;
  delete from private.es02_branch_launch_confirmations where company_id=p_company_id and branch_id=p_branch_id;
  return public.es02_read_owned_branch_knowledge(p_expected_account_id,p_company_id,p_branch_id);
exception when others then
  return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end $$;
alter function public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text) owner to postgres;
alter function public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text,integer) owner to postgres;
revoke all on function public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text) from public,anon,service_role;
revoke all on function public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text,integer) from public,anon,service_role;
grant execute on function public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text,integer) to authenticated;
commit;

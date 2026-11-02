CREATE OR REPLACE FUNCTION public.es02_add_owned_branch_website(p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_expected_version integer, p_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  auth_check jsonb;
  entitlement jsonb;
  pkg text;
  quota_limit int := 10;
  quota_used int := 0;
  page_id uuid;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or nullif(trim(p_url), '') is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  -- Lock branch row to serialize concurrent website additions and CAS check
  perform 1 from public.company_branches
  where company_id = p_company_id and id = p_branch_id
  for update;

  entitlement := auth_check->'data';
  pkg := entitlement->>'package';
  if pkg = 'premium' then
    quota_limit := 50;
  else
    quota_limit := 10;
  end if;

  select count(*) into quota_used
  from private.es02_branch_website_pages
  where branch_id = p_branch_id;

  if quota_used >= quota_limit then
    return jsonb_build_object('ok', false, 'code', 'QUOTA_EXCEEDED');
  end if;

  -- Stored with 'pending' status (never immediately 'ready' before extraction/indexing)
  insert into private.es02_branch_website_pages (company_id, branch_id, url, status)
  values (p_company_id, p_branch_id, trim(p_url), 'pending')
  on conflict (branch_id, url)
  do update set updated_at = clock_timestamp(), version = private.es02_branch_website_pages.version + 1, status = 'pending', error = null
  returning id into page_id;

  -- Invalidate any prior launch confirmation if knowledge changed
  delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  return public.es02_read_owned_branch_knowledge(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.es02_confirm_owned_branch_reply_language(p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_expected_version bigint, p_reply_language text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  auth_check jsonb;
  current_rev bigint;
  next_rev bigint;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_reply_language is null or p_reply_language not in ('ar', 'en', 'both')
     or p_expected_version is null or p_expected_version < 1 or p_expected_version > 9007199254740991 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- Serialize even the absent confirmation row; mirror the displayed initial revision 1.
  perform 1 from public.company_branches where company_id=p_company_id and id=p_branch_id for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_OWNED');end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select revision into current_rev
  from private.es02_branch_reply_language_confirmations
  where company_id = p_company_id and branch_id = p_branch_id
  for update;

  if coalesce(current_rev, 1) <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  next_rev := coalesce(current_rev, 1) + 1;

  insert into private.es02_branch_reply_language_confirmations (company_id, branch_id, reply_language, revision, confirmed_at)
  values (p_company_id, p_branch_id, p_reply_language, next_rev, clock_timestamp())
  on conflict (company_id, branch_id)
  do update set reply_language = excluded.reply_language, revision = excluded.revision, confirmed_at = excluded.confirmed_at;

  update public.companies set reply_language = p_reply_language where id = p_company_id;

  -- Invalidate any prior launch confirmation if language confirmed/changed
  delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  return public.es02_read_owned_branch_reply_language(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.es02_index_branch_website_page(p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_page_id uuid, p_title text, p_extracted_text text, p_status text, p_error text, p_expected_version integer, p_expected_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  auth_check jsonb;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_page_id is null or p_status not in ('indexed', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  perform 1 from public.company_branches where company_id=p_company_id and id=p_branch_id for update;
  update private.es02_branch_website_pages
  set title = coalesce(p_title, title),
      extracted_text = case when p_status = 'indexed' then coalesce(p_extracted_text, '') else extracted_text end,
      status = p_status,
      error = case when p_status = 'failed' then coalesce(p_error, 'Extraction failed') else null end,
      indexed_at = case when p_status = 'indexed' then clock_timestamp() else indexed_at end,
      updated_at = clock_timestamp(),
      version = version + 1
  where id = p_page_id and branch_id = p_branch_id and company_id = p_company_id
     and version=p_expected_version and url=p_expected_url;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PAGE_CHANGED');
  end if;

  delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  return public.es02_read_owned_branch_knowledge(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.es02_page_action_owned_branch_knowledge(p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_page_id uuid, p_action text, p_expected_page_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  DELETE FROM private.es02_branch_launch_confirmations where company_id=p_company_id and branch_id=p_branch_id;
  return public.es02_read_owned_branch_knowledge(p_expected_account_id,p_company_id,p_branch_id);
exception when others then
  return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end $function$
;

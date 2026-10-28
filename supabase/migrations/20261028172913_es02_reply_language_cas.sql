-- LOCAL CANDIDATE: no Production application authorized.
-- Preserve read contract absent version=1; first saved revision=2 prevents stale initial replay.
-- Branch lock protects first insert, revisions protect subsequent saves. Existing ACL retained.
-- Rollback by restoring previous function; do not rewind saved revisions or delete confirmations.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create or replace function public.es02_confirm_owned_branch_reply_language(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_expected_version bigint,
  p_reply_language text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
commit;

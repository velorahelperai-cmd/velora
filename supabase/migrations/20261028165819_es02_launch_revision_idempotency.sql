-- Local review candidate; no Production apply authorized.
-- Preserve first confirmation for unchanged readiness; a new readiness gets its own operation.
-- Rollback: restore this function from 20261022040333; preserve confirmation rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create or replace function public.es02_confirm_owned_branch_launch(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_expected_version bigint,
  p_readiness_revision text,
  p_operation_id uuid,
  p_confirmed boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  summary jsonb;
  current_readiness_rev text;
  receipt_id uuid;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_operation_id is null or p_confirmed is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- Caller session identity guard
  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  -- Lock branch row to serialize concurrent launch confirmations
  perform 1 from public.company_branches
  where company_id = p_company_id and id = p_branch_id
  for update;

  summary := public.es02_read_owned_branch_launch_summary(p_expected_account_id, p_company_id, p_branch_id);
  if summary->>'ok' is distinct from 'true' then
    return summary;
  end if;

  if p_expected_version is distinct from (summary->'data'->'snapshot'->>'version')::bigint then
    return jsonb_build_object('ok', false, 'code', 'VERSION_CHANGED');
  end if;

  if summary->'data'->'snapshot'->'readiness'->>'status' is distinct from 'ready' then
    return jsonb_build_object('ok', false, 'code', 'READINESS_INCOMPLETE', 'blockers', summary->'data'->'snapshot'->'readiness'->'blockers');
  end if;

  current_readiness_rev := summary->'data'->'snapshot'->'readiness'->>'revision';
  if p_readiness_revision is distinct from current_readiness_rev then
    return jsonb_build_object('ok', false, 'code', 'READINESS_CHANGED', 'currentRevision', current_readiness_rev);
  end if;

  -- The branch lock serializes repeated confirmations. Preserve the first receipt/time.
  if exists(select 1 from private.es02_branch_launch_confirmations
    where company_id=p_company_id and branch_id=p_branch_id and confirmed
      and readiness_revision=current_readiness_rev) then return summary; end if;

  insert into private.es02_branch_launch_confirmations (company_id, branch_id, account_id, readiness_revision, operation_id, confirmed)
  values (p_company_id, p_branch_id, p_expected_account_id, p_readiness_revision, p_operation_id, true)
  on conflict (company_id, branch_id)
  do update set confirmed = true, confirmed_at = clock_timestamp(), readiness_revision = excluded.readiness_revision, operation_id = excluded.operation_id
  returning id into receipt_id;

  -- Activate branch and company if still in setup
  update public.company_branches set status = 'active' where company_id = p_company_id and id = p_branch_id and status = 'setup';
  perform set_config('velora.allow_status_change', 'on', true);
  update public.companies set status = 'active' where id = p_company_id and status = 'setup';

  return public.es02_read_owned_branch_launch_summary(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;
commit;

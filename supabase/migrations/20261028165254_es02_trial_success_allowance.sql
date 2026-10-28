-- Q12 owner decision 2026-10-28: only successful saved engine replies consume the ten free replies.
-- Provider cost/holds remain in ai_usage_ledger. Unknown or missing transcript blocks new dispatch.
-- LOCAL REVIEW CANDIDATE: no Production apply authorized. No data/ACL changes.
-- Rollback: restore these two prior function bodies from 20261022093000 and
-- 20261022040333 only after reviewing active operations; preserve all ledger/history rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- A settled response from obsolete context is retained for accounting, not trial proof.
alter table private.es02_branch_trial_operations add column if not exists result_discarded_at timestamptz;
comment on column private.es02_branch_trial_operations.result_discarded_at is 'Terminal context_changed reconciliation; preserve checkpoint and provider costs, exclude from saved reply allowance.';
create or replace function public.es02_reserve_branch_trial(
  p_operation_id uuid,p_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid,
  p_question text,p_knowledge_revision text,p_hours_revision bigint,p_language_code text,p_persona text,p_model_id text,
  p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations; budget public.ai_budget_accounts; used integer; state text;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_operation_id is null or p_session_id is null or length(btrim(coalesce(p_question,''))) not between 1 and 1000
     or p_model_id<>'gemini-3.8-flash' or p_reserved_baisa is null or p_reserved_baisa<=0 or p_reserved_baisa>1000
     or p_reserved_baisa::text in ('NaN','Infinity','-Infinity')
     or jsonb_typeof(p_pricing_snapshot) is distinct from 'object'
     or p_pricing_snapshot->>'modelId' is distinct from p_model_id or p_pricing_snapshot->>'version' is distinct from p_pricing_version
     or jsonb_typeof(p_source_citations) is distinct from 'array' or jsonb_array_length(p_source_citations)>40 then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  -- Same global budget-first lock order as existing reserve/start/settle/reconcile.
  select * into budget from public.ai_budget_accounts where scope='admin_test' and company_id is null for update;
  if budget.id is null or not budget.enabled then return jsonb_build_object('ok',false,'code','BUDGET_DISABLED'); end if;
  perform 1 from public.company_branches where company_id=p_company_id and id=p_branch_id for update;
  select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id;
  if op.operation_id is not null then
    if op.account_id<>p_account_id or op.company_id<>p_company_id or op.branch_id<>p_branch_id or op.question_hash<>md5(btrim(p_question)) then
      return jsonb_build_object('ok',false,'code','EXECUTION_CONFLICT');
    end if;
    select status into state from public.ai_usage_ledger where id=op.operation_id;
    return jsonb_build_object('ok',true,'newlyReserved',false,'state',state,'operationId',p_operation_id);
  end if;
  op.operation_id:=p_operation_id;op.company_id:=p_company_id;op.branch_id:=p_branch_id;op.account_id:=p_account_id;
  op.native_session_id:=p_session_id;op.question_hash:=md5(btrim(p_question));op.knowledge_revision:=p_knowledge_revision;
  op.hours_revision:=p_hours_revision;op.language_code:=p_language_code;op.persona:=p_persona;op.model_id:=p_model_id;
  if not private.es02_trial_context_current(op) then return jsonb_build_object('ok',false,'code','AUTHORIZATION_OR_CONTEXT_CHANGED'); end if;
  if exists(select 1 from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id and (l.status in ('reserved','running','uncertain') or (l.status='success' and t.result_discarded_at is null and not exists(select 1 from private.es02_branch_assistant_trials receipt where receipt.execution_id=t.operation_id and receipt.company_id=p_company_id and receipt.branch_id=p_branch_id and receipt.origin='engine')))) then
    return jsonb_build_object('ok',false,'code','TRIAL_PENDING');
  end if;
  select count(*) into used from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id and l.status='success' and exists(select 1 from private.es02_branch_assistant_trials receipt where receipt.execution_id=t.operation_id and receipt.company_id=p_company_id and receipt.branch_id=p_branch_id and receipt.origin='engine');
  if used>=10 then return jsonb_build_object('ok',false,'code','TRIAL_LIMIT_REACHED'); end if;
  if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>least(budget.limit_baisa,1000) then return jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED'); end if;
  insert into public.ai_usage_ledger(id,budget_account_id,company_id,actor_user_id,actor_session_id,execution_id,attempt,usage_mode,model_id,provider,reserved_baisa,pricing_version,pricing_snapshot,source_citations)
    values(p_operation_id,budget.id,p_company_id,p_account_id,p_session_id,p_operation_id,1,'setup_trial',p_model_id,'google',p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
  insert into private.es02_branch_trial_operations(operation_id,company_id,branch_id,account_id,native_session_id,question_hash,knowledge_revision,hours_revision,language_code,persona,model_id,created_at,native_session_id_snapshot) values(op.operation_id,op.company_id,op.branch_id,op.account_id,op.native_session_id,op.question_hash,op.knowledge_revision,op.hours_revision,op.language_code,op.persona,op.model_id,clock_timestamp(),op.native_session_id);
  update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
  return jsonb_build_object('ok',true,'newlyReserved',true,'state','reserved','operationId',p_operation_id,'remaining',10-used);
end;
$$;

create or replace function public.es02_read_owned_branch_assistant_trial(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority jsonb;
  is_member boolean;
  branch public.company_branches%rowtype;
  company public.companies%rowtype;
  messages_arr jsonb := '[]'::jsonb;
  t_row record;
  current_knowledge_rev text;
begin
  authority := public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
  if authority->>'ok' is distinct from 'true' then return authority; end if;
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = p_expected_account_id and m.status = 'active'
  ) into is_member;
  if not is_member then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into branch from public.company_branches where company_id = p_company_id and id = p_branch_id;
  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  select * into company from public.companies where id = p_company_id;

  for t_row in
    select id, question, answer, origin, model_id, hours_revision, language_code, persona, knowledge_revision, execution_id, created_at
    from private.es02_branch_assistant_trials
    where company_id = p_company_id and branch_id = p_branch_id
    order by created_at asc
    limit 20
  loop
    messages_arr := messages_arr || jsonb_build_array(jsonb_build_object(
      'id', t_row.id,
      'executionId', t_row.execution_id,
      'scope', jsonb_build_object(
        'expectedAccountId', p_expected_account_id,
        'companyId', p_company_id,
        'branchId', p_branch_id
      ),
      'version', 1,
      'knowledgeRevision', t_row.knowledge_revision,
      'hoursRevision', t_row.hours_revision,
      'languageCode', t_row.language_code,
      'persona', t_row.persona,
      'question', t_row.question,
      'origin', t_row.origin,
      'result', jsonb_build_object(
        'ok', true,
        'text', t_row.answer,
        'modelId', t_row.model_id,
        'citations', coalesce((select l.source_citations from public.ai_usage_ledger l where l.id=t_row.execution_id),'[]'::jsonb)
      )
    ));
  end loop;

  current_knowledge_rev := private.es02_branch_knowledge_revision(p_company_id,p_branch_id);

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', 1,
        'knowledgeRevision', current_knowledge_rev,
        'branchLabel', branch.name,
        'businessType', coalesce(company.business_type, 'retail'),
        'canAsk', branch.status='setup' and
          (select count(*) from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and l.status='success' and exists(select 1 from private.es02_branch_assistant_trials receipt where receipt.execution_id=op.operation_id and receipt.company_id=p_company_id and receipt.branch_id=p_branch_id and receipt.origin='engine'))<10 and
          not exists(select 1 from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and (l.status in ('reserved','running','uncertain') or (l.status='success' and op.result_discarded_at is null and not exists(select 1 from private.es02_branch_assistant_trials receipt where receipt.execution_id=op.operation_id and receipt.company_id=p_company_id and receipt.branch_id=p_branch_id and receipt.origin='engine')))),
        'trialAllowance', jsonb_build_object('limit',10,'used',(select count(*) from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and l.status='success' and exists(select 1 from private.es02_branch_assistant_trials receipt where receipt.execution_id=op.operation_id and receipt.company_id=p_company_id and receipt.branch_id=p_branch_id and receipt.origin='engine'))),
        'messages', messages_arr
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;
commit;

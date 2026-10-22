-- Preserve trial audit history while native Auth revokes sessions.
-- Verified/applied to isolated local fixture only; hosted approval/backup gates remain required.
begin;
-- Local fixture only approval required; hosted use requires backup and release gates.
-- Keep the historical session UUID when native Auth revokes/deletes its live session.
-- No account, email, role, grant, RLS, budget, allowance or provider-policy changes.
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table private.es02_branch_trial_operations add column native_session_id_snapshot uuid;
update private.es02_branch_trial_operations set native_session_id_snapshot=native_session_id;
alter table private.es02_branch_trial_operations alter column native_session_id_snapshot set not null;
alter table private.es02_branch_trial_operations alter column native_session_id drop not null;
alter table private.es02_branch_trial_operations drop constraint es02_branch_trial_operations_native_session_id_fkey;
alter table private.es02_branch_trial_operations add constraint es02_branch_trial_operations_native_session_id_fkey foreign key(native_session_id) references auth.sessions(id) on delete set null;
alter table private.es02_branch_trial_operations add constraint es02_trial_session_snapshot_match check(native_session_id is null or native_session_id=native_session_id_snapshot);

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
    where t.company_id=p_company_id and t.branch_id=p_branch_id and l.status in ('reserved','running','uncertain')) then
    return jsonb_build_object('ok',false,'code','TRIAL_PENDING');
  end if;
  select count(*) into used from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id and l.status<>'rejected';
  if used>=10 then return jsonb_build_object('ok',false,'code','TRIAL_LIMIT_REACHED'); end if;
  if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>least(budget.limit_baisa,1000) then return jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED'); end if;
  insert into public.ai_usage_ledger(id,budget_account_id,company_id,actor_user_id,actor_session_id,execution_id,attempt,usage_mode,model_id,provider,reserved_baisa,pricing_version,pricing_snapshot,source_citations)
    values(p_operation_id,budget.id,p_company_id,p_account_id,p_session_id,p_operation_id,1,'setup_trial',p_model_id,'google',p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
  insert into private.es02_branch_trial_operations(operation_id,company_id,branch_id,account_id,native_session_id,question_hash,knowledge_revision,hours_revision,language_code,persona,model_id,created_at,native_session_id_snapshot) values(op.operation_id,op.company_id,op.branch_id,op.account_id,op.native_session_id,op.question_hash,op.knowledge_revision,op.hours_revision,op.language_code,op.persona,op.model_id,clock_timestamp(),op.native_session_id);
  update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
  return jsonb_build_object('ok',true,'newlyReserved',true,'state','reserved','operationId',p_operation_id,'remaining',9-used);
end;
$$;

commit;

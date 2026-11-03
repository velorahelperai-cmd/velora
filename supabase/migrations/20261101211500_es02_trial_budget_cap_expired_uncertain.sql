-- Migration: Update es02_reserve_branch_trial_capped to exclude expired uncertain operations
-- from committed spend calculation, consistent with es02_reserve_branch_trial.

begin;

create or replace function public.es02_reserve_branch_trial_capped(
  p_operation_id uuid,p_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid,
  p_question text,p_knowledge_revision text,p_hours_revision bigint,p_language_code text,p_persona text,p_model_id text,
  p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb,
  p_trial_cap_baisa numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
declare budget public.ai_budget_accounts; committed numeric;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_trial_cap_baisa is null or p_trial_cap_baisa<=0 or p_trial_cap_baisa::text in ('NaN','Infinity','-Infinity')
     or p_reserved_baisa is null or p_reserved_baisa<=0 or p_reserved_baisa>1000
     or p_reserved_baisa::text in ('NaN','Infinity','-Infinity') then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  select * into budget from public.ai_budget_accounts where scope='admin_test' and company_id is null for update;
  if budget.id is null or not budget.enabled then return jsonb_build_object('ok',false,'code','BUDGET_DISABLED'); end if;
  perform 1 from public.company_branches where company_id=p_company_id and id=p_branch_id for update;
  if not exists(select 1 from private.es02_branch_trial_operations where operation_id=p_operation_id) then
    select coalesce(sum(case when l.status in ('success','incomplete','rejected') and l.cost_baisa is not null
                             then l.cost_baisa
                             when l.status in ('reserved','running') or (l.status='uncertain' and (l.finished_at is null or l.finished_at>clock_timestamp()-interval '5 minutes' or t.result_checkpoint is not null))
                             then l.reserved_baisa
                             else 0 end),0)
      into committed
      from private.es02_branch_trial_operations t
      join public.ai_usage_ledger l on l.id=t.operation_id
      where t.company_id=p_company_id and t.branch_id=p_branch_id;
    if committed+p_reserved_baisa>p_trial_cap_baisa then
      return jsonb_build_object('ok',false,'code','TRIAL_BUDGET_EXCEEDED','committedBaisa',committed,'capBaisa',p_trial_cap_baisa);
    end if;
  end if;
  return public.es02_reserve_branch_trial(p_operation_id,p_account_id,p_session_id,p_company_id,p_branch_id,
    p_question,p_knowledge_revision,p_hours_revision,p_language_code,p_persona,p_model_id,
    p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
end;
$$;

commit;

-- Local candidate only. Durable provider response recovery, never a provider retry.
-- Existing operation row is the source of truth; no new credential/data store.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table private.es02_branch_trial_operations add column result_checkpoint jsonb;
alter table private.es02_branch_trial_operations add constraint es02_trial_result_size check(result_checkpoint is null or octet_length(result_checkpoint::text)<=100000);

create function public.es02_checkpoint_branch_trial_result(p_operation_id uuid,p_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations; state text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 -- Preserve the budget-first lock order used by reserve/start/settle.
 perform 1 from public.ai_budget_accounts where scope='admin_test' and company_id is null for update;
 select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id for update;
 if op.operation_id is null or op.account_id is distinct from p_account_id or op.company_id is distinct from p_company_id or op.branch_id is distinct from p_branch_id
 or op.native_session_id_snapshot is distinct from p_session_id then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>100000
 or jsonb_typeof(p_result->'answer') is distinct from 'string' or length(btrim(p_result->>'answer')) not between 1 and 20000
 or jsonb_typeof(p_result->'question') is distinct from 'string' or md5(btrim(p_result->>'question')) is distinct from op.question_hash
 or p_result->>'modelId' is distinct from op.model_id
 or nullif(btrim(p_result->>'requestId'),'') is null or nullif(btrim(p_result->>'actualModelId'),'') is null
 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform private.ai_validated_usage(p_result->'usage','success',true);
 perform private.ai_validate_cost('success',(p_result->>'costUsd')::numeric,(p_result->>'costBaisa')::numeric);
 select status into state from public.ai_usage_ledger where id=op.operation_id and usage_mode='setup_trial';
 if state is null or state not in ('running','success') then return jsonb_build_object('ok',false,'code','TRIAL_PENDING');end if;
 if op.result_checkpoint is not null and op.result_checkpoint is distinct from p_result then return jsonb_build_object('ok',false,'code','EXECUTION_CONFLICT');end if;
 update private.es02_branch_trial_operations set result_checkpoint=p_result where operation_id=op.operation_id and result_checkpoint is null;
 -- Trusted completion must account for received usage even after the initiating
 -- session ends. Disclosure and trial proof still require current authorization.
 begin
  if not public.ai_settle_admin_attempt(op.operation_id,'success',(p_result->>'costUsd')::numeric,(p_result->>'costBaisa')::numeric,p_result->'usage',p_result->>'requestId',null,(p_result->>'latencyMs')::integer,p_result->>'responseId',p_result->>'actualModelId') then
   return jsonb_build_object('ok',false,'code','TRIAL_PENDING');end if;
 exception when others then
  -- The subtransaction rolls back accounting only; preserve the saved response.
  return jsonb_build_object('ok',false,'code','TRIAL_PENDING');
 end;
 return jsonb_build_object('ok',true);
end;$$;

create function public.es02_recover_branch_trial_result(p_operation_id uuid,p_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations; r jsonb; receipt jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 perform 1 from public.ai_budget_accounts where scope='admin_test' and company_id is null for update;
 perform 1 from public.company_branches where company_id=p_company_id and id=p_branch_id for update;
 select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id for update;
 if op.operation_id is null or op.account_id is distinct from p_account_id or op.company_id is distinct from p_company_id or op.branch_id is distinct from p_branch_id
 or not private.es02_b3_session_open(p_account_id,p_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.company_members m join public.companies c on c.id=m.company_id
 where m.company_id=p_company_id and m.user_id=p_account_id and m.role='owner' and m.status='active' and c.status in ('setup','active') for share of m,c;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if exists(select 1 from private.es02_branch_assistant_trials t where t.execution_id=op.operation_id and t.company_id=op.company_id and t.branch_id=op.branch_id and t.origin='engine') then
  return jsonb_build_object('ok',true);end if;
 -- A newly signed-in owner may recover the saved result, not replay its old authorization.
 op.native_session_id:=p_session_id;
 r:=op.result_checkpoint;
 if r is null then return jsonb_build_object('ok',false,'code','TRIAL_OUTCOME_UNKNOWN');end if;
 if not public.ai_settle_admin_attempt(op.operation_id,'success',(r->>'costUsd')::numeric,(r->>'costBaisa')::numeric,r->'usage',r->>'requestId',null,(r->>'latencyMs')::integer,r->>'responseId',r->>'actualModelId') then
  return jsonb_build_object('ok',false,'code','TRIAL_PENDING');end if;
 if op.result_discarded_at is not null then return jsonb_build_object('ok',true,'discarded',true);end if;
 if not private.es02_trial_context_current(op) then
  update private.es02_branch_trial_operations set result_discarded_at=clock_timestamp() where operation_id=op.operation_id and result_discarded_at is null;
  return jsonb_build_object('ok',true,'discarded',true);end if;
 receipt:=public.es02_record_owned_branch_assistant_trial(op.account_id,op.company_id,op.branch_id,r->>'question',r->>'answer',op.model_id,op.hours_revision,op.language_code,op.persona,op.knowledge_revision,op.operation_id);
 return receipt;
end;$$;

create function public.es02_read_owned_branch_trial_recovery(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority jsonb; op record;
begin
 authority:=public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 select t.operation_id,l.status,t.result_checkpoint is not null as recoverable into op
 from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
 where t.account_id=p_expected_account_id and t.company_id=p_company_id and t.branch_id=p_branch_id
 and l.status in ('reserved','running','uncertain','success')
 and not (l.status='success' and t.result_discarded_at is not null)
 and not exists(select 1 from private.es02_branch_assistant_trials r where r.execution_id=t.operation_id and r.company_id=t.company_id and r.branch_id=t.branch_id and r.origin='engine')
 order by t.created_at desc limit 1;
 return jsonb_build_object('ok',true,'operation',case when op.operation_id is null then null else jsonb_build_object('id',op.operation_id,'status',op.status,'recoverable',op.recoverable and op.status in ('running','success')) end);
end;$$;
revoke all on function public.es02_checkpoint_branch_trial_result(uuid,uuid,uuid,uuid,uuid,jsonb),public.es02_recover_branch_trial_result(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.es02_checkpoint_branch_trial_result(uuid,uuid,uuid,uuid,uuid,jsonb),public.es02_recover_branch_trial_result(uuid,uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.es02_read_owned_branch_trial_recovery(uuid,uuid,uuid) from public,anon;
grant execute on function public.es02_read_owned_branch_trial_recovery(uuid,uuid,uuid) to authenticated;
commit;

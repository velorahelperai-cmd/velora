-- Durable retrieval and unknown-outcome classification. No hold release or worker changes.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
alter table private.es02_branch_trial_operations add column provider_handle jsonb;
alter table private.es02_branch_trial_operations add column provider_question text;
alter table private.es02_branch_trial_operations add constraint es02_provider_handle_size check(provider_handle is null or octet_length(provider_handle::text)<=4096);
alter table private.es02_branch_trial_operations add constraint es02_provider_question_size check(provider_question is null or length(provider_question)<=1000);

create function public.es02_attach_trial_provider(p_operation_id uuid,p_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid,p_handle jsonb,p_question text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id for update;
 if op.operation_id is null or op.account_id is distinct from p_account_id or op.company_id is distinct from p_company_id or op.branch_id is distinct from p_branch_id or op.native_session_id_snapshot is distinct from p_session_id then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_question is null or length(p_question)>1000 or md5(btrim(p_question)) is distinct from op.question_hash then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if p_handle is null then
  if not exists(select 1 from public.ai_usage_ledger where id=op.operation_id and usage_mode='setup_trial' and status='running') then return jsonb_build_object('ok',false,'code','TRIAL_PENDING');end if;
  update private.es02_branch_trial_operations set provider_question=btrim(p_question) where operation_id=op.operation_id and provider_question is null;
  return jsonb_build_object('ok',true);
 end if;
 if jsonb_typeof(p_handle) is distinct from 'object' or p_handle->>'id' is null or p_handle->>'id' !~ '^[A-Za-z0-9_-]+$' or length(p_handle->>'id')>200 or p_handle->>'modelId' is distinct from op.model_id or octet_length(p_handle::text)>4096 or p_question is null or length(p_question)>1000 or md5(btrim(p_question)) is distinct from op.question_hash then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if not exists(select 1 from public.ai_usage_ledger where id=op.operation_id and usage_mode='setup_trial' and status='running') then return jsonb_build_object('ok',false,'code','TRIAL_PENDING');end if;
 if op.provider_handle is not null and (op.provider_handle is distinct from p_handle or op.provider_question is distinct from btrim(p_question)) then return jsonb_build_object('ok',false,'code','EXECUTION_CONFLICT');end if;
 update private.es02_branch_trial_operations set provider_handle=p_handle,provider_question=btrim(p_question) where operation_id=op.operation_id and provider_handle is null;
 return jsonb_build_object('ok',true);
end;$$;

create function public.es02_load_trial_provider(p_operation_id uuid,p_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations;ledger public.ai_usage_ledger;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_b3_session_open(p_account_id,p_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 -- Match checkpoint/recovery lock order; never expire a stale handle/checkpoint snapshot.
 perform 1 from public.ai_budget_accounts where scope='admin_test' and company_id is null for update;
 select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id for update;
 if op.operation_id is null or op.account_id is distinct from p_account_id or op.company_id is distinct from p_company_id or op.branch_id is distinct from p_branch_id then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id where m.company_id=p_company_id and m.user_id=p_account_id and m.role='owner' and m.status='active' and c.status in ('setup','active')) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into ledger from public.ai_usage_ledger where id=op.operation_id and usage_mode='setup_trial';
 if ledger.status='running' and op.result_checkpoint is null and op.provider_question is not null and ((op.provider_handle is null and op.created_at<clock_timestamp()-interval '5 minutes') or op.created_at<clock_timestamp()-interval '24 hours') then
  if not public.ai_settle_admin_attempt(op.operation_id,'uncertain',null,null,'{}'::jsonb,null,'GEMINI_SUBMISSION_UNKNOWN',0,null,null) then return jsonb_build_object('ok',false,'code','TRIAL_PENDING');end if;
  return jsonb_build_object('ok',true,'data',null,'submissionUnknown',true);
 end if;
 if op.provider_handle is null then return jsonb_build_object('ok',true,'data',null);end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('handle',op.provider_handle,'question',op.provider_question,'sessionId',op.native_session_id_snapshot,'pricing',ledger.pricing_snapshot,'state',ledger.status,'checkpoint',op.result_checkpoint is not null));
end;$$;
revoke all on function public.es02_attach_trial_provider(uuid,uuid,uuid,uuid,uuid,jsonb,text),public.es02_load_trial_provider(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.es02_attach_trial_provider(uuid,uuid,uuid,uuid,uuid,jsonb,text),public.es02_load_trial_provider(uuid,uuid,uuid,uuid,uuid) to service_role;

create or replace function public.es02_read_owned_branch_trial_recovery(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority jsonb;op record;
begin
 authority:=public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 select t.operation_id,l.status,t.result_checkpoint is not null as recoverable,
 (l.status='running' and t.result_checkpoint is null and (t.provider_handle is not null or (t.provider_question is not null and t.created_at<clock_timestamp()-interval '5 minutes'))) as pollable,
 (l.status='uncertain' and l.error_code in ('GEMINI_INCOMPLETE_RESPONSE','GEMINI_HTTP_503')) as provider_failed,
 (l.status<>'uncertain' or l.finished_at is null or l.finished_at>clock_timestamp()-interval '5 minutes' or t.result_checkpoint is not null) as blocking
 into op from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
 where t.account_id=p_expected_account_id and t.company_id=p_company_id and t.branch_id=p_branch_id
 and l.status in ('reserved','running','uncertain','success')
 and not(l.status='success' and t.result_discarded_at is not null)
 and not exists(select 1 from private.es02_branch_assistant_trials r where r.execution_id=t.operation_id and r.company_id=t.company_id and r.branch_id=t.branch_id and r.origin='engine')
 order by blocking desc,t.created_at desc limit 1;
 return jsonb_build_object('ok',true,'operation',case when op.operation_id is null then null else jsonb_build_object('id',op.operation_id,'status',op.status,'recoverable',op.recoverable and op.status in ('running','success'),'blocksNewRequests',op.blocking,'pollable',op.pollable,'providerFailed',op.provider_failed) end);
end;$$;
revoke all on function public.es02_read_owned_branch_trial_recovery(uuid,uuid,uuid) from public,anon;
grant execute on function public.es02_read_owned_branch_trial_recovery(uuid,uuid,uuid) to authenticated;
commit;

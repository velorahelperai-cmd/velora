-- Add Flash-Lite only to setup trials; preserve every existing operation, hold and tariff.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
alter table public.ai_usage_ledger drop constraint ai_usage_ledger_model_id_check;
alter table public.ai_usage_ledger add constraint ai_usage_ledger_model_id_check check(model_id in ('gpt-6-luna','gpt-6.1-sol','gemini-3.8-flash','gemini-3.5-flash-lite'));
alter table public.ai_usage_ledger drop constraint ai_attempt_provider_model_pair;
alter table public.ai_usage_ledger add constraint ai_attempt_provider_model_pair check(
 (model_id='gemini-3.8-flash' and provider='google') or
 (model_id='gemini-3.5-flash-lite' and provider='google' and usage_mode='setup_trial' and worker_job_id is null) or
 (model_id in ('gpt-6-luna','gpt-6.1-sol') and provider='openai'));
-- Exact deployed-body guard: change only the model allowlist, retaining all budget/ownership locks.
do $patch$
declare body text;
begin
 select pg_get_functiondef(p.oid) into strict body from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='es02_reserve_branch_trial';
 if md5(body)<>'dffb47ef54f85fc32b6969b2f5acf829' then raise exception 'TRIAL_RESERVE_DEFINITION_DRIFT';end if;
 execute replace(body, $old$p_model_id<>'gemini-3.8-flash'$old$, $new$p_model_id not in ('gemini-3.8-flash','gemini-3.5-flash-lite')$new$);
end;$patch$;
-- Read-only stream authorization. No expiry, settlement, hold or counter mutation.
create function public.es02_read_trial_stream(p_operation_id uuid,p_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_b3_session_open(p_account_id,p_session_id) then return jsonb_build_object('ok',false);end if;
 select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id;
 if op.operation_id is null or op.account_id is distinct from p_account_id or op.company_id is distinct from p_company_id or op.branch_id is distinct from p_branch_id then return jsonb_build_object('ok',false);end if;
 op.native_session_id:=p_session_id;
 if not private.es02_trial_context_current(op) then return jsonb_build_object('ok',false);end if;
 if op.provider_handle is null or op.result_checkpoint is not null or not exists(select 1 from public.ai_usage_ledger where id=op.operation_id and usage_mode='setup_trial' and status='running') then return jsonb_build_object('ok',true,'handle',null);end if;
 return jsonb_build_object('ok',true,'handle',op.provider_handle);
end;$$;
revoke all on function public.es02_read_trial_stream(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.es02_read_trial_stream(uuid,uuid,uuid,uuid,uuid) to service_role;
commit;

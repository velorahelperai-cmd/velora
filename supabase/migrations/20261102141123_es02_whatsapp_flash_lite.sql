-- Extend only native WhatsApp reservations to the priced Flash-Lite model.
begin;
alter table public.ai_usage_ledger drop constraint ai_attempt_provider_model_pair;
alter table public.ai_usage_ledger add constraint ai_attempt_provider_model_pair check (
 (model_id='gemini-3.8-flash' and provider='google') or
 (model_id='gemini-3.5-flash-lite' and provider='google' and
  ((usage_mode='setup_trial' and worker_job_id is null) or (usage_mode='company_live' and worker_job_id is not null))) or
 (model_id in ('gpt-6-luna','gpt-6.1-sol') and provider='openai'));
do $migration$
declare body text; old_expr text:=$old$p_model_id='gemini-3.8-flash' and p_provider='google'$old$;
new_expr text:=$new$p_model_id in ('gemini-3.8-flash','gemini-3.5-flash-lite') and p_provider='google'$new$;
begin
 select pg_get_functiondef('private.es02_reserve_whatsapp_capacity_cost_before_budget_bridge(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text)'::regprocedure) into body;
 if (length(body)-length(replace(body,old_expr,'')))/length(old_expr)<>1 then raise exception 'ES02_LITE_RESERVATION_SOURCE_DRIFT';end if;
 execute replace(body,old_expr,new_expr);
end;$migration$;
commit;

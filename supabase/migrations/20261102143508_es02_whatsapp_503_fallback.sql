-- Permit one separately reserved native fallback after a finished Flash-Lite
-- HTTP 503. The uncertain provider ledger and its budget hold remain intact.
begin;
do $migration$
declare
 body text;
 old_expr text := $old$(automation_generation is distinct from generation or status<>'rejected' or cost_baisa is distinct from 0
    or cost_usd is distinct from 0 or error_code not in ('KEY_MISSING','PROVIDER_HTTP_403','PROVIDER_HTTP_404') or error_code is null)$old$;
 new_expr text := $new$(automation_generation is distinct from generation or not coalesce((
   (status='rejected' and cost_baisa is not distinct from 0 and cost_usd is not distinct from 0
    and error_code in ('KEY_MISSING','PROVIDER_HTTP_403','PROVIDER_HTTP_404'))
   or (p_attempt=2 and p_model_id='gemini-3.8-flash' and p_provider='google'
    and attempt=1 and model_id='gemini-3.5-flash-lite' and provider='google'
    and status='uncertain' and error_code='PROVIDER_HTTP_503' and finished_at is not null
    and worker_claim_token=p_claim_token and cost_baisa is null and cost_usd is null
    and response_text is null and j.staged_reply is null and j.staged_ai_attempt_id is null
    and j.send_intent_id is null and not exists(select 1 from public.whatsapp_send_intents where original_job_id=p_job_id))
  ),false))$new$;
begin
 select pg_get_functiondef('private.es02_reserve_whatsapp_capacity_cost_before_budget_bridge(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text)'::regprocedure) into body;
 if (length(body)-length(replace(body,old_expr,'')))/length(old_expr)<>1 then raise exception 'ES02_503_FALLBACK_SOURCE_DRIFT';end if;
 execute replace(body,old_expr,new_expr);
end;$migration$;
commit;

-- Remove only the selection filter; do not alter claims, jobs or outcomes.
begin;
do $patch$
declare
 body text;
 old_expr text:='and private.whatsapp_coexistence_ai_allowed(j.company_id,c.phone_number_id) and private.es02_auto_dispatch_ready(j.company_id,c.branch_id) and j.next_attempt_at<=clock_timestamp()';
 new_expr text:='and private.es02_auto_dispatch_ready(j.company_id,c.branch_id) and j.next_attempt_at<=clock_timestamp()';
begin
 select pg_get_functiondef('public.whatsapp_claim_inbound_batch(integer)'::regprocedure) into body;
 if (length(body)-length(replace(body,old_expr,'')))/length(old_expr)<>1 then
  raise exception 'WA_BATCH_COEXISTENCE_ROLLBACK_SOURCE_DRIFT';
 end if;
 execute replace(body,old_expr,new_expr);
end;$patch$;
commit;

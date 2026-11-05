-- An unresolved earlier reply must block later automatic replies in the same
-- conversation. Preserve all claim, authorization and settlement logic.
begin;
do $patch$
declare
 item record;
 body text;
begin
 for item in select * from (values
  ('public.whatsapp_claim_inbound_batch(integer)',
   'earlier.status in (''pending'',''retry_wait'',''claimed'')',
   'earlier.status in (''pending'',''retry_wait'',''claimed'',''review_required'')'),
  ('private.wa_claim_job_pre_accepted_usage(uuid,integer)',
   'other.status in (''pending'',''retry_wait'',''claimed'')',
   'other.status in (''pending'',''retry_wait'',''claimed'',''review_required'')')
 ) as replacements(signature,old_expr,new_expr) loop
  select pg_get_functiondef(to_regprocedure(item.signature)) into body;
  if body is null or (length(body)-length(replace(body,item.old_expr,'')))/length(item.old_expr)<>1 then
   raise exception 'WA_REVIEW_ORDER_SOURCE_DRIFT: %',item.signature;
  end if;
  execute replace(body,item.old_expr,item.new_expr);
 end loop;
end;$patch$;
commit;

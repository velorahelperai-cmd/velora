-- Expand broad service questions only after the exact search has no match.
-- Original question remains bound to the inbound message; the same authorized
-- branch sources, passage limits, citation verification and send gates apply.
begin;
do $patch$
declare body text;old_expr text:=$old$selected_context:=private.es02_select_knowledge_passages(p_company_id,(g->>'branch_id')::uuid,p_question);$old$;
new_expr text:=$new$selected_context:=private.es02_select_knowledge_passages(p_company_id,(g->>'branch_id')::uuid,p_question);
 if selected_context->>'code'='NO_KNOWLEDGE' and length(btrim(p_question))<=120
  and private.knowledge_search_text(p_question) ~ '(خدمات|خدمه|خدمة|تقدم|بتقدم|تقدمون|services|offer)' then
  selected_context:=private.es02_select_knowledge_passages(p_company_id,(g->>'branch_id')::uuid,
   p_question||' '||'تقدم بتقدم متخصصه متخصصة تصميم تنفيذ خدمات services offer');
 end if;$new$;
begin
 select pg_get_functiondef('public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text)'::regprocedure) into body;
 if (length(body)-length(replace(body,old_expr,'')))/length(old_expr)<>1 then raise exception 'SERVICES_SEARCH_SOURCE_DRIFT';end if;
 execute replace(body,old_expr,new_expr);
end;$patch$;
commit;

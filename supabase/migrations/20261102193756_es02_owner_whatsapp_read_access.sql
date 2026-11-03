-- Local candidate: restore owner WhatsApp reading for the active native ES02
-- contract. This does not grant send, Instagram, staff, or expired access.
begin;
do $patch$
declare source text; candidate text; needle text := 'private.billing_chat_access(p_company_id,''whatsapp'')';
 replacement text := $expr$(private.billing_chat_access(p_company_id,'whatsapp') or
  (p_capability='wa.conversations.read' and exists(
   select 1 from public.company_members m join public.whatsapp_company_links l on l.company_id=m.company_id
   where m.company_id=p_company_id and m.user_id=auth.uid() and m.role='owner' and m.status='active'
    and l.status='verified' and private.es02_active_whatsapp_readonly(p_company_id,l.provider_phone_number_id))))$expr$;
begin
 select pg_get_functiondef('private.es02_b3_current_binding(uuid,uuid,uuid,text)'::regprocedure) into source;
 if md5(source)<>'85e62cef7b2056486dc6ed8ccf013129' or (length(source)-length(replace(source,'for update','')))/length('for update')<>10 then
  raise exception 'ES02_READ_BINDING_SOURCE_DRIFT';end if;
 candidate:=replace(replace(source,'FUNCTION private.es02_b3_current_binding(','FUNCTION private.es02_b3_current_binding_readonly('),'for update','');
 if candidate ~* '\m(insert|update|delete)\M' then raise exception 'ES02_READ_BINDING_NOT_READ_ONLY';end if;
 execute candidate;
 execute 'revoke all on function private.es02_b3_current_binding_readonly(uuid,uuid,uuid,text) from public,anon,authenticated,service_role';
 select pg_get_functiondef('private.es02_active_whatsapp_ingress(uuid,text)'::regprocedure) into source;
 if md5(source)<>'43582810265a8f462d8c3d8574fdb6c4' then raise exception 'ES02_READ_INGRESS_SOURCE_DRIFT';end if;
 candidate:=replace(replace(source,'FUNCTION private.es02_active_whatsapp_ingress(','FUNCTION private.es02_active_whatsapp_readonly('),
  'private.es02_b3_current_binding(','private.es02_b3_current_binding_readonly(');
 execute candidate;
 execute 'revoke all on function private.es02_active_whatsapp_readonly(uuid,text) from public,anon,authenticated,service_role';
 select pg_get_functiondef('public.has_company_capability(uuid,text)'::regprocedure) into source;
 if md5(source)<>'647e9619f8273a0340772aa61bc5fc82' or (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then
  raise exception 'ES02_READ_CAPABILITY_SOURCE_DRIFT';end if;
 execute replace(source,needle,replacement);
end;$patch$;
commit;

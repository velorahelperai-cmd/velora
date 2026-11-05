begin;

-- Starting a thread does not create an inbound message or authorize a send.
-- The existing native send path still requires its own service-window proof.
create function public.whatsapp_start_conversation(p_company_id uuid, p_recipient text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  sid uuid;
  link public.whatsapp_company_links%rowtype;
  gate jsonb;
  conv public.whatsapp_conversations%rowtype;
  recipient text := btrim(coalesce(p_recipient,''));
  created boolean := false;
begin
  if current_setting('role',true) is distinct from 'authenticated' or actor is null
     or p_company_id is null or recipient !~ '^[1-9][0-9]{6,14}$' then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  begin sid := (auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then sid := null; end;
  perform 1 from public.companies where id=p_company_id and status='active' for share nowait;
  if not found or private.whatsapp_inbox_scope(p_company_id) is distinct from 'all_company'
     or not coalesce(private.wa_staff_session_authority(actor,sid,p_company_id,null),false) then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;
  select * into link from public.whatsapp_company_links
    where company_id=p_company_id and status='verified' for share nowait;
  if not found or link.provider_phone_number_id is null or link.provider_waba_id is null then
    return jsonb_build_object('ok',false,'code','connection_unavailable');
  end if;
  gate := private.whatsapp_meta_asset_binding(link.provider_waba_id,link.provider_phone_number_id);
  if gate->>'ok' is distinct from 'true' or gate->>'company_id' is distinct from p_company_id::text
     or gate->>'link_id' is distinct from link.id::text
     or gate->>'link_generation' is distinct from link.generation::text then
    return jsonb_build_object('ok',false,'code','connection_unavailable');
  end if;
  insert into public.whatsapp_conversations(company_id,phone_number_id,customer_wa_id,automation_allowed)
    values(p_company_id,link.provider_phone_number_id,recipient,false)
    on conflict(company_id,phone_number_id,customer_wa_id) do nothing
    returning * into conv;
  created := found;
  if not created then
    select * into conv from public.whatsapp_conversations
      where company_id=p_company_id and phone_number_id=link.provider_phone_number_id and customer_wa_id=recipient
      for share nowait;
  end if;
  if conv.id is null or not coalesce(private.conversation_readable(p_company_id,conv.assigned_to),false)
     or private.whatsapp_inbox_scope(p_company_id) is distinct from 'all_company'
     or not coalesce(private.wa_staff_session_authority(actor,sid,p_company_id,conv.assigned_to),false) then
    raise insufficient_privilege;
  end if;
  return jsonb_build_object('ok',true,'company_id',p_company_id,'conversation_id',conv.id,'created',created);
exception
  when insufficient_privilege then return jsonb_build_object('ok',false,'code','forbidden');
  when lock_not_available then return jsonb_build_object('ok',false,'code','unavailable');
end; $$;
revoke all on function public.whatsapp_start_conversation(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_start_conversation(uuid,text) to authenticated;

commit;

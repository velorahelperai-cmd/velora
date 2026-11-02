-- Read-only display evidence. Never writes legacy test markers or grants service.
begin;
create function public.whatsapp_read_message_evidence(p_company_id uuid,p_link_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare l public.whatsapp_company_links%rowtype; inbound_at timestamptz; delivered_at timestamptz;
 sid text:=auth.jwt()->>'session_id';
begin
 if current_setting('role',true)<>'authenticated' or auth.uid() is null
  or not exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id
   where m.company_id=p_company_id and m.user_id=auth.uid() and m.role='owner' and m.status='active' and c.status<>'suspended')
  or public.has_company_capability(p_company_id,'wa.conversations.read') is distinct from true
 then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if sid is null or sid !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
   join private.app_session_activity a on a.session_id=s.id and a.user_id=u.id
   where u.id=auth.uid() and s.id=sid::uuid and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
   and a.expired_at is null and a.last_activity_at<=statement_timestamp() and a.last_activity_at>statement_timestamp()-interval '2 hours')
 then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select * into l from public.whatsapp_company_links where id=p_link_id and company_id=p_company_id and status='verified';
 if not found then return jsonb_build_object('ok',false,'code','scope_changed');end if;
 -- Company history is not generation-bound and is explicitly labelled as such.
 select max(m.received_at) into inbound_at from public.whatsapp_messages m
 where m.company_id=p_company_id and m.direction='inbound' and m.received_at<=statement_timestamp();
 select max(s.occurred_at) into delivered_at from public.whatsapp_send_intents i
 join public.whatsapp_messages m on (m.company_id,m.conversation_id,m.id,m.wa_message_id)=(i.company_id,i.conversation_id,i.message_id,i.wa_message_id)
 join public.whatsapp_delivery_statuses s on (s.company_id,s.message_id,s.wa_message_id,s.phone_number_id,s.recipient_wa_id)=(i.company_id,i.message_id,i.wa_message_id,i.phone_number_id,i.recipient_wa_id)
 where i.company_id=p_company_id and i.link_id=l.id and i.link_generation=l.generation and i.phone_number_id=l.provider_phone_number_id
  and i.outcome='accepted' and m.direction='outbound' and m.delivery_state in ('delivered','read')
  and lower(s.status) in ('delivered','read') and s.link_state in ('applied','ignored_stale')
  and s.occurred_at<=statement_timestamp() and i.attempt_started_at<=s.occurred_at+interval '1 second';
 return jsonb_build_object('ok',true,'company_id',p_company_id,'link_id',l.id,'generation',l.generation,
  'latest_company_inbound_at',inbound_at,'current_link_delivered_at',delivered_at);
end;$$;
revoke all on function public.whatsapp_read_message_evidence(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_read_message_evidence(uuid,uuid) to authenticated;
comment on function public.whatsapp_read_message_evidence(uuid,uuid) is 'Owner-only message history and current-binding delivery evidence; display only, no activation or send grant.';
commit;

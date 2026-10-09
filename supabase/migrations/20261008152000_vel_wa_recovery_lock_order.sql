-- Forward-only receipt recovery lock ordering. Preserve accepted evidence and API contracts.
begin;
alter function public.retry_whatsapp_send_persist(uuid,uuid) set schema private;
alter function private.retry_whatsapp_send_persist(uuid,uuid) rename to wa_retry_persist_pre_lock_order;
revoke all on function private.wa_retry_persist_pre_lock_order(uuid,uuid) from public,anon,authenticated,service_role;

create function public.retry_whatsapp_send_persist(p_intent_id uuid,p_actor_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare identity public.whatsapp_send_intents%rowtype;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 -- Identity fields are immutable. Acquire the same company -> conversation ->
 -- original job -> intent locks as workers before calling the retained finalizer.
 -- Do not require active automation, subscription or credentials: an accepted
 -- external receipt still needs repair after takeover, expiry or revocation.
 select * into identity from public.whatsapp_send_intents where id=p_intent_id;
 if found then
  perform 1 from public.companies where id=identity.company_id for no key update;
  perform 1 from public.whatsapp_conversations where id=identity.conversation_id and company_id=identity.company_id for update;
  if identity.original_job_id is not null then
   perform 1 from public.whatsapp_inbound_jobs where id=identity.original_job_id and company_id=identity.company_id for update;
  end if;
 end if;
 return private.wa_retry_persist_pre_lock_order(p_intent_id,p_actor_user_id);
end; $$;
revoke all on function public.retry_whatsapp_send_persist(uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_whatsapp_send_persist(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;

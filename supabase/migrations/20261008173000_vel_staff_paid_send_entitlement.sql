-- CLI-created forward correction, timestamp advanced after the 170000 chain.
-- Manual dispatch uses the existing authoritative Live paid-proof contract.
begin;

alter function public.claim_whatsapp_send_attempt(uuid,uuid,integer) set schema private;
alter function private.claim_whatsapp_send_attempt(uuid,uuid,integer) rename to wa_claim_staff_pre_paid_entitlement;
revoke all on function private.wa_claim_staff_pre_paid_entitlement(uuid,uuid,integer)
 from public,anon,authenticated,service_role;

create function public.claim_whatsapp_send_attempt(p_intent_id uuid,p_actor_user_id uuid,p_lease_seconds integer default 90)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.whatsapp_send_intents%rowtype;r jsonb;proof jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id;
 if found then
  -- Match worker/settlement ordering before the old claim acquires intent locks.
  -- The stored tenant and conversation are immutable; never take caller tenant data.
  perform 1 from public.companies where id=i.company_id for no key update;
  perform 1 from public.billing_subscriptions where company_id=i.company_id and environment='live' for no key update;
  perform 1 from public.whatsapp_conversations where id=i.conversation_id and company_id=i.company_id for update;
  select * into i from public.whatsapp_send_intents where id=p_intent_id for update;
 end if;
 begin
  -- Retain every Meta window, actor, capability, binding and historical-outcome check.
  r:=private.wa_claim_staff_pre_paid_entitlement(p_intent_id,p_actor_user_id,p_lease_seconds);
  if r->'ok'='true'::jsonb and r->'claimed'='true'::jsonb and i.sender_kind='staff' and i.outcome='ready' then
   proof:=public.billing_read_company_operational_entitlement(i.company_id);
   if proof->'ok' is distinct from 'true'::jsonb or proof->'active' is distinct from 'true'::jsonb
    or proof->>'environment' is distinct from 'live' or proof->>'plan_version_id' is null
    or proof->>'paid_through' is null or (proof->>'paid_through')::timestamptz<=clock_timestamp() then
    -- Roll back only this newly allocated attempt. Paid history/known outcomes remain untouched.
    r:=jsonb_build_object('ok',false,'code','subscription_inactive','intent',private.whatsapp_send_intent_public(i));
    raise exception 'STAFF_PAID_DISPATCH_DENIED' using errcode='PWA03';
   end if;
   return r||jsonb_build_object('manual_paid_entitlement',jsonb_build_object('company_id',i.company_id,
    'environment','live','plan_version_id',proof->'plan_version_id','paid_through',proof->'paid_through'));
  end if;
  return r;
 exception when sqlstate 'PWA03' then return r;
 end;
end;$$;
revoke all on function public.claim_whatsapp_send_attempt(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_send_attempt(uuid,uuid,integer) to service_role;
comment on function public.claim_whatsapp_send_attempt(uuid,uuid,integer) is
 'Service-only staff dispatch: retains Meta/actor/identity guards, requires authoritative current Live payment for new claims, and attests company/plan/expiry for the pre-Graph application gate. Historical outcomes retain their original semantics.';
notify pgrst,'reload schema';
commit;

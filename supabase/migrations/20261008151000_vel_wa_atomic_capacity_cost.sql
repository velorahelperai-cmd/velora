-- Fresh WhatsApp paid work reserves existing message capacity and AI cost together.
-- Reuse the established claim/window/profile/citation/budget guards and ledgers.
begin;

create function public.ai_reserve_whatsapp_capacity_cost_attempt(p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,
 p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb,
 p_expected_persona text default null,p_expected_plan_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare capacity jsonb;reservation jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 -- The capacity guard obtains the shared company -> subscription -> conversation
 -- -> job locks first. The cost guard reuses them before its citation/budget locks.
 -- An inner exception block is a PostgreSQL subtransaction: a denied cost/profile
 -- rolls back only writes from this joint operation, including a new message slot.
 -- Existing reservations and settled/uncertain cost predate this block and survive.
 begin
  capacity:=public.whatsapp_reserve_job_usage(p_job_id,p_claim_token);
  if capacity->>'ok' is distinct from 'true' then
   reservation:=capacity;
   raise exception 'ATOMIC_RESERVATION_DENIED' using errcode='PWA01';
  end if;
  if p_expected_persona is not null or p_expected_plan_version_id is not null then
   reservation:=public.ai_reserve_whatsapp_profile_attempt(p_id,p_job_id,p_claim_token,p_attempt,
    p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations,
    p_expected_persona,p_expected_plan_version_id);
  else
   reservation:=public.ai_reserve_whatsapp_attempt(p_id,p_job_id,p_claim_token,p_attempt,
    p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
  end if;
  if reservation->>'ok' is distinct from 'true' then
   raise exception 'ATOMIC_RESERVATION_DENIED' using errcode='PWA01';
  end if;
  return reservation;
 exception when sqlstate 'PWA01' then
  return reservation;
 end;
end; $$;
revoke all on function public.ai_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid)
 from public,anon,authenticated;
grant execute on function public.ai_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid)
 to service_role;
comment on function public.ai_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid) is
 'Service-only joint message capacity and AI cost reservation. Denials roll back new writes; previous cost and quota evidence is preserved.';

commit;

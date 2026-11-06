-- Restores the claim-only continuity watchdog (no inbound schedule phase).
-- Does not delete conversations, messages, jobs, intents, or the cutover stamp.

create or replace function public.whatsapp_claim_continuity_watchdog(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed jsonb := '[]'::jsonb;
  intent public.whatsapp_response_intents%rowtype;
  token uuid;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'server_role_required');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  for intent in
    select *
    from public.whatsapp_response_intents
    where channel = 'whatsapp'
      and response_kind = 'ack_v1'
      and phase = 'ack_due'
    order by updated_at, id
    limit p_limit
    for update skip locked
  loop
    if exists (
      select 1 from public.whatsapp_response_intents sibling
      where sibling.company_id = intent.company_id
        and sibling.channel = intent.channel
        and sibling.provider_message_id = intent.provider_message_id
        and sibling.phase in ('unknown', 'attempting')
    ) then
      continue;
    end if;
    if exists (
      select 1 from public.whatsapp_response_intents answer
      where answer.company_id = intent.company_id
        and answer.channel = intent.channel
        and answer.provider_message_id = intent.provider_message_id
        and answer.response_kind = 'answer_v1'
        and answer.phase in ('answer_ready', 'send_reserved', 'attempting', 'provider_accepted', 'delivered', 'read')
    ) then
      update public.whatsapp_response_intents
      set phase = 'cancelled', claim_token = null, updated_at = pg_catalog.clock_timestamp()
      where id = intent.id and phase = 'ack_due';
      continue;
    end if;
    token := gen_random_uuid();
    update public.whatsapp_response_intents
    set phase = 'send_reserved',
        claim_token = token,
        claim_expires_at = pg_catalog.clock_timestamp() + interval '60 seconds',
        updated_at = pg_catalog.clock_timestamp()
    where id = intent.id and phase = 'ack_due';
    claimed := claimed || jsonb_build_array(jsonb_build_object(
      'id', intent.id,
      'company_id', intent.company_id,
      'provider_message_id', intent.provider_message_id,
      'response_kind', 'ack_v1',
      'claim_token', token,
      'automation_generation', intent.automation_generation
    ));
  end loop;
  return jsonb_build_object('ok', true, 'dispatch', false, 'claimed', claimed);
end;
$$;

drop function if exists private.whatsapp_schedule_due_continuity_acks(integer);
drop function if exists private.whatsapp_continuity_staff_replied_since(uuid, uuid, timestamptz);
-- Keep cutover row; dropping it would risk re-scheduling historical pending on replay.

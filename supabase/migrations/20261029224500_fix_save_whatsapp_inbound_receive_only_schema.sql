-- Fix public.save_whatsapp_inbound_receive_only to align with the actual schema of public.whatsapp_inbound_jobs.
-- Replaces non-existent columns next_retry_at and last_error_code with existing columns,
-- while preserving next_attempt_at (not null), claim_token/claim_expires_at clearing,
-- atomic single-transaction completion, worker claim preservation, and service_role security.

begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.save_whatsapp_inbound_receive_only(
  p_company_id uuid,
  p_phone_number_id text,
  p_customer_wa_id text,
  p_customer_name text,
  p_wa_message_id text,
  p_body text,
  p_message_type text,
  p_received_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wa_id text := pg_catalog.btrim(p_wa_message_id);
  v_saved jsonb;
  v_job_id uuid;
  v_job public.whatsapp_inbound_jobs%rowtype;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'SERVER_ROLE_REQUIRED' using errcode = '42501';
  end if;

  if v_wa_id is null or v_wa_id = '' then
    raise exception 'wa_message_id is required' using errcode = '22023';
  end if;

  -- Serialize with duplicate redelivery and any concurrent inbound save for the same wa_message_id.
  perform pg_catalog.pg_advisory_xact_lock(87420101, pg_catalog.hashtext(v_wa_id));

  v_saved := public.save_whatsapp_inbound(
    p_company_id,
    p_phone_number_id,
    p_customer_wa_id,
    p_customer_name,
    p_wa_message_id,
    p_body,
    p_message_type,
    p_received_at
  );

  if coalesce((v_saved ->> 'ok')::boolean, false) is not true then
    return v_saved;
  end if;

  v_job_id := nullif(v_saved ->> 'job_id', '')::uuid;
  if v_job_id is null then
    raise exception 'RECEIVE_ONLY_JOB_ID_MISSING' using errcode = 'P0001';
  end if;

  select *
    into v_job
    from public.whatsapp_inbound_jobs
   where id = v_job_id
     and company_id = p_company_id
     for update;

  if not found then
    raise exception 'RECEIVE_ONLY_JOB_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Duplicate redelivery: do not mutate or pull an existing job.
  -- If the job is claimed or an outbound send started and its outcome is unresolved,
  -- preserve it and reject converting to receive-only until reconciled.
  if coalesce((v_saved ->> 'inserted')::boolean, false) is false then
    if v_job.status = 'claimed'
       or exists (
         select 1
           from public.whatsapp_send_intents s
          where s.company_id = v_job.company_id
            and (s.id = v_job.send_intent_id or s.original_job_id = v_job.id)
            and s.outcome = 'pending'
       ) then
      raise exception 'RECEIVE_ONLY_UNRESOLVED_JOB' using errcode = '23514';
    end if;

    -- Return the saved state without changing the earlier job.
    return v_saved || pg_catalog.jsonb_build_object(
      'job_status', v_job.status,
      'result_code', v_job.result_code
    );
  end if;

  -- Only NEW messages (inserted = true) are saved with runnable execution prevented atomically.
  if v_job.usage_status is not distinct from 'accepted'
     or exists (
       select 1
         from public.whatsapp_send_intents s
        where s.company_id = v_job.company_id
          and (s.id = v_job.send_intent_id or s.original_job_id = v_job.id)
          and s.outcome = 'accepted'
          and s.wa_message_id is not null
     ) then
    raise exception 'RECEIVE_ONLY_ALREADY_ACCEPTED' using errcode = '23514';
  end if;

  update public.whatsapp_inbound_jobs
     set status = 'completed',
         claim_token = null,
         claim_expires_at = null,
         completed_at = coalesce(completed_at, pg_catalog.clock_timestamp()),
         result_code = 'SETUP_META_TEST_RECEIVE_ONLY',
         updated_at = pg_catalog.clock_timestamp()
   where id = v_job.id
     and company_id = p_company_id
   returning * into v_job;

  if not found
     or v_job.status is distinct from 'completed'
     or v_job.claim_token is not null
     or v_job.claim_expires_at is not null
     or v_job.result_code is distinct from 'SETUP_META_TEST_RECEIVE_ONLY' then
    raise exception 'RECEIVE_ONLY_JOB_PREVENTION_FAILED' using errcode = 'P0001';
  end if;

  return v_saved || pg_catalog.jsonb_build_object(
    'job_status', v_job.status,
    'result_code', v_job.result_code
  );
end;
$$;

alter function public.save_whatsapp_inbound_receive_only(uuid, text, text, text, text, text, text, timestamptz) owner to postgres;
revoke all on function public.save_whatsapp_inbound_receive_only(uuid, text, text, text, text, text, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.save_whatsapp_inbound_receive_only(uuid, text, text, text, text, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;

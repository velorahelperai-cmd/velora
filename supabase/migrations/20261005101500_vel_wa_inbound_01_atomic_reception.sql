-- VEL-WA-INBOUND-01 (unapplied)
-- Atomic inbound persist + durable processing lease ownership.
-- RPCs are internal (service_role only). No worker/cron in this package.

-- ---------------------------------------------------------------------------
-- Processing ledger (one row per inbound message) — internal, not client-readable
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_inbound_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  message_id uuid not null references public.whatsapp_messages (id) on delete cascade,
  wa_message_id text not null,
  status text not null default 'pending',
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  completed_at timestamptz,
  result_code text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_inbound_jobs_status_chk
    check (status in ('pending', 'claimed', 'completed', 'failed')),
  constraint whatsapp_inbound_jobs_message_uid unique (message_id),
  constraint whatsapp_inbound_jobs_wa_uid unique (wa_message_id),
  constraint whatsapp_inbound_jobs_attempt_chk check (attempt_count >= 0)
);

create index if not exists whatsapp_inbound_jobs_claimable_idx
  on public.whatsapp_inbound_jobs (status, claim_expires_at)
  where status in ('pending', 'claimed');

create index if not exists whatsapp_inbound_jobs_company_idx
  on public.whatsapp_inbound_jobs (company_id, created_at desc);

comment on table public.whatsapp_inbound_jobs is
  'Internal inbound processing ledger (service_role / definer RPCs only). Not exposed to authenticated clients; claim_token must not be readable by members.';

alter table public.whatsapp_inbound_jobs enable row level security;

-- No member/admin SELECT policies: ledger is not a UI surface; claim_token stays off the client.
drop policy if exists whatsapp_inbound_jobs_select on public.whatsapp_inbound_jobs;

revoke all on table public.whatsapp_inbound_jobs from public, anon, authenticated;

do $$
begin
  grant all on table public.whatsapp_inbound_jobs to service_role;
exception
  when undefined_object then
    null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic save: conversation + message + job in one transaction
-- ---------------------------------------------------------------------------
create or replace function public.save_whatsapp_inbound(
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
  v_conversation_id uuid;
  v_message_id uuid;
  v_job_id uuid;
  v_inserted boolean := false;
  v_existing public.whatsapp_messages%rowtype;
  v_conv public.whatsapp_conversations%rowtype;
  v_name text := coalesce(pg_catalog.btrim(p_customer_name), '');
  v_phone text := coalesce(pg_catalog.btrim(p_phone_number_id), '');
  v_customer text := coalesce(pg_catalog.btrim(p_customer_wa_id), '');
  v_wa_id text := coalesce(pg_catalog.btrim(p_wa_message_id), '');
  v_body text := coalesce(p_body, '');
  v_type text := pg_catalog.btrim(coalesce(p_message_type, ''));
begin
  if v_type = '' then
    v_type := 'text';
  end if;

  if p_company_id is null
     or v_phone = ''
     or v_customer = ''
     or v_wa_id = ''
     or p_received_at is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Serialize same wa_message_id before any conversation write (SELECT-alone is not enough).
  perform pg_catalog.pg_advisory_xact_lock(
    87420101,
    pg_catalog.hashtext(v_wa_id)
  );

  select m.*
  into v_existing
  from public.whatsapp_messages as m
  where m.wa_message_id = v_wa_id
  for update;

  if found then
    select c.*
    into v_conv
    from public.whatsapp_conversations as c
    where c.id = v_existing.conversation_id
    for update;

    if not found then
      raise exception 'conversation_missing' using errcode = 'P0002';
    end if;

    if v_existing.company_id is distinct from p_company_id
       or v_existing.direction is distinct from 'inbound'
       or v_existing.sender is distinct from 'customer'
       or v_conv.company_id is distinct from p_company_id
       or v_conv.phone_number_id is distinct from v_phone
       or v_conv.customer_wa_id is distinct from v_customer
       or v_existing.conversation_id is distinct from v_conv.id then
      -- Identity conflict: reject without side conversation or data mutation.
      raise exception 'inbound_identity_conflict' using errcode = '22023';
    end if;

    -- Correct duplicate: keep original body/type/received_at; use stored timing only.
    v_message_id := v_existing.id;
    v_conversation_id := v_existing.conversation_id;

    update public.whatsapp_conversations as c
    set
      last_message_at = greatest(c.last_message_at, v_existing.received_at)
    where c.id = v_conversation_id
      and c.company_id = p_company_id;
  else
    -- First sight of this wa_message_id under the lock: create conversation then message.
    insert into public.whatsapp_conversations as c (
      company_id,
      phone_number_id,
      customer_wa_id,
      customer_name,
      last_message_at
    ) values (
      p_company_id,
      v_phone,
      v_customer,
      v_name,
      p_received_at
    )
    on conflict (company_id, phone_number_id, customer_wa_id)
    do update set
      customer_name = case
        when excluded.customer_name <> '' then excluded.customer_name
        else c.customer_name
      end,
      last_message_at = greatest(c.last_message_at, excluded.last_message_at)
    returning c.id into v_conversation_id;

    insert into public.whatsapp_messages (
      company_id,
      conversation_id,
      wa_message_id,
      body,
      message_type,
      direction,
      sender,
      received_at
    ) values (
      p_company_id,
      v_conversation_id,
      v_wa_id,
      v_body,
      v_type,
      'inbound',
      'customer',
      p_received_at
    )
    returning id into v_message_id;

    v_inserted := true;
  end if;

  -- One processing row per message; redelivery can create a missing job only.
  insert into public.whatsapp_inbound_jobs (
    company_id,
    message_id,
    wa_message_id,
    status
  ) values (
    p_company_id,
    v_message_id,
    v_wa_id,
    'pending'
  )
  on conflict (message_id) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select j.id into v_job_id
    from public.whatsapp_inbound_jobs as j
    where j.message_id = v_message_id;
  end if;

  if v_job_id is null then
    raise exception 'job_missing' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'message_id', v_message_id,
    'conversation_id', v_conversation_id,
    'job_id', v_job_id,
    'job_status', (
      select j.status from public.whatsapp_inbound_jobs as j where j.id = v_job_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim / complete (lease ownership). No worker runs in this package.
-- ---------------------------------------------------------------------------
create or replace function public.claim_whatsapp_inbound_job(
  p_job_id uuid,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease integer := greatest(coalesce(p_lease_seconds, 120), 1);
  v_row public.whatsapp_inbound_jobs%rowtype;
begin
  if p_job_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  update public.whatsapp_inbound_jobs as j
  set
    status = 'claimed',
    claim_token = gen_random_uuid(),
    claimed_at = pg_catalog.now(),
    claim_expires_at = pg_catalog.now() + make_interval(secs => v_lease),
    attempt_count = j.attempt_count + 1,
    updated_at = pg_catalog.now(),
    completed_at = null,
    result_code = null
  where j.id = p_job_id
    and (
      j.status = 'pending'
      or (
        j.status = 'claimed'
        and j.claim_expires_at is not null
        and j.claim_expires_at < pg_catalog.now()
      )
    )
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_id', v_row.id,
    'message_id', v_row.message_id,
    'company_id', v_row.company_id,
    'wa_message_id', v_row.wa_message_id,
    'claim_token', v_row.claim_token,
    'claim_expires_at', v_row.claim_expires_at,
    'attempt_count', v_row.attempt_count
  );
end;
$$;

create or replace function public.complete_whatsapp_inbound_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_ok boolean,
  p_result_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.whatsapp_inbound_jobs%rowtype;
  v_status text := case when coalesce(p_ok, false) then 'completed' else 'failed' end;
begin
  if p_job_id is null or p_claim_token is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  update public.whatsapp_inbound_jobs as j
  set
    status = v_status,
    completed_at = pg_catalog.now(),
    result_code = nullif(pg_catalog.btrim(coalesce(p_result_code, '')), ''),
    updated_at = pg_catalog.now(),
    claim_token = null,
    claim_expires_at = null
  where j.id = p_job_id
    and j.status = 'claimed'
    and j.claim_token is not distinct from p_claim_token
    and j.claim_expires_at is not null
    and j.claim_expires_at > pg_catalog.now()
  returning * into v_row;

  if not found then
    -- Expired lease or another worker holds the claim: reject stale completion.
    return jsonb_build_object('ok', false, 'code', 'claim_rejected');
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_id', v_row.id,
    'status', v_row.status,
    'result_code', v_row.result_code
  );
end;
$$;

revoke all on function public.save_whatsapp_inbound(uuid, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_whatsapp_inbound_job(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_whatsapp_inbound_job(uuid, uuid, boolean, text)
  from public, anon, authenticated;

do $$
begin
  grant execute on function public.save_whatsapp_inbound(uuid, text, text, text, text, text, text, timestamptz)
    to service_role;
  grant execute on function public.claim_whatsapp_inbound_job(uuid, integer)
    to service_role;
  grant execute on function public.complete_whatsapp_inbound_job(uuid, uuid, boolean, text)
    to service_role;
exception
  when undefined_object then
    null;
end;
$$;

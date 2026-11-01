-- F5 (NOT APPLIED to any hosted DB). Two additive pieces:
--  (1) Server-persisted owner confirmation of the Meta-verified WhatsApp number.
--      Every transition of a company link into `verified` (or a new generation /
--      phone_number_id) requires a fresh owner decision. Until it is `confirmed`
--      no outbound send intent may move to `attempting` (staff, assistant, review).
--      "Not my number" disconnects through the EXISTING legacy disconnect RPCs,
--      retires the es02 binding so a new attempt can be started, and is audited.
--      No grandfathering: links verified before this migration are backfilled as
--      `legacy_unconfirmed` (an old link is not proof of confirmation) and the gate
--      fails closed for any verified link without a `confirmed` row. The gate is
--      governed by private.wa_number_gate_settings.enforce (default true = enforce).
--      Pre-go-live decision (owner, 2026-11-01): no production customers, enforce from start.
--  (2) A read-only resume RPC that re-issues the launch payload of an existing,
--      unexpired, unclaimed attempt for the SAME actor + SAME native session
--      (same stored nonce, same server-side binding). It never creates attempts.
-- Graph version, grants of existing functions and their bodies are unchanged.
begin;

create table private.whatsapp_link_number_confirmations (
  link_id uuid not null,
  link_generation bigint not null check (link_generation >= 1),
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'legacy_unconfirmed', 'confirmed', 'rejected')),
  phone_number_id text,
  display_number text,
  required_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  decided_by uuid,
  decided_session_id uuid,
  primary key (link_id, link_generation),
  check ((status in ('pending', 'legacy_unconfirmed')) = (decided_at is null))
);
create table private.whatsapp_link_number_confirmation_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  link_id uuid not null,
  link_generation bigint not null,
  event text not null check (event in ('required', 'legacy_required', 'confirmed', 'rejected', 'disconnect_failed')),
  actor_user_id uuid,
  session_id uuid,
  phone_number_id text,
  display_number text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.whatsapp_link_number_confirmations enable row level security;
alter table private.whatsapp_link_number_confirmation_events enable row level security;
revoke all on private.whatsapp_link_number_confirmations from public, anon, authenticated, service_role;
revoke all on private.whatsapp_link_number_confirmation_events from public, anon, authenticated, service_role;
comment on table private.whatsapp_link_number_confirmation_events is 'F5 append-only audit of number confirmation decisions. Never updated or deleted by app code.';

create function private.wa_f5_events_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'WA_NUMBER_CONFIRMATION_AUDIT_APPEND_ONLY' using errcode = '42501'; end; $$;
create trigger wa_f5_events_append_only before update or delete on private.whatsapp_link_number_confirmation_events
  for each row execute function private.wa_f5_events_append_only();

-- (1a) Require a fresh decision whenever a link becomes verified / changes generation or number.
create function private.wa_f5_require_number_confirmation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified'
     or old.generation is distinct from new.generation
     or old.provider_phone_number_id is distinct from new.provider_phone_number_id) then
    insert into private.whatsapp_link_number_confirmations (link_id, link_generation, company_id, status, phone_number_id, display_number)
    values (new.id, new.generation, new.company_id, 'pending', new.provider_phone_number_id, new.verified_display_number)
    on conflict (link_id, link_generation) do update set status = 'pending', phone_number_id = excluded.phone_number_id,
      display_number = excluded.display_number, required_at = clock_timestamp(), decided_at = null, decided_by = null, decided_session_id = null;
    insert into private.whatsapp_link_number_confirmation_events (company_id, link_id, link_generation, event, phone_number_id, display_number)
    values (new.company_id, new.id, new.generation, 'required', new.provider_phone_number_id, new.verified_display_number);
  elsif new.status = 'verified' and old.verified_display_number is distinct from new.verified_display_number then
    update private.whatsapp_link_number_confirmations set display_number = new.verified_display_number
    where link_id = new.id and link_generation = new.generation and status in ('pending', 'legacy_unconfirmed');
  end if;
  return null;
end; $$;
revoke all on function private.wa_f5_require_number_confirmation() from public, anon, authenticated, service_role;
create trigger wa_f5_require_number_confirmation
  after insert or update on public.whatsapp_company_links
  for each row execute function private.wa_f5_require_number_confirmation();

-- Send-gate setting (single row). Default = enforce. Only service-side SQL may change it.
create table private.wa_number_gate_settings (
  singleton boolean primary key default true check (singleton),
  enforce boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);
insert into private.wa_number_gate_settings (singleton, enforce) values (true, true);
alter table private.wa_number_gate_settings enable row level security;
revoke all on private.wa_number_gate_settings from public, anon, authenticated, service_role;

-- Backfill: every link already verified is legacy_unconfirmed (no exemption).
insert into private.whatsapp_link_number_confirmations (link_id, link_generation, company_id, status, phone_number_id, display_number)
select l.id, l.generation, l.company_id, 'legacy_unconfirmed', l.provider_phone_number_id, l.verified_display_number
  from public.whatsapp_company_links l where l.status = 'verified'
on conflict (link_id, link_generation) do nothing;
insert into private.whatsapp_link_number_confirmation_events (company_id, link_id, link_generation, event, phone_number_id, display_number)
select l.company_id, l.id, l.generation, 'legacy_required', l.provider_phone_number_id, l.verified_display_number
  from public.whatsapp_company_links l where l.status = 'verified';

-- Fail closed: unconfirmed unless an explicit `confirmed` row exists for this link generation.
-- (Missing row = unconfirmed.) Setting row missing => enforce.
create function private.wa_f5_number_unconfirmed(p_link_id uuid, p_generation bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.enforce from private.wa_number_gate_settings s where s.singleton), true)
     and not exists (select 1 from private.whatsapp_link_number_confirmations c
       where c.link_id = p_link_id and c.link_generation = p_generation and c.status = 'confirmed');
$$;
revoke all on function private.wa_f5_number_unconfirmed(uuid, bigint) from public, anon, authenticated, service_role;

-- (1b) Gate both claim entry points (wrapper pattern used by earlier migrations).
alter function public.claim_whatsapp_send_attempt(uuid, uuid, integer) set schema private;
alter function private.claim_whatsapp_send_attempt(uuid, uuid, integer) rename to wa_f5_pre_number_gate_claim_staff;
revoke all on function private.wa_f5_pre_number_gate_claim_staff(uuid, uuid, integer) from public, anon, authenticated, service_role;
create function public.claim_whatsapp_send_attempt(p_intent_id uuid, p_actor_user_id uuid, p_lease_seconds integer default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.whatsapp_send_intents%rowtype;
begin
  select * into i from public.whatsapp_send_intents where id = p_intent_id;
  if found and i.outcome = 'ready' and private.wa_f5_number_unconfirmed(i.link_id, i.link_generation) then
    return jsonb_build_object('ok', false, 'code', 'number_unconfirmed');
  end if;
  return private.wa_f5_pre_number_gate_claim_staff(p_intent_id, p_actor_user_id, p_lease_seconds);
end; $$;
revoke all on function public.claim_whatsapp_send_attempt(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_send_attempt(uuid, uuid, integer) to service_role;

alter function public.whatsapp_claim_assistant_job_send(uuid, uuid) set schema private;
alter function private.whatsapp_claim_assistant_job_send(uuid, uuid) rename to wa_f5_pre_number_gate_claim_assistant;
revoke all on function private.wa_f5_pre_number_gate_claim_assistant(uuid, uuid) from public, anon, authenticated, service_role;
create function public.whatsapp_claim_assistant_job_send(p_job_id uuid, p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.whatsapp_send_intents%rowtype;
begin
  select s.* into i from public.whatsapp_inbound_jobs j join public.whatsapp_send_intents s
    on s.id = j.send_intent_id and s.company_id = j.company_id where j.id = p_job_id;
  if found and i.outcome = 'ready' and private.wa_f5_number_unconfirmed(i.link_id, i.link_generation) then
    return jsonb_build_object('ok', false, 'code', 'number_unconfirmed');
  end if;
  return private.wa_f5_pre_number_gate_claim_assistant(p_job_id, p_claim_token);
end; $$;
revoke all on function public.whatsapp_claim_assistant_job_send(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_claim_assistant_job_send(uuid, uuid) to service_role;

-- (1c) Defense in depth: any other path (e.g. review sends) cannot start an attempt either.
create function private.wa_f5_block_unconfirmed_attempt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.outcome = 'attempting' and old.outcome is distinct from 'attempting'
     and private.wa_f5_number_unconfirmed(new.link_id, new.link_generation) then
    raise exception 'WA_NUMBER_UNCONFIRMED' using errcode = 'P0001';
  end if;
  return new;
end; $$;
revoke all on function private.wa_f5_block_unconfirmed_attempt() from public, anon, authenticated, service_role;
create trigger wa_f5_block_unconfirmed_attempt before update of outcome on public.whatsapp_send_intents
  for each row execute function private.wa_f5_block_unconfirmed_attempt();

-- (1d) Owner read + decision.
create function public.whatsapp_read_number_confirmation(p_company_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare sid uuid; l public.whatsapp_company_links%rowtype; c private.whatsapp_link_number_confirmations%rowtype;
begin
  begin sid := (auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end;
  if not private.whatsapp_signup_owner_valid(p_company_id, auth.uid(), sid) then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into l from public.whatsapp_company_links where company_id = p_company_id;
  if l.id is null then return jsonb_build_object('ok', true, 'status', 'not_required'); end if;
  select * into c from private.whatsapp_link_number_confirmations where link_id = l.id and link_generation = l.generation;
  -- legacy_unconfirmed is reported as pending so the owner prompt is shown; a verified link
  -- with no row (should not happen after backfill) is also pending (fail closed).
  return jsonb_build_object('ok', true, 'status', case when c.status in ('pending', 'legacy_unconfirmed') then 'pending'
      when c.status is not null then c.status when l.status = 'verified' then 'pending' else 'not_required' end,
    'legacy', coalesce(c.status = 'legacy_unconfirmed', false), 'link_id', l.id, 'link_generation', l.generation,
    'link_status', l.status, 'decided_at', c.decided_at);
end; $$;
revoke all on function public.whatsapp_read_number_confirmation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_read_number_confirmation(uuid) to authenticated;

create function public.whatsapp_decide_number_confirmation(p_company_id uuid, p_link_id uuid, p_link_generation bigint, p_answer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sid uuid; uid uuid := auth.uid(); l public.whatsapp_company_links%rowtype; c private.whatsapp_link_number_confirmations%rowtype; d jsonb;
begin
  begin sid := (auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end;
  if p_answer is null or p_answer not in ('confirmed', 'rejected') or p_link_id is null or p_link_generation is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT'); end if;
  perform 1 from public.companies where id = p_company_id for update;
  if not private.whatsapp_signup_owner_valid(p_company_id, uid, sid) then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into c from private.whatsapp_link_number_confirmations
   where company_id = p_company_id and link_id = p_link_id and link_generation = p_link_generation for update;
  if c.link_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_REQUIRED'); end if;
  if c.status not in ('pending', 'legacy_unconfirmed') then
    -- Idempotent replay of the same decision; a different decision is a conflict.
    if c.status = p_answer then return jsonb_build_object('ok', true, 'status', c.status, 'replayed', true); end if;
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DECIDED', 'status', c.status);
  end if;
  select * into l from public.whatsapp_company_links where company_id = p_company_id and id = p_link_id;
  if l.id is null or l.generation is distinct from p_link_generation or l.status <> 'verified' then
    return jsonb_build_object('ok', false, 'code', 'STALE_LINK'); end if;
  if p_answer = 'confirmed' then
    update private.whatsapp_link_number_confirmations set status = 'confirmed', decided_at = clock_timestamp(), decided_by = uid, decided_session_id = sid
     where link_id = c.link_id and link_generation = c.link_generation;
    insert into private.whatsapp_link_number_confirmation_events (company_id, link_id, link_generation, event, actor_user_id, session_id, phone_number_id, display_number)
    values (p_company_id, p_link_id, p_link_generation, 'confirmed', uid, sid, l.provider_phone_number_id, l.verified_display_number);
    return jsonb_build_object('ok', true, 'status', 'confirmed');
  end if;
  -- Rejection: existing local-only disconnect paths (no Meta/Graph call, no deregistration).
  if l.keep_on_phone then d := public.whatsapp_coexistence_disconnect(p_company_id);
  else d := public.whatsapp_disconnect_embedded_signup(p_company_id); end if;
  if d->>'ok' is distinct from 'true' then
    insert into private.whatsapp_link_number_confirmation_events (company_id, link_id, link_generation, event, actor_user_id, session_id, detail)
    values (p_company_id, p_link_id, p_link_generation, 'disconnect_failed', uid, sid, jsonb_build_object('code', d->>'code'));
    return jsonb_build_object('ok', false, 'code', 'DISCONNECT_FAILED');
  end if;
  update private.whatsapp_link_number_confirmations set status = 'rejected', decided_at = clock_timestamp(), decided_by = uid, decided_session_id = sid
   where link_id = c.link_id and link_generation = c.link_generation;
  -- Retire the es02 binding so the branch can start a new attempt (canStart via terminal 'rejected').
  update private.es02_b3_connection_attempts a set status = 'rejected'
   where a.company_id = p_company_id and a.channel = 'whatsapp' and a.status = 'bound'
     and exists (select 1 from private.es02_b3_connection_links b where b.attempt_id = a.id and b.legacy_link_id = p_link_id
       and b.status = 'active' and b.revoked_at is null);
  update private.es02_b3_connection_links set verified = false
   where company_id = p_company_id and channel = 'whatsapp' and legacy_link_id = p_link_id and status = 'active' and revoked_at is null;
  insert into private.whatsapp_link_number_confirmation_events (company_id, link_id, link_generation, event, actor_user_id, session_id, phone_number_id, display_number, detail)
  values (p_company_id, p_link_id, p_link_generation, 'rejected', uid, sid, l.provider_phone_number_id, l.verified_display_number,
    jsonb_build_object('disconnect', d->>'ok', 'keep_on_phone', l.keep_on_phone));
  return jsonb_build_object('ok', true, 'status', 'rejected', 'disconnected', true);
end; $$;
revoke all on function public.whatsapp_decide_number_confirmation(uuid, uuid, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_decide_number_confirmation(uuid, uuid, bigint, text) to authenticated;

-- (1e) Retry after rejection: es02 links are never revoked elsewhere, and
-- es02_b3_one_active_branch_channel would reject the new attempt's binding.
-- Only a binding whose attempt was number-rejected is retired, at the moment
-- a newer binding for the same branch/channel is inserted.
create function private.wa_f5_retire_rejected_binding() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.channel = 'whatsapp' and new.status = 'active' and new.revoked_at is null then
    update private.es02_b3_connection_links b set status = 'revoked', revoked_at = clock_timestamp()
     where b.channel = 'whatsapp' and b.status = 'active' and b.revoked_at is null and b.id is distinct from new.id
       and (b.branch_id = new.branch_id or (new.legacy_link_id is not null and b.legacy_link_id = new.legacy_link_id))
       and exists (select 1 from private.es02_b3_connection_attempts a where a.id = b.attempt_id and a.status = 'rejected');
  end if;
  return new;
end; $$;
revoke all on function private.wa_f5_retire_rejected_binding() from public, anon, authenticated, service_role;
create trigger wa_f5_retire_rejected_binding before insert on private.es02_b3_connection_links
  for each row execute function private.wa_f5_retire_rejected_binding();

-- (2) Resume: re-issue the stored launch of an existing pending attempt. Never creates.
create function public.es02_b3_resume_owned_branch_launch(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_attempt_id uuid, p_session_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; sid uuid; a private.es02_b3_connection_attempts%rowtype; observed jsonb;
begin
  actor := private.es02_require_active_actor(p_expected_account_id);
  begin sid := (auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid := null; end;
  if actor is null or actor is distinct from auth.uid() or sid is null or sid is distinct from p_session_id
     or not private.es02_b3_session_open(actor, sid) then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  observed := private.es02_b3_current_binding(actor, p_company_id, p_branch_id, 'whatsapp');
  if observed->>'ok' is distinct from 'true' then return jsonb_build_object('ok', false, 'code', coalesce(observed->>'code', 'conflict')); end if;
  select * into a from private.es02_b3_connection_attempts
   where id = p_attempt_id and account_id = actor and company_id = p_company_id and branch_id = p_branch_id and channel = 'whatsapp';
  if a.id is null or a.flow not in ('wa_new_number', 'wa_coexistence') or a.status <> 'pending' or a.expires_at <= clock_timestamp()
     or a.session_id is distinct from sid or a.launch_nonce is null or not private.es02_b3_pin_matches(a, observed)
     -- must still be the newest attempt for this actor/branch/channel
     or exists (select 1 from private.es02_b3_connection_attempts n where n.company_id = a.company_id and n.branch_id = a.branch_id
          and n.channel = a.channel and n.account_id = actor and (n.created_at, n.id) > (a.created_at, a.id))
     or (a.flow = 'wa_new_number' and not exists (select 1 from public.whatsapp_embedded_signup_attempts w
          where w.id = a.legacy_attempt_id and w.status = 'in_progress' and w.consumed_at is null))
     or (a.flow = 'wa_coexistence' and not exists (select 1 from private.whatsapp_coexistence_signup_attempts w
          where w.id = a.legacy_attempt_id and w.status = 'started' and w.consumed_at is null)) then
    return jsonb_build_object('ok', false, 'code', 'not_resumable');
  end if;
  return jsonb_build_object('ok', true, 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, 'whatsapp'), 'launch', private.es02_b3_launch(a));
end; $$;
revoke all on function public.es02_b3_resume_owned_branch_launch(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.es02_b3_resume_owned_branch_launch(uuid, uuid, uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

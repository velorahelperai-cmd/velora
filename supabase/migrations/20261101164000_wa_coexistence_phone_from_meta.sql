-- Coexistence: the WhatsApp Business App number is entered inside Meta's own
-- Embedded Signup steps, not in Velora before Meta opens. The expected number is
-- now OPTIONAL at start and DERIVED from Meta's server-verified proof
-- (waba_id + phone_number_id -> display_phone_number read server-side).
-- Security stays meaningful:
--  * if a number IS supplied (legacy clients / review-restricted replacement), it is
--    still validated (E.164) and must match Meta's proof exactly;
--  * if none is supplied, the checkpoint proof's canonical display number is
--    written once to expected_phone_number (immutable afterwards), so finalize,
--    the NOT NULL connection row, projection and sync keep exact-number checks;
--  * the customer is shown the linked number returned by Meta for confirmation.
-- NOT APPLIED. Review before `supabase db push`.

alter table private.whatsapp_coexistence_signup_attempts alter column expected_phone_number drop not null;

create or replace function private.whatsapp_coexistence_proof(p_app_id text,p_expected_phone text,p_proof jsonb,p_subscribed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare exp bigint;data_exp bigint;deadline timestamptz;verified timestamptz;display text;begin
  if p_proof is null or jsonb_typeof(p_proof) is distinct from 'object' or octet_length(p_proof::text)>16384
    or (p_proof-array['app_id','waba_id','phone_number_id','display_phone_number','scopes','granular_scopes','expires_at','data_access_expires_at','authorization_expires_at','platform_type','is_on_biz_app','subscribed','verified_at'])<>'{}'::jsonb
    or p_proof->>'app_id' is distinct from p_app_id
    or coalesce(p_proof->>'waba_id','')!~'^[0-9]{1,64}$' or coalesce(p_proof->>'phone_number_id','')!~'^[0-9]{1,64}$'
    or p_proof->>'platform_type' is distinct from 'CLOUD_API' or p_proof->'is_on_biz_app' is distinct from 'true'::jsonb
    or p_proof->'subscribed' is distinct from to_jsonb(p_subscribed)
    or jsonb_typeof(p_proof->'scopes') is distinct from 'array'
    or jsonb_typeof(p_proof->'granular_scopes') is distinct from 'array'
    then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if jsonb_array_length(p_proof->'scopes')>32 or jsonb_array_length(p_proof->'granular_scopes')>64
    or not(p_proof->'scopes' @> '["whatsapp_business_management","whatsapp_business_messaging"]'::jsonb)
    or exists(select 1 from jsonb_array_elements(p_proof->'scopes') s where jsonb_typeof(s)<>'string' or length(s#>>'{}')>64)
    or exists(select 1 from jsonb_array_elements(p_proof->'granular_scopes') g where jsonb_typeof(g)<>'object'
      or (g-array['scope','target_ids'])<>'{}'::jsonb or jsonb_typeof(g->'scope') is distinct from 'string'
      or jsonb_typeof(g->'target_ids') is distinct from 'array')
    then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if exists(select 1 from jsonb_array_elements(p_proof->'granular_scopes') g where jsonb_array_length(g->'target_ids')>100
    or exists(select 1 from jsonb_array_elements(g->'target_ids') t where jsonb_typeof(t)<>'string' or (t#>>'{}')!~'^[0-9]{1,64}$'))
    or not exists(select 1 from jsonb_array_elements(p_proof->'granular_scopes') g where g->>'scope'='whatsapp_business_management' and g->'target_ids' @> jsonb_build_array(p_proof->>'waba_id'))
    or not exists(select 1 from jsonb_array_elements(p_proof->'granular_scopes') g where g->>'scope'='whatsapp_business_messaging' and g->'target_ids' @> jsonb_build_array(p_proof->>'waba_id'))
    then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  display:=p_proof->>'display_phone_number';
  if display is null or length(display)>40 or display!~'^[+0-9() -]+$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  display:=regexp_replace(display,'[() -]','','g');if left(display,1)<>'+' then display:='+'||display;end if;
  if p_expected_phone is not null and display is distinct from p_expected_phone then return jsonb_build_object('ok',false,'code','META_ASSET_REJECTED');end if;
  begin
    if jsonb_typeof(p_proof->'expires_at') is distinct from 'number' or jsonb_typeof(p_proof->'data_access_expires_at') is distinct from 'number'
      or coalesce(p_proof->>'expires_at','')!~'^[0-9]{1,16}$' or coalesce(p_proof->>'data_access_expires_at','')!~'^[0-9]{1,16}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
    exp:=(p_proof->>'expires_at')::bigint;data_exp:=(p_proof->>'data_access_expires_at')::bigint;
    deadline:=case when exp=0 and data_exp=0 then null when exp=0 then to_timestamp(data_exp) when data_exp=0 then to_timestamp(exp) else to_timestamp(least(exp,data_exp)) end;
    verified:=(p_proof->>'verified_at')::timestamptz;
    if (deadline is not null and deadline<=clock_timestamp()) or (p_proof->>'authorization_expires_at')::timestamptz is distinct from deadline
      or verified is null or not isfinite(verified) or verified<clock_timestamp()-interval '5 minutes' or verified>clock_timestamp()+interval '1 minute' then
      return jsonb_build_object('ok',false,'code','META_AUTHORIZATION_REJECTED');end if;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end;
  return jsonb_build_object('ok',true,'deadline',deadline,'non_expiring',exp=0 and data_exp=0,'verified_at',verified);
end; $$;

create or replace function public.whatsapp_coexistence_start_signup(p_company_id uuid,p_attempt_id uuid,p_nonce text,p_expected_phone_number text,p_app_id text,p_config_id text,p_graph_version text,p_keep_on_phone boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;gen bigint;deadline timestamptz;begin
  begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
  perform 1 from public.companies where id=p_company_id for update;
  if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if public.whatsapp_coexistence_signup_readiness(p_company_id)->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
  if p_attempt_id is null or p_nonce is null or p_nonce!~'^[0-9a-f]{64}$' or p_keep_on_phone is distinct from true
    or (p_expected_phone_number is not null and p_expected_phone_number!~'^\+[1-9][0-9]{6,14}$')
    or p_app_id is null or p_app_id!~'^[0-9]{1,64}$' or p_config_id is null or p_config_id!~'^[0-9]{1,64}$'
    or p_graph_version is null or p_graph_version!~'^v[0-9]+\.0$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  -- Reconnect and uncertain provider steps require deliberate reconciliation;
  -- starting another window never silently cancels an in-flight mutation.
  if exists(select 1 from public.whatsapp_company_links where company_id=p_company_id and status='verified')
    or exists(select 1 from private.whatsapp_coexistence_connections where company_id=p_company_id)
    or exists(select 1 from private.whatsapp_coexistence_signup_attempts where company_id=p_company_id and status in ('claimed','token_checkpointed','reconcile_required')) then
    return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
  update private.whatsapp_coexistence_signup_attempts set status='cancelled',consumed_at=clock_timestamp() where company_id=p_company_id and status='started';
  select generation into gen from public.whatsapp_company_links where company_id=p_company_id for update;
  deadline:=clock_timestamp()+interval '10 minutes';
  insert into private.whatsapp_coexistence_signup_attempts(id,company_id,user_id,session_id,nonce_hash,expected_phone_number,app_id,config_id,graph_version,base_link_generation,expires_at)
    values(p_attempt_id,p_company_id,auth.uid(),sid,pg_catalog.sha256(pg_catalog.convert_to(p_nonce,'UTF8')),p_expected_phone_number,p_app_id,p_config_id,p_graph_version,gen,deadline);
  return jsonb_build_object('ok',true,'company_id',p_company_id,'attempt_id',p_attempt_id,'nonce',p_nonce,'expected_phone_number',p_expected_phone_number,'expires_at',deadline);
end; $$;

-- Derive the expected number from the verified checkpoint proof (never overwrites a supplied number).
create or replace function private.whatsapp_coexistence_derive_expected_phone() returns trigger
language plpgsql security definer set search_path='' as $$
declare display text;begin
  if new.expected_phone_number is null and new.checkpoint_proof is not null then
    display:=new.checkpoint_proof->>'display_phone_number';
    if display is not null and length(display)<=40 and display~'^[+0-9() -]+$' then
      display:=regexp_replace(display,'[() -]','','g');if left(display,1)<>'+' then display:='+'||display;end if;
      if display~'^\+[1-9][0-9]{6,14}$' then new.expected_phone_number:=display;end if;
    end if;
  end if;
  if old.expected_phone_number is not null and new.expected_phone_number is distinct from old.expected_phone_number then
    raise exception 'WA_COEX_EXPECTED_PHONE_IMMUTABLE' using errcode='23514';
  end if;
  return new;
end $$;
alter function private.whatsapp_coexistence_derive_expected_phone() owner to postgres;
revoke all on function private.whatsapp_coexistence_derive_expected_phone() from public,anon,authenticated,service_role;
drop trigger if exists whatsapp_coexistence_derive_expected_phone on private.whatsapp_coexistence_signup_attempts;
create trigger whatsapp_coexistence_derive_expected_phone before update on private.whatsapp_coexistence_signup_attempts
  for each row execute function private.whatsapp_coexistence_derive_expected_phone();

create or replace function public.es02_b3_start_owned_branch_connection(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_channel text, p_flow text,
  p_client_op_id uuid, p_expected_revision text, p_confirmed_phone_number text,
  p_app_id text, p_config_id text, p_graph_version text, p_nonce text, p_oauth_state text,
  p_contract_id text, p_session_id uuid, p_confirmed boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  sid uuid;
  reason text;
  fingerprint text;
  existing private.es02_b3_connection_attempts%rowtype;
  scope private.es02_b3_connection_scope%rowtype;
  rights private.es02_branch_slot_rights%rowtype;
  started jsonb;
  attempt_id uuid;
  legacy_generation bigint;
  denial text;
  observed jsonb;
begin
  actor := private.es02_require_active_actor(p_expected_account_id);
  begin sid := (auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid := null; end;
  if actor is null or actor is distinct from auth.uid() or sid is null or sid is distinct from p_session_id
     or not private.es02_b3_session_open(actor, sid) then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'read', private.es02_b3_unavailable(p_expected_account_id, p_company_id, p_branch_id, p_channel, 'unauthenticated'));
  end if;
  if p_channel not in ('whatsapp', 'instagram')
     or (p_channel = 'whatsapp' and p_flow not in ('wa_new_number', 'wa_coexistence'))
     or (p_channel = 'instagram' and p_flow is distinct from 'instagram_direct')
     or p_expected_revision is null or p_expected_revision !~ '^(0|[1-9][0-9]{0,18})$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, 'invalid_input'));
  end if;
  if p_flow = 'wa_coexistence' and p_confirmed_phone_number is not null and (p_confirmed is distinct from true or p_confirmed_phone_number !~ '^\+[1-9][0-9]{6,14}$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, 'invalid_input'));
  end if;
  if p_flow <> 'wa_coexistence' and p_confirmed_phone_number is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, 'invalid_input'));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(87420303, pg_catalog.hashtext(p_company_id::text || ':' || p_channel));
  observed := private.es02_b3_current_binding(actor, p_company_id, p_branch_id, p_channel);
  if observed->>'ok' is distinct from 'true' then
    return jsonb_build_object('ok', false, 'code', observed->>'code', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, observed->>'code'));
  end if;
  fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'account', actor, 'company', p_company_id, 'branch', p_branch_id, 'channel', p_channel,
    'flow', p_flow, 'revision', p_expected_revision, 'phone', p_confirmed_phone_number, 'confirmed', p_confirmed
  )::text, 'UTF8')), 'hex');
  select * into existing from private.es02_b3_connection_attempts
  where account_id = actor and client_op_id = p_client_op_id
  for update;
  if existing.id is not null then
    if existing.fingerprint = fingerprint and existing.branch_id = p_branch_id and existing.flow = p_flow
       and existing.session_id = sid and private.es02_b3_pin_matches(existing, observed) then
      return jsonb_build_object('ok', true, 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel), 'launch', private.es02_b3_launch(existing));
    end if;
    return jsonb_build_object('ok', false, 'code', 'conflict', 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
  end if;
  insert into private.es02_b3_connection_scope (company_id, branch_id, channel)
  values (p_company_id, p_branch_id, p_channel)
  on conflict (company_id, branch_id, channel) do nothing;
  select * into scope from private.es02_b3_connection_scope
  where company_id = p_company_id and branch_id = p_branch_id and channel = p_channel
  for update;
  if scope.revision::text is distinct from p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'stale_scope', 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
  end if;
  if exists (
    select 1 from private.es02_b3_connection_links
    where company_id = p_company_id and channel = p_channel and branch_id is distinct from p_branch_id and status = 'active' and revoked_at is null
  ) or exists (
    select 1 from private.es02_b3_connection_attempts
    where company_id = p_company_id and channel = p_channel and branch_id is distinct from p_branch_id
      and status in ('pending', 'claimed', 'vault_staged', 'unknown')
  ) then
    return jsonb_build_object('ok', false, 'code', 'conflict', 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
  end if;
  if p_channel = 'whatsapp' and (
    exists (select 1 from public.whatsapp_company_links l where l.company_id = p_company_id and not exists (
      select 1 from private.es02_b3_connection_links b where b.legacy_link_id = l.id and b.channel = 'whatsapp' and b.revoked_at is null))
    or exists (select 1 from public.whatsapp_embedded_signup_attempts w where w.company_id = p_company_id and w.status in ('in_progress', 'code_received')
      and not exists (select 1 from private.es02_b3_connection_attempts b where b.legacy_attempt_id = w.id))
    or exists (select 1 from private.whatsapp_coexistence_signup_attempts w where w.company_id = p_company_id and w.status in ('started', 'claimed', 'token_checkpointed', 'reconcile_required')
      and not exists (select 1 from private.es02_b3_connection_attempts b where b.legacy_attempt_id = w.id))
  ) or p_channel = 'instagram' and (
    exists (select 1 from private.instagram_company_links l where l.company_id = p_company_id and l.status = 'active' and not exists (
      select 1 from private.es02_b3_connection_links b where b.legacy_link_id = l.id and b.channel = 'instagram' and b.revoked_at is null))
    or exists (select 1 from private.instagram_oauth_attempts w where w.company_id = p_company_id and w.status in ('pending', 'claimed', 'vault_staged', 'unknown')
      and not exists (select 1 from private.es02_b3_connection_attempts b where b.legacy_attempt_id = w.id))
  ) then
    return jsonb_build_object('ok', false, 'code', 'legacy_ambiguous', 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
  end if;
  if p_flow = 'instagram_direct' then
    if p_oauth_state is null or p_oauth_state !~ '^[a-f0-9]{64}$' or p_app_id is null or p_contract_id is null then
      return jsonb_build_object('ok', false, 'code', 'setup_required', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, 'setup_required'));
    end if;
  elsif p_nonce is null or p_nonce !~ '^[a-f0-9]{64}$' or p_app_id is null or p_app_id !~ '^[0-9]{1,64}$'
     or p_config_id is null or p_config_id !~ '^[0-9]{1,64}$' or p_graph_version is null or p_graph_version !~ '^v[0-9]+\.0$' then
    return jsonb_build_object('ok', false, 'code', 'setup_required', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, 'setup_required'));
  end if;
  attempt_id := gen_random_uuid();
  begin
    if p_flow = 'wa_new_number' then
      started := public.whatsapp_start_embedded_signup(p_company_id, attempt_id, p_nonce, false, p_app_id, p_config_id, p_graph_version);
      select generation into legacy_generation from public.whatsapp_company_links where company_id = p_company_id;
    elsif p_flow = 'wa_coexistence' then
      started := public.whatsapp_coexistence_start_signup(p_company_id, attempt_id, p_nonce, p_confirmed_phone_number, p_app_id, p_config_id, p_graph_version, true);
      select base_link_generation into legacy_generation from private.whatsapp_coexistence_signup_attempts where id = attempt_id;
    else
      select coalesce(g.attempt_generation, 0) into legacy_generation
      from private.instagram_company_generations g where g.company_id = p_company_id;
      if not found then legacy_generation := 0; end if;
      started := public.instagram_start_connection(p_company_id, attempt_id, encode(sha256(convert_to(p_oauth_state, 'UTF8')), 'hex'), p_app_id, p_contract_id, legacy_generation);
      legacy_generation := (started->'binding'->>'generation')::bigint;
    end if;
    if started->>'ok' is distinct from 'true' then
      denial := lower(coalesce(started->>'code', 'source_failed'));
      raise exception 'ES02_B3_LEGACY_DENIED' using errcode = 'P0001';
    end if;
    insert into private.es02_b3_connection_attempts (
      id, account_id, company_id, branch_id, channel, flow, client_op_id, fingerprint, revision, generation,
      order_id, slot_index, selection_id, selection_fingerprint, paid_fingerprint, legacy_attempt_id, legacy_generation, session_id, app_id, config_id, graph_version,
      contract_id, confirmed_phone, launch_nonce, launch_state, nonce_hash, oauth_state_hash, status, expires_at
    ) values (
      attempt_id, actor, p_company_id, p_branch_id, p_channel, p_flow, p_client_op_id, fingerprint, p_expected_revision,
      scope.revision + 1, (observed->>'orderId')::uuid, (observed->>'slotIndex')::integer,
      (observed->>'selectionId')::uuid, observed->>'selectionFingerprint', observed->>'paidFingerprint',
      attempt_id, legacy_generation, sid, p_app_id, p_config_id,
      p_graph_version, p_contract_id, p_confirmed_phone_number, p_nonce, p_oauth_state,
      case when p_nonce is null then null else encode(sha256(convert_to(p_nonce, 'UTF8')), 'hex') end,
      case when p_oauth_state is null then null else encode(sha256(convert_to(p_oauth_state, 'UTF8')), 'hex') end,
      'pending', clock_timestamp() + interval '10 minutes'
    );
    update private.es02_b3_connection_scope set revision = revision + 1
    where company_id = p_company_id and branch_id = p_branch_id and channel = p_channel;
  exception when others then
    return jsonb_build_object('ok', false, 'code', coalesce(denial, 'conflict'), 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
  end;
  select * into existing from private.es02_b3_connection_attempts where id = attempt_id;
  return jsonb_build_object('ok', true, 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel), 'launch', private.es02_b3_launch(existing));
end;
$$;

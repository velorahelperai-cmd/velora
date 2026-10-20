-- Filename: 20261020012749_es02_b3_branch_channel_connection.sql
-- Additive branch-bound channel bridge. Does not edit installed migrations.
-- Checkpoint and Instagram subscription claim revalidate the immutable B3
-- binding and current paid right in the same transaction as the legacy call.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regrole('postgres') is null
     or to_regprocedure('private.es02_require_active_actor(uuid)') is null
     or to_regprocedure('public.whatsapp_start_embedded_signup(uuid,uuid,text,boolean,text,text,text)') is null
     or to_regprocedure('public.whatsapp_claim_embedded_signup(uuid,uuid,text)') is null
     or to_regprocedure('public.whatsapp_finalize_embedded_signup(uuid,uuid,uuid,text,jsonb)') is null
     or to_regprocedure('public.whatsapp_cancel_embedded_signup(uuid,uuid,text)') is null
     or to_regprocedure('public.whatsapp_coexistence_start_signup(uuid,uuid,text,text,text,text,text,boolean)') is null
     or to_regprocedure('public.whatsapp_coexistence_claim_signup(uuid,uuid,text)') is null
     or to_regprocedure('public.whatsapp_coexistence_checkpoint_signup(uuid,uuid,uuid,text,jsonb)') is null
     or to_regprocedure('public.whatsapp_coexistence_finalize_signup(uuid,uuid,uuid,jsonb)') is null
     or to_regprocedure('public.whatsapp_coexistence_cancel_signup(uuid,uuid,text)') is null
     or to_regprocedure('public.instagram_start_connection(uuid,uuid,text,text,text,bigint)') is null
     or to_regprocedure('public.instagram_claim_connection(jsonb,text)') is null
     or to_regprocedure('public.instagram_stage_connection(jsonb,text,jsonb)') is null
     or to_regprocedure('public.instagram_finalize_connection(jsonb,uuid)') is null
     or to_regprocedure('public.instagram_cancel_owner_oauth(jsonb,text)') is null
     or to_regprocedure('public.instagram_claim_subscription(jsonb,uuid)') is null
     or to_regprocedure('private.es02_authority_footprint_ok()') is null
     or to_regprocedure('private.es02_catalog_slot(text,text,text)') is null
     or to_regprocedure('private.es02_order_catalog_consistent(private.es02_account_orders)') is null
     or to_regprocedure('private.master_identity_session_current(uuid,uuid)') is null
     or to_regclass('private.es02_activation_foundation') is null
     or to_regclass('private.es02_branch_slot_rights') is null
     or to_regclass('private.es02_account_provisioning') is null
     or to_regclass('private.es02_branch_channel_selections') is null
     or to_regclass('private.instagram_subscription_attempts') is null
     or to_regclass('public.vel_broker_sessions') is null
     or to_regclass('public.vel_broker_browser_lineages') is null
     or to_regclass('public.whatsapp_company_links') is null
     or to_regclass('private.whatsapp_coexistence_connections') is null
     or to_regclass('private.instagram_company_links') is null
     or to_regclass('private.instagram_oauth_attempts') is null then
    raise exception 'ES02_B3_BASELINE_MISSING';
  end if;
end;
$guard$;

create table private.es02_b3_connection_scope (
  company_id uuid not null,
  branch_id uuid not null,
  channel text not null check (channel in ('whatsapp', 'instagram')),
  revision bigint not null default 0 check (revision >= 0),
  primary key (company_id, branch_id, channel)
);

create table private.es02_b3_connection_attempts (
  id uuid primary key,
  account_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  channel text not null check (channel in ('whatsapp', 'instagram')),
  flow text not null check (flow in ('wa_new_number', 'wa_coexistence', 'instagram_direct')),
  client_op_id uuid not null,
  fingerprint text not null,
  revision text not null,
  generation integer not null check (generation >= 1),
  order_id uuid not null,
  slot_index integer not null,
  selection_id uuid not null,
  selection_fingerprint text not null,
  paid_fingerprint text not null,
  legacy_attempt_id uuid not null,
  legacy_generation bigint,
  session_id uuid not null,
  app_id text,
  config_id text,
  graph_version text,
  contract_id text,
  confirmed_phone text,
  launch_nonce text,
  launch_state text,
  nonce_hash text,
  oauth_state_hash text,
  status text not null check (status in ('pending', 'claimed', 'vault_staged', 'bound', 'unknown', 'rejected', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (account_id, client_op_id)
);

create unique index es02_b3_one_open_attempt
  on private.es02_b3_connection_attempts (branch_id, channel)
  where status in ('pending', 'claimed', 'vault_staged', 'unknown');

create table private.es02_b3_connection_links (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique,
  company_id uuid not null,
  branch_id uuid not null,
  channel text not null check (channel in ('whatsapp', 'instagram')),
  legacy_link_id uuid,
  legacy_generation bigint,
  verified boolean not null default false,
  revoked_at timestamptz,
  status text not null check (status in ('active', 'revoked')),
  created_at timestamptz not null default clock_timestamp()
);

create unique index es02_b3_one_active_branch_channel
  on private.es02_b3_connection_links (branch_id, channel)
  where status = 'active' and revoked_at is null;

create unique index es02_b3_one_active_legacy_link
  on private.es02_b3_connection_links (channel, legacy_link_id)
  where status = 'active' and revoked_at is null and legacy_link_id is not null;

alter table private.es02_b3_connection_scope owner to postgres;
alter table private.es02_b3_connection_attempts owner to postgres;
alter table private.es02_b3_connection_links owner to postgres;
alter table private.es02_b3_connection_scope enable row level security;
alter table private.es02_b3_connection_attempts enable row level security;
alter table private.es02_b3_connection_links enable row level security;
revoke all on private.es02_b3_connection_scope from public, anon, authenticated, service_role;
revoke all on private.es02_b3_connection_attempts from public, anon, authenticated, service_role;
revoke all on private.es02_b3_connection_links from public, anon, authenticated, service_role;

-- Lock order for every authenticated and service_role phase, including both backends:
-- 1. session and browser lineage (es02_require_active_actor / es02_b3_session_open)
-- 2. company member, company, branch, order, provisioning, foundation, slot right, selection
-- 3. the B3 attempt row
-- Service phases use this same order. They do not lock the attempt before the session or these rows.
create function private.es02_b3_current_binding(p_account uuid, p_company uuid, p_branch uuid, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  company public.companies%rowtype;
  branch public.company_branches%rowtype;
  rights private.es02_branch_slot_rights%rowtype;
  ord private.es02_account_orders%rowtype;
  sel private.es02_branch_channel_selections%rowtype;
  rights_count integer;
  foundation_group uuid;
  foundation_account uuid;
  foundation_order uuid;
  payment_at timestamptz;
  clock_state text;
  catalog jsonb;
  stored jsonb;
  paid_fingerprint text;
  order_hint text;
begin
  if p_channel not in ('whatsapp', 'instagram') then return jsonb_build_object('ok', false, 'code', 'invalid_input'); end if;
  if private.es02_authority_footprint_ok() is distinct from true then return jsonb_build_object('ok', false, 'code', 'source_failed'); end if;
  perform 1 from public.company_members m
  where m.company_id = p_company and m.user_id = p_account and m.role = 'owner' and m.status = 'active'
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  select * into company from public.companies where id = p_company for update;
  if company.id is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if (company.status is distinct from 'setup' and company.status is distinct from 'active')
     or nullif(to_jsonb(company)->>'archived_at', '') is not null
     or nullif(to_jsonb(company)->>'setup_file_destruction_at', '') is not null then
    return jsonb_build_object('ok', false, 'code', 'suspended');
  end if;
  select * into branch from public.company_branches where company_id = p_company and id = p_branch for update;
  if branch.id is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if branch.status is distinct from 'setup' and branch.status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'suspended');
  end if;
  select r.order_id::text into order_hint from private.es02_branch_slot_rights r
  where r.company_id = p_company and r.branch_id = p_branch
  order by r.order_id
  limit 1;
  if order_hint is null then
    perform 1 from private.es02_branch_slot_rights r
    where r.company_id = p_company and r.branch_id = p_branch
    for update;
    return jsonb_build_object('ok', false, 'code', 'unpaid');
  end if;
  select * into ord from private.es02_account_orders where id = order_hint::uuid for update;
  if ord.id is null or ord.account_id is distinct from p_account then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if ord.provisioned_company_id is distinct from p_company or ord.original_order_group_id is null then return jsonb_build_object('ok', false, 'code', 'source_failed'); end if;
  if ord.status in ('open', 'collection_pending', 'failed', 'cancelled') then return jsonb_build_object('ok', false, 'code', 'unpaid'); end if;
  if ord.status is distinct from 'provisioned' or ord.provisioned_company_id is null then return jsonb_build_object('ok', false, 'code', 'unpaid'); end if;
  perform 1 from private.es02_account_provisioning p
  where p.order_id = ord.id and p.account_id = p_account and p.company_id = p_company and p.state = 'completed'
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'unpaid'); end if;
  if private.es02_order_catalog_consistent(ord) is distinct from true then return jsonb_build_object('ok', false, 'code', 'source_failed'); end if;
  select a.order_group_id, a.account_id, a.order_id, a.payment_confirmed_at, a.clock_state
    into foundation_group, foundation_account, foundation_order, payment_at, clock_state
  from private.es02_activation_foundation a
  where a.company_id = p_company and a.order_id = ord.id
  for update;
  if foundation_group is null
     or foundation_group is distinct from ord.original_order_group_id
     or foundation_account is distinct from p_account
     or foundation_order is distinct from ord.id
     or payment_at is null
     or clock_state not in ('waiting_readiness', 'active', 'ended') then
    return jsonb_build_object('ok', false, 'code', 'source_failed');
  end if;
  perform r.id from private.es02_branch_slot_rights r
  where r.company_id = p_company and r.branch_id = p_branch
  order by r.order_id, r.slot_index
  for update;
  select count(*) into rights_count from private.es02_branch_slot_rights r
  where r.company_id = p_company and r.branch_id = p_branch;
  if rights_count > 1 then return jsonb_build_object('ok', false, 'code', 'conflict'); end if;
  if rights_count = 0 then return jsonb_build_object('ok', false, 'code', 'unpaid'); end if;
  select * into rights from private.es02_branch_slot_rights r
  where r.company_id = p_company and r.branch_id = p_branch for update;
  if rights.order_id::text is distinct from order_hint then return jsonb_build_object('ok', false, 'code', 'source_failed'); end if;
  if rights.term is distinct from ord.term
     or rights.persona not in ('level_1', 'level_2', 'level_3')
     or rights.package not in ('basic', 'premium')
     or rights.term not in ('monthly', 'yearly')
     or rights.slot_index < 0
     or rights.slot_index >= 32
     or (rights.package = 'basic' and (rights.channels <> 1 or rights.employees <> 2))
     or (rights.package = 'premium' and (rights.channels <> 2 or rights.employees <> 4)) then
    return jsonb_build_object('ok', false, 'code', 'source_failed');
  end if;
  catalog := private.es02_catalog_slot(rights.persona, rights.package, rights.term);
  if catalog is null
     or (catalog->>'persona') is distinct from rights.persona
     or (catalog->>'package') is distinct from rights.package
     or (catalog->>'term') is distinct from rights.term
     or (catalog->>'amount_baisa')::integer is distinct from rights.amount_baisa
     or (catalog->>'replies_per_month')::integer is distinct from rights.replies_per_month
     or (catalog->>'employees')::integer is distinct from rights.employees
     or (catalog->>'channels')::integer is distinct from rights.channels then
    return jsonb_build_object('ok', false, 'code', 'source_failed');
  end if;
  if ord.slots is null or jsonb_typeof(ord.slots) is distinct from 'array' or rights.slot_index >= jsonb_array_length(ord.slots) then
    return jsonb_build_object('ok', false, 'code', 'source_failed');
  end if;
  stored := ord.slots -> rights.slot_index;
  if stored is null
     or jsonb_typeof(stored) is distinct from 'object'
     or (stored->>'slotIndex')::integer is distinct from rights.slot_index
     or (stored->>'persona') is distinct from rights.persona
     or (stored->>'package') is distinct from rights.package
     or (stored->>'amountBaisa')::integer is distinct from rights.amount_baisa
     or (stored->>'repliesPerMonth')::integer is distinct from rights.replies_per_month
     or (stored->>'employees')::integer is distinct from rights.employees
     or (stored->>'channels')::integer is distinct from rights.channels then
    return jsonb_build_object('ok', false, 'code', 'source_failed');
  end if;
  select * into sel from private.es02_branch_channel_selections
  where company_id = p_company and branch_id = p_branch and account_id = p_account
  for update;
  if sel.id is null then return jsonb_build_object('ok', false, 'code', 'selection_required'); end if;
  if not (sel.channels ? p_channel) then return jsonb_build_object('ok', false, 'code', 'channel_not_selected'); end if;
  if sel.order_id is distinct from rights.order_id or sel.slot_index is distinct from rights.slot_index then
    return jsonb_build_object('ok', false, 'code', 'source_failed');
  end if;
  paid_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'order', rights.order_id, 'slot', rights.slot_index, 'persona', rights.persona, 'package', rights.package,
    'term', rights.term, 'amount', rights.amount_baisa, 'channels', rights.channels, 'employees', rights.employees,
    'group', foundation_group, 'selection', sel.id, 'selectionFingerprint', sel.request_fingerprint
  )::text, 'UTF8')), 'hex');
  return jsonb_build_object(
    'ok', true, 'orderId', rights.order_id, 'slotIndex', rights.slot_index,
    'selectionId', sel.id, 'selectionFingerprint', sel.request_fingerprint, 'paidFingerprint', paid_fingerprint
  );
end;
$$;

create function private.es02_b3_paid_right(p_account uuid, p_company uuid, p_branch uuid, p_channel text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare observed jsonb;
begin
  observed := private.es02_b3_current_binding(p_account, p_company, p_branch, p_channel);
  if observed->>'ok' = 'true' then return null; end if;
  return observed->>'code';
end;
$$;

create function private.es02_b3_pin_matches(a private.es02_b3_connection_attempts, observed jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select a.order_id = (observed->>'orderId')::uuid
    and a.slot_index = (observed->>'slotIndex')::integer
    and a.selection_id = (observed->>'selectionId')::uuid
    and a.selection_fingerprint = observed->>'selectionFingerprint'
    and a.paid_fingerprint = observed->>'paidFingerprint';
$$;

create function private.es02_b3_session_open(p_account uuid, p_session uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  native auth.sessions%rowtype;
  tip_id uuid;
  tip_lineage uuid;
  tip_native uuid;
  tip_status text;
  root_registry uuid;
  root_state text;
  root_valid timestamptz;
begin
  if private.es02_authority_footprint_ok() is distinct from true then return false; end if;
  if p_account is null or p_session is null then return false; end if;
  if not exists (
    select 1 from auth.users u where u.id = p_account and u.email_confirmed_at is not null
  ) then
    return false;
  end if;
  select * into native from auth.sessions where id = p_session and user_id = p_account for share;
  if native.id is null then return false; end if;
  if native.not_after is not null and native.not_after <= clock_timestamp() then return false; end if;
  if private.master_identity_session_current(p_account, p_session) is distinct from true then return false; end if;
  execute $q$
    select id, browser_lineage_id, native_session_id, status
    from public.vel_broker_sessions
    where native_session_id = $1 and user_id = $2 and status = 'active'
    order by last_seen_at desc nulls last
    limit 1
  $q$ into tip_id, tip_lineage, tip_native, tip_status using p_session, p_account;
  if tip_id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(tip_lineage::text, 0));
  execute $q$
    select current_registry_id, state, valid_until
    from public.vel_broker_browser_lineages
    where id = $1 for update
  $q$ into root_registry, root_state, root_valid using tip_lineage;
  if root_registry is null or root_state is distinct from 'active' then return false; end if;
  if root_valid is not null and root_valid <= clock_timestamp() then return false; end if;
  if root_registry is distinct from tip_id then return false; end if;
  execute $q$
    select native_session_id, status from public.vel_broker_sessions where id = $1 for share
  $q$ into tip_native, tip_status using tip_id;
  return tip_status = 'active' and tip_native = p_session;
end;
$$;

create function private.es02_b3_unavailable(p_account uuid, p_company uuid, p_branch uuid, p_channel text, p_reason text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'sourceStatus', 'unavailable',
    'expectedAccountId', coalesce(p_account, '00000000-0000-0000-0000-000000000000'::uuid),
    'companyId', coalesce(p_company, '00000000-0000-0000-0000-000000000000'::uuid),
    'branchId', coalesce(p_branch, '00000000-0000-0000-0000-000000000000'::uuid),
    'channel', case when p_channel in ('whatsapp', 'instagram') then p_channel else 'whatsapp' end,
    'asOf', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revision', null,
    'connection', jsonb_build_object(
      'state', 'unavailable', 'flow', null, 'attempt', null, 'link', null,
      'verified', false, 'reasonCodes', jsonb_build_array(p_reason)
    )
  );
$$;

create function private.es02_b3_project(p_account uuid, p_company uuid, p_branch uuid, p_channel text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  scope private.es02_b3_connection_scope%rowtype;
  attempt private.es02_b3_connection_attempts%rowtype;
  link private.es02_b3_connection_links%rowtype;
  wa public.whatsapp_company_links%rowtype;
  ig private.instagram_company_links%rowtype;
  state text := 'not_connected';
  verified boolean := false;
  reasons jsonb := '[]'::jsonb;
  flow text := null;
  live boolean := false;
begin
  select * into scope from private.es02_b3_connection_scope
  where company_id = p_company and branch_id = p_branch and channel = p_channel;
  select * into attempt from private.es02_b3_connection_attempts
  where company_id = p_company and branch_id = p_branch and channel = p_channel and account_id = p_account
  order by created_at desc, id desc limit 1;
  select * into link from private.es02_b3_connection_links
  where company_id = p_company and branch_id = p_branch and channel = p_channel and status = 'active' and revoked_at is null
  order by created_at desc limit 1;
  if attempt.id is not null then flow := attempt.flow; end if;
  if link.id is not null and attempt.id is not null and link.attempt_id = attempt.id
     and link.legacy_link_id is not null and link.legacy_generation is not null
     and attempt.legacy_generation is not distinct from link.legacy_generation then
    if attempt.flow = 'wa_coexistence' then
      select * into wa from public.whatsapp_company_links where company_id = p_company and id = link.legacy_link_id;
      live := wa.id is not null and wa.generation = link.legacy_generation
        and wa.authorization_app_id is not distinct from attempt.app_id
        and wa.authorization_session_id is not distinct from attempt.session_id
        and wa.status = 'verified' and wa.authorization_status = 'active' and wa.keep_on_phone
        and wa.authorization_app_id is not null and wa.authorization_user_id is not null and wa.authorization_session_id is not null
        and wa.authorization_verified_at is not null and wa.authorization_verified_at <= clock_timestamp()
        and wa.inbound_tested_at is not null and wa.outbound_tested_at is not null
        and (wa.authorization_expires_at > clock_timestamp() or (wa.authorization_expires_at is null and wa.authorization_non_expiring))
        and exists (
          select 1 from private.whatsapp_coexistence_connections c
          where c.company_id = p_company and c.link_id = wa.id and c.link_generation = wa.generation
            and c.status = 'active' and c.waba_id = wa.provider_waba_id and c.phone_number_id = wa.provider_phone_number_id
        );
      verified := live;
    elsif attempt.flow = 'wa_new_number' and p_channel = 'whatsapp' then
      select * into wa from public.whatsapp_company_links where company_id = p_company and id = link.legacy_link_id;
      verified := wa.id is not null and wa.generation = link.legacy_generation
        and wa.authorization_app_id is not distinct from attempt.app_id
        and wa.authorization_session_id is not distinct from attempt.session_id
        and wa.status = 'verified' and wa.authorization_status = 'active' and wa.keep_on_phone is false
        and wa.authorization_app_id is not null and wa.access_secret_id is not null
        and (wa.authorization_expires_at > clock_timestamp() or (wa.authorization_expires_at is null and wa.authorization_non_expiring));
    elsif attempt.flow = 'instagram_direct' and p_channel = 'instagram' then
      select * into ig from private.instagram_company_links where id = link.legacy_link_id and company_id = p_company;
      verified := ig.id is not null and ig.status = 'active' and ig.generation = link.legacy_generation
        and ig.attempt_id is not distinct from attempt.legacy_attempt_id
        and ig.app_id is not distinct from attempt.app_id
        and ig.contract_id is not distinct from attempt.contract_id
        and ig.authorization_expires_at > clock_timestamp()
        and exists (
          select 1 from private.instagram_subscription_attempts s
          where s.attempt_id = ig.attempt_id and s.state = 'verified'
            and s.generation = ig.generation and s.app_id = ig.app_id and s.account_id = ig.account_id
        );
    end if;
    state := case when verified then 'connected' when attempt.status = 'unknown' then 'reconciliation_required' else 'pending' end;
    if state = 'reconciliation_required' then reasons := jsonb_build_array('reconciliation_required'); end if;
  elsif attempt.status in ('pending', 'claimed', 'vault_staged') then
    state := 'pending';
  elsif attempt.status = 'unknown' then
    state := 'reconciliation_required';
    reasons := jsonb_build_array('reconciliation_required');
  elsif exists (
    select 1 from private.es02_b3_connection_links other
    where other.company_id = p_company and other.channel = p_channel and other.branch_id is distinct from p_branch
      and other.status = 'active' and other.revoked_at is null
  ) or exists (
    select 1 from public.whatsapp_company_links l
    where p_channel = 'whatsapp' and l.company_id = p_company
      and not exists (
        select 1 from private.es02_b3_connection_links b
        where b.company_id = p_company and b.channel = 'whatsapp' and b.legacy_link_id = l.id and b.revoked_at is null
      )
  ) or exists (
    select 1 from private.instagram_company_links l
    where p_channel = 'instagram' and l.company_id = p_company and l.status = 'active'
      and not exists (
        select 1 from private.es02_b3_connection_links b
        where b.company_id = p_company and b.channel = 'instagram' and b.legacy_link_id = l.id and b.revoked_at is null
      )
  ) then
    state := 'legacy_ambiguous';
    reasons := jsonb_build_array('legacy_ambiguous');
  end if;
  return jsonb_build_object(
    'schemaVersion', 1,
    'sourceStatus', 'ready',
    'expectedAccountId', p_account,
    'companyId', p_company,
    'branchId', p_branch,
    'channel', p_channel,
    'asOf', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revision', coalesce(scope.revision, 0)::text,
    'connection', jsonb_build_object(
      'state', state,
      'flow', flow,
      'attempt', case when attempt.id is null then null else jsonb_build_object(
        'id', attempt.id, 'generation', attempt.generation,
        'expiresAt', to_char(attempt.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'status', attempt.status
      ) end,
      'link', case when link.id is null or link.legacy_generation is null then null else jsonb_build_object('id', link.id, 'generation', link.legacy_generation) end,
      'verified', verified,
      'reasonCodes', reasons
    )
  );
end;
$$;

create function private.es02_b3_launch(a private.es02_b3_connection_attempts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when a.flow = 'instagram_direct' then jsonb_build_object('flow', a.flow, 'attemptId', a.id, 'state', a.launch_state)
    when a.flow = 'wa_coexistence' then jsonb_build_object(
      'flow', a.flow, 'attemptId', a.id, 'nonce', a.launch_nonce, 'appId', a.app_id,
      'configId', a.config_id, 'graphVersion', a.graph_version, 'confirmedPhoneNumber', a.confirmed_phone)
    else jsonb_build_object(
      'flow', a.flow, 'attemptId', a.id, 'nonce', a.launch_nonce, 'appId', a.app_id,
      'configId', a.config_id, 'graphVersion', a.graph_version)
  end;
$$;

create function public.es02_b3_read_owned_branch_connection(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_channel text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid; observed jsonb; pinned private.es02_b3_connection_attempts%rowtype;
begin
  actor := private.es02_require_active_actor(p_expected_account_id);
  if actor is null or actor is distinct from auth.uid() then
    return private.es02_b3_unavailable(p_expected_account_id, p_company_id, p_branch_id, p_channel, 'unauthenticated');
  end if;
  if p_channel not in ('whatsapp', 'instagram') then
    return private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, 'invalid_input');
  end if;
  observed := private.es02_b3_current_binding(actor, p_company_id, p_branch_id, p_channel);
  if observed->>'ok' is distinct from 'true' then
    return private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, observed->>'code');
  end if;
  select * into pinned from private.es02_b3_connection_attempts
  where account_id = actor and company_id = p_company_id and branch_id = p_branch_id and channel = p_channel
  order by created_at desc limit 1
  for share;
  if pinned.id is not null and not private.es02_b3_pin_matches(pinned, observed) then
    return private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, 'conflict');
  end if;
  return private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel);
end;
$$;

create function public.es02_b3_start_owned_branch_connection(
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
  if p_flow = 'wa_coexistence' and (p_confirmed is distinct from true or p_confirmed_phone_number is null or p_confirmed_phone_number !~ '^\+[1-9][0-9]{6,14}$') then
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

create function public.es02_b3_claim_owned_branch_connection(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_channel text, p_flow text,
  p_attempt_id uuid, p_generation integer, p_nonce text, p_oauth_state text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  sid uuid;
  a private.es02_b3_connection_attempts%rowtype;
  reason text;
  claimed jsonb;
  binding jsonb;
  fresh boolean := false;
  observed jsonb;
begin
  actor := private.es02_require_active_actor(p_expected_account_id);
  begin sid := (auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid := null; end;
  if actor is null or sid is null or not private.es02_b3_session_open(actor, sid) then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'read', private.es02_b3_unavailable(p_expected_account_id, p_company_id, p_branch_id, p_channel, 'unauthenticated'));
  end if;
  observed := private.es02_b3_current_binding(actor, p_company_id, p_branch_id, p_channel);
  if observed->>'ok' is distinct from 'true' then
    return jsonb_build_object('ok', false, 'code', observed->>'code', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, observed->>'code'));
  end if;
  select * into a from private.es02_b3_connection_attempts
  where id = p_attempt_id and account_id = actor and company_id = p_company_id and branch_id = p_branch_id
    and channel = p_channel and flow = p_flow and generation = p_generation and session_id = sid
  for update;
  if a.id is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, 'forbidden'));
  end if;
  if not private.es02_b3_pin_matches(a, observed) then
    return jsonb_build_object('ok', false, 'code', 'conflict', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, 'conflict'));
  end if;
  if a.status in ('claimed', 'vault_staged', 'bound', 'unknown') then
    return jsonb_build_object('ok', true, 'fresh', false, 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
  end if;
  if a.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'expired', 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
  end if;
  if p_flow = 'instagram_direct' then
    if p_oauth_state is null or encode(sha256(convert_to(p_oauth_state, 'UTF8')), 'hex') is distinct from a.oauth_state_hash then
      return jsonb_build_object('ok', false, 'code', 'forbidden', 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
    end if;
    binding := jsonb_build_object('companyId', a.company_id, 'userId', a.account_id, 'sessionId', a.session_id, 'attemptId', a.id, 'generation', a.legacy_generation, 'appId', a.app_id, 'contractId', a.contract_id);
    claimed := public.instagram_claim_connection(binding, p_oauth_state);
    fresh := claimed->>'kind' = 'claimed' and claimed->>'committed' = 'true';
  elsif p_nonce is null or encode(sha256(convert_to(p_nonce, 'UTF8')), 'hex') is distinct from a.nonce_hash then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
  elsif p_flow = 'wa_coexistence' then
    claimed := public.whatsapp_coexistence_claim_signup(p_company_id, a.legacy_attempt_id, p_nonce);
    fresh := claimed->>'ok' = 'true';
  else
    claimed := public.whatsapp_claim_embedded_signup(p_company_id, a.legacy_attempt_id, p_nonce);
    fresh := claimed->>'ok' = 'true';
  end if;
  if not fresh then
    return jsonb_build_object('ok', false, 'code', 'reconciliation_required', 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
  end if;
  update private.es02_b3_connection_attempts set status = 'claimed' where id = a.id;
  return jsonb_build_object('ok', true, 'fresh', true, 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel), 'legacy', claimed);
end;
$$;

create function public.es02_b3_checkpoint_owned_branch_connection(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_channel text, p_flow text,
  p_attempt_id uuid, p_generation integer, p_session_id uuid, p_user_id uuid, p_access_token text, p_proof jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a private.es02_b3_connection_attempts%rowtype;
  observed jsonb;
  legacy jsonb;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'SERVER_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if not private.es02_b3_session_open(p_expected_account_id, p_session_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  observed := private.es02_b3_current_binding(p_expected_account_id, p_company_id, p_branch_id, p_channel);
  if observed->>'ok' is distinct from 'true' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  select * into a from private.es02_b3_connection_attempts
  where id = p_attempt_id and legacy_attempt_id = p_attempt_id and account_id = p_expected_account_id
    and company_id = p_company_id and branch_id = p_branch_id and channel = p_channel and flow = p_flow
    and generation = p_generation and session_id = p_session_id and account_id = p_user_id
    and flow = 'wa_coexistence' and status = 'claimed'
  for update;
  if a.id is null or not private.es02_b3_pin_matches(a, observed) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  legacy := public.whatsapp_coexistence_checkpoint_signup(a.legacy_attempt_id, p_user_id, p_session_id, p_access_token, p_proof);
  if legacy->>'ok' = 'true' then
    update private.es02_b3_connection_attempts set status = 'vault_staged' where id = a.id and status = 'claimed';
  elsif a.status = 'claimed' then
    update private.es02_b3_connection_attempts set status = 'unknown' where id = a.id and status = 'claimed';
  end if;
  return legacy;
end;
$$;

create function public.es02_b3_claim_instagram_subscription(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_channel text, p_flow text,
  p_attempt_id uuid, p_generation integer, p_session_id uuid, p_binding jsonb, p_stage_receipt uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a private.es02_b3_connection_attempts%rowtype;
  observed jsonb;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'SERVER_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_channel is distinct from 'instagram' or p_flow is distinct from 'instagram_direct'
     or not private.es02_b3_session_open(p_expected_account_id, p_session_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  observed := private.es02_b3_current_binding(p_expected_account_id, p_company_id, p_branch_id, 'instagram');
  if observed->>'ok' is distinct from 'true' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  select * into a from private.es02_b3_connection_attempts
  where id = p_attempt_id and account_id = p_expected_account_id and company_id = p_company_id
    and branch_id = p_branch_id and channel = 'instagram' and flow = 'instagram_direct'
    and generation = p_generation and session_id = p_session_id and status in ('vault_staged', 'bound')
  for update;
  if a.id is null or not private.es02_b3_pin_matches(a, observed)
     or lower(p_binding->>'companyId') is distinct from a.company_id::text
     or lower(p_binding->>'userId') is distinct from a.account_id::text
     or lower(p_binding->>'sessionId') is distinct from a.session_id::text
     or lower(p_binding->>'attemptId') is distinct from a.id::text
     or p_binding->>'appId' is distinct from a.app_id
     or p_binding->>'contractId' is distinct from a.contract_id
     or p_binding->>'generation' is distinct from a.legacy_generation::text
     or p_stage_receipt is null then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  return public.instagram_claim_subscription(p_binding, p_stage_receipt);
end;
$$;

create function public.es02_b3_stage_owned_branch_connection(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_channel text, p_flow text,
  p_attempt_id uuid, p_generation integer, p_session_id uuid, p_access_token text, p_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a private.es02_b3_connection_attempts%rowtype;
  observed jsonb;
  binding jsonb;
  staged jsonb;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'SERVER_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if not private.es02_b3_session_open(p_expected_account_id, p_session_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  observed := private.es02_b3_current_binding(p_expected_account_id, p_company_id, p_branch_id, p_channel);
  if observed->>'ok' is distinct from 'true' then
    return jsonb_build_object('ok', false, 'code', observed->>'code');
  end if;
  select * into a from private.es02_b3_connection_attempts
  where id = p_attempt_id and account_id = p_expected_account_id and company_id = p_company_id
    and branch_id = p_branch_id and channel = p_channel and flow = p_flow and generation = p_generation
    and session_id = p_session_id and flow = 'instagram_direct' and status = 'claimed'
  for update;
  if a.id is null or not private.es02_b3_pin_matches(a, observed) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  binding := jsonb_build_object('companyId', a.company_id, 'userId', a.account_id, 'sessionId', a.session_id, 'attemptId', a.id, 'generation', a.legacy_generation, 'appId', a.app_id, 'contractId', a.contract_id);
  staged := public.instagram_stage_connection(binding, p_access_token, p_evidence);
  if staged->>'stageReceipt' is null then
    update private.es02_b3_connection_attempts set status = 'unknown' where id = a.id and status = 'claimed';
    return jsonb_build_object('ok', false, 'code', 'reconciliation_required');
  end if;
  update private.es02_b3_connection_attempts set status = 'vault_staged' where id = a.id;
  return jsonb_build_object('ok', true, 'stageReceipt', staged->>'stageReceipt');
end;
$$;

create function public.es02_b3_finalize_owned_branch_connection(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_channel text, p_flow text,
  p_attempt_id uuid, p_generation integer, p_session_id uuid, p_access_token text, p_proof jsonb, p_stage_receipt text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a private.es02_b3_connection_attempts%rowtype;
  observed jsonb;
  legacy jsonb;
  binding jsonb;
  link_id uuid;
  link_generation bigint;
  verified boolean := false;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'SERVER_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if not private.es02_b3_session_open(p_expected_account_id, p_session_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'read', private.es02_b3_unavailable(p_expected_account_id, p_company_id, p_branch_id, p_channel, 'forbidden'));
  end if;
  observed := private.es02_b3_current_binding(p_expected_account_id, p_company_id, p_branch_id, p_channel);
  if observed->>'ok' is distinct from 'true' then
    return jsonb_build_object('ok', false, 'code', observed->>'code', 'read', private.es02_b3_unavailable(p_expected_account_id, p_company_id, p_branch_id, p_channel, observed->>'code'));
  end if;
  select * into a from private.es02_b3_connection_attempts
  where id = p_attempt_id and account_id = p_expected_account_id and company_id = p_company_id
    and branch_id = p_branch_id and channel = p_channel and flow = p_flow and generation = p_generation
    and session_id = p_session_id
  for update;
  if a.id is null or not private.es02_b3_pin_matches(a, observed) then
    return jsonb_build_object('ok', false, 'code', 'conflict', 'read', private.es02_b3_unavailable(p_expected_account_id, p_company_id, p_branch_id, p_channel, 'conflict'));
  end if;
  if a.status = 'bound' then
    return jsonb_build_object('ok', true, 'read', private.es02_b3_project(p_expected_account_id, p_company_id, p_branch_id, p_channel));
  end if;
  if p_flow = 'wa_new_number' then
    legacy := public.whatsapp_finalize_embedded_signup(a.legacy_attempt_id, a.account_id, a.session_id, p_access_token, p_proof);
    select id, generation into link_id, link_generation from public.whatsapp_company_links where company_id = p_company_id;
    verified := legacy->>'ok' = 'true';
  elsif p_flow = 'wa_coexistence' then
    legacy := public.whatsapp_coexistence_finalize_signup(a.legacy_attempt_id, a.account_id, a.session_id, p_proof);
    select id, generation into link_id, link_generation from public.whatsapp_company_links where company_id = p_company_id;
    verified := false;
  else
    binding := jsonb_build_object('companyId', a.company_id, 'userId', a.account_id, 'sessionId', a.session_id, 'attemptId', a.id, 'generation', a.legacy_generation, 'appId', a.app_id, 'contractId', a.contract_id);
    legacy := public.instagram_finalize_connection(binding, nullif(p_stage_receipt, '')::uuid);
    if legacy->>'ok' = 'true' then
      link_id := (legacy->>'linkId')::uuid;
      select generation into link_generation from private.instagram_company_links where id = link_id;
      verified := true;
    end if;
  end if;
  if legacy->>'ok' is distinct from 'true' or link_id is null or link_generation is null then
    update private.es02_b3_connection_attempts set status = 'unknown' where id = a.id and status in ('claimed', 'vault_staged');
    return jsonb_build_object('ok', false, 'code', 'reconciliation_required', 'read', private.es02_b3_project(p_expected_account_id, p_company_id, p_branch_id, p_channel));
  end if;
  insert into private.es02_b3_connection_links (attempt_id, company_id, branch_id, channel, legacy_link_id, legacy_generation, verified, status)
  values (a.id, p_company_id, p_branch_id, p_channel, link_id, link_generation, verified, 'active');
  update private.es02_b3_connection_attempts set status = 'bound', legacy_generation = link_generation where id = a.id;
  return jsonb_build_object('ok', true, 'read', private.es02_b3_project(p_expected_account_id, p_company_id, p_branch_id, p_channel));
end;
$$;

create function public.es02_b3_recover_owned_branch_connection(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_channel text, p_flow text,
  p_attempt_id uuid, p_generation integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid; sid uuid; observed jsonb; a private.es02_b3_connection_attempts%rowtype;
begin
  actor := private.es02_require_active_actor(p_expected_account_id);
  begin sid := (auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid := null; end;
  if actor is null or sid is null or not private.es02_b3_session_open(actor, sid) then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'read', private.es02_b3_unavailable(p_expected_account_id, p_company_id, p_branch_id, p_channel, 'unauthenticated'));
  end if;
  observed := private.es02_b3_current_binding(actor, p_company_id, p_branch_id, p_channel);
  if observed->>'ok' is distinct from 'true' then
    return jsonb_build_object('ok', false, 'code', observed->>'code', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, observed->>'code'));
  end if;
  select * into a from private.es02_b3_connection_attempts
  where id = p_attempt_id and account_id = actor and company_id = p_company_id and branch_id = p_branch_id
    and channel = p_channel and flow = p_flow and generation = p_generation and session_id = sid
  for share;
  if a.id is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, 'forbidden'));
  end if;
  if not private.es02_b3_pin_matches(a, observed) then
    return jsonb_build_object('ok', false, 'code', 'conflict', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, 'conflict'));
  end if;
  return jsonb_build_object('ok', true, 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
end;
$$;

create function public.es02_b3_cancel_owned_branch_connection(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid, p_channel text, p_flow text,
  p_attempt_id uuid, p_generation integer, p_oauth_state text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  sid uuid;
  a private.es02_b3_connection_attempts%rowtype;
  legacy jsonb;
  binding jsonb;
  observed jsonb;
begin
  actor := private.es02_require_active_actor(p_expected_account_id);
  begin sid := (auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid := null; end;
  if actor is null or sid is null or not private.es02_b3_session_open(actor, sid) then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'read', private.es02_b3_unavailable(p_expected_account_id, p_company_id, p_branch_id, p_channel, 'unauthenticated'));
  end if;
  observed := private.es02_b3_current_binding(actor, p_company_id, p_branch_id, p_channel);
  if observed->>'ok' is distinct from 'true' then
    return jsonb_build_object('ok', false, 'code', observed->>'code', 'read', private.es02_b3_unavailable(actor, p_company_id, p_branch_id, p_channel, observed->>'code'));
  end if;
  select * into a from private.es02_b3_connection_attempts
  where id = p_attempt_id and account_id = actor and company_id = p_company_id and branch_id = p_branch_id
    and channel = p_channel and flow = p_flow and generation = p_generation and session_id = sid
  for update;
  if a.id is null or a.status not in ('pending', 'claimed') or not private.es02_b3_pin_matches(a, observed) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
  end if;
  if p_flow = 'instagram_direct' then
    if p_oauth_state is null or p_oauth_state !~ '^[a-f0-9]{64}$'
       or encode(sha256(convert_to(p_oauth_state, 'UTF8')), 'hex') is distinct from a.oauth_state_hash then
      return jsonb_build_object('ok', false, 'code', 'forbidden', 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
    end if;
    binding := jsonb_build_object('companyId', a.company_id, 'userId', a.account_id, 'sessionId', a.session_id, 'attemptId', a.id, 'generation', a.legacy_generation, 'appId', a.app_id, 'contractId', a.contract_id);
    legacy := public.instagram_cancel_owner_oauth(binding, p_oauth_state);
  elsif p_flow = 'wa_coexistence' then
    legacy := public.whatsapp_coexistence_cancel_signup(p_company_id, a.legacy_attempt_id, a.launch_nonce);
  else
    legacy := public.whatsapp_cancel_embedded_signup(p_company_id, a.legacy_attempt_id, a.launch_nonce);
  end if;
  if coalesce(legacy->>'ok', 'false') is distinct from 'true' then
    return jsonb_build_object('ok', false, 'code', 'reconciliation_required', 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
  end if;
  update private.es02_b3_connection_attempts set status = 'cancelled' where id = a.id;
  return jsonb_build_object('ok', true, 'read', private.es02_b3_project(actor, p_company_id, p_branch_id, p_channel));
end;
$$;

create function public.es02_b3_classify_instagram_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare a private.es02_b3_connection_attempts%rowtype; actor uuid; sid uuid;
begin
  begin
    select * into a from private.es02_b3_connection_attempts where id = p_attempt_id and channel = 'instagram';
  exception when others then
    return jsonb_build_object('kind', 'unavailable');
  end;
  if a.id is null then return jsonb_build_object('kind', 'legacy'); end if;
  begin
    actor := private.es02_require_active_actor(auth.uid());
    begin sid := (auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid := null; end;
    if actor is null or sid is null or not private.es02_b3_session_open(actor, sid)
       or a.account_id is distinct from actor or a.session_id is distinct from sid then
      return jsonb_build_object('kind', 'unavailable');
    end if;
    if not exists (
      select 1 from public.company_members m
      where m.company_id = a.company_id and m.user_id = actor and m.role = 'owner' and m.status = 'active'
    ) then
      return jsonb_build_object('kind', 'unavailable');
    end if;
  exception when others then
    return jsonb_build_object('kind', 'unavailable');
  end;
  return jsonb_build_object(
    'kind', 'branch', 'expectedAccountId', actor, 'companyId', a.company_id, 'branchId', a.branch_id,
    'channel', 'instagram', 'generation', a.generation, 'flow', 'instagram_direct'
  );
end;
$$;

alter function private.es02_b3_current_binding(uuid, uuid, uuid, text) owner to postgres;
alter function private.es02_b3_paid_right(uuid, uuid, uuid, text) owner to postgres;
alter function private.es02_b3_pin_matches(private.es02_b3_connection_attempts, jsonb) owner to postgres;
alter function private.es02_b3_session_open(uuid, uuid) owner to postgres;
alter function private.es02_b3_unavailable(uuid, uuid, uuid, text, text) owner to postgres;
alter function private.es02_b3_project(uuid, uuid, uuid, text) owner to postgres;
alter function private.es02_b3_launch(private.es02_b3_connection_attempts) owner to postgres;
alter function public.es02_b3_read_owned_branch_connection(uuid, uuid, uuid, text) owner to postgres;
alter function public.es02_b3_start_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, text, text, text, text, text, text, text, text, uuid, boolean) owner to postgres;
alter function public.es02_b3_claim_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, text, text) owner to postgres;
alter function public.es02_b3_checkpoint_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, uuid, uuid, text, jsonb) owner to postgres;
alter function public.es02_b3_claim_instagram_subscription(uuid, uuid, uuid, text, text, uuid, integer, uuid, jsonb, uuid) owner to postgres;
alter function public.es02_b3_stage_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, uuid, text, jsonb) owner to postgres;
alter function public.es02_b3_finalize_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, uuid, text, jsonb, text) owner to postgres;
alter function public.es02_b3_recover_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer) owner to postgres;
alter function public.es02_b3_cancel_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, text) owner to postgres;
alter function public.es02_b3_classify_instagram_attempt(uuid) owner to postgres;

revoke all on function private.es02_b3_current_binding(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.es02_b3_paid_right(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.es02_b3_pin_matches(private.es02_b3_connection_attempts, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.es02_b3_session_open(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.es02_b3_unavailable(uuid, uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.es02_b3_project(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.es02_b3_launch(private.es02_b3_connection_attempts) from public, anon, authenticated, service_role;

revoke all on function public.es02_b3_read_owned_branch_connection(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.es02_b3_start_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, text, text, text, text, text, text, text, text, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.es02_b3_claim_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, text, text) from public, anon, authenticated, service_role;
revoke all on function public.es02_b3_recover_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.es02_b3_cancel_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.es02_b3_classify_instagram_attempt(uuid) from public, anon, authenticated, service_role;
grant execute on function public.es02_b3_read_owned_branch_connection(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.es02_b3_start_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, text, text, text, text, text, text, text, text, uuid, boolean) to authenticated;
grant execute on function public.es02_b3_claim_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, text, text) to authenticated;
grant execute on function public.es02_b3_recover_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer) to authenticated;
grant execute on function public.es02_b3_cancel_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, text) to authenticated;
grant execute on function public.es02_b3_classify_instagram_attempt(uuid) to authenticated;

revoke all on function public.es02_b3_checkpoint_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.es02_b3_claim_instagram_subscription(uuid, uuid, uuid, text, text, uuid, integer, uuid, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.es02_b3_stage_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.es02_b3_finalize_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.es02_b3_checkpoint_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.es02_b3_claim_instagram_subscription(uuid, uuid, uuid, text, text, uuid, integer, uuid, jsonb, uuid) to service_role;
grant execute on function public.es02_b3_stage_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, uuid, text, jsonb) to service_role;
grant execute on function public.es02_b3_finalize_owned_branch_connection(uuid, uuid, uuid, text, text, uuid, integer, uuid, text, jsonb, text) to service_role;
commit;

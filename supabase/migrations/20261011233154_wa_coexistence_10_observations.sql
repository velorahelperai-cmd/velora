-- DETERMINISTIC INSTALLATION TRANSACTION. Not approved or applied.
-- Input source SHA256: 707da6fc075009ccbf868e659f0cee623d2ee8ee1a6e6a2b5fcc1e0bdacdbabb
-- Migration version: 20261011233154; original source is unchanged between marked insertions.
-- REVIEW ARTIFACT ONLY. Not executed; not a generated migration filename.
-- Depends on the existing tenant-composite link identity and verified Meta asset
-- binding function from 20261008130000 / 20261008140000 / 20261008143000.
-- Receipts are normalized server-ingress evidence, not canonical inbox messages,
-- provider send receipts, imported-history completion or AI authorization.
-- Existing live inbound, service-window, send, usage and worker RPCs are untouched.
-- Lock/expiry review only: PostgreSQL concurrency behavior has not been executed
-- or verified. The adapter's RPC-double tests do not verify this SQL boundary.
begin;
-- BEGIN INSTALLATION HISTORY PREFLIGHT
set local standard_conforming_strings='on';
set local lock_timeout='2s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $wa_history_guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='20261011233154') then
  raise exception 'WA_INSTALLATION_HISTORY_VERSION_PRESENT: 20261011233154' using errcode='55000';
 end if;
end; $wa_history_guard$;
-- END INSTALLATION HISTORY PREFLIGHT


do $$ begin
  if to_regclass('public.whatsapp_company_links') is null
    or to_regprocedure('private.whatsapp_meta_asset_binding(text,text)') is null then
    raise exception 'COEXISTENCE_OBSERVATION_PREREQUISITES_MISSING';
  end if;
end; $$;

create table private.whatsapp_coexistence_observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  link_id uuid not null,
  link_generation bigint not null check (link_generation >= 1),
  waba_id text not null check (waba_id ~ '^[0-9]{1,64}$'),
  phone_number_id text not null check (phone_number_id ~ '^[0-9]{1,64}$'),
  kind text not null check (kind in ('history','mobile_echo')),
  customer_wa_id text not null check (char_length(customer_wa_id) between 1 and 128
    and customer_wa_id !~ '[[:space:][:cntrl:]]'),
  wa_message_id text not null check (char_length(wa_message_id) between 1 and 512
    and wa_message_id !~ '[[:space:][:cntrl:]]'),
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null check (message_type ~ '^[a-z][a-z0-9_]{0,31}$'),
  body text not null check (char_length(body) <= 4096 and octet_length(body) <= 16384),
  provider_occurred_at timestamptz not null check (isfinite(provider_occurred_at)
    and provider_occurred_at > '1970-01-01T00:00:00Z'::timestamptz),
  stored_at timestamptz not null default clock_timestamp(),
  projection_status text not null default 'pending' check (projection_status = 'pending'),
  constraint wa_coexistence_observation_echo_direction check (kind <> 'mobile_echo' or direction = 'outbound'),
  constraint wa_coexistence_observation_tenant_link_fk foreign key (company_id,link_id)
    references public.whatsapp_company_links(company_id,id),
  constraint wa_coexistence_observation_receipt_uid
    unique (company_id,link_id,link_generation,kind,phone_number_id,wa_message_id)
);
comment on table private.whatsapp_coexistence_observations is
  'Bounded normalized history/mobile-echo receipt ledger. Never stores OAuth codes, tokens, raw webhooks or arbitrary JSON. Canonical projection remains pending; no jobs, intents or live service-window evidence are created.';
comment on column private.whatsapp_coexistence_observations.projection_status is
  'Receipt stored only. Canonical associations and projection need a separately reviewed implementation; pending does not mean imported, visible in inbox, sent or delivered.';
create index wa_coexistence_observation_pending_idx
  on private.whatsapp_coexistence_observations(company_id,link_id,link_generation,stored_at,id);
alter table private.whatsapp_coexistence_observations enable row level security;
-- Intentionally no user policies or direct service-role table privileges.
revoke all on table private.whatsapp_coexistence_observations from public,anon,authenticated,service_role;

create function private.whatsapp_coexistence_observation_immutable()
returns trigger language plpgsql set search_path='' as $$ begin
  if new is distinct from old then
    raise exception 'COEXISTENCE_OBSERVATION_IMMUTABLE' using errcode='23514';
  end if;
  return new;
end; $$;
revoke all on function private.whatsapp_coexistence_observation_immutable()
  from public,anon,authenticated,service_role;
create trigger wa_coexistence_observation_immutable before update
  on private.whatsapp_coexistence_observations for each row
  execute function private.whatsapp_coexistence_observation_immutable();

create function public.whatsapp_record_coexistence_observation(
  p_company_id uuid,p_link_id uuid,p_link_generation bigint,p_waba_id text,p_phone_number_id text,
  p_kind text,p_customer_wa_id text,p_wa_message_id text,p_direction text,p_message_type text,
  p_body text,p_provider_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare gate jsonb;r private.whatsapp_coexistence_observations%rowtype;inserted boolean;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';
  end if;
  if p_company_id is null or p_link_id is null or p_link_generation is null or p_link_generation < 1
    or p_link_generation > 9007199254740991
    or p_waba_id is null or p_waba_id !~ '^[0-9]{1,64}$'
    or p_phone_number_id is null or p_phone_number_id !~ '^[0-9]{1,64}$'
    or p_kind is null or p_kind not in ('history','mobile_echo')
    or p_customer_wa_id is null or char_length(p_customer_wa_id) not between 1 and 128
    or p_customer_wa_id ~ '[[:space:][:cntrl:]]'
    or p_wa_message_id is null or char_length(p_wa_message_id) not between 1 and 512
    or p_wa_message_id ~ '[[:space:][:cntrl:]]'
    or p_direction is null or p_direction not in ('inbound','outbound')
    or (p_kind='mobile_echo' and p_direction <> 'outbound')
    or p_message_type is null or p_message_type !~ '^[a-z][a-z0-9_]{0,31}$'
    or p_body is null or char_length(p_body) > 4096 or octet_length(p_body) > 16384
    or p_provider_occurred_at is null or not isfinite(p_provider_occurred_at)
    or p_provider_occurred_at <= '1970-01-01T00:00:00Z'::timestamptz
    or p_provider_occurred_at > clock_timestamp()
    or p_provider_occurred_at <> date_trunc('milliseconds',p_provider_occurred_at) then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;

  -- Serialize all receipt writers for this company BEFORE testing authorization.
  -- Company -> link -> receipt is the existing worker/authorization lock order.
  -- Compatible SHARE locks alone would allow a second exact receipt to pass the
  -- expiry gate, wait at the unique index, then acknowledge after its token expiry.
  -- Every RPC writer now waits here; the fresh helper gate runs after that wait.
  -- Direct table writes remain denied, so there is no alternate supported writer.
  perform 1 from public.companies where id=p_company_id for no key update;
  if not found then return jsonb_build_object('ok',false,'code','CONNECTION_UNAVAILABLE');end if;

  -- Existing helper takes company -> link SHARE locks and checks current company
  -- suspension, verified WABA/phone, authorization/scopes/expiry and secret reference.
  -- The locks survive this function until transaction end, fencing reconnect/revoke.
  gate := private.whatsapp_meta_asset_binding(p_waba_id,p_phone_number_id);
  if gate->>'ok' is distinct from 'true'
    or gate->>'company_id' is distinct from p_company_id::text
    or gate->>'link_id' is distinct from p_link_id::text
    or gate->>'link_generation' is distinct from p_link_generation::text
    or gate->>'provider_waba_id' is distinct from p_waba_id
    or gate->>'provider_phone_number_id' is distinct from p_phone_number_id then
    return jsonb_build_object('ok',false,'code','CONNECTION_UNAVAILABLE');
  end if;

  -- Unique index serializes concurrent delivery of this logical receipt. Arrival
  -- time is deliberately excluded from identity; redelivery never refreshes it.
  insert into private.whatsapp_coexistence_observations(
    company_id,link_id,link_generation,waba_id,phone_number_id,kind,customer_wa_id,wa_message_id,
    direction,message_type,body,provider_occurred_at
  ) values (
    p_company_id,p_link_id,p_link_generation,p_waba_id,p_phone_number_id,p_kind,p_customer_wa_id,p_wa_message_id,
    p_direction,p_message_type,p_body,p_provider_occurred_at
  ) on conflict on constraint wa_coexistence_observation_receipt_uid do nothing returning * into r;
  inserted := found;
  if not inserted then
    select * into r from private.whatsapp_coexistence_observations
    where company_id=p_company_id and link_id=p_link_id and link_generation=p_link_generation
      and kind=p_kind and phone_number_id=p_phone_number_id and wa_message_id=p_wa_message_id for share;
    if not found then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
    -- Preserve the original durable receipt. Contradictory normalized redelivery
    -- is a conflict, not successful deduplication and never an overwrite.
    if row(r.waba_id,r.customer_wa_id,r.direction,r.message_type,r.body,r.provider_occurred_at)
      is distinct from row(p_waba_id,p_customer_wa_id,p_direction,p_message_type,p_body,p_provider_occurred_at) then
      return jsonb_build_object('ok',false,'code','IDENTITY_CONFLICT');
    end if;
  end if;
  return jsonb_build_object('ok',true,'receipt_id',r.id,'inserted',inserted,'duplicate',not inserted,
    'projection_status',r.projection_status,'company_id',r.company_id,'link_id',r.link_id,
    'link_generation',r.link_generation,'waba_id',r.waba_id,'phone_number_id',r.phone_number_id,
    'kind',r.kind,'wa_message_id',r.wa_message_id);
end; $$;
revoke all on function public.whatsapp_record_coexistence_observation(
  uuid,uuid,bigint,text,text,text,text,text,text,text,text,timestamptz
) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_record_coexistence_observation(
  uuid,uuid,bigint,text,text,text,text,text,text,text,text,timestamptz
) to service_role;
notify pgrst,'reload schema';

-- BEGIN INSTALLATION HISTORY RECORD
insert into supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key,rollback)
values('20261011233154',ARRAY['-- REVIEW ARTIFACT ONLY. Not executed; not a generated migration filename.
-- Depends on the existing tenant-composite link identity and verified Meta asset
-- binding function from 20261008130000 / 20261008140000 / 20261008143000.
-- Receipts are normalized server-ingress evidence, not canonical inbox messages,
-- provider send receipts, imported-history completion or AI authorization.
-- Existing live inbound, service-window, send, usage and worker RPCs are untouched.
-- Lock/expiry review only: PostgreSQL concurrency behavior has not been executed
-- or verified. The adapter''s RPC-double tests do not verify this SQL boundary.
begin;

do $$ begin
  if to_regclass(''public.whatsapp_company_links'') is null
    or to_regprocedure(''private.whatsapp_meta_asset_binding(text,text)'') is null then
    raise exception ''COEXISTENCE_OBSERVATION_PREREQUISITES_MISSING'';
  end if;
end; $$;

create table private.whatsapp_coexistence_observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  link_id uuid not null,
  link_generation bigint not null check (link_generation >= 1),
  waba_id text not null check (waba_id ~ ''^[0-9]{1,64}$''),
  phone_number_id text not null check (phone_number_id ~ ''^[0-9]{1,64}$''),
  kind text not null check (kind in (''history'',''mobile_echo'')),
  customer_wa_id text not null check (char_length(customer_wa_id) between 1 and 128
    and customer_wa_id !~ ''[[:space:][:cntrl:]]''),
  wa_message_id text not null check (char_length(wa_message_id) between 1 and 512
    and wa_message_id !~ ''[[:space:][:cntrl:]]''),
  direction text not null check (direction in (''inbound'',''outbound'')),
  message_type text not null check (message_type ~ ''^[a-z][a-z0-9_]{0,31}$''),
  body text not null check (char_length(body) <= 4096 and octet_length(body) <= 16384),
  provider_occurred_at timestamptz not null check (isfinite(provider_occurred_at)
    and provider_occurred_at > ''1970-01-01T00:00:00Z''::timestamptz),
  stored_at timestamptz not null default clock_timestamp(),
  projection_status text not null default ''pending'' check (projection_status = ''pending''),
  constraint wa_coexistence_observation_echo_direction check (kind <> ''mobile_echo'' or direction = ''outbound''),
  constraint wa_coexistence_observation_tenant_link_fk foreign key (company_id,link_id)
    references public.whatsapp_company_links(company_id,id),
  constraint wa_coexistence_observation_receipt_uid
    unique (company_id,link_id,link_generation,kind,phone_number_id,wa_message_id)
);
comment on table private.whatsapp_coexistence_observations is
  ''Bounded normalized history/mobile-echo receipt ledger. Never stores OAuth codes, tokens, raw webhooks or arbitrary JSON. Canonical projection remains pending; no jobs, intents or live service-window evidence are created.'';
comment on column private.whatsapp_coexistence_observations.projection_status is
  ''Receipt stored only. Canonical associations and projection need a separately reviewed implementation; pending does not mean imported, visible in inbox, sent or delivered.'';
create index wa_coexistence_observation_pending_idx
  on private.whatsapp_coexistence_observations(company_id,link_id,link_generation,stored_at,id);
alter table private.whatsapp_coexistence_observations enable row level security;
-- Intentionally no user policies or direct service-role table privileges.
revoke all on table private.whatsapp_coexistence_observations from public,anon,authenticated,service_role;

create function private.whatsapp_coexistence_observation_immutable()
returns trigger language plpgsql set search_path='''' as $$ begin
  if new is distinct from old then
    raise exception ''COEXISTENCE_OBSERVATION_IMMUTABLE'' using errcode=''23514'';
  end if;
  return new;
end; $$;
revoke all on function private.whatsapp_coexistence_observation_immutable()
  from public,anon,authenticated,service_role;
create trigger wa_coexistence_observation_immutable before update
  on private.whatsapp_coexistence_observations for each row
  execute function private.whatsapp_coexistence_observation_immutable();

create function public.whatsapp_record_coexistence_observation(
  p_company_id uuid,p_link_id uuid,p_link_generation bigint,p_waba_id text,p_phone_number_id text,
  p_kind text,p_customer_wa_id text,p_wa_message_id text,p_direction text,p_message_type text,
  p_body text,p_provider_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='''' as $$
declare gate jsonb;r private.whatsapp_coexistence_observations%rowtype;inserted boolean;
begin
  if current_setting(''role'',true) is distinct from ''service_role'' then
    raise exception ''SERVER_ROLE_REQUIRED'' using errcode=''42501'';
  end if;
  if p_company_id is null or p_link_id is null or p_link_generation is null or p_link_generation < 1
    or p_link_generation > 9007199254740991
    or p_waba_id is null or p_waba_id !~ ''^[0-9]{1,64}$''
    or p_phone_number_id is null or p_phone_number_id !~ ''^[0-9]{1,64}$''
    or p_kind is null or p_kind not in (''history'',''mobile_echo'')
    or p_customer_wa_id is null or char_length(p_customer_wa_id) not between 1 and 128
    or p_customer_wa_id ~ ''[[:space:][:cntrl:]]''
    or p_wa_message_id is null or char_length(p_wa_message_id) not between 1 and 512
    or p_wa_message_id ~ ''[[:space:][:cntrl:]]''
    or p_direction is null or p_direction not in (''inbound'',''outbound'')
    or (p_kind=''mobile_echo'' and p_direction <> ''outbound'')
    or p_message_type is null or p_message_type !~ ''^[a-z][a-z0-9_]{0,31}$''
    or p_body is null or char_length(p_body) > 4096 or octet_length(p_body) > 16384
    or p_provider_occurred_at is null or not isfinite(p_provider_occurred_at)
    or p_provider_occurred_at <= ''1970-01-01T00:00:00Z''::timestamptz
    or p_provider_occurred_at > clock_timestamp()
    or p_provider_occurred_at <> date_trunc(''milliseconds'',p_provider_occurred_at) then
    return jsonb_build_object(''ok'',false,''code'',''INVALID_INPUT'');
  end if;

  -- Serialize all receipt writers for this company BEFORE testing authorization.
  -- Company -> link -> receipt is the existing worker/authorization lock order.
  -- Compatible SHARE locks alone would allow a second exact receipt to pass the
  -- expiry gate, wait at the unique index, then acknowledge after its token expiry.
  -- Every RPC writer now waits here; the fresh helper gate runs after that wait.
  -- Direct table writes remain denied, so there is no alternate supported writer.
  perform 1 from public.companies where id=p_company_id for no key update;
  if not found then return jsonb_build_object(''ok'',false,''code'',''CONNECTION_UNAVAILABLE'');end if;

  -- Existing helper takes company -> link SHARE locks and checks current company
  -- suspension, verified WABA/phone, authorization/scopes/expiry and secret reference.
  -- The locks survive this function until transaction end, fencing reconnect/revoke.
  gate := private.whatsapp_meta_asset_binding(p_waba_id,p_phone_number_id);
  if gate->>''ok'' is distinct from ''true''
    or gate->>''company_id'' is distinct from p_company_id::text
    or gate->>''link_id'' is distinct from p_link_id::text
    or gate->>''link_generation'' is distinct from p_link_generation::text
    or gate->>''provider_waba_id'' is distinct from p_waba_id
    or gate->>''provider_phone_number_id'' is distinct from p_phone_number_id then
    return jsonb_build_object(''ok'',false,''code'',''CONNECTION_UNAVAILABLE'');
  end if;

  -- Unique index serializes concurrent delivery of this logical receipt. Arrival
  -- time is deliberately excluded from identity; redelivery never refreshes it.
  insert into private.whatsapp_coexistence_observations(
    company_id,link_id,link_generation,waba_id,phone_number_id,kind,customer_wa_id,wa_message_id,
    direction,message_type,body,provider_occurred_at
  ) values (
    p_company_id,p_link_id,p_link_generation,p_waba_id,p_phone_number_id,p_kind,p_customer_wa_id,p_wa_message_id,
    p_direction,p_message_type,p_body,p_provider_occurred_at
  ) on conflict on constraint wa_coexistence_observation_receipt_uid do nothing returning * into r;
  inserted := found;
  if not inserted then
    select * into r from private.whatsapp_coexistence_observations
    where company_id=p_company_id and link_id=p_link_id and link_generation=p_link_generation
      and kind=p_kind and phone_number_id=p_phone_number_id and wa_message_id=p_wa_message_id for share;
    if not found then return jsonb_build_object(''ok'',false,''code'',''UNAVAILABLE'');end if;
    -- Preserve the original durable receipt. Contradictory normalized redelivery
    -- is a conflict, not successful deduplication and never an overwrite.
    if row(r.waba_id,r.customer_wa_id,r.direction,r.message_type,r.body,r.provider_occurred_at)
      is distinct from row(p_waba_id,p_customer_wa_id,p_direction,p_message_type,p_body,p_provider_occurred_at) then
      return jsonb_build_object(''ok'',false,''code'',''IDENTITY_CONFLICT'');
    end if;
  end if;
  return jsonb_build_object(''ok'',true,''receipt_id'',r.id,''inserted'',inserted,''duplicate'',not inserted,
    ''projection_status'',r.projection_status,''company_id'',r.company_id,''link_id'',r.link_id,
    ''link_generation'',r.link_generation,''waba_id'',r.waba_id,''phone_number_id'',r.phone_number_id,
    ''kind'',r.kind,''wa_message_id'',r.wa_message_id);
end; $$;
revoke all on function public.whatsapp_record_coexistence_observation(
  uuid,uuid,bigint,text,text,text,text,text,text,text,text,timestamptz
) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_record_coexistence_observation(
  uuid,uuid,bigint,text,text,text,text,text,text,text,text,timestamptz
) to service_role;
notify pgrst,''reload schema'';
commit;
']::text[],'wa_coexistence_10_observations_sha256_707da6fc075009ccbf868e659f0cee623d2ee8ee1a6e6a2b5fcc1e0bdacdbabb',current_user,'velora-wa-install:20261011233154:707da6fc075009ccbf868e659f0cee623d2ee8ee1a6e6a2b5fcc1e0bdacdbabb',NULL::text[]);
-- END INSTALLATION HISTORY RECORD
commit;

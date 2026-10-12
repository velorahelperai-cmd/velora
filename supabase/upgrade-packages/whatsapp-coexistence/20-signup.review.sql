-- REVIEW ARTIFACT ONLY; no SQL execution or generated migration is claimed.
-- Apply only after installed-schema review and 10-observations.review.sql.
-- Baseline dependencies: 20261008130000 identity keys/guards, 20261008140000
-- owner/session proof, Vault, revocation/generation; 20261008143000 Meta binding;
-- 20261010100003 latest accepted-receipt claim/repair wrappers.
-- Independent-number signup APIs are preserved. No provider calls/register/deregister.
-- RPC-double tests validate TypeScript only, not this SQL's ACL/lock/concurrency behavior.
begin;
do $$ begin
  if to_regprocedure('private.whatsapp_signup_owner_valid(uuid,uuid,uuid)') is null
    or to_regprocedure('private.whatsapp_meta_asset_binding(text,text)') is null
    or to_regprocedure('private.whatsapp_clear_link_authorization(uuid,text)') is null
    or to_regprocedure('private.wa_worker_lock(uuid,uuid,boolean)') is null
    or to_regprocedure('public.claim_whatsapp_inbound_job(uuid,integer)') is null
    or to_regclass('private.whatsapp_coexistence_observations') is null then
    raise exception 'COEXISTENCE_SIGNUP_PREREQUISITES_MISSING';
  end if;
end; $$;

create table private.whatsapp_coexistence_signup_attempts (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null, session_id uuid not null,
  nonce_hash bytea not null unique check(octet_length(nonce_hash)=32),
  expected_phone_number text not null check(expected_phone_number ~ '^\+[1-9][0-9]{6,14}$'),
  keep_on_phone boolean not null default true check(keep_on_phone),
  app_id text not null check(app_id ~ '^[0-9]{1,64}$'),
  config_id text not null check(config_id ~ '^[0-9]{1,64}$'),
  graph_version text not null check(graph_version ~ '^v[0-9]+\.0$'),
  base_link_generation bigint,
  status text not null default 'started' check(status in ('started','claimed','token_checkpointed','reconcile_required','completed','cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default(clock_timestamp()+interval '10 minutes'),
  consumed_at timestamptz,
  pending_secret_id uuid,
  checkpoint_proof jsonb check(checkpoint_proof is null or (jsonb_typeof(checkpoint_proof)='object' and octet_length(checkpoint_proof::text)<=16384)),
  checkpointed_at timestamptz,
  finalized_link_id uuid,
  finalized_link_generation bigint check(finalized_link_generation is null or finalized_link_generation>=1),
  last_error_code text check(last_error_code is null or last_error_code in ('NEEDS_SETUP','INVALID_INPUT','META_AUTHORIZATION_REJECTED','META_ASSET_REJECTED','META_UNAVAILABLE','RECONCILIATION_REQUIRED','FORBIDDEN','EXPIRED','CONSUMED','UNAVAILABLE')),
  constraint wa_coex_checkpoint_pair check((pending_secret_id is null)=(checkpoint_proof is null)),
  constraint wa_coex_finalized_pair check((finalized_link_id is null)=(finalized_link_generation is null)),
  foreign key(company_id,finalized_link_id) references public.whatsapp_company_links(company_id,id),
  constraint wa_coex_attempt_tenant_uid unique(company_id,id)
);
create index wa_coex_attempt_company_idx on private.whatsapp_coexistence_signup_attempts(company_id,created_at desc,id);
-- No two pending owner attempts can claim the same provider phone. The index is
-- a final atomic fence even when differently scoped advisory locks are supplied.
create unique index wa_coex_pending_phone_uid on private.whatsapp_coexistence_signup_attempts((checkpoint_proof->>'phone_number_id'))
  where checkpoint_proof is not null and status in ('token_checkpointed','reconcile_required');
create table private.whatsapp_coexistence_connections (
  company_id uuid primary key references public.companies(id) on delete cascade,
  link_id uuid not null,link_generation bigint not null check(link_generation>=1),
  waba_id text not null,phone_number_id text not null,
  expected_phone_number text not null,
  status text not null default 'active' check(status in ('active','disconnected')),
  history_status text not null default 'disabled' check(history_status='disabled'),
  history_sync_status text not null default 'not_requested' check(history_sync_status in ('not_requested','pending','syncing','completed','failed','reconcile_required')),
  ai_enabled boolean not null default false check(not ai_enabled),
  linked_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,link_id) references public.whatsapp_company_links(company_id,id)
);
alter table private.whatsapp_coexistence_signup_attempts enable row level security;
alter table private.whatsapp_coexistence_connections enable row level security;
revoke all on table private.whatsapp_coexistence_signup_attempts,private.whatsapp_coexistence_connections from public,anon,authenticated,service_role;
comment on table private.whatsapp_coexistence_signup_attempts is
  'Owner/native-session-bound one-use coexistence attempt. Only nonce digest, bounded verified proof and Vault references; no OAuth code or plaintext token. Checkpoint survives local finalization failure. Reload never replays exchange/subscription.';

create function private.whatsapp_coexistence_proof(p_app_id text,p_expected_phone text,p_proof jsonb,p_subscribed boolean)
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
  if display is distinct from p_expected_phone then return jsonb_build_object('ok',false,'code','META_ASSET_REJECTED');end if;
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
revoke all on function private.whatsapp_coexistence_proof(text,text,jsonb,boolean) from public,anon,authenticated,service_role;

create function public.whatsapp_coexistence_signup_readiness(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;f text;begin
  begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
  if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if not exists(select 1 from pg_extension where extname='supabase_vault') or to_regclass('vault.secrets') is null
    or to_regclass('vault.decrypted_secrets') is null or to_regprocedure('vault.create_secret(text,text,text,uuid)') is null
    or to_regclass('private.whatsapp_coexistence_signup_attempts') is null or to_regclass('private.whatsapp_coexistence_connections') is null
    then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
  foreach f in array array['public.whatsapp_coexistence_start_signup(uuid,uuid,text,text,text,text,text,boolean)',
    'public.whatsapp_coexistence_claim_signup(uuid,uuid,text)','public.whatsapp_coexistence_checkpoint_signup(uuid,uuid,uuid,text,jsonb)',
    'public.whatsapp_coexistence_finalize_signup(uuid,uuid,uuid,jsonb)','public.whatsapp_coexistence_fail_signup(uuid,uuid,uuid,text)',
    'public.whatsapp_coexistence_cancel_signup(uuid,uuid,text)','public.whatsapp_coexistence_read_signup_status(uuid)',
    'public.whatsapp_coexistence_disconnect(uuid)',
    'public.whatsapp_ingest_coexistence_event(text,text,text,text,text,text,text,text,text,text,timestamptz,text,text,integer,integer,integer,integer,text,text,text)',
    'public.whatsapp_reconcile_coexistence_events(uuid,integer)'] loop
    if to_regprocedure(f) is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
  end loop;
  if to_regprocedure('private.wa_meta_asset_binding_pre_coexistence(text,text)') is null
    or to_regprocedure('private.whatsapp_coexistence_binding_version()') is null
    or to_regprocedure('private.whatsapp_coexistence_ai_allowed(uuid,text)') is null
    or not exists(select 1 from pg_trigger where tgrelid='public.whatsapp_inbound_jobs'::regclass and tgname='whatsapp_coexistence_job_gate' and not tgisinternal and tgenabled='O') then
    return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
  return jsonb_build_object('ok',true,'version','coexistence_signup_v1','connection_mode_contract','coexistence_binding_v1','company_id',p_company_id,'history_enabled',false,'ai_enabled',false);
end; $$;

create function public.whatsapp_coexistence_start_signup(p_company_id uuid,p_attempt_id uuid,p_nonce text,p_expected_phone_number text,p_app_id text,p_config_id text,p_graph_version text,p_keep_on_phone boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;gen bigint;deadline timestamptz;begin
  begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
  perform 1 from public.companies where id=p_company_id for update;
  if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if public.whatsapp_coexistence_signup_readiness(p_company_id)->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
  if p_attempt_id is null or p_nonce is null or p_nonce!~'^[0-9a-f]{64}$' or p_keep_on_phone is distinct from true
    or p_expected_phone_number is null or p_expected_phone_number!~'^\+[1-9][0-9]{6,14}$'
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

create function public.whatsapp_coexistence_claim_signup(p_company_id uuid,p_attempt_id uuid,p_nonce text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;a private.whatsapp_coexistence_signup_attempts%rowtype;begin
  begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
  perform 1 from public.companies where id=p_company_id for update;
  if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if p_nonce is null or p_nonce!~'^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  select * into a from private.whatsapp_coexistence_signup_attempts where id=p_attempt_id and company_id=p_company_id
    and user_id=auth.uid() and session_id=sid and nonce_hash=pg_catalog.sha256(pg_catalog.convert_to(p_nonce,'UTF8')) for update;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if a.status<>'started' or a.consumed_at is not null then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
  if a.expires_at<=clock_timestamp() then update private.whatsapp_coexistence_signup_attempts set status='cancelled',consumed_at=clock_timestamp(),last_error_code='EXPIRED' where id=a.id;return jsonb_build_object('ok',false,'code','EXPIRED');end if;
  update private.whatsapp_coexistence_signup_attempts set status='claimed',consumed_at=clock_timestamp() where id=a.id;
  return jsonb_build_object('ok',true,'attempt_id',a.id,'company_id',a.company_id,'user_id',a.user_id,'session_id',a.session_id,
    'app_id',a.app_id,'config_id',a.config_id,'graph_version',a.graph_version,'keep_on_phone',true,'expected_phone_number',a.expected_phone_number);
end; $$;

create function public.whatsapp_coexistence_checkpoint_signup(p_attempt_id uuid,p_user_id uuid,p_session_id uuid,p_access_token text,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.whatsapp_coexistence_signup_attempts%rowtype;l public.whatsapp_company_links%rowtype;v jsonb;secret_id uuid;begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
  if p_proof is null or coalesce(p_proof->>'waba_id','')!~'^[0-9]{1,64}$' or p_access_token is null
    or nullif(btrim(p_access_token),'') is null or length(p_access_token)>16384 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  select * into a from private.whatsapp_coexistence_signup_attempts where id=p_attempt_id;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  -- Match existing signup/revocation ordering: WABA advisory -> company -> link.
  perform pg_catalog.pg_advisory_xact_lock(87420104,pg_catalog.hashtext(p_proof->>'waba_id'));
  perform 1 from public.companies where id=a.company_id for update;
  select * into l from public.whatsapp_company_links where company_id=a.company_id for update;
  select * into a from private.whatsapp_coexistence_signup_attempts where id=p_attempt_id for update;
  if a.user_id is distinct from p_user_id or a.session_id is distinct from p_session_id
    or not private.whatsapp_signup_owner_valid(a.company_id,p_user_id,p_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if a.status<>'claimed' or a.pending_secret_id is not null then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
  if a.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
  if l.generation is distinct from a.base_link_generation then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
  v:=private.whatsapp_coexistence_proof(a.app_id,a.expected_phone_number,p_proof,false);
  if v->>'ok' is distinct from 'true' then return v;end if;
  if exists(select 1 from public.whatsapp_company_links where company_id<>a.company_id and status='verified' and provider_phone_number_id=p_proof->>'phone_number_id')
    or exists(select 1 from private.whatsapp_coexistence_signup_attempts where id<>a.id and checkpoint_proof is not null
      and status in ('token_checkpointed','reconcile_required') and checkpoint_proof->>'phone_number_id'=p_proof->>'phone_number_id') then
    update private.whatsapp_coexistence_signup_attempts set status='reconcile_required',last_error_code='RECONCILIATION_REQUIRED' where id=a.id;
    return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
  if exists(select 1 from private.whatsapp_meta_authorization_revocations where waba_id=p_proof->>'waba_id'
    and (v->>'verified_at')::timestamptz<=occurred_at+interval '1 second') then return jsonb_build_object('ok',false,'code','META_AUTHORIZATION_REJECTED');end if;
  if not exists(select 1 from pg_extension where extname='supabase_vault') or to_regprocedure('vault.create_secret(text,text,text,uuid)') is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
  begin
    execute 'select vault.create_secret($1,$2,$3)' into secret_id using p_access_token,'velora-coex-pending-'||a.id::text,'Verified coexistence token before subscription';
    if secret_id is null then raise exception 'VAULT_CHECKPOINT_UNCONFIRMED';end if;
    update private.whatsapp_coexistence_signup_attempts set pending_secret_id=secret_id,checkpoint_proof=p_proof,
      checkpointed_at=clock_timestamp(),status='token_checkpointed',last_error_code=null where id=a.id;
  exception when others then
    -- Nested scope rolls back both Vault and checkpoint changes together.
    update private.whatsapp_coexistence_signup_attempts set status='reconcile_required',last_error_code='RECONCILIATION_REQUIRED' where id=a.id;
    return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');
  end;
  return jsonb_build_object('ok',true,'attempt_id',a.id,'company_id',a.company_id,'user_id',a.user_id,'session_id',a.session_id,'status','token_checkpointed','token_checkpointed',true);
end; $$;

create function public.whatsapp_coexistence_finalize_signup(p_attempt_id uuid,p_user_id uuid,p_session_id uuid,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.whatsapp_coexistence_signup_attempts%rowtype;l public.whatsapp_company_links%rowtype;v jsonb;c record;has_secret boolean;removed boolean;old_secret_id uuid;begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
  if p_proof is null or coalesce(p_proof->>'waba_id','')!~'^[0-9]{1,64}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  select * into a from private.whatsapp_coexistence_signup_attempts where id=p_attempt_id;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  perform pg_catalog.pg_advisory_xact_lock(87420104,pg_catalog.hashtext(p_proof->>'waba_id'));
  perform 1 from public.companies where id=a.company_id for update;
  select * into l from public.whatsapp_company_links where company_id=a.company_id for update;
  old_secret_id:=l.access_secret_id;
  select * into a from private.whatsapp_coexistence_signup_attempts where id=p_attempt_id for update;
  if a.user_id is distinct from p_user_id or a.session_id is distinct from p_session_id
    or not private.whatsapp_signup_owner_valid(a.company_id,p_user_id,p_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if a.status<>'token_checkpointed' or a.pending_secret_id is null then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
  if a.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
  if l.generation is distinct from a.base_link_generation then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
  v:=private.whatsapp_coexistence_proof(a.app_id,a.expected_phone_number,p_proof,true);
  if v->>'ok' is distinct from 'true' then return v;end if;
  if (p_proof->>'app_id',p_proof->>'waba_id',p_proof->>'phone_number_id') is distinct from
    (a.checkpoint_proof->>'app_id',a.checkpoint_proof->>'waba_id',a.checkpoint_proof->>'phone_number_id') then return jsonb_build_object('ok',false,'code','META_ASSET_REJECTED');end if;
  --30 may receive a signed removal while provider subscription is in flight.
  -- Any exact-attempt removal (including conflict-review) after the checkpoint
  -- proof prevents new local send authority; do not revoke an unrelated WABA.
  if to_regclass('private.whatsapp_coexistence_checkpoint_events') is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
  execute 'select exists(select 1 from private.whatsapp_coexistence_checkpoint_events where company_id=$1 and attempt_id=$2 and kind=''partner_removed'' and provider_occurred_at + interval ''1 second'' >= $3)'
    into removed using a.company_id,a.id,(a.checkpoint_proof->>'verified_at')::timestamptz;
  if removed then
    update private.whatsapp_coexistence_signup_attempts set status='reconcile_required',last_error_code='RECONCILIATION_REQUIRED' where id=a.id;
    return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
  if exists(select 1 from private.whatsapp_meta_authorization_revocations where waba_id=p_proof->>'waba_id'
    and (v->>'verified_at')::timestamptz<=occurred_at+interval '1 second') then return jsonb_build_object('ok',false,'code','META_AUTHORIZATION_REJECTED');end if;
  if exists(select 1 from public.whatsapp_company_links where company_id<>a.company_id and status='verified' and provider_phone_number_id=p_proof->>'phone_number_id') then return jsonb_build_object('ok',false,'code','META_ASSET_REJECTED');end if;
  if to_regclass('vault.secrets') is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
  execute 'select exists(select 1 from vault.secrets where id=$1)' into has_secret using a.pending_secret_id;
  if has_secret is distinct from true then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
  begin
    insert into public.whatsapp_company_links(company_id,status,provider_phone_number_id,provider_waba_id,verified_display_number,keep_on_phone,access_secret_id,
      authorization_status,authorization_expires_at,authorization_verified_at,authorization_app_id,authorization_scopes,authorization_user_id,authorization_session_id,authorization_non_expiring)
    values(a.company_id,'verified',p_proof->>'phone_number_id',p_proof->>'waba_id',p_proof->>'display_phone_number',true,a.pending_secret_id,
      'active',(v->>'deadline')::timestamptz,(v->>'verified_at')::timestamptz,a.app_id,p_proof->'scopes',a.user_id,a.session_id,(v->>'non_expiring')::boolean)
    on conflict(company_id) do update set status='verified',provider_phone_number_id=excluded.provider_phone_number_id,provider_waba_id=excluded.provider_waba_id,
      verified_display_number=excluded.verified_display_number,keep_on_phone=true,access_secret_id=excluded.access_secret_id,authorization_status='active',authorization_expires_at=excluded.authorization_expires_at,
      authorization_verified_at=excluded.authorization_verified_at,authorization_app_id=excluded.authorization_app_id,authorization_scopes=excluded.authorization_scopes,
      authorization_user_id=excluded.authorization_user_id,authorization_session_id=excluded.authorization_session_id,authorization_non_expiring=excluded.authorization_non_expiring,
      inbound_tested_at=null,outbound_tested_at=null,last_error_code=null,updated_at=clock_timestamp();
    select * into l from public.whatsapp_company_links where company_id=a.company_id;
    insert into private.whatsapp_coexistence_connections(company_id,link_id,link_generation,waba_id,phone_number_id,expected_phone_number)
    values(a.company_id,l.id,l.generation,l.provider_waba_id,l.provider_phone_number_id,a.expected_phone_number)
    on conflict(company_id) do update set link_id=excluded.link_id,link_generation=excluded.link_generation,waba_id=excluded.waba_id,phone_number_id=excluded.phone_number_id,
      expected_phone_number=excluded.expected_phone_number,status='active',history_status='disabled',history_sync_status='not_requested',ai_enabled=false,linked_at=clock_timestamp(),updated_at=clock_timestamp();
    -- Existing conversation automation is paused atomically and audited. New AI
    -- jobs/claims/worker authorization are positively blocked below as well.
    perform set_config('velora.conversation_control','1',true);
    for c in update public.whatsapp_conversations set automation_allowed=false,automation_generation=automation_generation+1,
      control_revision=control_revision+1,control_actor_id=a.user_id,control_acted_at=clock_timestamp(),
      status=case when status='open' then 'handed_over' else status end
      where company_id=a.company_id and automation_allowed returning id,control_revision,automation_generation loop
      insert into public.whatsapp_conversation_events(company_id,conversation_id,actor_user_id,action,revision,automation_generation,detail)
      values(a.company_id,c.id,a.user_id,'take_over',c.control_revision,c.automation_generation,jsonb_build_object('reason','coexistence_signup_ai_disabled','attempt_id',a.id));
    end loop;
    perform set_config('velora.conversation_control','',true);
    -- Recovery is permanently tied to the actual finalized identity, never an
    -- inferred generation or a later connection reusing the same provider asset.
    update private.whatsapp_coexistence_signup_attempts set status='completed',finalized_link_id=l.id,finalized_link_generation=l.generation,
      pending_secret_id=null,checkpoint_proof=null,last_error_code=null where id=a.id;
    if old_secret_id is not null and old_secret_id is distinct from a.pending_secret_id then execute 'delete from vault.secrets where id=$1' using old_secret_id;end if;
    -- The pending Vault reference is now exclusively owned by the verified link.
  exception when others then
    -- Preserve the separately committed checkpoint/Vault token for reconciliation.
    -- No partial link, connection, control event or completion can survive this scope.
    update private.whatsapp_coexistence_signup_attempts set status='reconcile_required',last_error_code='RECONCILIATION_REQUIRED' where id=a.id;
    return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');
  end;
  return jsonb_build_object('ok',true,'attempt_id',a.id,'company_id',a.company_id,'user_id',a.user_id,'session_id',a.session_id,'status','completed','history_enabled',false,'ai_enabled',false);
end; $$;

create function public.whatsapp_coexistence_fail_signup(p_attempt_id uuid,p_user_id uuid,p_session_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
  select company_id into cid from private.whatsapp_coexistence_signup_attempts where id=p_attempt_id and user_id=p_user_id and session_id=p_session_id;
  if cid is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  perform 1 from public.companies where id=cid for update;
  -- A local failure after claim cannot establish that exchange/subscription did
  -- not happen. Retain the token checkpoint and never authorize implicit repeats.
  update private.whatsapp_coexistence_signup_attempts set status='reconcile_required',last_error_code='RECONCILIATION_REQUIRED'
    where id=p_attempt_id and user_id=p_user_id and session_id=p_session_id and status in ('claimed','token_checkpointed','reconcile_required');
  return jsonb_build_object('ok',found);
end; $$;

create function public.whatsapp_coexistence_cancel_signup(p_company_id uuid,p_attempt_id uuid,p_nonce text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;a private.whatsapp_coexistence_signup_attempts%rowtype;begin
  begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
  perform 1 from public.companies where id=p_company_id for update;
  if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if p_nonce is null or p_nonce!~'^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  select * into a from private.whatsapp_coexistence_signup_attempts where id=p_attempt_id and company_id=p_company_id and user_id=auth.uid() and session_id=sid
    and nonce_hash=pg_catalog.sha256(pg_catalog.convert_to(p_nonce,'UTF8')) for update;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if a.status in ('claimed','token_checkpointed','reconcile_required') then
    update private.whatsapp_coexistence_signup_attempts set status='reconcile_required',last_error_code='RECONCILIATION_REQUIRED' where id=a.id;
    return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
  if a.status<>'started' then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
  update private.whatsapp_coexistence_signup_attempts set status='cancelled',consumed_at=clock_timestamp() where id=a.id;
  return jsonb_build_object('ok',true,'company_id',a.company_id,'attempt_id',a.id,'cancelled',true);
end; $$;

create function public.whatsapp_coexistence_read_signup_status(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;a private.whatsapp_coexistence_signup_attempts%rowtype;s private.whatsapp_coexistence_connections%rowtype;l public.whatsapp_company_links%rowtype;conn text:='not_connected';live boolean:=false;display text;begin
  begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
  perform 1 from public.companies where id=p_company_id for share;
  if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  select * into l from public.whatsapp_company_links where company_id=p_company_id for share;
  select * into s from private.whatsapp_coexistence_connections where company_id=p_company_id;
  select * into a from private.whatsapp_coexistence_signup_attempts where company_id=p_company_id and user_id=auth.uid() order by created_at desc,id desc limit 1 for update;
  if a.expires_at<=clock_timestamp() and a.status in ('started','claimed','token_checkpointed') then
    update private.whatsapp_coexistence_signup_attempts set status=case when a.status='started' then 'cancelled' else 'reconcile_required' end,
      consumed_at=coalesce(consumed_at,clock_timestamp()),last_error_code=case when a.status='started' then 'EXPIRED' else 'RECONCILIATION_REQUIRED' end
      where id=a.id returning * into a;
  end if;
  if s.company_id is not null then
    conn:=case when l.authorization_status='revoked' then 'revoked' when l.authorization_status='expired' or (l.authorization_expires_at is not null and l.authorization_expires_at<=clock_timestamp()) then 'expired'
      when s.status='disconnected' or l.status='disconnected' then 'disconnected'
      when l.id=s.link_id and l.generation=s.link_generation and l.keep_on_phone and l.status='verified' and l.authorization_status='active'
        and l.provider_waba_id=s.waba_id and l.provider_phone_number_id=s.phone_number_id
        and l.authorization_app_id is not null and l.authorization_user_id is not null and l.authorization_session_id is not null
        and l.authorization_verified_at is not null and l.authorization_verified_at<=clock_timestamp()
        and l.authorization_scopes @> '["whatsapp_business_management","whatsapp_business_messaging"]'::jsonb
        and l.verified_display_number is not null and l.access_secret_id is not null
        and (l.authorization_expires_at>clock_timestamp() or (l.authorization_expires_at is null and l.authorization_non_expiring)) then 'active' else 'needs_reauth' end;
    if conn='active' then display:=l.verified_display_number;live:=l.inbound_tested_at is not null and l.outbound_tested_at is not null;end if;
  end if;
  return jsonb_build_object('ok',true,'company_id',p_company_id,'attempt_id',a.id,'status',coalesce(a.status,'no_attempt'),
    'expected_phone_number',coalesce(a.expected_phone_number,s.expected_phone_number),'expires_at',a.expires_at,'connection_status',conn,
    'link_id',s.link_id,'link_generation',s.link_generation,'display_phone_number',display,'live_verified',live,
    'history_status','disabled','history_sync_status',coalesce(s.history_sync_status,'not_requested'),'ai_enabled',false,'last_error_code',a.last_error_code);
end; $$;

create function public.whatsapp_coexistence_disconnect(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;l public.whatsapp_company_links%rowtype;a record;begin
  begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
  perform 1 from public.companies where id=p_company_id for update;
  if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  select * into l from public.whatsapp_company_links where company_id=p_company_id for update;
  if l.id is not null and not l.keep_on_phone then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  -- Local revoke only: preserve the mobile business app; no deregistration or API call.
  if l.id is not null then perform private.whatsapp_clear_link_authorization(l.id,'OWNER_DISCONNECTED');end if;
  -- Disconnect cannot establish that an in-flight provider exchange/subscription
  -- did not happen. Only unclaimed starts may be cancelled. Consumed attempts,
  -- pending Vault references and proofs survive and keep new signup blocked.
  update private.whatsapp_coexistence_signup_attempts set status='cancelled',consumed_at=clock_timestamp()
    where company_id=p_company_id and status='started' and consumed_at is null;
  update private.whatsapp_coexistence_signup_attempts set status='reconcile_required',last_error_code='RECONCILIATION_REQUIRED'
    where company_id=p_company_id and status in ('claimed','token_checkpointed','reconcile_required');
  update private.whatsapp_coexistence_connections set status='disconnected',history_status='disabled',ai_enabled=false,updated_at=clock_timestamp() where company_id=p_company_id;
  return jsonb_build_object('ok',true,'company_id',p_company_id,'disconnected',true,'history_enabled',false,'ai_enabled',false);
end; $$;

-- AI remains positively denied for every current coexistence link, regardless of
-- conversation flags or forged direct-service job writes. No activation API here.
create function private.whatsapp_coexistence_ai_allowed(p_company_id uuid,p_phone_number_id text)
returns boolean language sql security definer set search_path='' as $$
  select not exists(select 1 from public.whatsapp_company_links where company_id=p_company_id and provider_phone_number_id=p_phone_number_id and keep_on_phone);
$$;
revoke all on function private.whatsapp_coexistence_ai_allowed(uuid,text) from public,anon,authenticated,service_role;

-- Receipt retention after a durable verified checkpoint does not depend on the
-- short-lived signup nonce or original login remaining live. Tenant ownership,
-- provider authorization, generation and revocation remain fresh gates. This
-- helper never grants connection, finalization, AI or send authority.
create function private.whatsapp_coexistence_receipt_owner_valid(p_company_id uuid,p_user_id uuid)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id join auth.users u on u.id=m.user_id
    where m.company_id=p_company_id and m.user_id=p_user_id and m.role='owner' and m.status='active' and c.status<>'suspended'
      and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null));
$$;
revoke all on function private.whatsapp_coexistence_receipt_owner_valid(uuid,uuid) from public,anon,authenticated,service_role;

-- The existing public asset resolver delegates to this helper. Its mode comes
-- only from the exact current verified link + completed coexistence connection.
alter function private.whatsapp_meta_asset_binding(text,text) rename to wa_meta_asset_binding_pre_coexistence;
revoke all on function private.wa_meta_asset_binding_pre_coexistence(text,text) from public,anon,authenticated,service_role;
create function private.whatsapp_meta_asset_binding(p_waba_id text,p_phone_number_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gate jsonb;l public.whatsapp_company_links%rowtype;a private.whatsapp_coexistence_signup_attempts%rowtype;matches integer;aid uuid;gen bigint;deadline timestamptz;begin
  gate:=private.wa_meta_asset_binding_pre_coexistence(p_waba_id,p_phone_number_id);
  if gate->>'ok' is distinct from 'true' then
    -- A pending classification is a failed operational binding. It authorizes
    -- only routing to30's independently revalidated durable holding RPC.
    if gate->>'code' is distinct from 'unknown_or_inactive' then return gate;end if;
    select count(*),(array_agg(id order by id))[1] into matches,aid from private.whatsapp_coexistence_signup_attempts
      where status in ('token_checkpointed','reconcile_required') and pending_secret_id is not null
        and checkpoint_proof->>'waba_id'=p_waba_id and checkpoint_proof->>'phone_number_id'=p_phone_number_id;
    if matches<>1 then return gate;end if;
    select * into a from private.whatsapp_coexistence_signup_attempts where id=aid;
    perform 1 from public.companies where id=a.company_id and status<>'suspended' for share;
    if not found then return gate;end if;
    select generation into gen from public.whatsapp_company_links where company_id=a.company_id for share;
    select * into a from private.whatsapp_coexistence_signup_attempts where id=aid for share;
    deadline:=(a.checkpoint_proof->>'authorization_expires_at')::timestamptz;
    if a.status not in ('token_checkpointed','reconcile_required') or a.pending_secret_id is null
      or gen is distinct from a.base_link_generation or not private.whatsapp_coexistence_receipt_owner_valid(a.company_id,a.user_id)
      or a.checkpoint_proof->>'app_id' is distinct from a.app_id or a.checkpoint_proof->>'waba_id' is distinct from p_waba_id
      or a.checkpoint_proof->>'phone_number_id' is distinct from p_phone_number_id
      or a.checkpoint_proof->'is_on_biz_app' is distinct from 'true'::jsonb or a.checkpoint_proof->>'platform_type' is distinct from 'CLOUD_API'
      or not(a.checkpoint_proof->'scopes' @> '["whatsapp_business_management","whatsapp_business_messaging"]'::jsonb)
      or (deadline is not null and deadline<=clock_timestamp())
      or exists(select 1 from private.whatsapp_meta_authorization_revocations where waba_id=p_waba_id
        and (a.checkpoint_proof->>'verified_at')::timestamptz<=occurred_at+interval '1 second') then return gate;end if;
    return jsonb_build_object('ok',false,'eligible',false,'code','unknown_or_inactive','connection_mode','coexistence_pending');
  end if;
  select * into l from public.whatsapp_company_links where id=(gate->>'link_id')::uuid and generation=(gate->>'link_generation')::bigint;
  if l.keep_on_phone then
    if not exists(select 1 from private.whatsapp_coexistence_connections s where s.company_id=l.company_id and s.link_id=l.id and s.link_generation=l.generation
      and s.waba_id=p_waba_id and s.phone_number_id=p_phone_number_id and s.status='active') then
      return jsonb_build_object('ok',false,'eligible',false,'code','unknown_or_inactive');end if;
    return gate||jsonb_build_object('connection_mode','coexistence');
  end if;
  return gate||jsonb_build_object('connection_mode','cloud_api');
end; $$;
revoke all on function private.whatsapp_meta_asset_binding(text,text) from public,anon,authenticated,service_role;
create function private.whatsapp_coexistence_binding_version() returns text language sql immutable set search_path='' as $$ select 'coexistence_binding_v1'::text; $$;
revoke all on function private.whatsapp_coexistence_binding_version() from public,anon,authenticated,service_role;

-- Deny coexistence before the legacy RPC can acquire message advisory/row locks.
-- Ingress uses the separately reviewed inbox-only path, never this AI-job writer.
alter function public.save_whatsapp_inbound(uuid,text,text,text,text,text,text,timestamptz) set schema private;
alter function private.save_whatsapp_inbound(uuid,text,text,text,text,text,text,timestamptz) rename to wa_save_inbound_pre_coexistence;
revoke all on function private.wa_save_inbound_pre_coexistence(uuid,text,text,text,text,text,text,timestamptz) from public,anon,authenticated,service_role;
create function public.save_whatsapp_inbound(p_company_id uuid,p_phone_number_id text,p_customer_wa_id text,p_customer_name text,p_wa_message_id text,p_body text,p_message_type text,p_received_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare coex boolean;begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
  perform 1 from public.companies where id=p_company_id for share;
  select keep_on_phone into coex from public.whatsapp_company_links where company_id=p_company_id and provider_phone_number_id=p_phone_number_id for share;
  if coex then return jsonb_build_object('ok',false,'code','COEXISTENCE_AI_DISABLED');end if;
  return private.wa_save_inbound_pre_coexistence(p_company_id,p_phone_number_id,p_customer_wa_id,p_customer_name,p_wa_message_id,p_body,p_message_type,p_received_at);
end; $$;
create function private.whatsapp_coexistence_job_gate() returns trigger language plpgsql security definer set search_path='' as $$
declare phone text;begin
  select c.phone_number_id into phone from public.whatsapp_messages m join public.whatsapp_conversations c
    on c.company_id=m.company_id and c.id=m.conversation_id where m.id=new.message_id and m.company_id=new.company_id;
  if not private.whatsapp_coexistence_ai_allowed(new.company_id,phone) then raise exception 'COEXISTENCE_AI_DISABLED' using errcode='42501';end if;
  return new;
end; $$;
revoke all on function private.whatsapp_coexistence_job_gate() from public,anon,authenticated,service_role;
create trigger whatsapp_coexistence_job_gate before insert on public.whatsapp_inbound_jobs for each row execute function private.whatsapp_coexistence_job_gate();
alter function private.wa_worker_lock(uuid,uuid,boolean) rename to wa_worker_lock_pre_coexistence;
revoke all on function private.wa_worker_lock_pre_coexistence(uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function private.wa_worker_lock(p_job uuid,p_claim uuid,p_generation boolean default true)
returns public.whatsapp_inbound_jobs language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;phone text;begin
  j:=private.wa_worker_lock_pre_coexistence(p_job,p_claim,p_generation);
  if j.id is null then return null;end if;
  select c.phone_number_id into phone from public.whatsapp_messages m join public.whatsapp_conversations c on c.company_id=m.company_id and c.id=m.conversation_id where m.id=j.message_id and m.company_id=j.company_id;
  -- Generationless paths settle/repair known costs; they cannot dispatch fresh AI.
  if p_generation and not private.whatsapp_coexistence_ai_allowed(j.company_id,phone) then return null;end if;
  return j;
end; $$;
revoke all on function private.wa_worker_lock(uuid,uuid,boolean) from public,anon,authenticated,service_role;
alter function public.claim_whatsapp_inbound_job(uuid,integer) set schema private;
alter function private.claim_whatsapp_inbound_job(uuid,integer) rename to wa_claim_job_pre_coexistence;
revoke all on function private.wa_claim_job_pre_coexistence(uuid,integer) from public,anon,authenticated,service_role;
create function public.claim_whatsapp_inbound_job(p_job_id uuid,p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;phone text;begin
  if current_setting('role',true) is distinct from 'service_role' then return jsonb_build_object('ok',false,'code','server_role_required');end if;
  select * into j from public.whatsapp_inbound_jobs where id=p_job_id;
  -- Preserve the latest accepted-receipt repair behavior before the fresh-AI gate.
  if exists(select 1 from public.whatsapp_send_intents where id=j.send_intent_id and company_id=j.company_id and original_job_id=j.id and outcome='accepted' and wa_message_id is not null) then
    perform public.billing_finalize_automated_usage(j.company_id,j.send_intent_id);return jsonb_build_object('ok',false,'code','accepted_receipt_repair_only');end if;
  perform 1 from public.companies where id=j.company_id for no key update;
  select c.phone_number_id into phone from public.whatsapp_messages m join public.whatsapp_conversations c on c.company_id=m.company_id and c.id=m.conversation_id where m.id=j.message_id and m.company_id=j.company_id;
  if not private.whatsapp_coexistence_ai_allowed(j.company_id,phone) then return jsonb_build_object('ok',false,'code','COEXISTENCE_AI_DISABLED');end if;
  return private.wa_claim_job_pre_coexistence(p_job_id,p_lease_seconds);
end; $$;

do $$ declare f text;begin
  foreach f in array array['public.whatsapp_coexistence_signup_readiness(uuid)','public.whatsapp_coexistence_start_signup(uuid,uuid,text,text,text,text,text,boolean)',
    'public.whatsapp_coexistence_claim_signup(uuid,uuid,text)','public.whatsapp_coexistence_cancel_signup(uuid,uuid,text)',
    'public.whatsapp_coexistence_read_signup_status(uuid)','public.whatsapp_coexistence_disconnect(uuid)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);execute format('grant execute on function %s to authenticated',f);
  end loop;
  foreach f in array array['public.whatsapp_coexistence_checkpoint_signup(uuid,uuid,uuid,text,jsonb)','public.whatsapp_coexistence_finalize_signup(uuid,uuid,uuid,jsonb)',
    'public.whatsapp_coexistence_fail_signup(uuid,uuid,uuid,text)','public.claim_whatsapp_inbound_job(uuid,integer)',
    'public.save_whatsapp_inbound(uuid,text,text,text,text,text,text,timestamptz)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);execute format('grant execute on function %s to service_role',f);
  end loop;
end; $$;
notify pgrst,'reload schema';
commit;

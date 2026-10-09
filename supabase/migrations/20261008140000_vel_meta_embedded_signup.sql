-- Durable Meta Embedded Signup v4. Forward-only; no provider calls in SQL.
begin;
alter table public.whatsapp_embedded_signup_attempts
 add column session_id uuid,
 add column expires_at timestamptz not null default (now()+interval '10 minutes'),
 add column app_id text,
 add column config_id text,
 add column graph_version text,
 add column base_link_generation bigint,
 add column last_error_code text;
-- Legacy attempts have no provable Auth session and cannot be resumed.
update public.whatsapp_embedded_signup_attempts set status='cancelled',consumed_at=coalesce(consumed_at,now()) where session_id is null;
alter table public.whatsapp_embedded_signup_attempts drop constraint whatsapp_es_attempts_status_chk;
alter table public.whatsapp_embedded_signup_attempts add constraint whatsapp_es_attempts_status_chk
 check(status in ('in_progress','cancelled','failed','code_received','completed','reconcile_required'));
alter table public.whatsapp_company_links
 add column provider_waba_id text,
 add column authorization_expires_at timestamptz,
 add column authorization_status text not null default 'needs_reauth' check(authorization_status in ('active','revoked','expired','needs_reauth')),
 add column authorization_verified_at timestamptz,
 add column authorization_app_id text,
 add column authorization_scopes jsonb,
 add column authorization_user_id uuid,
 add column authorization_session_id uuid,
 add column authorization_non_expiring boolean not null default false;
comment on column public.whatsapp_company_links.authorization_non_expiring is
 'True only when server verified BOTH Graph expires_at and data_access_expires_at are zero; null expiry alone is never active proof.';
create table private.whatsapp_meta_authorization_revocations(waba_id text primary key,occurred_at timestamptz not null);
revoke all on table private.whatsapp_meta_authorization_revocations from public,anon,authenticated;

create function private.whatsapp_signup_owner_valid(p_company_id uuid,p_user_id uuid,p_session_id uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id
 join auth.users u on u.id=m.user_id join auth.sessions s on s.user_id=u.id and s.id=p_session_id
 join private.app_session_activity a on a.user_id=u.id and a.session_id=s.id
 where m.company_id=p_company_id and m.user_id=p_user_id and m.role='owner' and m.status='active' and c.status<>'suspended'
 and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
 and ((to_jsonb(s)->>'not_after') is null or (to_jsonb(s)->>'not_after')::timestamptz>clock_timestamp())
 and a.expired_at is null and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours');
$$;
revoke all on function private.whatsapp_signup_owner_valid(uuid,uuid,uuid) from public,anon,authenticated;

create function public.whatsapp_embedded_signup_readiness(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not exists(select 1 from pg_extension where extname='supabase_vault') or to_regclass('vault.secrets') is null or to_regprocedure('vault.create_secret(text,text,text,uuid)') is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
 return jsonb_build_object('ok',true);
end;$$;

create function public.whatsapp_start_embedded_signup(p_company_id uuid,p_attempt_id uuid,p_nonce text,p_keep_on_phone boolean,p_app_id text,p_config_id text,p_graph_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;gen bigint;deadline timestamptz;begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 perform 1 from public.companies where id=p_company_id for update;
 if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if (public.whatsapp_embedded_signup_readiness(p_company_id)->>'ok')::boolean is not true or p_keep_on_phone then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
 if p_attempt_id is null or p_nonce is null or p_app_id is null or p_config_id is null or p_graph_version is null or p_nonce!~'^[0-9a-f]{64}$' or p_app_id!~'^[0-9]{1,64}$' or p_config_id!~'^[0-9]{1,64}$' or p_graph_version!~'^v[0-9]+\.0$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 update public.whatsapp_embedded_signup_attempts set status='cancelled',consumed_at=coalesce(consumed_at,now()) where company_id=p_company_id and status in ('in_progress','code_received');
 select generation into gen from public.whatsapp_company_links where company_id=p_company_id;
 deadline:=now()+interval '10 minutes';
 insert into public.whatsapp_embedded_signup_attempts(id,company_id,user_id,session_id,nonce,keep_on_phone,app_id,config_id,graph_version,base_link_generation,expires_at)
 values(p_attempt_id,p_company_id,auth.uid(),sid,p_nonce,false,p_app_id,p_config_id,p_graph_version,gen,deadline);
 return jsonb_build_object('ok',true,'attempt_id',p_attempt_id,'nonce',p_nonce,'expires_at',deadline);
end;$$;

create function public.whatsapp_claim_embedded_signup(p_company_id uuid,p_attempt_id uuid,p_nonce text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;a public.whatsapp_embedded_signup_attempts%rowtype;begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into a from public.whatsapp_embedded_signup_attempts where id=p_attempt_id and company_id=p_company_id and user_id=auth.uid() and session_id=sid and nonce=p_nonce for update;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if a.expires_at<=clock_timestamp() then update public.whatsapp_embedded_signup_attempts set status='failed',consumed_at=coalesce(consumed_at,now()),last_error_code='EXPIRED' where id=a.id;return jsonb_build_object('ok',false,'code','EXPIRED');end if;
 if a.status<>'in_progress' or a.consumed_at is not null then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
 update public.whatsapp_embedded_signup_attempts set status='code_received',consumed_at=now() where id=a.id;
 return jsonb_build_object('ok',true,'attempt_id',a.id,'company_id',a.company_id,'user_id',a.user_id,'session_id',a.session_id,'app_id',a.app_id,'config_id',a.config_id,'graph_version',a.graph_version,'keep_on_phone',a.keep_on_phone);
end;$$;

create function public.whatsapp_cancel_embedded_signup(p_company_id uuid,p_attempt_id uuid,p_nonce text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 update public.whatsapp_embedded_signup_attempts set status='cancelled',consumed_at=coalesce(consumed_at,now()) where id=p_attempt_id and company_id=p_company_id and user_id=auth.uid() and session_id=sid and nonce=p_nonce and status in ('in_progress','code_received');
 return jsonb_build_object('ok',found);
end;$$;

create function public.whatsapp_finalize_embedded_signup(p_attempt_id uuid,p_user_id uuid,p_session_id uuid,p_access_token text,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.whatsapp_embedded_signup_attempts%rowtype;l public.whatsapp_company_links%rowtype;secret_id uuid;deadline timestamptz;exp bigint;data_exp bigint;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_proof->>'waba_id' is null or p_proof->>'waba_id'!~'^[0-9]{1,64}$' then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
 perform pg_catalog.pg_advisory_xact_lock(87420104,pg_catalog.hashtext(p_proof->>'waba_id'));
 select * into a from public.whatsapp_embedded_signup_attempts where id=p_attempt_id;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.companies where id=a.company_id for update;
 select * into a from public.whatsapp_embedded_signup_attempts where id=p_attempt_id for update;
 if a.user_id<>p_user_id or a.session_id<>p_session_id or a.session_id is null or not private.whatsapp_signup_owner_valid(a.company_id,p_user_id,p_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if a.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
 if a.status<>'code_received' or a.consumed_at is null then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
 select * into l from public.whatsapp_company_links where company_id=a.company_id for update;
 if l.generation is distinct from a.base_link_generation then return jsonb_build_object('ok',false,'code','LINK_CHANGED');end if;
 if a.keep_on_phone or nullif(btrim(p_access_token),'') is null or length(p_access_token)>16384 or jsonb_typeof(p_proof)<>'object'
 or p_proof->>'app_id' is distinct from a.app_id or p_proof->>'waba_id' is null or p_proof->>'phone_number_id' is null or p_proof->>'waba_id'!~'^[0-9]{1,64}$' or p_proof->>'phone_number_id'!~'^[0-9]{1,64}$'
 or p_proof->>'code_verification_status' is distinct from 'VERIFIED' or p_proof->>'platform_type' is distinct from 'CLOUD_API'
 or p_proof->'registered' is distinct from 'true'::jsonb or p_proof->'subscribed' is distinct from 'true'::jsonb or p_proof->'is_on_biz_app' is distinct from 'false'::jsonb
 or jsonb_typeof(p_proof->'scopes') is distinct from 'array' or not (p_proof->'scopes' @> '["whatsapp_business_management","whatsapp_business_messaging"]'::jsonb)
 or jsonb_typeof(p_proof->'granular_scopes') is distinct from 'array'
 or not exists(select 1 from jsonb_array_elements(p_proof->'granular_scopes') g where g->>'scope'='whatsapp_business_management' and g->'target_ids' @> jsonb_build_array(p_proof->>'waba_id'))
 or not exists(select 1 from jsonb_array_elements(p_proof->'granular_scopes') g where g->>'scope'='whatsapp_business_messaging' and g->'target_ids' @> jsonb_build_array(p_proof->>'waba_id'))
 or nullif(p_proof->>'display_phone_number','') is null or length(p_proof->>'display_phone_number')>40 then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
 begin
  exp:=(p_proof->>'expires_at')::bigint;data_exp:=(p_proof->>'data_access_expires_at')::bigint;
  if exp is null or data_exp is null or exp<0 or data_exp<0 then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
  deadline:=case when exp=0 and data_exp=0 then null when exp=0 then to_timestamp(data_exp) when data_exp=0 then to_timestamp(exp) else to_timestamp(least(exp,data_exp)) end;
  if (deadline is not null and deadline<=clock_timestamp()) or (p_proof->>'authorization_expires_at')::timestamptz is distinct from deadline
  or (p_proof->>'verified_at')::timestamptz is null or (p_proof->>'verified_at')::timestamptz<now()-interval '5 minutes' or (p_proof->>'verified_at')::timestamptz>now()+interval '1 minute' then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
 exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end;
 if not exists(select 1 from pg_extension where extname='supabase_vault') or to_regclass('vault.secrets') is null or to_regprocedure('vault.create_secret(text,text,text,uuid)') is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
 -- Serialize against exact WABA revocation, including events arriving before a link exists.
 if exists(select 1 from private.whatsapp_meta_authorization_revocations r where r.waba_id=p_proof->>'waba_id' and (p_proof->>'verified_at')::timestamptz<=r.occurred_at+interval '1 second') then return jsonb_build_object('ok',false,'code','AUTHORIZATION_REVOKED');end if;
 if exists(select 1 from public.whatsapp_company_links x where x.company_id<>a.company_id and x.status='verified' and x.provider_phone_number_id=p_proof->>'phone_number_id') then return jsonb_build_object('ok',false,'code','ASSET_ALREADY_LINKED');end if;
 execute 'select vault.create_secret($1,$2,$3)' into secret_id using p_access_token,'velora-wa-'||a.id::text,'Verified Meta business authorization';
 insert into public.whatsapp_company_links(company_id,status,provider_phone_number_id,provider_waba_id,verified_display_number,keep_on_phone,access_secret_id,authorization_status,authorization_expires_at,authorization_verified_at,authorization_app_id,authorization_scopes,authorization_user_id,authorization_session_id,authorization_non_expiring)
 values(a.company_id,'verified',p_proof->>'phone_number_id',p_proof->>'waba_id',p_proof->>'display_phone_number',false,secret_id,'active',deadline,now(),a.app_id,p_proof->'scopes',a.user_id,a.session_id,exp=0 and data_exp=0)
 on conflict(company_id) do update set status='verified',provider_phone_number_id=excluded.provider_phone_number_id,provider_waba_id=excluded.provider_waba_id,verified_display_number=excluded.verified_display_number,keep_on_phone=false,access_secret_id=excluded.access_secret_id,authorization_status='active',authorization_expires_at=excluded.authorization_expires_at,authorization_verified_at=excluded.authorization_verified_at,authorization_app_id=excluded.authorization_app_id,authorization_scopes=excluded.authorization_scopes,authorization_user_id=excluded.authorization_user_id,authorization_session_id=excluded.authorization_session_id,authorization_non_expiring=excluded.authorization_non_expiring,inbound_tested_at=null,outbound_tested_at=null,last_error_code=null,updated_at=now();
 if l.access_secret_id is not null then execute 'delete from vault.secrets where id=$1' using l.access_secret_id;end if;
 update public.whatsapp_embedded_signup_attempts set status='completed' where id=a.id;
 return jsonb_build_object('ok',true,'company_id',a.company_id);
end;$$;

create function public.whatsapp_fail_embedded_signup(p_attempt_id uuid,p_user_id uuid,p_session_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 update public.whatsapp_embedded_signup_attempts set status=case when p_code='RECONCILIATION_REQUIRED' then 'reconcile_required' else 'failed' end,last_error_code=case when p_code in ('RECONCILIATION_REQUIRED','META_UNAVAILABLE','META_AUTHORIZATION_REJECTED','META_ASSET_REJECTED','INVALID_INPUT','NEEDS_SETUP') then p_code else 'UNAVAILABLE' end
 where id=p_attempt_id and user_id=p_user_id and session_id=p_session_id and status='code_received';return jsonb_build_object('ok',found);
end;$$;

create function private.whatsapp_clear_link_authorization(p_link_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$ declare secret_id uuid;begin
 select access_secret_id into secret_id from public.whatsapp_company_links where id=p_link_id for update;
 if not found then return false;end if;
 update public.whatsapp_company_links set status='disconnected',authorization_status='revoked',access_secret_id=null,last_error_code=p_reason,updated_at=now() where id=p_link_id;
 if secret_id is not null and to_regclass('vault.secrets') is not null then execute 'delete from vault.secrets where id=$1' using secret_id;end if;
 return true;
end;$$;
revoke all on function private.whatsapp_clear_link_authorization(uuid,text) from public,anon,authenticated;

create function public.whatsapp_disconnect_embedded_signup(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$ declare sid uuid;link_id uuid;begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 perform 1 from public.companies where id=p_company_id for update;
 if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 update public.whatsapp_embedded_signup_attempts set status='cancelled',consumed_at=coalesce(consumed_at,now()) where company_id=p_company_id and status in ('in_progress','code_received');
 select id into link_id from public.whatsapp_company_links where company_id=p_company_id;
 if link_id is not null then perform private.whatsapp_clear_link_authorization(link_id,'OWNER_DISCONNECTED');end if;
 return jsonb_build_object('ok',true);
end;$$;

create function public.whatsapp_revoke_link_authorization(p_link_id uuid,p_waba_id text,p_phone_number_id text,p_reason text,p_occurred_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$ declare company uuid;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_waba_id is null then return false;end if;
 perform pg_catalog.pg_advisory_xact_lock(87420104,pg_catalog.hashtext(p_waba_id));
 select company_id into company from public.whatsapp_company_links where id=p_link_id and provider_waba_id=p_waba_id and provider_phone_number_id=p_phone_number_id;
 if not found then return false;end if;
 perform 1 from public.companies where id=company for update;
 if p_occurred_at is null or p_occurred_at>clock_timestamp() or not exists(select 1 from public.whatsapp_company_links where id=p_link_id and provider_waba_id=p_waba_id and provider_phone_number_id=p_phone_number_id and authorization_verified_at<=p_occurred_at+interval '1 second') then return false;end if;
 return private.whatsapp_clear_link_authorization(p_link_id,case when p_reason='PARTNER_REMOVED' then p_reason else 'META_AUTHORIZATION_REVOKED' end);
end;$$;

create function public.whatsapp_revoke_meta_waba_authorization(p_waba_id text,p_reason text,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$ declare l record;n integer:=0;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_waba_id is null or p_waba_id!~'^[0-9]{1,64}$' or p_reason is distinct from 'PARTNER_REMOVED' or p_occurred_at is null or p_occurred_at>clock_timestamp() then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 -- WABA lock is acquired before company locks, as in finalization below.
 perform pg_catalog.pg_advisory_xact_lock(87420104,pg_catalog.hashtext(p_waba_id));
 insert into private.whatsapp_meta_authorization_revocations(waba_id,occurred_at) values(p_waba_id,p_occurred_at)
 on conflict(waba_id) do update set occurred_at=greatest(private.whatsapp_meta_authorization_revocations.occurred_at,excluded.occurred_at);
 for l in select id,provider_phone_number_id from public.whatsapp_company_links where provider_waba_id=p_waba_id order by company_id loop
  if public.whatsapp_revoke_link_authorization(l.id,p_waba_id,l.provider_phone_number_id,p_reason,p_occurred_at) then n:=n+1;end if;
 end loop;return jsonb_build_object('ok',true,'revoked',n);
end;$$;

create or replace function private.whatsapp_company_link_bump_generation()
returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='UPDATE' and (old.status,old.provider_phone_number_id,old.provider_waba_id,old.access_secret_id,old.authorization_status,old.authorization_expires_at,old.authorization_app_id,old.authorization_scopes,old.authorization_non_expiring)
 is distinct from (new.status,new.provider_phone_number_id,new.provider_waba_id,new.access_secret_id,new.authorization_status,new.authorization_expires_at,new.authorization_app_id,new.authorization_scopes,new.authorization_non_expiring) then new.generation:=old.generation+1;end if;
 return new;
end;$$;

create or replace function public.whatsapp_read_link_access_secret(p_company_id uuid,p_link_id uuid,p_phone_number_id text,p_link_generation bigint)
returns jsonb language plpgsql security definer set search_path='' as $$ declare secret_id uuid;token text;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select l.access_secret_id into secret_id from public.whatsapp_company_links l join public.companies c on c.id=l.company_id
 where l.id=p_link_id and l.company_id=p_company_id and c.status<>'suspended' and l.status='verified'
 and l.provider_phone_number_id=p_phone_number_id and l.generation=p_link_generation and l.authorization_status='active'
 and l.provider_waba_id is not null and l.authorization_app_id is not null and l.authorization_verified_at is not null
 and l.authorization_scopes @> '["whatsapp_business_management","whatsapp_business_messaging"]'::jsonb
 and l.authorization_user_id is not null and l.authorization_session_id is not null
 and (l.authorization_expires_at>now() or (l.authorization_expires_at is null and l.authorization_non_expiring));
 if secret_id is null or not exists(select 1 from pg_extension where extname='supabase_vault') or to_regclass('vault.decrypted_secrets') is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where id=$1' into token using secret_id;
 if nullif(btrim(token),'') is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
 return jsonb_build_object('ok',true,'access_token',token,'company_id',p_company_id,'link_id',p_link_id,'phone_number_id',p_phone_number_id,'link_generation',p_link_generation);
end;$$;
create or replace function private.whatsapp_guard_persisted_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_message public.whatsapp_messages%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_link public.whatsapp_company_links%rowtype;
begin
  if tg_table_name='whatsapp_conversations' then
    if (new.id,new.company_id,new.phone_number_id,new.customer_wa_id,new.created_at)
      is distinct from (old.id,old.company_id,old.phone_number_id,old.customer_wa_id,old.created_at) then
      raise exception 'wa_conversation_identity_immutable' using errcode='23514';
    end if;
  elsif tg_table_name='whatsapp_company_links' then
    if (new.id,new.company_id,new.created_at) is distinct from (old.id,old.company_id,old.created_at) then
      raise exception 'wa_link_identity_immutable' using errcode='23514';
    end if;
    if new.generation is distinct from (case when (new.status,new.provider_phone_number_id,new.provider_waba_id,new.access_secret_id,new.authorization_status,new.authorization_expires_at,new.authorization_app_id,new.authorization_scopes,new.authorization_non_expiring)
      is distinct from (old.status,old.provider_phone_number_id,old.provider_waba_id,old.access_secret_id,old.authorization_status,old.authorization_expires_at,old.authorization_app_id,old.authorization_scopes,old.authorization_non_expiring) then old.generation+1 else old.generation end) then
      raise exception 'wa_link_generation_invalid' using errcode='23514';
    end if;
  elsif tg_table_name='whatsapp_messages' then
    if tg_op='INSERT' then
      -- Same lock namespace as atomic inbound save and status insertion. Acquire
      -- only on INSERT, never after an existing message row lock in rebind.
      perform pg_catalog.pg_advisory_xact_lock(87420101,pg_catalog.hashtext(new.wa_message_id));
      if new.delivery_state is not null and new.delivery_state<>'accepted' then
        raise exception 'wa_delivery_initial_state_invalid' using errcode='23514';
      end if;
      if new.delivery_rank<>coalesce(private.whatsapp_delivery_rank(new.delivery_state),0)
        or (new.direction='inbound' and (new.delivery_state is not null or new.delivery_updated_at is not null)) then
        raise exception 'wa_delivery_initial_snapshot_invalid' using errcode='23514';
      end if;
    else
      if (new.id,new.company_id,new.conversation_id,new.wa_message_id,new.direction,new.sender,new.body,new.message_type,new.received_at,new.created_at)
        is distinct from (old.id,old.company_id,old.conversation_id,old.wa_message_id,old.direction,old.sender,old.body,old.message_type,old.received_at,old.created_at) then
        raise exception 'wa_message_identity_immutable' using errcode='23514';
      end if;
      if (new.delivery_state,new.delivery_rank,new.delivery_updated_at)
        is distinct from (old.delivery_state,old.delivery_rank,old.delivery_updated_at) then
        if new.direction<>'outbound'
          or new.delivery_rank<>private.whatsapp_delivery_rank(new.delivery_state)
          or not coalesce(private.whatsapp_delivery_may_advance(old.delivery_state,old.delivery_updated_at,new.delivery_state,new.delivery_updated_at),false)
          or not exists (
            select 1 from public.whatsapp_delivery_statuses s
            join public.whatsapp_conversations c on c.id=new.conversation_id and c.company_id=new.company_id
            where s.company_id=new.company_id and s.wa_message_id=new.wa_message_id
              and s.phone_number_id=c.phone_number_id and s.recipient_wa_id=c.customer_wa_id
              and (case when pg_catalog.lower(s.status)='accepted' then 'sent' else pg_catalog.lower(s.status) end)=new.delivery_state
              and s.occurred_at=new.delivery_updated_at
          ) then
          raise exception 'wa_delivery_snapshot_unproven' using errcode='23514';
        end if;
      end if;
    end if;
  elsif tg_table_name='whatsapp_inbound_jobs' then
    if tg_op='UPDATE' and (new.id,new.company_id,new.message_id,new.wa_message_id,new.created_at)
      is distinct from (old.id,old.company_id,old.message_id,old.wa_message_id,old.created_at) then
      raise exception 'wa_job_identity_immutable' using errcode='23514';
    end if;
    select * into v_message from public.whatsapp_messages where id=new.message_id;
    if not found or (new.company_id,new.wa_message_id) is distinct from (v_message.company_id,v_message.wa_message_id)
      or v_message.direction<>'inbound' or v_message.sender<>'customer' then
      raise exception 'wa_job_message_identity_invalid' using errcode='23514';
    end if;
  elsif tg_table_name='whatsapp_send_intents' then
    if tg_op='UPDATE' then
      if (new.id,new.company_id,new.client_op_id,new.conversation_id,new.phone_number_id,new.recipient_wa_id,new.body,new.sender_kind,new.actor_user_id,new.expected_automation_generation,new.link_id,new.link_generation,new.created_at)
        is distinct from (old.id,old.company_id,old.client_op_id,old.conversation_id,old.phone_number_id,old.recipient_wa_id,old.body,old.sender_kind,old.actor_user_id,old.expected_automation_generation,old.link_id,old.link_generation,old.created_at)
        or (old.wa_message_id is not null and new.wa_message_id is distinct from old.wa_message_id)
        or (old.message_id is not null and new.message_id is distinct from old.message_id) then
        raise exception 'wa_send_intent_identity_immutable' using errcode='23514';
      end if;
    elsif new.link_id is not null then
      select * into v_link from public.whatsapp_company_links where id=new.link_id for share;
      if not found or (new.company_id,new.phone_number_id,new.link_generation)
        is distinct from (v_link.company_id,v_link.provider_phone_number_id,v_link.generation) or v_link.status<>'verified' then
        raise exception 'wa_send_intent_link_identity_invalid' using errcode='23514';
      end if;
    end if;
    if new.message_id is not null then
      select * into v_message from public.whatsapp_messages where id=new.message_id;
      if not found or (new.company_id,new.conversation_id,new.wa_message_id,new.body,new.sender_kind)
        is distinct from (v_message.company_id,v_message.conversation_id,v_message.wa_message_id,v_message.body,v_message.sender)
        or v_message.direction<>'outbound' then
        raise exception 'wa_send_intent_message_identity_invalid' using errcode='23514';
      end if;
    end if;
  elsif tg_table_name='whatsapp_conversation_events' then
    if new is distinct from old then
      raise exception 'wa_control_event_immutable' using errcode='23514';
    end if;
  elsif tg_table_name='whatsapp_delivery_statuses' then
    if tg_op='UPDATE' and ((new.id,new.company_id,new.phone_number_id,new.wa_message_id,new.status,new.recipient_wa_id,new.occurred_at,new.created_at)
      is distinct from (old.id,old.company_id,old.phone_number_id,old.wa_message_id,old.status,old.recipient_wa_id,old.occurred_at,old.created_at)
      or (old.message_id is not null and new.message_id is distinct from old.message_id)) then
      raise exception 'wa_delivery_event_identity_immutable' using errcode='23514';
    end if;
    if new.message_id is not null then
      select * into v_message from public.whatsapp_messages where id=new.message_id;
      select * into v_conversation from public.whatsapp_conversations where id=v_message.conversation_id;
      if v_message.id is null or v_conversation.id is null or v_message.direction<>'outbound'
        or (new.company_id,new.wa_message_id,new.phone_number_id,new.recipient_wa_id)
          is distinct from (v_message.company_id,v_message.wa_message_id,v_conversation.phone_number_id,v_conversation.customer_wa_id) then
        raise exception 'wa_delivery_event_binding_invalid' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.whatsapp_company_link_public(p_row public.whatsapp_company_links,p_include_admin boolean default false)
returns jsonb language sql stable set search_path='' as $$
 with validity as (select coalesce(p_row.authorization_status='active' and p_row.authorization_verified_at is not null
 and p_row.authorization_app_id is not null and p_row.provider_waba_id is not null and p_row.access_secret_id is not null
 and p_row.authorization_user_id is not null and p_row.authorization_session_id is not null
 and p_row.authorization_scopes @> '["whatsapp_business_management","whatsapp_business_messaging"]'::jsonb
 and (p_row.authorization_expires_at>now() or (p_row.authorization_expires_at is null and p_row.authorization_non_expiring)),false) as active)
 select jsonb_build_object('id',p_row.id,'company_id',p_row.company_id,'requested_display_number',p_row.requested_display_number,'keep_on_phone',p_row.keep_on_phone,
 'status',case when p_row.status='verified' and not validity.active then 'error' else p_row.status end,
 'verified_display_number',p_row.verified_display_number,'inbound_tested_at',p_row.inbound_tested_at,'outbound_tested_at',p_row.outbound_tested_at,
 'reception_send_tested',p_row.status='verified' and validity.active and p_row.inbound_tested_at is not null and p_row.outbound_tested_at is not null,
 'prior_link_evidence',(p_row.status is distinct from 'verified' or not validity.active) and (p_row.verified_display_number is not null or p_row.inbound_tested_at is not null or p_row.outbound_tested_at is not null or (p_include_admin and p_row.provider_phone_number_id is not null)),
 'last_error_code',case when p_row.status='verified' and not validity.active then 'REAUTHORIZATION_REQUIRED' else p_row.last_error_code end,
 'authorization_expires_at',p_row.authorization_expires_at,'authorization_ready',validity.active,
 'created_at',p_row.created_at,'updated_at',p_row.updated_at,'admin_note',case when p_include_admin then p_row.admin_note else null end,
 'provider_phone_number_id',case when p_include_admin then p_row.provider_phone_number_id else null end) from validity;
$$;

-- A confirmed OAuth token rejection invalidates only the generation that sent it.
-- An old request cannot revoke a concurrently renewed business credential.
create function public.whatsapp_revoke_failed_credential(p_company_id uuid,p_link_id uuid,p_phone_number_id text,p_link_generation bigint,p_provider_code integer)
returns boolean language plpgsql security definer set search_path='' as $$ begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_provider_code is distinct from 190 then return false;end if;
 perform 1 from public.companies where id=p_company_id for update;
 perform 1 from public.whatsapp_company_links where id=p_link_id and company_id=p_company_id
 and provider_phone_number_id=p_phone_number_id and generation=p_link_generation for update;
 if not found then return false;end if;
 return private.whatsapp_clear_link_authorization(p_link_id,'META_TOKEN_INVALID');
end;$$;

-- Record confirmed provider rejection and revoke its exact credential atomically.
alter function public.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid) set schema private;
alter function private.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid) rename to wa_finalize_pre_meta_signup;
revoke all on function private.wa_finalize_pre_meta_signup(uuid,uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
create function public.finalize_whatsapp_send_attempt(p_intent_id uuid,p_attempt_token uuid,p_result text,p_wa_message_id text default null,p_error_code text default null,p_actor_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;i public.whatsapp_send_intents%rowtype;company uuid;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 -- Intent company is immutable. Preserve the common company -> intent lock order.
 select company_id into company from public.whatsapp_send_intents where id=p_intent_id;
 if company is not null then perform 1 from public.companies where id=company for update;end if;
 r:=private.wa_finalize_pre_meta_signup(p_intent_id,p_attempt_token,p_result,p_wa_message_id,p_error_code,p_actor_user_id);
 if r->>'ok'='true' and p_result='rejected' and p_error_code='graph_190' then
  select * into i from public.whatsapp_send_intents where id=p_intent_id and outcome='rejected' and provider_error_code='graph_190';
  if i.link_id is not null and i.link_generation is not null then
   perform public.whatsapp_revoke_failed_credential(i.company_id,i.link_id,i.phone_number_id,i.link_generation,190);
  end if;
 end if;
 return r;
end;$$;

do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('whatsapp_embedded_signup_readiness','whatsapp_start_embedded_signup','whatsapp_claim_embedded_signup','whatsapp_cancel_embedded_signup','whatsapp_disconnect_embedded_signup') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to authenticated',f);end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('whatsapp_finalize_embedded_signup','whatsapp_fail_embedded_signup','whatsapp_revoke_link_authorization','whatsapp_revoke_meta_waba_authorization','whatsapp_read_link_access_secret','whatsapp_revoke_failed_credential','finalize_whatsapp_send_attempt') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);end loop;
end;$$;
notify pgrst,'reload schema';
commit;

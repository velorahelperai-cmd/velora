-- Forward policy: signed WABA/phone tenant binding and freeform service windows.
-- Reuses existing durable inbound jobs, send intents and AI reservations.
begin;
-- Preserve ingress order even when several messages are stored in one transaction.
alter table public.whatsapp_inbound_jobs alter column created_at set default clock_timestamp();

create function private.whatsapp_meta_asset_binding(p_waba_id text,p_phone_number_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.whatsapp_company_links%rowtype; state text;cid uuid;begin
 if nullif(p_waba_id,'') is null or p_waba_id<>btrim(p_waba_id)
 or nullif(p_phone_number_id,'') is null or p_phone_number_id<>btrim(p_phone_number_id)
 then return jsonb_build_object('ok',false,'eligible',false,'code','invalid_input');end if;
 -- Discover without a lock, then retain company -> link lock ordering used by workers.
 select x.company_id into cid from public.whatsapp_company_links x where x.provider_waba_id=p_waba_id
 and x.provider_phone_number_id=p_phone_number_id and x.status='verified';
 if cid is null then return jsonb_build_object('ok',false,'eligible',false,'code','unknown_or_inactive');end if;
 select c.status into state from public.companies c where c.id=cid for share;
 if state is null or state='suspended' then return jsonb_build_object('ok',false,'eligible',false,'code','company_suspended');end if;
 -- Revalidate after the company lock; share lock retains exact authorization.
 select x.* into l from public.whatsapp_company_links x
 where x.company_id=cid and x.provider_waba_id=p_waba_id and x.provider_phone_number_id=p_phone_number_id
 and x.status='verified' and x.authorization_status='active' and x.authorization_verified_at is not null
 and x.authorization_app_id is not null and x.authorization_user_id is not null and x.authorization_session_id is not null
 and x.authorization_scopes @> '["whatsapp_business_management","whatsapp_business_messaging"]'::jsonb
 and x.authorization_verified_at<=clock_timestamp() and x.access_secret_id is not null
 and (x.authorization_expires_at>clock_timestamp() or (x.authorization_expires_at is null and x.authorization_non_expiring)) for share;
 if not found then return jsonb_build_object('ok',false,'eligible',false,'code','unknown_or_inactive');end if;
 return jsonb_build_object('ok',true,'eligible',true,'company_id',l.company_id,'link_id',l.id,
   'generation',l.generation,'link_generation',l.generation,'provider_waba_id',l.provider_waba_id,
   'provider_phone_number_id',l.provider_phone_number_id,'status',l.status);
end; $$;
revoke all on function private.whatsapp_meta_asset_binding(text,text) from public,anon,authenticated,service_role;

create function public.resolve_whatsapp_company_by_meta_asset(p_waba_id text,p_provider_phone_number_id text)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 return private.whatsapp_meta_asset_binding(p_waba_id,p_provider_phone_number_id);
end; $$;

-- Only the signed Meta ingress wrapper can mint this evidence. Existing service
-- table writes and the legacy inbound RPC remain unable to open a service window.
create table private.whatsapp_meta_inbound_evidence(
 message_id uuid primary key,
 company_id uuid not null,
 conversation_id uuid not null,
 wa_message_id text not null,
 waba_id text not null check(length(btrim(waba_id))>0 and waba_id=btrim(waba_id)),
 phone_number_id text not null,
 received_at timestamptz not null,
 verified_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,conversation_id,message_id,wa_message_id)
   references public.whatsapp_messages(company_id,conversation_id,id,wa_message_id) on delete cascade
);
alter table private.whatsapp_meta_inbound_evidence enable row level security;
revoke all on table private.whatsapp_meta_inbound_evidence from public,anon,authenticated,service_role;
create index whatsapp_meta_window_idx on private.whatsapp_meta_inbound_evidence(company_id,conversation_id,received_at desc);

create function public.whatsapp_store_meta_inbound(p_company_id uuid,p_waba_id text,p_phone_number_id text,
 p_customer_wa_id text,p_customer_name text,p_wa_message_id text,p_body text,p_message_type text,p_received_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gate jsonb;r jsonb;m public.whatsapp_messages%rowtype;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 gate:=private.whatsapp_meta_asset_binding(p_waba_id,p_phone_number_id);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 if gate->>'company_id' is distinct from p_company_id::text
 then return jsonb_build_object('ok',false,'code','binding_mismatch');end if;
 r:=public.save_whatsapp_inbound(p_company_id,p_phone_number_id,p_customer_wa_id,p_customer_name,p_wa_message_id,p_body,p_message_type,p_received_at);
 if r->>'ok' is distinct from 'true' then return r;end if;
 -- Replay uses immutable stored provider time. A pre-existing legacy row cannot
 -- acquire new provenance from a replay and a changed timestamp cannot extend it.
 if r->>'inserted'='true' and p_received_at<=clock_timestamp() then
 select * into m from public.whatsapp_messages where id=(r->>'message_id')::uuid;
 insert into private.whatsapp_meta_inbound_evidence(message_id,company_id,conversation_id,wa_message_id,waba_id,phone_number_id,received_at)
 values(m.id,m.company_id,m.conversation_id,m.wa_message_id,p_waba_id,p_phone_number_id,m.received_at) on conflict do nothing;
 end if;
 return r;
end; $$;

create function public.whatsapp_apply_meta_delivery_status(p_company_id uuid,p_waba_id text,p_phone_number_id text,
 p_wa_message_id text,p_status text,p_recipient_wa_id text,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$ declare gate jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 gate:=private.whatsapp_meta_asset_binding(p_waba_id,p_phone_number_id);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 if gate->>'company_id' is distinct from p_company_id::text
 then return jsonb_build_object('ok',false,'code','binding_mismatch');end if;
 return public.apply_whatsapp_delivery_status(p_company_id,p_phone_number_id,p_wa_message_id,p_status,p_recipient_wa_id,p_occurred_at);
end; $$;

create function private.whatsapp_service_window(p_company_id uuid,p_conversation_id uuid,p_phone_number_id text,p_recipient_wa_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare last_inbound timestamptz;now_at timestamptz:=clock_timestamp();waba text;gate jsonb;begin
 if not exists(select 1 from public.whatsapp_conversations c where c.id=p_conversation_id and c.company_id=p_company_id
 and c.phone_number_id=p_phone_number_id and c.customer_wa_id=p_recipient_wa_id)
 then return jsonb_build_object('ok',false,'code','service_window_closed');end if;
 select provider_waba_id into waba from public.whatsapp_company_links where company_id=p_company_id
 and status='verified' and provider_phone_number_id=p_phone_number_id;
 gate:=private.whatsapp_meta_asset_binding(waba,p_phone_number_id);
 if gate->>'ok' is distinct from 'true' or gate->>'company_id' is distinct from p_company_id::text
 then return jsonb_build_object('ok',false,'code','service_window_closed');end if;
 select max(m.received_at) into last_inbound from private.whatsapp_meta_inbound_evidence e
 join public.whatsapp_messages m on (m.company_id,m.conversation_id,m.id,m.wa_message_id,m.received_at)
   =(e.company_id,e.conversation_id,e.message_id,e.wa_message_id,e.received_at)
 where e.company_id=p_company_id and e.conversation_id=p_conversation_id and e.phone_number_id=p_phone_number_id
 and e.waba_id=waba and m.direction='inbound' and m.sender='customer'
 and m.received_at<=now_at and m.received_at>now_at-interval '24 hours';
 if last_inbound is null then return jsonb_build_object('ok',false,'code','service_window_closed');end if;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'conversation_id',p_conversation_id,
 'phone_number_id',p_phone_number_id,'recipient_wa_id',p_recipient_wa_id,
 'last_inbound_at',last_inbound,'valid_until',last_inbound+interval '24 hours');
end; $$;
revoke all on function private.whatsapp_service_window(uuid,uuid,text,text) from public,anon,authenticated,service_role;

create function public.whatsapp_check_service_window(p_company_id uuid,p_conversation_id uuid,p_phone_number_id text,p_recipient_wa_id text)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 return private.whatsapp_service_window(p_company_id,p_conversation_id,p_phone_number_id,p_recipient_wa_id);
end; $$;

create function private.whatsapp_job_service_window(p_job_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;c public.whatsapp_conversations%rowtype;begin
 j:=private.wa_worker_lock(p_job_id,p_claim_token);
 if j.id is null then return jsonb_build_object('ok',false,'code','claim_or_automation_rejected');end if;
 select x.* into c from public.whatsapp_conversations x join public.whatsapp_messages m
 on m.company_id=x.company_id and m.conversation_id=x.id where m.id=j.message_id and m.company_id=j.company_id;
 return private.whatsapp_service_window(j.company_id,c.id,c.phone_number_id,c.customer_wa_id);
end; $$;
revoke all on function private.whatsapp_job_service_window(uuid,uuid) from public,anon,authenticated,service_role;

-- Wrap authorization points only. The shared worker lock and settlement/repair
-- functions remain usable after expiry so known paid cost can always be settled.
alter function public.billing_load_worker_frame(uuid,uuid) set schema private;
alter function private.billing_load_worker_frame(uuid,uuid) rename to wa_frame_pre_meta_policy;
revoke all on function private.wa_frame_pre_meta_policy(uuid,uuid) from public,anon,authenticated,service_role;
create function public.billing_load_worker_frame(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare gate jsonb;r jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 gate:=private.whatsapp_job_service_window(p_job_id,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 r:=private.wa_frame_pre_meta_policy(p_job_id,p_claim_token);
 if r->>'ok'='true' then r:=jsonb_set(r,'{data,service_window_expires_at}',gate->'valid_until');end if;
 return r;
end; $$;

alter function public.whatsapp_reserve_job_usage(uuid,uuid) set schema private;
alter function private.whatsapp_reserve_job_usage(uuid,uuid) rename to wa_reserve_usage_pre_meta_policy;
revoke all on function private.wa_reserve_usage_pre_meta_policy(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_reserve_job_usage(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare gate jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 gate:=private.whatsapp_job_service_window(p_job_id,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 return private.wa_reserve_usage_pre_meta_policy(p_job_id,p_claim_token);
end; $$;

alter function public.whatsapp_claim_assistant_job_send(uuid,uuid) set schema private;
alter function private.whatsapp_claim_assistant_job_send(uuid,uuid) rename to wa_claim_assistant_pre_meta_policy;
revoke all on function private.wa_claim_assistant_pre_meta_policy(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_claim_assistant_job_send(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare gate jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 gate:=private.whatsapp_job_service_window(p_job_id,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 return private.wa_claim_assistant_pre_meta_policy(p_job_id,p_claim_token);
end; $$;

alter function public.claim_whatsapp_send_attempt(uuid,uuid,integer) set schema private;
alter function private.claim_whatsapp_send_attempt(uuid,uuid,integer) rename to wa_claim_staff_pre_meta_policy;
revoke all on function private.wa_claim_staff_pre_meta_policy(uuid,uuid,integer) from public,anon,authenticated,service_role;
create function public.claim_whatsapp_send_attempt(p_intent_id uuid,p_actor_user_id uuid,p_lease_seconds integer default 90)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.whatsapp_send_intents%rowtype;gate jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 if i.sender_kind='assistant' then return jsonb_build_object('ok',false,'code','assistant_job_required');end if;
 gate:=private.whatsapp_service_window(i.company_id,i.conversation_id,i.phone_number_id,i.recipient_wa_id);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 return private.wa_claim_staff_pre_meta_policy(p_intent_id,p_actor_user_id,p_lease_seconds);
end; $$;

alter function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) set schema private;
alter function private.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) rename to wa_ai_reserve_pre_meta_policy;
revoke all on function private.wa_ai_reserve_pre_meta_policy(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.ai_reserve_whatsapp_attempt(p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,
 p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$ declare gate jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 gate:=private.whatsapp_job_service_window(p_job_id,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 return private.wa_ai_reserve_pre_meta_policy(p_id,p_job_id,p_claim_token,p_attempt,p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
end; $$;

alter function public.ai_start_whatsapp_attempt(uuid,uuid) set schema private;
alter function private.ai_start_whatsapp_attempt(uuid,uuid) rename to wa_ai_start_pre_meta_policy;
revoke all on function private.wa_ai_start_pre_meta_policy(uuid,uuid) from public,anon,authenticated,service_role;
create function public.ai_start_whatsapp_attempt(p_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$ declare j uuid;gate jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select worker_job_id into j from public.ai_usage_ledger where id=p_id and worker_claim_token=p_claim_token;
 if j is null then return false;end if;
 gate:=private.whatsapp_job_service_window(j,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return false;end if;
 return private.wa_ai_start_pre_meta_policy(p_id,p_claim_token);
end; $$;

do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('resolve_whatsapp_company_by_meta_asset','whatsapp_store_meta_inbound',
 'whatsapp_apply_meta_delivery_status','whatsapp_check_service_window','billing_load_worker_frame','whatsapp_reserve_job_usage',
 'whatsapp_claim_assistant_job_send','claim_whatsapp_send_attempt','ai_reserve_whatsapp_attempt','ai_start_whatsapp_attempt') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to service_role',f);
 end loop;
end; $$;
notify pgrst,'reload schema';
commit;

-- Forward review package; do not apply to production without the release gate.
-- Requires the baseline through 20261010100003 and 20-signup.review.sql.
-- Only a server that has verified the raw Meta webhook signature may call ingress.
-- No provider HTTP, AI jobs, send intents, usage, registration or deregistration.
begin;

do $$ begin
 if to_regclass('private.whatsapp_coexistence_connections') is null
 or to_regprocedure('private.whatsapp_meta_asset_binding(text,text)') is null
 or to_regclass('private.whatsapp_meta_inbound_evidence') is null then
  raise exception 'COEXISTENCE_PROJECTION_PREREQUISITES_MISSING';
 end if;
end; $$;

create table private.whatsapp_coexistence_events(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 link_id uuid not null,link_generation bigint not null check(link_generation>=1),
 waba_id text not null check(waba_id ~ '^[0-9]{1,64}$'),
 phone_number_id text not null check(phone_number_id ~ '^[0-9]{1,64}$'),
 display_phone_number text,
 kind text not null check(kind in ('live_inbound','history','mobile_echo','history_chunk','contact','history_media','partner_removed')),
 event_key text not null check(char_length(event_key) between 1 and 512 and event_key !~ '[[:cntrl:]]'),
 customer_wa_id text,wa_message_id text,direction text,message_type text,body text,
 provider_occurred_at timestamptz,contact_action text,contact_name text,
 history_phase integer,history_chunk_order integer,history_progress integer,history_error_code integer,
 disconnection_reason text,initiated_by text,media_id text,
 projection_status text not null default 'pending' check(projection_status in ('projected','pending','conflict_review')),
 projection_error text,message_id uuid,stored_at timestamptz not null default clock_timestamp(),
 unique(company_id,link_id,link_generation,kind,event_key),
 foreign key(company_id,link_id) references public.whatsapp_company_links(company_id,id),
 foreign key(company_id,message_id,wa_message_id) references public.whatsapp_messages(company_id,id,wa_message_id),
 check(customer_wa_id is null or customer_wa_id ~ '^[0-9]{1,20}$'),
 check(wa_message_id is null or (char_length(wa_message_id) between 1 and 512 and wa_message_id !~ '[[:space:][:cntrl:]]')),
 check(direction is null or direction in ('inbound','outbound')),
 check(message_type is null or message_type ~ '^[a-z][a-z0-9_]{0,31}$'),
 check(body is null or (char_length(body)<=4096 and octet_length(body)<=16384)),
 check(provider_occurred_at is null or (isfinite(provider_occurred_at) and provider_occurred_at>'1970-01-01'::timestamptz)),
 check(contact_action is null or contact_action in ('add','remove')),
 check(contact_name is null or char_length(contact_name)<=256),
 check(history_phase is null or history_phase between 0 and 2),
 check(history_chunk_order is null or history_chunk_order>=0),
 check(history_progress is null or history_progress between 0 and 100),
 check(history_error_code is null or history_error_code>=0),
 check(disconnection_reason is null or char_length(disconnection_reason)<=512),
 check(initiated_by is null or initiated_by in ('USER','SYSTEM')),
 check(media_id is null or media_id ~ '^[0-9]{1,64}$')
);
create index whatsapp_coexistence_events_pending_idx on private.whatsapp_coexistence_events(company_id,link_id,link_generation,stored_at,id) where projection_status='pending';
create index whatsapp_coexistence_events_message_idx on private.whatsapp_coexistence_events(company_id,phone_number_id,wa_message_id) where wa_message_id is not null;
create index whatsapp_coexistence_events_lifecycle_idx on private.whatsapp_coexistence_events(waba_id,event_key) where kind='partner_removed';
alter table private.whatsapp_coexistence_events enable row level security;
revoke all on private.whatsapp_coexistence_events from public,anon,authenticated,service_role;

-- Conflicting replay fingerprints are bounded evidence. Original scalars remain
-- immutable; a conflicting payload is never permitted to replace a message.
create table private.whatsapp_coexistence_event_conflicts(
 receipt_id uuid not null references private.whatsapp_coexistence_events(id) on delete cascade,
 identity_hash text not null check(identity_hash ~ '^[0-9a-f]{32}$'),
 display_phone_number text,customer_wa_id text,wa_message_id text,direction text,message_type text,body text,
 provider_occurred_at timestamptz,contact_action text,contact_name text,history_phase integer,history_chunk_order integer,
 history_progress integer,history_error_code integer,disconnection_reason text,initiated_by text,media_id text,
 detected_at timestamptz not null default clock_timestamp(),primary key(receipt_id,identity_hash)
);
alter table private.whatsapp_coexistence_event_conflicts enable row level security;
revoke all on private.whatsapp_coexistence_event_conflicts from public,anon,authenticated,service_role;

create table private.whatsapp_coexistence_message_sources(
 message_id uuid primary key,company_id uuid not null,conversation_id uuid not null,wa_message_id text not null,
 origin text not null check(origin in ('history','mobile_echo','live_inbound')),
 receipt_id uuid not null references private.whatsapp_coexistence_events(id),
 foreign key(company_id,conversation_id,message_id,wa_message_id)
  references public.whatsapp_messages(company_id,conversation_id,id,wa_message_id) on delete cascade
);
alter table private.whatsapp_coexistence_message_sources enable row level security;
revoke all on private.whatsapp_coexistence_message_sources from public,anon,authenticated,service_role;

create table private.whatsapp_coexistence_contacts(
 company_id uuid not null,link_id uuid not null,link_generation bigint not null,
 phone_number_id text not null,customer_wa_id text not null,contact_name text not null,
 removed boolean not null,provider_occurred_at timestamptz not null,
 receipt_id uuid not null references private.whatsapp_coexistence_events(id),
 primary key(company_id,link_id,link_generation,customer_wa_id),
 foreign key(company_id,link_id) references public.whatsapp_company_links(company_id,id)
);
alter table private.whatsapp_coexistence_contacts enable row level security;
revoke all on private.whatsapp_coexistence_contacts from public,anon,authenticated,service_role;

create table private.whatsapp_coexistence_history_phases(
 company_id uuid not null,link_id uuid not null,link_generation bigint not null,phase integer not null check(phase between 0 and 2),
 max_progress integer not null default 0 check(max_progress between 0 and 100),
 observed_chunks bigint not null default 0,declined boolean not null default false,
 last_receipt_id uuid not null references private.whatsapp_coexistence_events(id),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(company_id,link_id,link_generation,phase),
 foreign key(company_id,link_id) references public.whatsapp_company_links(company_id,id)
);
alter table private.whatsapp_coexistence_history_phases enable row level security;
revoke all on private.whatsapp_coexistence_history_phases from public,anon,authenticated,service_role;

-- Media metadata may arrive before the historical message. Keep the same provider
-- ID and immutable canonical placeholder; this table grants no download ability.
create table private.whatsapp_coexistence_history_media(
 company_id uuid not null,phone_number_id text not null,wa_message_id text not null,
 media_id text not null,media_type text not null,receipt_id uuid not null references private.whatsapp_coexistence_events(id),
 message_id uuid,primary key(company_id,phone_number_id,wa_message_id),
 foreign key(company_id,message_id,wa_message_id) references public.whatsapp_messages(company_id,id,wa_message_id)
);
alter table private.whatsapp_coexistence_history_media enable row level security;
revoke all on private.whatsapp_coexistence_history_media from public,anon,authenticated,service_role;

-- Subscription can deliver signed events after a secure token checkpoint but
-- before finalization commits a link. Capture those against the verified attempt
-- rather than inventing a connected row, tenant or generation.
create table private.whatsapp_coexistence_checkpoint_events(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,attempt_id uuid not null,
 waba_id text not null,phone_number_id text not null,display_phone_number text,
 kind text not null check(kind in ('live_inbound','history','mobile_echo','history_chunk','contact','history_media','partner_removed')),
 event_key text not null,identity_hash bytea not null check(octet_length(identity_hash)=32),
 customer_wa_id text,wa_message_id text,direction text,message_type text,body text,provider_occurred_at timestamptz,
 contact_action text,contact_name text,history_phase integer,history_chunk_order integer,history_progress integer,
 history_error_code integer,disconnection_reason text,initiated_by text,media_id text,
 projection_status text not null default 'pending' check(projection_status in ('pending','conflict_review','recovered')),
 recovered_receipt_id uuid references private.whatsapp_coexistence_events(id),stored_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,attempt_id) references private.whatsapp_coexistence_signup_attempts(company_id,id),
 unique(company_id,attempt_id,kind,event_key,identity_hash)
);
create index whatsapp_coexistence_checkpoint_events_pending_idx on private.whatsapp_coexistence_checkpoint_events(company_id,attempt_id,stored_at,id) where projection_status='pending';
create index whatsapp_coexistence_checkpoint_events_asset_idx on private.whatsapp_coexistence_checkpoint_events(waba_id,phone_number_id,kind,event_key);
alter table private.whatsapp_coexistence_checkpoint_events enable row level security;
revoke all on private.whatsapp_coexistence_checkpoint_events from public,anon,authenticated,service_role;

create function private.whatsapp_capture_checkpoint_event(
 p_waba_id text,p_phone_number_id text,p_display_phone_number text,p_kind text,p_event_key text,
 p_customer_wa_id text,p_wa_message_id text,p_direction text,p_message_type text,p_body text,p_provider_occurred_at timestamptz,
 p_contact_action text,p_contact_name text,p_history_phase integer,p_history_chunk_order integer,p_history_progress integer,
 p_history_error_code integer,p_disconnection_reason text,p_initiated_by text,p_media_id text
) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare a private.whatsapp_coexistence_signup_attempts%rowtype;s private.whatsapp_coexistence_checkpoint_events%rowtype;
 aid uuid;matches integer;proof_deadline timestamptz;h bytea;inserted boolean:=false;conflicted boolean:=false;gen bigint;
begin
 -- Private constructor: public ingress has already validated all bounded scalars.
 -- Repeat the app/scope/asset/current-owner/deadline gates after the company lock.
 -- A consumed nonce or initiator logout never discards known signed receipts.
 select count(*),(array_agg(x.id order by x.id))[1] into matches,aid from private.whatsapp_coexistence_signup_attempts x
 where x.status in ('token_checkpointed','reconcile_required') and x.pending_secret_id is not null
  and x.checkpoint_proof->>'waba_id'=p_waba_id
  and (p_phone_number_id is null or x.checkpoint_proof->>'phone_number_id'=p_phone_number_id)
  and (p_display_phone_number is null or regexp_replace(x.expected_phone_number,'[^0-9]','','g')=p_display_phone_number);
 if matches<>1 then return jsonb_build_object('ok',false,'durable',false,'code','CONNECTION_UNAVAILABLE');end if;
 select * into a from private.whatsapp_coexistence_signup_attempts where id=aid;
 perform 1 from public.companies where id=a.company_id for no key update;
 select generation into gen from public.whatsapp_company_links where company_id=a.company_id for update;
 select * into a from private.whatsapp_coexistence_signup_attempts where id=aid for update;
 proof_deadline:=(a.checkpoint_proof->>'authorization_expires_at')::timestamptz;
  if a.status not in ('token_checkpointed','reconcile_required') or a.pending_secret_id is null
  or not private.whatsapp_coexistence_receipt_owner_valid(a.company_id,a.user_id)
  or gen is distinct from a.base_link_generation
  or a.checkpoint_proof->>'app_id' is distinct from a.app_id
  or a.checkpoint_proof->>'waba_id' is distinct from p_waba_id
  or (p_phone_number_id is not null and a.checkpoint_proof->>'phone_number_id' is distinct from p_phone_number_id)
  or (p_display_phone_number is not null and regexp_replace(a.expected_phone_number,'[^0-9]','','g') is distinct from p_display_phone_number)
  or a.checkpoint_proof->'is_on_biz_app' is distinct from 'true'::jsonb
  or a.checkpoint_proof->>'platform_type' is distinct from 'CLOUD_API'
  or not(a.checkpoint_proof->'scopes' @> '["whatsapp_business_management","whatsapp_business_messaging"]'::jsonb)
  or (proof_deadline is not null and proof_deadline<=clock_timestamp())
  or exists(select 1 from private.whatsapp_meta_authorization_revocations x where x.waba_id=p_waba_id
   and (a.checkpoint_proof->>'verified_at')::timestamptz<=x.occurred_at+interval '1 second')
 then return jsonb_build_object('ok',false,'durable',false,'code','CONNECTION_UNAVAILABLE');end if;
 h:=sha256(convert_to(jsonb_build_array(p_display_phone_number,p_customer_wa_id,p_wa_message_id,p_direction,p_message_type,p_body,p_provider_occurred_at,
  p_contact_action,p_contact_name,p_history_phase,p_history_chunk_order,p_history_progress,p_history_error_code,p_disconnection_reason,p_initiated_by,p_media_id)::text,'UTF8'));
 select exists(select 1 from private.whatsapp_coexistence_checkpoint_events x where x.company_id=a.company_id and x.attempt_id=a.id and x.kind=p_kind and x.event_key=p_event_key and x.identity_hash<>h) into conflicted;
 insert into private.whatsapp_coexistence_checkpoint_events(company_id,attempt_id,waba_id,phone_number_id,display_phone_number,kind,event_key,identity_hash,
  customer_wa_id,wa_message_id,direction,message_type,body,provider_occurred_at,contact_action,contact_name,history_phase,history_chunk_order,
  history_progress,history_error_code,disconnection_reason,initiated_by,media_id,projection_status)
 values(a.company_id,a.id,p_waba_id,a.checkpoint_proof->>'phone_number_id',p_display_phone_number,p_kind,p_event_key,h,
  p_customer_wa_id,p_wa_message_id,p_direction,p_message_type,p_body,p_provider_occurred_at,p_contact_action,p_contact_name,p_history_phase,p_history_chunk_order,
  p_history_progress,p_history_error_code,p_disconnection_reason,p_initiated_by,p_media_id,case when conflicted then 'conflict_review' else 'pending' end)
 on conflict(company_id,attempt_id,kind,event_key,identity_hash) do nothing returning * into s;
 inserted:=s.id is not null;
 if not inserted then select * into s from private.whatsapp_coexistence_checkpoint_events where company_id=a.company_id and attempt_id=a.id and kind=p_kind and event_key=p_event_key and identity_hash=h for update;end if;
 if conflicted then
  update private.whatsapp_coexistence_checkpoint_events set projection_status='conflict_review' where company_id=a.company_id and attempt_id=a.id and kind=p_kind and event_key=p_event_key;
  s.projection_status:='conflict_review';
 end if;
 return jsonb_build_object('ok',true,'durable',true,'receipt_id',s.id,'event_key',s.event_key,'kind',s.kind,'waba_id',s.waba_id,
  'phone_number_id',s.phone_number_id,'display_phone_number',s.display_phone_number,'company_id',s.company_id,'binding_state','signup_checkpoint','signup_attempt_id',s.attempt_id,
  'link_id',null,'link_generation',null,'projection_status',s.projection_status,'inserted',inserted,'duplicate',not inserted,'message_inserted',false);
end; $$;
revoke all on function private.whatsapp_capture_checkpoint_event(text,text,text,text,text,text,text,text,text,text,timestamptz,text,text,integer,integer,integer,integer,text,text,text) from public,anon,authenticated,service_role;

create function private.whatsapp_coexistence_checkpoint_event_guard() returns trigger
language plpgsql set search_path='' as $$ begin
 if (new.id,new.company_id,new.attempt_id,new.waba_id,new.phone_number_id,new.display_phone_number,new.kind,new.event_key,new.identity_hash,
  new.customer_wa_id,new.wa_message_id,new.direction,new.message_type,new.body,new.provider_occurred_at,new.contact_action,new.contact_name,
  new.history_phase,new.history_chunk_order,new.history_progress,new.history_error_code,new.disconnection_reason,new.initiated_by,new.media_id,new.stored_at)
 is distinct from (old.id,old.company_id,old.attempt_id,old.waba_id,old.phone_number_id,old.display_phone_number,old.kind,old.event_key,old.identity_hash,
  old.customer_wa_id,old.wa_message_id,old.direction,old.message_type,old.body,old.provider_occurred_at,old.contact_action,old.contact_name,
  old.history_phase,old.history_chunk_order,old.history_progress,old.history_error_code,old.disconnection_reason,old.initiated_by,old.media_id,old.stored_at)
 or (old.recovered_receipt_id is not null and new.recovered_receipt_id is distinct from old.recovered_receipt_id)
 then raise exception 'COEXISTENCE_CHECKPOINT_RECEIPT_IMMUTABLE' using errcode='23514';end if;
 return new;
end; $$;
revoke all on function private.whatsapp_coexistence_checkpoint_event_guard() from public,anon,authenticated,service_role;
create trigger whatsapp_coexistence_checkpoint_event_guard before update on private.whatsapp_coexistence_checkpoint_events for each row execute function private.whatsapp_coexistence_checkpoint_event_guard();

create function private.whatsapp_coexistence_event_guard() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if tg_table_name='whatsapp_coexistence_events' then
  if (new.id,new.company_id,new.link_id,new.link_generation,new.waba_id,new.phone_number_id,new.display_phone_number,
   new.kind,new.event_key,new.customer_wa_id,new.wa_message_id,new.direction,new.message_type,new.body,new.provider_occurred_at,
   new.contact_action,new.contact_name,new.history_phase,new.history_chunk_order,new.history_progress,new.history_error_code,
   new.disconnection_reason,new.initiated_by,new.media_id,new.stored_at)
  is distinct from (old.id,old.company_id,old.link_id,old.link_generation,old.waba_id,old.phone_number_id,old.display_phone_number,
   old.kind,old.event_key,old.customer_wa_id,old.wa_message_id,old.direction,old.message_type,old.body,old.provider_occurred_at,
   old.contact_action,old.contact_name,old.history_phase,old.history_chunk_order,old.history_progress,old.history_error_code,
   old.disconnection_reason,old.initiated_by,old.media_id,old.stored_at)
  or (old.message_id is not null and new.message_id is distinct from old.message_id)
  then raise exception 'COEXISTENCE_RECEIPT_IMMUTABLE' using errcode='23514';end if;
 else
  if new is distinct from old then raise exception 'COEXISTENCE_SOURCE_IMMUTABLE' using errcode='23514';end if;
 end if;
 return new;
end; $$;
revoke all on function private.whatsapp_coexistence_event_guard() from public,anon,authenticated,service_role;
create trigger whatsapp_coexistence_event_guard before update on private.whatsapp_coexistence_events for each row execute function private.whatsapp_coexistence_event_guard();
create trigger whatsapp_coexistence_source_guard before update on private.whatsapp_coexistence_message_sources for each row execute function private.whatsapp_coexistence_event_guard();

-- Permanent import provenance survives disconnect and later independent-number
-- reconnect. Legacy inbound/job repair must not turn an import into an AI job.
create function private.whatsapp_coexistence_no_import_job() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from private.whatsapp_coexistence_message_sources s where s.company_id=new.company_id and s.message_id=new.message_id and s.origin='history')
 then raise exception 'HISTORICAL_MESSAGE_NEVER_AUTOMATED' using errcode='42501';end if;
 return new;
end; $$;
revoke all on function private.whatsapp_coexistence_no_import_job() from public,anon,authenticated,service_role;
create trigger whatsapp_coexistence_no_import_job before insert on public.whatsapp_inbound_jobs for each row execute function private.whatsapp_coexistence_no_import_job();

-- Provider progress is not canonical projection completion. Keep all known
-- pending/conflicting history receipts visible as reconciliation, and never
-- infer that unreported/empty phases or undelivered chunks have been imported.
create function private.whatsapp_refresh_coexistence_history_status(p_company_id uuid,p_link_id uuid,p_generation bigint)
returns void language plpgsql security definer set search_path='' as $$ declare state text;begin
 if not exists(select 1 from private.whatsapp_coexistence_events e where e.company_id=p_company_id and e.link_id=p_link_id and e.link_generation=p_generation and e.kind='history_chunk') then return;end if;
 state:=case
  when exists(select 1 from private.whatsapp_coexistence_events e where e.company_id=p_company_id and e.link_id=p_link_id and e.link_generation=p_generation and e.kind='history_chunk' and e.history_error_code is not null) then 'failed'
  when exists(select 1 from private.whatsapp_coexistence_events e where e.company_id=p_company_id and e.link_id=p_link_id and e.link_generation=p_generation and e.kind in ('history','history_chunk','history_media') and e.projection_status<>'projected') then 'reconcile_required'
  when exists(select 1 from private.whatsapp_coexistence_history_phases h where h.company_id=p_company_id and h.link_id=p_link_id and h.link_generation=p_generation and h.max_progress=100) then 'completed'
  else 'syncing' end;
 update private.whatsapp_coexistence_connections set history_sync_status=state,updated_at=clock_timestamp()
  where company_id=p_company_id and link_id=p_link_id and link_generation=p_generation;
end; $$;
revoke all on function private.whatsapp_refresh_coexistence_history_status(uuid,uuid,bigint) from public,anon,authenticated,service_role;

create function public.whatsapp_ingest_coexistence_event(
 p_waba_id text,p_phone_number_id text,p_display_phone_number text,p_kind text,p_event_key text,
 p_customer_wa_id text,p_wa_message_id text,p_direction text,p_message_type text,p_body text,p_provider_occurred_at timestamptz,
 p_contact_action text,p_contact_name text,p_history_phase integer,p_history_chunk_order integer,p_history_progress integer,
 p_history_error_code integer,p_disconnection_reason text,p_initiated_by text,p_media_id text
) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare l public.whatsapp_company_links%rowtype;e private.whatsapp_coexistence_events%rowtype;
 c public.whatsapp_conversations%rowtype;m public.whatsapp_messages%rowtype;ct private.whatsapp_coexistence_contacts%rowtype;
 gate jsonb;cid uuid;matched_count integer;normalized_display text;inserted_receipt boolean:=false;
 inserted_message boolean:=false;conflicted boolean:=false;identity_hash text;projected boolean:=false;
 accepted_pending boolean:=false;revoked boolean;name text:='';intent_id uuid;intent_count integer;repair jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_waba_id is null or p_waba_id !~ '^[0-9]{1,64}$'
 or p_kind is null or p_kind not in ('live_inbound','history','mobile_echo','history_chunk','contact','history_media','partner_removed')
 or p_event_key is null or char_length(p_event_key) not between 1 and 512 or p_event_key ~ '[[:cntrl:]]'
 or (p_phone_number_id is not null and p_phone_number_id !~ '^[0-9]{1,64}$')
 or (p_display_phone_number is not null and (char_length(p_display_phone_number)>40 or p_display_phone_number !~ '^\+?[0-9 ().-]+$'))
 or (p_customer_wa_id is not null and p_customer_wa_id !~ '^[0-9]{1,20}$')
 or (p_wa_message_id is not null and (char_length(p_wa_message_id) not between 1 and 512 or p_wa_message_id ~ '[[:space:][:cntrl:]]'))
 or (p_direction is not null and p_direction not in ('inbound','outbound'))
 or (p_message_type is not null and p_message_type !~ '^[a-z][a-z0-9_]{0,31}$')
 or (p_body is not null and (char_length(p_body)>4096 or octet_length(p_body)>16384))
 or (p_provider_occurred_at is not null and (not isfinite(p_provider_occurred_at) or p_provider_occurred_at<='1970-01-01'::timestamptz))
 or (p_contact_name is not null and char_length(p_contact_name)>128)
 or (p_contact_action is not null and p_contact_action not in ('add','remove'))
 or (p_history_phase is not null and p_history_phase not between 0 and 2)
 or (p_history_chunk_order is not null and p_history_chunk_order<0)
 or (p_history_progress is not null and p_history_progress not between 0 and 100)
 or (p_history_error_code is not null and p_history_error_code<0)
 or (p_disconnection_reason is not null and char_length(p_disconnection_reason)>512)
 or (p_initiated_by is not null and p_initiated_by not in ('USER','SYSTEM'))
 or (p_media_id is not null and p_media_id !~ '^[0-9]{1,64}$') then
  return jsonb_build_object('ok',false,'durable',false,'code','invalid_input');
 end if;
 if (p_kind in ('live_inbound','history','mobile_echo') and (p_phone_number_id is null or p_customer_wa_id is null or p_wa_message_id is null or p_direction is null or p_message_type is null or p_body is null or p_provider_occurred_at is null))
 or (p_kind='live_inbound' and p_direction<>'inbound') or (p_kind='mobile_echo' and p_direction<>'outbound')
 or (p_kind='contact' and (p_phone_number_id is null or p_customer_wa_id is null or p_contact_action is null or p_contact_action not in ('add','remove') or p_provider_occurred_at is null))
 or (p_kind='history_chunk' and (p_phone_number_id is null or (p_history_error_code is null and (p_history_phase is null or p_history_chunk_order is null or p_history_progress is null))))
 or (p_kind='history_media' and (p_phone_number_id is null or p_wa_message_id is null or p_media_id is null or p_message_type is null))
 or (p_kind='partner_removed' and (p_provider_occurred_at is null or p_provider_occurred_at>clock_timestamp() or (p_phone_number_id is null and p_display_phone_number is null))) then
  return jsonb_build_object('ok',false,'durable',false,'code','invalid_input');
 end if;
 normalized_display:=case when p_display_phone_number is null then null else regexp_replace(p_display_phone_number,'[^0-9]','','g') end;
 if normalized_display is not null and normalized_display !~ '^[1-9][0-9]{6,14}$' then return jsonb_build_object('ok',false,'durable',false,'code','invalid_input');end if;
 -- Same WABA -> company -> link order as signup/revocation. Retain the company
 -- serialization through projection; recheck deadlines after any lock wait.
 perform pg_advisory_xact_lock(87420104,hashtext(p_waba_id));
 -- An exact active independent-number binding alone authorizes the route to use
 -- the existing Cloud API path. Unknown/coexistence failures never fall through.
 if p_kind='live_inbound' and p_phone_number_id is not null and exists(select 1 from public.whatsapp_company_links x
  where x.provider_waba_id=p_waba_id and x.provider_phone_number_id=p_phone_number_id and x.status='verified' and not x.keep_on_phone
   and (normalized_display is null or regexp_replace(x.verified_display_number,'[^0-9]','','g')=normalized_display)) then
  gate:=private.whatsapp_meta_asset_binding(p_waba_id,p_phone_number_id);
  if gate->>'ok'='true' then return jsonb_build_object('ok',false,'durable',false,'code','NOT_COEXISTENCE');end if;
 end if;
 -- Retained lifecycle receipts identify their original company even after its
 -- authorization has been cleared or this number has moved to another company.
 -- Replay cannot revoke a newly authorized generation.
 if p_kind='partner_removed' then
  select count(*),(array_agg(x.company_id order by x.company_id))[1] into matched_count,cid
  from private.whatsapp_coexistence_events x where x.waba_id=p_waba_id and x.kind=p_kind and x.event_key=p_event_key
   and (p_phone_number_id is null or x.phone_number_id=p_phone_number_id)
   and (normalized_display is null or x.display_phone_number=normalized_display);
 end if;
 if cid is null then
  select count(*),(array_agg(x.company_id order by x.company_id))[1] into matched_count,cid
  from public.whatsapp_company_links x where x.provider_waba_id=p_waba_id and x.keep_on_phone
   and x.status='verified' and x.authorization_status='active'
   and (p_phone_number_id is null or x.provider_phone_number_id=p_phone_number_id)
   and (normalized_display is null or regexp_replace(x.verified_display_number,'[^0-9]','','g')=normalized_display);
 end if;
 if matched_count=0 then return private.whatsapp_capture_checkpoint_event(p_waba_id,p_phone_number_id,normalized_display,p_kind,p_event_key,
  p_customer_wa_id,p_wa_message_id,p_direction,p_message_type,p_body,p_provider_occurred_at,p_contact_action,p_contact_name,p_history_phase,p_history_chunk_order,
  p_history_progress,p_history_error_code,p_disconnection_reason,p_initiated_by,p_media_id);end if;
 if matched_count<>1 then return jsonb_build_object('ok',false,'durable',false,'code','unknown_or_ambiguous_asset');end if;
 perform 1 from public.companies where id=cid for no key update;
 select * into l from public.whatsapp_company_links x where x.company_id=cid for update;
 if p_kind='partner_removed' then
  select * into e from private.whatsapp_coexistence_events x where x.company_id=cid and x.waba_id=p_waba_id and x.kind=p_kind and x.event_key=p_event_key
   and (p_phone_number_id is null or x.phone_number_id=p_phone_number_id) and (normalized_display is null or x.display_phone_number=normalized_display)
   order by x.stored_at limit 1 for update;
 end if;
 if e.id is null and (l.provider_waba_id is distinct from p_waba_id or not l.keep_on_phone
 or (p_phone_number_id is not null and l.provider_phone_number_id is distinct from p_phone_number_id)
 or (normalized_display is not null and regexp_replace(l.verified_display_number,'[^0-9]','','g') is distinct from normalized_display))
 then return jsonb_build_object('ok',false,'durable',false,'code','binding_changed');end if;
 -- Lifecycle retry is allowed to acknowledge its exact retained receipt after
 -- revocation changed the generation. It never replays revocation on a new link.
 if p_kind='partner_removed' then
  -- Retained receipt was resolved before validating the current link snapshot.
  null;
 else
  gate:=private.whatsapp_meta_asset_binding(p_waba_id,l.provider_phone_number_id);
  if gate->>'ok' is distinct from 'true' or gate->>'company_id' is distinct from l.company_id::text
  or not exists(select 1 from private.whatsapp_coexistence_connections x where x.company_id=l.company_id and x.link_id=l.id
   and x.link_generation=l.generation and x.waba_id=l.provider_waba_id and x.phone_number_id=l.provider_phone_number_id and x.status='active' and not x.ai_enabled)
  then return jsonb_build_object('ok',false,'durable',false,'code','unknown_or_inactive');end if;
  select * into e from private.whatsapp_coexistence_events x where x.company_id=l.company_id and x.link_id=l.id
   and x.link_generation=l.generation and x.kind=p_kind and x.event_key=p_event_key for update;
 end if;
 if e.id is not null then
  conflicted:=(e.display_phone_number,e.customer_wa_id,e.wa_message_id,e.direction,e.message_type,e.body,e.provider_occurred_at,
   e.contact_action,e.contact_name,e.history_phase,e.history_chunk_order,e.history_progress,e.history_error_code,e.disconnection_reason,e.initiated_by,e.media_id)
   is distinct from (normalized_display,p_customer_wa_id,p_wa_message_id,p_direction,p_message_type,p_body,p_provider_occurred_at,
   p_contact_action,p_contact_name,p_history_phase,p_history_chunk_order,p_history_progress,p_history_error_code,p_disconnection_reason,p_initiated_by,p_media_id);
  if conflicted then
   identity_hash:=md5(jsonb_build_array(normalized_display,p_customer_wa_id,p_wa_message_id,p_direction,p_message_type,p_body,p_provider_occurred_at,p_contact_action,p_contact_name,p_history_phase,p_history_chunk_order,p_history_progress,p_history_error_code,p_disconnection_reason,p_initiated_by,p_media_id)::text);
   insert into private.whatsapp_coexistence_event_conflicts(receipt_id,identity_hash,display_phone_number,customer_wa_id,wa_message_id,direction,message_type,body,
    provider_occurred_at,contact_action,contact_name,history_phase,history_chunk_order,history_progress,history_error_code,disconnection_reason,initiated_by,media_id)
   values(e.id,identity_hash,normalized_display,p_customer_wa_id,p_wa_message_id,p_direction,p_message_type,p_body,p_provider_occurred_at,
    p_contact_action,p_contact_name,p_history_phase,p_history_chunk_order,p_history_progress,p_history_error_code,p_disconnection_reason,p_initiated_by,p_media_id) on conflict do nothing;
   update private.whatsapp_coexistence_events set projection_status='conflict_review',projection_error='contradictory_replay' where id=e.id returning * into e;
  end if;
 else
  if p_kind='partner_removed' and (l.authorization_status<>'active' or l.authorization_verified_at is null
   or l.authorization_verified_at>p_provider_occurred_at+interval '1 second') then
   return jsonb_build_object('ok',false,'durable',false,'code','stale_or_inactive_lifecycle');end if;
  insert into private.whatsapp_coexistence_events(company_id,link_id,link_generation,waba_id,phone_number_id,display_phone_number,kind,event_key,
   customer_wa_id,wa_message_id,direction,message_type,body,provider_occurred_at,contact_action,contact_name,history_phase,history_chunk_order,
   history_progress,history_error_code,disconnection_reason,initiated_by,media_id)
  values(l.company_id,l.id,l.generation,p_waba_id,l.provider_phone_number_id,normalized_display,p_kind,p_event_key,
   p_customer_wa_id,p_wa_message_id,p_direction,p_message_type,p_body,p_provider_occurred_at,p_contact_action,p_contact_name,p_history_phase,p_history_chunk_order,
   p_history_progress,p_history_error_code,p_disconnection_reason,p_initiated_by,p_media_id) returning * into e;
  inserted_receipt:=true;
 end if;
 if p_kind='partner_removed' and not conflicted and e.link_id=l.id and e.link_generation=l.generation
  and e.waba_id=l.provider_waba_id and e.phone_number_id=l.provider_phone_number_id and l.keep_on_phone
  and l.authorization_status='active' and l.authorization_verified_at<=p_provider_occurred_at+interval '1 second' then
  -- The durable removal itself revokes operational authorization. Optional Vault
  -- cleanup can fail later without leaving send/window authority active.
  update public.whatsapp_company_links set status='disconnected',authorization_status='revoked',last_error_code='PARTNER_REMOVED',updated_at=clock_timestamp() where id=l.id and generation=l.generation;
  update private.whatsapp_coexistence_connections set status='disconnected',updated_at=clock_timestamp() where company_id=l.company_id and link_id=l.id and link_generation=e.link_generation;
 end if;
 if e.projection_status='pending' and not conflicted and (p_kind<>'partner_removed'
  or (e.link_id=l.id and e.waba_id=l.provider_waba_id and e.phone_number_id=l.provider_phone_number_id and l.keep_on_phone
   and (e.link_generation=l.generation or (l.status='disconnected' and l.authorization_status='revoked' and l.last_error_code='PARTNER_REMOVED' and e.link_generation<l.generation)))) then
  -- A failed canonical write rolls back only this subtransaction. The normalized
  -- signed receipt survives and is acknowledged as durable, explicitly pending.
  begin
   if p_kind='partner_removed' then
    revoked:=public.whatsapp_revoke_link_authorization(l.id,p_waba_id,l.provider_phone_number_id,'PARTNER_REMOVED',p_provider_occurred_at);
    if not revoked then raise exception 'LIFECYCLE_RECONCILIATION_REQUIRED';end if;
    update private.whatsapp_coexistence_connections set status='disconnected',updated_at=clock_timestamp() where company_id=l.company_id and link_id=l.id and link_generation=e.link_generation;
    projected:=true;
   elsif p_kind='contact' then
    select * into ct from private.whatsapp_coexistence_contacts where company_id=l.company_id and link_id=l.id and link_generation=l.generation and customer_wa_id=p_customer_wa_id for update;
    if ct.customer_wa_id is not null and ct.provider_occurred_at=p_provider_occurred_at
     and (ct.removed,ct.contact_name) is distinct from (p_contact_action='remove',case when p_contact_action='remove' then '' else coalesce(p_contact_name,'') end)
    then conflicted:=true;
    elsif ct.customer_wa_id is null or ct.provider_occurred_at<p_provider_occurred_at then
     insert into private.whatsapp_coexistence_contacts(company_id,link_id,link_generation,phone_number_id,customer_wa_id,contact_name,removed,provider_occurred_at,receipt_id)
     values(l.company_id,l.id,l.generation,l.provider_phone_number_id,p_customer_wa_id,case when p_contact_action='remove' then '' else coalesce(p_contact_name,'') end,p_contact_action='remove',p_provider_occurred_at,e.id)
     on conflict(company_id,link_id,link_generation,customer_wa_id) do update set contact_name=excluded.contact_name,removed=excluded.removed,provider_occurred_at=excluded.provider_occurred_at,receipt_id=excluded.receipt_id;
     update public.whatsapp_conversations set customer_name=case when p_contact_action='remove' then '' else coalesce(p_contact_name,'') end where company_id=l.company_id and phone_number_id=l.provider_phone_number_id and customer_wa_id=p_customer_wa_id;
    end if;
    projected:=not conflicted;
   elsif p_kind='history_chunk' then
    -- Declined sync has a durable receipt even when Meta omits phase metadata.
    if p_history_phase is not null then
     insert into private.whatsapp_coexistence_history_phases(company_id,link_id,link_generation,phase,max_progress,observed_chunks,declined,last_receipt_id)
     values(l.company_id,l.id,l.generation,p_history_phase,coalesce(p_history_progress,0),1,coalesce(p_history_error_code=2593109,false),e.id)
     on conflict(company_id,link_id,link_generation,phase) do update set max_progress=greatest(private.whatsapp_coexistence_history_phases.max_progress,excluded.max_progress),
      observed_chunks=private.whatsapp_coexistence_history_phases.observed_chunks+1,declined=private.whatsapp_coexistence_history_phases.declined or excluded.declined,last_receipt_id=excluded.last_receipt_id,updated_at=clock_timestamp();
    end if;
    update private.whatsapp_coexistence_connections set history_sync_status=case
     when p_history_error_code is not null then 'failed'
     when p_history_progress=100 then 'completed'
     when history_sync_status='completed' then 'completed' else 'syncing' end,updated_at=clock_timestamp()
    where company_id=l.company_id and link_id=l.id and link_generation=l.generation;
    projected:=true;
   elsif p_kind='history_media' then
    if exists(select 1 from private.whatsapp_coexistence_history_media x where x.company_id=l.company_id and x.phone_number_id=l.provider_phone_number_id and x.wa_message_id=p_wa_message_id and (x.media_id,x.media_type) is distinct from (p_media_id,p_message_type)) then conflicted:=true;
    else
     select x.* into m from public.whatsapp_messages x join public.whatsapp_conversations y on y.company_id=x.company_id and y.id=x.conversation_id where x.company_id=l.company_id and x.wa_message_id=p_wa_message_id and y.phone_number_id=l.provider_phone_number_id;
     insert into private.whatsapp_coexistence_history_media(company_id,phone_number_id,wa_message_id,media_id,media_type,receipt_id,message_id)
     values(l.company_id,l.provider_phone_number_id,p_wa_message_id,p_media_id,p_message_type,e.id,m.id)
     on conflict(company_id,phone_number_id,wa_message_id) do update set message_id=coalesce(private.whatsapp_coexistence_history_media.message_id,excluded.message_id);
     projected:=m.id is not null;
    end if;
   else
    select contact_name into name from private.whatsapp_coexistence_contacts where company_id=l.company_id and link_id=l.id and link_generation=l.generation and customer_wa_id=p_customer_wa_id and not removed;
    insert into public.whatsapp_conversations(company_id,phone_number_id,customer_wa_id,customer_name,last_message_at)
    values(l.company_id,l.provider_phone_number_id,p_customer_wa_id,coalesce(name,''),p_provider_occurred_at)
    on conflict(company_id,phone_number_id,customer_wa_id) do nothing;
    select * into c from public.whatsapp_conversations where company_id=l.company_id and phone_number_id=l.provider_phone_number_id and customer_wa_id=p_customer_wa_id for update;
    -- Conversation lock precedes intent/message advisory, matching accepted-send
    -- finalization. Never rewrite accepted accounting or create a send intent.
    if p_direction='outbound' then
     perform 1 from public.whatsapp_send_intents x where x.company_id=l.company_id and x.conversation_id=c.id and x.phone_number_id=l.provider_phone_number_id and x.recipient_wa_id=p_customer_wa_id
      and (x.wa_message_id=p_wa_message_id or x.acceptance_observed_wa_message_id=p_wa_message_id) order by x.id for update;
     select exists(select 1 from public.whatsapp_send_intents x where x.company_id=l.company_id and x.conversation_id=c.id and x.phone_number_id=l.provider_phone_number_id and x.recipient_wa_id=p_customer_wa_id and x.wa_message_id=p_wa_message_id and x.outcome='accepted' and x.message_id is null) into accepted_pending;
     if accepted_pending then
      select count(*),(array_agg(x.id order by x.id))[1] into intent_count,intent_id from public.whatsapp_send_intents x
       where x.company_id=l.company_id and x.conversation_id=c.id and x.phone_number_id=l.provider_phone_number_id and x.recipient_wa_id=p_customer_wa_id
        and x.wa_message_id=p_wa_message_id and x.outcome='accepted' and x.message_id is null;
      if intent_count<>1 or not exists(select 1 from public.whatsapp_send_intents x where x.id=intent_id and x.body=p_body and p_message_type='text') then conflicted:=true;
      else
       -- Materialize an already durable acceptance via its existing fenced local
       -- repair contract. Never invoke Graph or invent a new accepted receipt.
       repair:=public.retry_whatsapp_send_persist(intent_id,null);
      end if;
     end if;
    end if;
    perform pg_advisory_xact_lock(87420101,hashtext(p_wa_message_id));
    select * into m from public.whatsapp_messages where wa_message_id=p_wa_message_id for update;
    if m.id is not null then
     conflicted:=conflicted or (m.company_id,m.conversation_id,m.direction,m.body,m.message_type) is distinct from (l.company_id,c.id,p_direction,p_body,p_message_type)
      or (p_direction='inbound' and (m.sender<>'customer' or m.received_at<>p_provider_occurred_at))
      or (p_direction='outbound' and m.sender not in ('staff','assistant'));
    elsif not accepted_pending and not conflicted then
     insert into public.whatsapp_messages(company_id,conversation_id,wa_message_id,body,message_type,direction,sender,received_at)
     values(l.company_id,c.id,p_wa_message_id,p_body,p_message_type,p_direction,case when p_direction='inbound' then 'customer' else 'staff' end,p_provider_occurred_at) returning * into m;
     inserted_message:=true;
     insert into private.whatsapp_coexistence_message_sources(message_id,company_id,conversation_id,wa_message_id,origin,receipt_id)
     values(m.id,m.company_id,m.conversation_id,m.wa_message_id,p_kind,e.id);
    end if;
    if m.id is not null and not conflicted then
     update public.whatsapp_conversations set last_message_at=greatest(last_message_at,m.received_at) where company_id=l.company_id and id=c.id;
     if p_kind='live_inbound' and p_provider_occurred_at<=clock_timestamp() then
      -- A separate positive signed live observation may prove an imported row,
      -- but its immutable provider time must match. Imports themselves never mint.
      insert into private.whatsapp_meta_inbound_evidence(message_id,company_id,conversation_id,wa_message_id,waba_id,phone_number_id,received_at)
      values(m.id,m.company_id,m.conversation_id,m.wa_message_id,l.provider_waba_id,l.provider_phone_number_id,m.received_at) on conflict do nothing;
      update public.whatsapp_company_links set inbound_tested_at=coalesce(inbound_tested_at,clock_timestamp()),updated_at=clock_timestamp() where id=l.id and generation=l.generation;
     end if;
     update private.whatsapp_coexistence_history_media set message_id=m.id where company_id=l.company_id and phone_number_id=l.provider_phone_number_id and wa_message_id=m.wa_message_id and message_id is null;
     update private.whatsapp_coexistence_events set message_id=m.id,projection_status='projected',projection_error=null
      where company_id=l.company_id and phone_number_id=l.provider_phone_number_id and wa_message_id=m.wa_message_id and kind='history_media'
       and projection_status='pending' and exists(select 1 from private.whatsapp_coexistence_history_media x where x.company_id=l.company_id and x.phone_number_id=l.provider_phone_number_id and x.wa_message_id=m.wa_message_id and x.media_id=private.whatsapp_coexistence_events.media_id);
     if p_direction='outbound' then perform public.rebind_whatsapp_delivery_statuses(l.company_id,l.provider_phone_number_id,m.wa_message_id);end if;
     projected:=true;
    end if;
   end if;
   update private.whatsapp_coexistence_events set projection_status=case when conflicted then 'conflict_review' when projected then 'projected' else 'pending' end,
    projection_error=case when conflicted then 'canonical_identity_conflict' when not projected then 'canonical_association_pending' else null end,
    message_id=case when projected and m.id is not null then m.id else message_id end where id=e.id returning * into e;
  exception when others then
   inserted_message:=false;
   update private.whatsapp_coexistence_events set projection_status='pending',projection_error='database_projection_failed' where id=e.id returning * into e;
  end;
 end if;
 if p_kind in ('history','history_chunk','history_media') then perform private.whatsapp_refresh_coexistence_history_status(e.company_id,e.link_id,e.link_generation);end if;
 return jsonb_build_object('ok',true,'durable',true,'receipt_id',e.id,'event_key',e.event_key,'kind',e.kind,
  'waba_id',e.waba_id,'phone_number_id',e.phone_number_id,'display_phone_number',e.display_phone_number,'company_id',e.company_id,'link_id',e.link_id,'link_generation',e.link_generation,
  'binding_state','active_link','signup_attempt_id',null,
  'projection_status',e.projection_status,'inserted',inserted_receipt,'duplicate',not inserted_receipt,'message_inserted',inserted_message);
end; $$;
revoke all on function public.whatsapp_ingest_coexistence_event(text,text,text,text,text,text,text,text,text,text,timestamptz,text,text,integer,integer,integer,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.whatsapp_ingest_coexistence_event(text,text,text,text,text,text,text,text,text,text,timestamptz,text,text,integer,integer,integer,integer,text,text,text) to service_role;

-- Called only after the signed delivery status itself has been durably saved.
-- A mobile echo or HTTP acceptance is insufficient proof of delivery to a user.
create function public.whatsapp_record_coexistence_outbound_proof(p_waba_id text,p_phone_number_id text,
 p_wa_message_id text,p_status text,p_recipient_wa_id text,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.whatsapp_company_links%rowtype;cid uuid;gate jsonb;proven boolean:=false;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_waba_id is null or p_waba_id !~ '^[0-9]{1,64}$' or p_phone_number_id is null or p_phone_number_id !~ '^[0-9]{1,64}$'
  or p_wa_message_id is null or char_length(p_wa_message_id) not between 1 and 512 or p_wa_message_id ~ '[[:space:][:cntrl:]]'
  or p_recipient_wa_id is null or p_recipient_wa_id !~ '^[0-9]{1,20}$' or p_status is null or p_status not in ('delivered','read')
  or p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at<='1970-01-01'::timestamptz or p_occurred_at>clock_timestamp()
 then return jsonb_build_object('ok',false,'verified',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(87420104,hashtext(p_waba_id));
 select company_id into cid from public.whatsapp_company_links where provider_waba_id=p_waba_id and provider_phone_number_id=p_phone_number_id and keep_on_phone and status='verified';
 if cid is null then return jsonb_build_object('ok',true,'verified',false);end if;
 perform 1 from public.companies where id=cid for no key update;
 select * into l from public.whatsapp_company_links where company_id=cid for update;
 gate:=private.whatsapp_meta_asset_binding(p_waba_id,p_phone_number_id);
 if gate->>'ok' is distinct from 'true' or gate->>'company_id' is distinct from cid::text
  or not l.keep_on_phone or l.authorization_verified_at>p_occurred_at+interval '1 second'
  or not exists(select 1 from private.whatsapp_coexistence_connections x where x.company_id=l.company_id and x.link_id=l.id and x.link_generation=l.generation and x.status='active')
 then return jsonb_build_object('ok',true,'verified',false);end if;
 select exists(select 1 from public.whatsapp_send_intents i
  join public.whatsapp_messages m on (m.company_id,m.conversation_id,m.id,m.wa_message_id)=(i.company_id,i.conversation_id,i.message_id,i.wa_message_id)
  join public.whatsapp_delivery_statuses s on (s.company_id,s.message_id,s.wa_message_id,s.phone_number_id,s.recipient_wa_id)=(i.company_id,i.message_id,i.wa_message_id,i.phone_number_id,i.recipient_wa_id)
  where i.company_id=l.company_id and i.link_id=l.id and i.link_generation=l.generation and i.phone_number_id=p_phone_number_id
   and i.recipient_wa_id=p_recipient_wa_id and i.wa_message_id=p_wa_message_id and i.outcome='accepted' and i.sender_kind='staff'
   and i.attempt_started_at<=p_occurred_at+interval '1 second' and m.sender='staff' and m.direction='outbound' and m.body=i.body
   and m.delivery_state in ('delivered','read') and lower(s.status)=p_status and s.occurred_at=p_occurred_at
   and s.link_state in ('applied','ignored_stale')) into proven;
 if proven then
  update public.whatsapp_company_links set outbound_tested_at=coalesce(outbound_tested_at,p_occurred_at),updated_at=clock_timestamp() where id=l.id and generation=l.generation;
 end if;
 return jsonb_build_object('ok',true,'verified',proven,'company_id',l.company_id,'link_id',l.id,'link_generation',l.generation);
end; $$;
revoke all on function public.whatsapp_record_coexistence_outbound_proof(text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.whatsapp_record_coexistence_outbound_proof(text,text,text,text,text,timestamptz) to service_role;

-- Local recovery only. Never repeats code exchange, subscription or one-time
-- provider sync. Checkpoint-time inbound is replayed as historical evidence:
-- a subsequent signed live observation is required to open a reply window.
create function public.whatsapp_reconcile_coexistence_events(p_company_id uuid,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.whatsapp_company_links%rowtype;s private.whatsapp_coexistence_checkpoint_events%rowtype;e private.whatsapp_coexistence_events%rowtype;
 gate jsonb;r jsonb;recovered integer:=0;pending integer:=0;conflicts integer:=0;processed integer:=0;remaining bigint:=0;waba text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_company_id is null or p_limit is null or p_limit not between 1 and 100 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select provider_waba_id into waba from public.whatsapp_company_links where company_id=p_company_id and keep_on_phone and status='verified';
 if waba is null then return jsonb_build_object('ok',false,'code','CONNECTION_UNAVAILABLE');end if;
 perform pg_advisory_xact_lock(87420104,hashtext(waba));
 perform 1 from public.companies where id=p_company_id for no key update;
 select * into l from public.whatsapp_company_links where company_id=p_company_id for update;
 if l.provider_waba_id is distinct from waba or not l.keep_on_phone then return jsonb_build_object('ok',false,'code','CONNECTION_UNAVAILABLE');end if;
 gate:=private.whatsapp_meta_asset_binding(l.provider_waba_id,l.provider_phone_number_id);
 if gate->>'ok' is distinct from 'true' or gate->>'company_id' is distinct from p_company_id::text then return jsonb_build_object('ok',false,'code','CONNECTION_UNAVAILABLE');end if;
 for s in select x.* from private.whatsapp_coexistence_checkpoint_events x join private.whatsapp_coexistence_signup_attempts a
  on a.company_id=x.company_id and a.id=x.attempt_id and a.status='completed'
   and a.finalized_link_id=l.id and a.finalized_link_generation=l.generation
  where x.company_id=p_company_id and x.waba_id=l.provider_waba_id and x.phone_number_id=l.provider_phone_number_id and x.projection_status='pending'
  order by case x.kind when 'contact' then 0 when 'history' then 1 when 'live_inbound' then 1 when 'mobile_echo' then 1 when 'history_chunk' then 2 when 'history_media' then 3 else 4 end,x.stored_at,x.id
  limit p_limit for update of x
 loop
  r:=public.whatsapp_ingest_coexistence_event(s.waba_id,s.phone_number_id,s.display_phone_number,
   case when s.kind='live_inbound' then 'history' else s.kind end,s.event_key,s.customer_wa_id,s.wa_message_id,s.direction,s.message_type,s.body,s.provider_occurred_at,
   s.contact_action,s.contact_name,s.history_phase,s.history_chunk_order,s.history_progress,s.history_error_code,s.disconnection_reason,s.initiated_by,s.media_id);
  processed:=processed+1;
  if r->>'ok'='true' and r->>'durable'='true' and r->>'binding_state'='active_link'
   and r->>'company_id'=p_company_id::text and r->>'link_id'=l.id::text and (r->>'link_generation')::bigint=l.generation then
   if r->>'projection_status'='projected' then
    update private.whatsapp_coexistence_checkpoint_events set projection_status='recovered',recovered_receipt_id=(r->>'receipt_id')::uuid where id=s.id;
    recovered:=recovered+1;
   elsif r->>'projection_status'='conflict_review' then
    update private.whatsapp_coexistence_checkpoint_events set projection_status='conflict_review',recovered_receipt_id=(r->>'receipt_id')::uuid where id=s.id;
    conflicts:=conflicts+1;
   else pending:=pending+1;end if;
  else pending:=pending+1;end if;
 end loop;
 -- Also retry pending canonical projection of an already active-link receipt.
 -- Its signed live provenance remains intact; these are local persistence retries.
 if processed<p_limit then
  for e in select x.* from private.whatsapp_coexistence_events x where x.company_id=p_company_id and x.link_id=l.id
   and x.link_generation=l.generation and x.waba_id=l.provider_waba_id and x.phone_number_id=l.provider_phone_number_id and x.projection_status='pending'
   order by case x.kind when 'partner_removed' then 1 else 0 end,x.stored_at,x.id limit (p_limit-processed) for update
  loop
   r:=public.whatsapp_ingest_coexistence_event(e.waba_id,e.phone_number_id,e.display_phone_number,e.kind,e.event_key,e.customer_wa_id,e.wa_message_id,
    e.direction,e.message_type,e.body,e.provider_occurred_at,e.contact_action,e.contact_name,e.history_phase,e.history_chunk_order,e.history_progress,
    e.history_error_code,e.disconnection_reason,e.initiated_by,e.media_id);
   processed:=processed+1;
   if r->>'ok'='true' and r->>'durable'='true' then
    if r->>'projection_status'='projected' then recovered:=recovered+1;
    elsif r->>'projection_status'='conflict_review' then conflicts:=conflicts+1;else pending:=pending+1;end if;
   else pending:=pending+1;end if;
  end loop;
 end if;
 select count(*) into remaining from private.whatsapp_coexistence_checkpoint_events x join private.whatsapp_coexistence_signup_attempts a on a.company_id=x.company_id and a.id=x.attempt_id and a.status='completed'
  and a.finalized_link_id=l.id and a.finalized_link_generation=l.generation
  where x.company_id=p_company_id and x.waba_id=l.provider_waba_id and x.phone_number_id=l.provider_phone_number_id and x.projection_status='pending';
 select remaining+count(*) into remaining from private.whatsapp_coexistence_events x where x.company_id=p_company_id and x.link_id=l.id and x.link_generation=l.generation and x.projection_status='pending';
 select count(*) into conflicts from private.whatsapp_coexistence_checkpoint_events x join private.whatsapp_coexistence_signup_attempts a on a.company_id=x.company_id and a.id=x.attempt_id and a.status='completed'
  and a.finalized_link_id=l.id and a.finalized_link_generation=l.generation
  where x.company_id=p_company_id and x.waba_id=l.provider_waba_id and x.phone_number_id=l.provider_phone_number_id and x.projection_status='conflict_review';
 select conflicts+count(*) into conflicts from private.whatsapp_coexistence_events x where x.company_id=p_company_id and x.link_id=l.id and x.link_generation=l.generation and x.projection_status='conflict_review';
 return jsonb_build_object('ok',true,'company_id',p_company_id,'processed',processed,'recovered',recovered,'pending',pending,'conflicts',conflicts,'remaining',remaining);
end; $$;
revoke all on function public.whatsapp_reconcile_coexistence_events(uuid,integer) from public,anon,authenticated;
grant execute on function public.whatsapp_reconcile_coexistence_events(uuid,integer) to service_role;

-- Existing tenant-authorized inbox reads already call this projection helper.
-- Extra fields explain provenance/placeholder limits without exposing asset IDs,
-- receipts, tokens or download credentials. Existing delivery truth is retained.
create or replace function private.whatsapp_inbox_message_public(p_row public.whatsapp_messages) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'arrival_sequence',p_row.arrival_sequence::text,'body',p_row.body,'sender',p_row.sender,
  'direction',p_row.direction,'received_at',p_row.received_at,'delivery_state',coalesce(p_row.delivery_state,
   case when p_row.direction='outbound' and exists(select 1 from public.whatsapp_send_intents i
    where (i.company_id,i.conversation_id,i.message_id,i.wa_message_id,i.body,i.sender_kind)=(p_row.company_id,p_row.conversation_id,p_row.id,p_row.wa_message_id,p_row.body,p_row.sender)
    and i.outcome='accepted') then 'accepted' end),
  'origin',(select origin from private.whatsapp_coexistence_message_sources where message_id=p_row.id and company_id=p_row.company_id),
  'historical_media_available',exists(select 1 from private.whatsapp_coexistence_history_media where message_id=p_row.id and company_id=p_row.company_id),
  'media_download_supported',false);
$$;
revoke all on function private.whatsapp_inbox_message_public(public.whatsapp_messages) from public,anon,authenticated,service_role;

-- CREATE OR REPLACE retains the original helper owner. Give that exact internal
-- definer owner only the reads needed for these additional public projections.
do $$ declare helper_owner name;begin
 select r.rolname into helper_owner from pg_proc p join pg_roles r on r.oid=p.proowner
  where p.oid='private.whatsapp_inbox_message_public(public.whatsapp_messages)'::regprocedure;
 execute format('grant select on private.whatsapp_coexistence_message_sources,private.whatsapp_coexistence_history_media to %I',helper_owner);
end; $$;

notify pgrst,'reload schema';
commit;

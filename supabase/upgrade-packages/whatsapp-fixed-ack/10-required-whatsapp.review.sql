begin;set local search_path='';set local lock_timeout='2s';set local statement_timeout='30s';
DO $pre$ DECLARE d record;BEGIN
 IF current_user<>'postgres' OR to_regclass('private.billing_service_grants') IS NULL OR to_regprocedure('public.billing_read_company_operational_entitlement(uuid)') IS NULL THEN RAISE EXCEPTION 'FIXED_ACK_BILLING_BASELINE_MISSING';END IF;
 FOR d IN SELECT * FROM (VALUES
 ('public.save_whatsapp_inbound(uuid,text,text,text,text,text,text,timestamp with time zone)','3c9cea207a30109a0c764ce9563046dd'),
 ('public.create_whatsapp_assistant_send_intent(text,uuid,text,text,integer,uuid,bigint)','b8d5cf04fecc2de9bedcf8137de4f4b9'),
 ('public.create_whatsapp_send_intent(text,uuid,text,text,text,integer,uuid,bigint)','98492951acc1aaa450edbed744f844d2'),
 ('public.claim_whatsapp_send_attempt(uuid,uuid,integer)','853cf92ee5ab3e4fae74e0b4c5f4ef0e'),
 ('public.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid)','d94ea1634ec4a72eaac7337e1461fbf4'),
 ('private.whatsapp_intent_link_current(public.whatsapp_send_intents)','e557d989aab6179bd94187b6793f7c85')
 ) x(signature,hash) LOOP
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure(d.signature) AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=""']::text[]) IS DISTINCT FROM d.hash THEN RAISE EXCEPTION 'FIXED_ACK_WA_BASELINE_DRIFT: %',d.signature;END IF;
 END LOOP;
 IF to_regclass('vault.secrets') IS NULL THEN RAISE EXCEPTION 'FIXED_ACK_VAULT_DEPENDENCY_MISSING';END IF;
END;$pre$;
DO $security$ DECLARE d record;BEGIN
 FOR d IN SELECT * FROM (VALUES ('private.whatsapp_company_link_bump_generation()','2fa60357d759ae2a7526db62d7c4ff22',false,true,true,true),('private.whatsapp_company_link_public(public.whatsapp_company_links,boolean)','afe9b81e6628b75d3e3c0e94117c8e4f',false,true,true,true),('private.whatsapp_conversations_guard_control()','c6015c762194094f1e1ada92d18bb1d4',true,true,true,true),('private.whatsapp_delivery_rank(text)','37d80570ad8dde5a9e7a212e80832e48',false,true,true,true),('private.whatsapp_intent_link_current(public.whatsapp_send_intents)','e557d989aab6179bd94187b6793f7c85',false,true,true,true),('private.whatsapp_send_intent_fields_match(public.whatsapp_send_intents,uuid,uuid,text,text,text,text,integer,uuid,bigint)','4da41b381390e7a4ab492a5da81bf1ba',false,true,true,true),('private.whatsapp_send_intent_public(public.whatsapp_send_intents)','3f21ca3fc4a12b2425fcf5b7b2dc4060',false,true,true,true),('public.app_session_is_valid()','b42c28f54d05778fcc994156c6ce4086',true,false,true,true),('public.apply_whatsapp_delivery_status(uuid,text,text,text,text,timestamp with time zone)','98eb04456ac02cd8c45a64cbd242ebf7',true,false,false,true),('public.claim_whatsapp_send_attempt(uuid,uuid,integer)','853cf92ee5ab3e4fae74e0b4c5f4ef0e',true,false,false,true),('public.company_conversation_scope(uuid)','a9ddc030788d96e72cbee329464faa16',true,false,true,true),('public.control_whatsapp_conversation(uuid,text,integer,uuid)','d4424038c1360fad28d31b9ebb43f11f',true,false,true,true),('public.create_whatsapp_assistant_send_intent(text,uuid,text,text,integer,uuid,bigint)','b8d5cf04fecc2de9bedcf8137de4f4b9',true,false,false,true),('public.create_whatsapp_send_intent(text,uuid,text,text,text,integer,uuid,bigint)','98492951acc1aaa450edbed744f844d2',true,false,true,true),('public.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid)','d94ea1634ec4a72eaac7337e1461fbf4',true,false,false,true),('public.has_company_capability(uuid,text)','71b77d37cd0e9e4d59c26aec47897de5',true,false,true,true),('public.rebind_whatsapp_delivery_statuses(uuid,text,text)','2e3141b4395bb0ac854cda947189429c',true,false,false,true),('public.retry_whatsapp_send_persist(uuid,uuid)','cf72e4078bb2a07f428cc02f61445c8d',true,false,false,true),('public.save_whatsapp_inbound(uuid,text,text,text,text,text,text,timestamp with time zone)','3c9cea207a30109a0c764ce9563046dd',true,false,false,true)) x(signature,hash,definer,anon_exec,auth_exec,service_exec) LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(d.signature) AND pg_get_userbyid(proowner)='postgres' AND md5(replace(prosrc,chr(13),''))=d.hash AND prosecdef=d.definer AND proconfig=ARRAY['search_path=""']::text[])
 OR has_function_privilege('anon',to_regprocedure(d.signature),'EXECUTE') IS DISTINCT FROM d.anon_exec OR has_function_privilege('authenticated',to_regprocedure(d.signature),'EXECUTE') IS DISTINCT FROM d.auth_exec OR has_function_privilege('service_role',to_regprocedure(d.signature),'EXECUTE') IS DISTINCT FROM d.service_exec THEN RAISE EXCEPTION 'FIXED_ACK_SECURITY_BASELINE_DRIFT: %',d.signature;END IF;
 END LOOP;END;$security$;
DO $catalog$ DECLARE expected jsonb; actual jsonb;BEGIN
 expected:='[{"name":"id","type":"uuid","not_null":true},{"name":"company_id","type":"uuid","not_null":true},{"name":"requested_display_number","type":"text","not_null":true},{"name":"keep_on_phone","type":"boolean","not_null":true},{"name":"status","type":"text","not_null":true},{"name":"provider_phone_number_id","type":"text","not_null":false},{"name":"verified_display_number","type":"text","not_null":false},{"name":"inbound_tested_at","type":"timestamp with time zone","not_null":false},{"name":"outbound_tested_at","type":"timestamp with time zone","not_null":false},{"name":"last_error_code","type":"text","not_null":false},{"name":"admin_note","type":"text","not_null":false},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"updated_at","type":"timestamp with time zone","not_null":true},{"name":"generation","type":"bigint","not_null":true}]'::jsonb;
 SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum) INTO actual FROM pg_attribute a WHERE a.attrelid='public.whatsapp_company_links'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 IF actual IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.whatsapp_company_links'::regclass AND pg_get_userbyid(relowner)='postgres' AND relrowsecurity AND ARRAY(SELECT z::text FROM unnest(relacl) z ORDER BY z::text)=ARRAY['postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]) THEN RAISE EXCEPTION 'FIXED_ACK_TABLE_BASELINE_DRIFT: whatsapp_company_links';END IF;
 expected:='[{"name":"id","type":"uuid","not_null":true},{"name":"company_id","type":"uuid","not_null":true},{"name":"phone_number_id","type":"text","not_null":true},{"name":"customer_wa_id","type":"text","not_null":true},{"name":"customer_name","type":"text","not_null":true},{"name":"last_message_at","type":"timestamp with time zone","not_null":true},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"status","type":"text","not_null":true},{"name":"automation_allowed","type":"boolean","not_null":true},{"name":"automation_generation","type":"integer","not_null":true},{"name":"control_revision","type":"integer","not_null":true},{"name":"control_actor_id","type":"uuid","not_null":false},{"name":"control_acted_at","type":"timestamp with time zone","not_null":false},{"name":"assigned_to","type":"uuid","not_null":false}]'::jsonb;
 SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum) INTO actual FROM pg_attribute a WHERE a.attrelid='public.whatsapp_conversations'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 IF actual IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.whatsapp_conversations'::regclass AND pg_get_userbyid(relowner)='postgres' AND relrowsecurity AND ARRAY(SELECT z::text FROM unnest(relacl) z ORDER BY z::text)=ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]) THEN RAISE EXCEPTION 'FIXED_ACK_TABLE_BASELINE_DRIFT: whatsapp_conversations' USING DETAIL=format('actual=%s expected=%s ACL=%s',actual,expected,(SELECT relacl::text FROM pg_class WHERE oid='public.whatsapp_conversations'::regclass));END IF;
 expected:='[{"name":"id","type":"uuid","not_null":true},{"name":"company_id","type":"uuid","not_null":true},{"name":"user_id","type":"uuid","not_null":true},{"name":"nonce","type":"text","not_null":true},{"name":"keep_on_phone","type":"boolean","not_null":true},{"name":"status","type":"text","not_null":true},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"consumed_at","type":"timestamp with time zone","not_null":false}]'::jsonb;
 SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum) INTO actual FROM pg_attribute a WHERE a.attrelid='public.whatsapp_embedded_signup_attempts'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 IF actual IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.whatsapp_embedded_signup_attempts'::regclass AND pg_get_userbyid(relowner)='postgres' AND relrowsecurity AND ARRAY(SELECT z::text FROM unnest(relacl) z ORDER BY z::text)=ARRAY['postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]) THEN RAISE EXCEPTION 'FIXED_ACK_TABLE_BASELINE_DRIFT: whatsapp_embedded_signup_attempts';END IF;
 expected:='[{"name":"id","type":"uuid","not_null":true},{"name":"company_id","type":"uuid","not_null":true},{"name":"message_id","type":"uuid","not_null":true},{"name":"wa_message_id","type":"text","not_null":true},{"name":"status","type":"text","not_null":true},{"name":"claim_token","type":"uuid","not_null":false},{"name":"claimed_at","type":"timestamp with time zone","not_null":false},{"name":"claim_expires_at","type":"timestamp with time zone","not_null":false},{"name":"completed_at","type":"timestamp with time zone","not_null":false},{"name":"result_code","type":"text","not_null":false},{"name":"attempt_count","type":"integer","not_null":true},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"updated_at","type":"timestamp with time zone","not_null":true}]'::jsonb;
 SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum) INTO actual FROM pg_attribute a WHERE a.attrelid='public.whatsapp_inbound_jobs'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 IF actual IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.whatsapp_inbound_jobs'::regclass AND pg_get_userbyid(relowner)='postgres' AND relrowsecurity AND ARRAY(SELECT z::text FROM unnest(relacl) z ORDER BY z::text)=ARRAY['postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]) THEN RAISE EXCEPTION 'FIXED_ACK_TABLE_BASELINE_DRIFT: whatsapp_inbound_jobs';END IF;
 expected:='[{"name":"id","type":"uuid","not_null":true},{"name":"company_id","type":"uuid","not_null":true},{"name":"conversation_id","type":"uuid","not_null":true},{"name":"wa_message_id","type":"text","not_null":true},{"name":"body","type":"text","not_null":true},{"name":"message_type","type":"text","not_null":true},{"name":"received_at","type":"timestamp with time zone","not_null":true},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"direction","type":"text","not_null":true},{"name":"sender","type":"text","not_null":true},{"name":"delivery_state","type":"text","not_null":false},{"name":"delivery_rank","type":"integer","not_null":true},{"name":"delivery_updated_at","type":"timestamp with time zone","not_null":false}]'::jsonb;
 SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum) INTO actual FROM pg_attribute a WHERE a.attrelid='public.whatsapp_messages'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 IF actual IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.whatsapp_messages'::regclass AND pg_get_userbyid(relowner)='postgres' AND relrowsecurity AND ARRAY(SELECT z::text FROM unnest(relacl) z ORDER BY z::text)=ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]) THEN RAISE EXCEPTION 'FIXED_ACK_TABLE_BASELINE_DRIFT: whatsapp_messages';END IF;
 expected:='[{"name":"id","type":"uuid","not_null":true},{"name":"client_op_id","type":"text","not_null":true},{"name":"company_id","type":"uuid","not_null":true},{"name":"conversation_id","type":"uuid","not_null":true},{"name":"phone_number_id","type":"text","not_null":true},{"name":"recipient_wa_id","type":"text","not_null":true},{"name":"body","type":"text","not_null":true},{"name":"sender_kind","type":"text","not_null":true},{"name":"actor_user_id","type":"uuid","not_null":false},{"name":"outcome","type":"text","not_null":true},{"name":"wa_message_id","type":"text","not_null":false},{"name":"message_id","type":"uuid","not_null":false},{"name":"attempt_token","type":"uuid","not_null":false},{"name":"attempt_started_at","type":"timestamp with time zone","not_null":false},{"name":"attempt_expires_at","type":"timestamp with time zone","not_null":false},{"name":"provider_error_code","type":"text","not_null":false},{"name":"expected_automation_generation","type":"integer","not_null":false},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"updated_at","type":"timestamp with time zone","not_null":true},{"name":"link_id","type":"uuid","not_null":false},{"name":"link_generation","type":"bigint","not_null":false}]'::jsonb;
 SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum) INTO actual FROM pg_attribute a WHERE a.attrelid='public.whatsapp_send_intents'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 IF actual IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.whatsapp_send_intents'::regclass AND pg_get_userbyid(relowner)='postgres' AND relrowsecurity AND ARRAY(SELECT z::text FROM unnest(relacl) z ORDER BY z::text)=ARRAY['postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]) THEN RAISE EXCEPTION 'FIXED_ACK_TABLE_BASELINE_DRIFT: whatsapp_send_intents';END IF;
END;$catalog$;
-- Exact existing identity/delivery preflight and guards, not full migration replay.


-- Hold the existing identities stable through preflight and constraint install.
lock table public.whatsapp_conversations, public.whatsapp_messages,
  public.whatsapp_inbound_jobs, public.whatsapp_send_intents,
  public.whatsapp_company_links, public.whatsapp_delivery_statuses,
  public.whatsapp_conversation_events in share row exclusive mode;

do $$
begin
  if exists (
    select 1 from public.whatsapp_messages m
    left join public.whatsapp_conversations c on c.id=m.conversation_id
    where c.id is null or c.company_id is distinct from m.company_id
      or not ((m.direction='inbound' and m.sender='customer')
        or (m.direction='outbound' and m.sender in ('staff','assistant')))
  ) then
    raise exception 'wa_identity_preflight_messages' using errcode='23514',
      hint='Review or explicitly quarantine inconsistent message/conversation records; no company reassignment is performed.';
  end if;
  if exists (
    select 1 from public.whatsapp_inbound_jobs j
    left join public.whatsapp_messages m on m.id=j.message_id
    where m.id is null or (j.company_id,j.wa_message_id) is distinct from (m.company_id,m.wa_message_id)
      or m.direction<>'inbound' or m.sender<>'customer'
  ) then
    raise exception 'wa_identity_preflight_jobs' using errcode='23514',
      hint='Review or explicitly quarantine inconsistent original job/message bindings before retrying.';
  end if;
  if exists (
    select 1 from public.whatsapp_send_intents i
    left join public.whatsapp_conversations c on c.id=i.conversation_id
    left join public.whatsapp_company_links l on l.id=i.link_id
    left join public.whatsapp_messages m on m.id=i.message_id
    where c.id is null
      or (i.company_id,i.phone_number_id,i.recipient_wa_id) is distinct from (c.company_id,c.phone_number_id,c.customer_wa_id)
      or (i.link_id is null) is distinct from (i.link_generation is null)
      or (i.link_id is not null and (l.id is null or l.company_id is distinct from i.company_id or i.link_generation<1))
      or (i.message_id is not null and (m.id is null
        or (i.company_id,i.conversation_id,i.wa_message_id,i.body) is distinct from (m.company_id,m.conversation_id,m.wa_message_id,m.body)
        or m.direction<>'outbound' or m.sender<>i.sender_kind))
  ) then
    raise exception 'wa_identity_preflight_intents' using errcode='23514',
      hint='Review or explicitly quarantine inconsistent conversation/link/message bindings. Historical link generations are retained.';
  end if;
  if exists (
    select 1 from public.whatsapp_conversation_events e
    left join public.whatsapp_conversations c on c.id=e.conversation_id
    where c.id is null or c.company_id is distinct from e.company_id
  ) then
    raise exception 'wa_identity_preflight_control_events' using errcode='23514',
      hint='Review the original control-event scope; this migration does not rewrite audit evidence.';
  end if;
  if exists (
    select 1 from public.whatsapp_delivery_statuses s
    left join public.whatsapp_messages m on m.id=s.message_id
    left join public.whatsapp_conversations c on c.id=m.conversation_id
    where s.message_id is not null and (m.id is null or c.id is null
      or (s.company_id,s.wa_message_id,s.phone_number_id,s.recipient_wa_id) is distinct from (m.company_id,m.wa_message_id,c.phone_number_id,c.customer_wa_id)
      or m.direction<>'outbound')
  ) then
    raise exception 'wa_identity_preflight_delivery_links' using errcode='23514',
      hint='Review or explicitly quarantine previously linked delivery evidence; it is not silently unlinked or moved.';
  end if;
end;
$$;

alter table public.whatsapp_conversations
  add constraint wa_conversation_tenant_uid unique (company_id,id),
  add constraint wa_conversation_recipient_uid unique (company_id,id,phone_number_id,customer_wa_id);
alter table public.whatsapp_messages
  add constraint wa_message_tenant_provider_uid unique (company_id,id,wa_message_id),
  add constraint wa_message_conversation_provider_uid unique (company_id,conversation_id,id,wa_message_id),
  add constraint wa_message_conversation_tenant_fk foreign key (company_id,conversation_id)
    references public.whatsapp_conversations(company_id,id),
  add constraint wa_message_direction_sender_chk check (
    (direction='inbound' and sender='customer') or (direction='outbound' and sender in ('staff','assistant')));
alter table public.whatsapp_company_links
  add constraint wa_company_link_tenant_uid unique (company_id,id);
alter table public.whatsapp_inbound_jobs
  add constraint wa_inbound_job_message_tenant_fk foreign key (company_id,message_id,wa_message_id)
    references public.whatsapp_messages(company_id,id,wa_message_id);
alter table public.whatsapp_send_intents
  add constraint wa_send_intent_conversation_recipient_fk foreign key (company_id,conversation_id,phone_number_id,recipient_wa_id)
    references public.whatsapp_conversations(company_id,id,phone_number_id,customer_wa_id),
  add constraint wa_send_intent_link_tenant_fk foreign key (company_id,link_id)
    references public.whatsapp_company_links(company_id,id),
  add constraint wa_send_intent_message_tenant_fk foreign key (company_id,conversation_id,message_id,wa_message_id)
    references public.whatsapp_messages(company_id,conversation_id,id,wa_message_id),
  add constraint wa_send_intent_link_pair_chk check ((link_id is null)=(link_generation is null) and (link_generation is null or link_generation>=1)),
  add constraint wa_send_intent_message_provider_chk check (message_id is null or wa_message_id is not null);
alter table public.whatsapp_conversation_events
  add constraint wa_control_event_conversation_tenant_fk foreign key (company_id,conversation_id)
    references public.whatsapp_conversations(company_id,id);
alter table public.whatsapp_delivery_statuses
  add constraint wa_delivery_message_tenant_fk foreign key (company_id,message_id,wa_message_id)
    references public.whatsapp_messages(company_id,id,wa_message_id);
create index wa_send_intent_link_tenant_idx on public.whatsapp_send_intents(link_id,company_id) where link_id is not null;
create index wa_delivery_message_tenant_idx on public.whatsapp_delivery_statuses(message_id,company_id) where message_id is not null;

alter table public.whatsapp_delivery_statuses drop constraint whatsapp_delivery_statuses_link_state_chk;
alter table public.whatsapp_delivery_statuses add constraint whatsapp_delivery_statuses_link_state_chk
  check (link_state in ('applied','unmatched','ignored_stale','conflict_review'));
comment on column public.whatsapp_delivery_statuses.link_state is
  'Durable evidence binding: conflict_review retains identity/contradictory evidence without changing proven delivery.';

create or replace function private.whatsapp_delivery_rank(p_status text)
returns integer language sql immutable set search_path='' as $$
  select case pg_catalog.lower(coalesce(p_status,''))
    when 'accepted' then 1 when 'sent' then 2 when 'failed' then 2
    when 'delivered' then 3 when 'read' then 4 else 0 end;
$$;

create function private.whatsapp_delivery_may_advance(
  p_current text, p_current_at timestamptz, p_incoming text, p_incoming_at timestamptz
)
returns boolean language sql immutable set search_path='' as $$
  select p_incoming_at is not null and case
    when p_incoming not in ('sent','failed','delivered','read') then false
    -- A local acceptance timestamp is not the provider's ordering timestamp.
    when p_current is null or p_current='accepted' then true
    when p_current in ('delivered','read') then p_incoming in ('delivered','read')
      and (private.whatsapp_delivery_rank(p_incoming)>private.whatsapp_delivery_rank(p_current)
        or (p_incoming=p_current and (p_current_at is null or p_incoming_at>=p_current_at)))
    when p_current in ('sent','failed') then p_incoming in ('delivered','read')
      or (p_incoming in ('sent','failed') and (p_current_at is null
        or p_incoming_at>p_current_at or (p_incoming=p_current and p_incoming_at=p_current_at)))
    else false end;
$$;
revoke all on function private.whatsapp_delivery_may_advance(text,timestamptz,text,timestamptz) from public,anon,authenticated;
-- Forward deployers can differ from the retained owner of an existing definer
-- RPC. Grant only that server-side owner access to this pure private helper.
do $$ declare v_owner name; begin
  select r.rolname into v_owner from pg_catalog.pg_proc p
    join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.rebind_whatsapp_delivery_statuses(uuid,text,text)'::regprocedure;
  execute pg_catalog.format('grant execute on function private.whatsapp_delivery_may_advance(text,timestamptz,text,timestamptz) to %I',v_owner);
end; $$;

-- Trigger execution, unlike RLS, applies to service-role table writes too.
create function private.whatsapp_guard_persisted_identity()
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
    if new.generation is distinct from (case when (new.status,new.provider_phone_number_id)
      is distinct from (old.status,old.provider_phone_number_id) then old.generation+1 else old.generation end) then
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
revoke all on function private.whatsapp_guard_persisted_identity() from public,anon,authenticated;
create trigger wa_conversation_persisted_identity before update on public.whatsapp_conversations
  for each row execute function private.whatsapp_guard_persisted_identity();
-- Existing generation bump trigger runs before this identity validator.
create trigger whatsapp_company_links_guard_identity before update on public.whatsapp_company_links
  for each row execute function private.whatsapp_guard_persisted_identity();
create trigger wa_message_persisted_identity before insert or update on public.whatsapp_messages
  for each row execute function private.whatsapp_guard_persisted_identity();
create trigger wa_job_persisted_identity before insert or update on public.whatsapp_inbound_jobs
  for each row execute function private.whatsapp_guard_persisted_identity();
create trigger wa_send_intent_persisted_identity before insert or update on public.whatsapp_send_intents
  for each row execute function private.whatsapp_guard_persisted_identity();
create trigger wa_control_event_persisted_identity before update on public.whatsapp_conversation_events
  for each row execute function private.whatsapp_guard_persisted_identity();
create trigger wa_delivery_event_persisted_identity before insert or update on public.whatsapp_delivery_statuses
  for each row execute function private.whatsapp_guard_persisted_identity();

create or replace function public.rebind_whatsapp_delivery_statuses(
  p_company_id uuid,p_phone_number_id text,p_wa_message_id text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_msg public.whatsapp_messages%rowtype;
  v_conv public.whatsapp_conversations%rowtype;
  v_ev public.whatsapp_delivery_statuses%rowtype;
  v_status text;
  v_applied integer:=0; v_kept integer:=0; v_conflicts integer:=0;
begin
  if p_company_id is null or nullif(pg_catalog.btrim(coalesce(p_phone_number_id,'')),'') is null
    or nullif(pg_catalog.btrim(coalesce(p_wa_message_id,'')),'') is null then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  select * into v_msg from public.whatsapp_messages m
    where m.wa_message_id=pg_catalog.btrim(p_wa_message_id) for update;
  if not found then
    return jsonb_build_object('ok',true,'applied',0,'unmatched',true);
  end if;
  select * into v_conv from public.whatsapp_conversations where id=v_msg.conversation_id;
  if v_msg.company_id is distinct from p_company_id or v_msg.direction<>'outbound'
    or v_conv.company_id is distinct from p_company_id or v_conv.phone_number_id is distinct from pg_catalog.btrim(p_phone_number_id) then
    update public.whatsapp_delivery_statuses s set link_state='conflict_review'
      where s.company_id=p_company_id and s.phone_number_id=pg_catalog.btrim(p_phone_number_id)
        and s.wa_message_id=v_msg.wa_message_id and s.message_id is null;
    return jsonb_build_object('ok',false,'code','delivery_identity_conflict','applied',0);
  end if;
  for v_ev in select * from public.whatsapp_delivery_statuses s
    where s.wa_message_id=v_msg.wa_message_id order by s.occurred_at,s.created_at,s.id for update
  loop
    v_status:=case when pg_catalog.lower(v_ev.status)='accepted' then 'sent' else pg_catalog.lower(v_ev.status) end;
    if (v_ev.company_id,v_ev.phone_number_id,v_ev.recipient_wa_id)
      is distinct from (v_msg.company_id,v_conv.phone_number_id,v_conv.customer_wa_id)
      or v_status not in ('sent','failed','delivered','read') then
      update public.whatsapp_delivery_statuses set link_state='conflict_review' where id=v_ev.id;
      v_conflicts:=v_conflicts+1; continue;
    end if;
    if (v_status='failed' and v_msg.delivery_state in ('delivered','read'))
      or (v_status in ('sent','failed') and v_msg.delivery_state in ('sent','failed')
        and v_status<>v_msg.delivery_state and v_ev.occurred_at=v_msg.delivery_updated_at) then
      update public.whatsapp_delivery_statuses set link_state='conflict_review',message_id=v_msg.id where id=v_ev.id;
      v_conflicts:=v_conflicts+1; continue;
    end if;
    if private.whatsapp_delivery_may_advance(v_msg.delivery_state,v_msg.delivery_updated_at,v_status,v_ev.occurred_at) then
      update public.whatsapp_messages set delivery_state=v_status,
        delivery_rank=private.whatsapp_delivery_rank(v_status),delivery_updated_at=v_ev.occurred_at
        where id=v_msg.id returning * into v_msg;
      update public.whatsapp_delivery_statuses set link_state='applied',message_id=v_msg.id where id=v_ev.id;
      v_applied:=v_applied+1;
    else
      update public.whatsapp_delivery_statuses set link_state='ignored_stale',message_id=v_msg.id where id=v_ev.id;
      v_kept:=v_kept+1;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'applied',v_applied,'kept',v_kept,'conflicts',v_conflicts);
end;
$$;

create or replace function public.apply_whatsapp_delivery_status(
  p_company_id uuid,p_phone_number_id text,p_wa_message_id text,p_status text,p_recipient_wa_id text,p_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_status text:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_status,'')));
  v_phone text:=pg_catalog.btrim(coalesce(p_phone_number_id,''));
  v_wamid text:=pg_catalog.btrim(coalesce(p_wa_message_id,''));
  v_recipient text:=pg_catalog.btrim(coalesce(p_recipient_wa_id,''));
  v_ev public.whatsapp_delivery_statuses%rowtype;
  v_msg public.whatsapp_messages%rowtype;
  v_conv public.whatsapp_conversations%rowtype;
  v_inserted boolean:=false; v_rebind jsonb;
begin
  if p_company_id is null or v_phone='' or v_wamid='' or v_recipient='' or p_occurred_at is null then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  if v_status='accepted' then v_status:='sent'; end if;
  if v_status not in ('sent','failed','delivered','read') then
    return jsonb_build_object('ok',false,'code','invalid_status');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(87420101,pg_catalog.hashtext(v_wamid));
  -- Match rebind's row→event lock order, including duplicate status handling.
  select * into v_msg from public.whatsapp_messages where wa_message_id=v_wamid for update;
  insert into public.whatsapp_delivery_statuses(company_id,phone_number_id,wa_message_id,status,recipient_wa_id,occurred_at,link_state)
    values(p_company_id,v_phone,v_wamid,v_status,v_recipient,p_occurred_at,'unmatched')
    on conflict (wa_message_id,status,occurred_at) do nothing returning * into v_ev;
  v_inserted:=found;
  if not v_inserted then
    select * into v_ev from public.whatsapp_delivery_statuses
      where wa_message_id=v_wamid and status=v_status and occurred_at=p_occurred_at for update;
    if not found or (v_ev.company_id,v_ev.phone_number_id,v_ev.recipient_wa_id)
      is distinct from (p_company_id,v_phone,v_recipient) then
      return jsonb_build_object('ok',false,'code','delivery_identity_conflict','duplicate',false);
    end if;
  end if;
  v_rebind:=public.rebind_whatsapp_delivery_statuses(p_company_id,v_phone,v_wamid);
  if v_msg.id is not null then
    select * into v_conv from public.whatsapp_conversations where id=v_msg.conversation_id;
    if v_msg.direction<>'outbound' or (p_company_id,v_phone,v_recipient)
      is distinct from (v_msg.company_id,v_conv.phone_number_id,v_conv.customer_wa_id) then
      return jsonb_build_object('ok',false,'code','delivery_identity_conflict','inserted',v_inserted,'id',v_ev.id);
    end if;
  end if;
  if v_rebind->>'ok'='false' then return v_rebind; end if;
  select * into v_ev from public.whatsapp_delivery_statuses where id=v_ev.id;
  return jsonb_build_object('ok',true,'inserted',v_inserted,'duplicate',not v_inserted,
    'id',v_ev.id,'link_state',v_ev.link_state,'conflict_review',v_ev.link_state='conflict_review');
end;
$$;
-- CREATE OR REPLACE preserves existing service-only EXECUTE privileges.
comment on column public.whatsapp_messages.delivery_rank is
  'State-derived progress: accepted 1, sent/failed 2, delivered 3, read 4. Failure cannot erase delivery proof; timestamps order pre-delivery evidence.';

alter table public.whatsapp_inbound_jobs drop constraint whatsapp_inbound_jobs_status_chk;
alter table public.whatsapp_inbound_jobs add constraint whatsapp_inbound_jobs_status_chk
 check(status in ('pending','claimed','completed','failed','retry_wait','dead_letter','review_required'));
alter table public.whatsapp_inbound_jobs add column next_attempt_at timestamptz not null default now(),
 add column expected_automation_generation integer,
 add column staged_reply text,add column staged_citations jsonb,
 add column staged_ai_attempt_id uuid references public.ai_usage_ledger(id),
 add column send_intent_id uuid references public.whatsapp_send_intents(id),
 add column usage_status text check(usage_status in ('reserved','accepted','released','unknown')),
 add column usage_period_start timestamptz,
 add column usage_subscription_id uuid references public.billing_subscriptions(id);
alter table public.whatsapp_send_intents add column original_job_id uuid references public.whatsapp_inbound_jobs(id);
create unique index whatsapp_send_original_job_uidx on public.whatsapp_send_intents(original_job_id) where original_job_id is not null;
create unique index whatsapp_worker_job_company_uidx on public.whatsapp_inbound_jobs(id,company_id);
create unique index whatsapp_worker_subscription_company_uidx on public.billing_subscriptions(id,company_id);
alter table public.whatsapp_inbound_jobs add constraint whatsapp_worker_subscription_company_fk
 foreign key(usage_subscription_id,company_id) references public.billing_subscriptions(id,company_id);
alter table public.whatsapp_send_intents add constraint whatsapp_worker_original_company_fk
 foreign key(original_job_id,company_id) references public.whatsapp_inbound_jobs(id,company_id);
create index whatsapp_jobs_retry_idx on public.whatsapp_inbound_jobs(next_attempt_at,created_at,id)
 where status in ('pending','retry_wait','claimed');
create index whatsapp_jobs_capacity_idx on public.whatsapp_inbound_jobs(company_id,usage_period_start,usage_status);
alter table public.whatsapp_conversation_events drop constraint whatsapp_conversation_events_action_chk;
alter table public.whatsapp_conversation_events add constraint whatsapp_conversation_events_action_chk
 check(action in ('take_over','resume','close','reopen_inbound','assign','worker_escalation'));
create unique index whatsapp_worker_escalation_uidx on public.whatsapp_conversation_events(company_id,conversation_id,(detail->>'job_id'))
 where action='worker_escalation';


create function private.wa_worker_month() returns timestamptz language sql stable as $$
 select date_trunc('month',clock_timestamp() at time zone 'Asia/Muscat') at time zone 'Asia/Muscat';$$;
create function private.wa_worker_lock(p_job uuid,p_claim uuid,p_generation boolean default true)
returns public.whatsapp_inbound_jobs language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;c public.whatsapp_conversations%rowtype;cid uuid;conv uuid;
begin
 select x.company_id,m.conversation_id into cid,conv from public.whatsapp_inbound_jobs x join public.whatsapp_messages m
 on m.id=x.message_id and m.company_id=x.company_id where x.id=p_job and m.direction='inbound' and m.sender='customer';
 if cid is null then return null;end if;
 perform 1 from public.companies where id=cid and status<>'suspended' for no key update;
 if not found then return null;end if;
 perform 1 from public.billing_subscriptions where company_id=cid and environment='live' for no key update;
 select * into c from public.whatsapp_conversations where id=conv and company_id=cid for update;
 select * into j from public.whatsapp_inbound_jobs where id=p_job and company_id=cid for update;
 if p_claim is null or j.claim_token is null or j.claim_expires_at is null or j.status<>'claimed'
 or j.claim_token is distinct from p_claim or j.claim_expires_at<=clock_timestamp()
 or (p_generation and (c.status<>'open' or not c.automation_allowed or c.automation_generation is distinct from j.expected_automation_generation)) then return null;end if;
 return j;
end;$$;
create function private.wa_fixed_reserve_usage(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;s public.billing_subscriptions%rowtype;proof jsonb;cap bigint;held bigint;period timestamptz:=private.wa_worker_month();
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 j:=private.whatsapp_fixed_ack_lock(p_job_id,p_claim_token);if j.id is null then return jsonb_build_object('ok',false,'code','claim_or_automation_rejected');end if;
 proof:=public.billing_read_company_operational_entitlement(j.company_id);
 if proof->'active' is distinct from 'true'::jsonb then return jsonb_build_object('ok',false,'code','subscription_inactive');end if;
 select * into s from public.billing_subscriptions where company_id=j.company_id and environment='live';
 select case when coalesce(limits->>'automated_outbound_per_month','')~'^[1-9][0-9]{0,8}$'
 then (limits->>'automated_outbound_per_month')::bigint else null end into cap from public.billing_plan_versions where id=s.plan_version_id;
 if cap is null then return jsonb_build_object('ok',false,'code','usage_not_configured');end if;
 if j.usage_status in ('accepted','unknown') then return jsonb_build_object('ok',false,'code','usage_already_final_or_unknown');end if;
 if j.usage_status='reserved' and j.usage_period_start=period then return jsonb_build_object('ok',true,'reused',true,'can_dispatch',false,'status','reserved');end if;
 if j.send_intent_id is not null and exists(select 1 from public.whatsapp_send_intents where id=j.send_intent_id and outcome<>'ready')
 then return jsonb_build_object('ok',false,'code','send_outcome_requires_review');end if;
 select count(*) into held from public.whatsapp_inbound_jobs where company_id=j.company_id and usage_period_start=period
 and usage_status in ('reserved','accepted','unknown') and id<>j.id;
 -- Include legacy accepted/held assistant intents lacking a job reservation.
 select held+count(*) into held from public.whatsapp_send_intents i left join public.whatsapp_messages m
 on m.id=i.message_id and m.company_id=i.company_id and m.conversation_id=i.conversation_id and m.wa_message_id=i.wa_message_id
 and m.direction='outbound' and m.sender='assistant'
 where i.company_id=j.company_id and i.sender_kind='assistant' and i.original_job_id is null
 and ((i.outcome='accepted' and coalesce(m.received_at,i.updated_at)>=period)
 or (i.outcome in ('ready','attempting','unknown') and i.created_at>=period));
 if held>=cap then return jsonb_build_object('ok',false,'code','usage_limit_reached');end if;
 update public.whatsapp_inbound_jobs set usage_status='reserved',usage_period_start=period,usage_subscription_id=s.id where id=j.id;
 return jsonb_build_object('ok',true,'reused',false,'can_dispatch',true,'status','reserved');
end;$$;
create function public.billing_finalize_automated_usage(p_company_id uuid,p_intent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;i public.whatsapp_send_intents%rowtype;s text;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 perform 1 from public.companies where id=p_company_id for no key update;
 select * into j from public.whatsapp_inbound_jobs where company_id=p_company_id and send_intent_id=p_intent_id for update;
 select * into i from public.whatsapp_send_intents where id=p_intent_id and company_id=p_company_id and original_job_id=j.id for update;
 if j.id is null or i.id is null then return jsonb_build_object('ok',false,'code','binding_missing');end if;
 s:=case when i.outcome='accepted' and exists(select 1 from public.whatsapp_messages where id=i.message_id and company_id=p_company_id
 and conversation_id=i.conversation_id and wa_message_id=i.wa_message_id and direction='outbound' and sender='assistant') then 'accepted'
 when i.outcome='rejected' then 'released' else 'unknown' end;
 if j.usage_status='accepted' and s<>'accepted' then return jsonb_build_object('ok',false,'code','accepted_usage_conflict');end if;
 update public.whatsapp_inbound_jobs set usage_status=s,status=case when s='accepted' then 'completed' else 'review_required' end,
 completed_at=case when s='accepted' then coalesce(completed_at,clock_timestamp()) else completed_at end,
 result_code='send_'||s,claim_token=null,claim_expires_at=null where id=j.id;
 return jsonb_build_object('ok',true,'status',s,'reused',j.usage_status=s);
end;$$;

alter table public.whatsapp_embedded_signup_attempts
 add column session_id uuid,
 add column expires_at timestamptz not null default (now()+interval '10 minutes'),
 add column app_id text,
 add column config_id text,
 add column graph_version text,
 add column base_link_generation bigint,
 add column last_error_code text;
-- Legacy attempts have no provable Auth session and cannot be resumed.
update public.whatsapp_embedded_signup_attempts set status='cancelled',consumed_at=coalesce(consumed_at,now()) where session_id is null and status in ('in_progress','code_received');
alter table public.whatsapp_embedded_signup_attempts drop constraint whatsapp_es_attempts_status_chk;
alter table public.whatsapp_embedded_signup_attempts add constraint whatsapp_es_attempts_status_chk
 check(status in ('in_progress','cancelled','failed','code_received','completed','reconcile_required'));
-- Exact required Vault pointer/index from 1320; creates no secret.
alter table public.whatsapp_company_links add column access_secret_id uuid;
create unique index whatsapp_link_secret_uidx on public.whatsapp_company_links(access_secret_id) where access_secret_id is not null;
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

alter function public.claim_whatsapp_send_attempt(uuid,uuid,integer) set schema private;
alter function private.claim_whatsapp_send_attempt(uuid,uuid,integer) rename to wa_claim_pre_fixed_ack;
revoke all on function private.wa_claim_pre_fixed_ack(uuid,uuid,integer) from public,anon,authenticated,service_role;
create function public.claim_whatsapp_send_attempt(p_intent_id uuid,p_actor_user_id uuid,p_lease_seconds integer default 90) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if exists(select 1 from public.whatsapp_send_intents where id=p_intent_id and sender_kind='assistant') then return jsonb_build_object('ok',false,'code','assistant_job_required');end if;
 return private.wa_claim_pre_fixed_ack(p_intent_id,p_actor_user_id,p_lease_seconds);end;$$;
DO $acl$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('wa_worker_month','wa_worker_lock','wa_fixed_reserve_usage') LOOP EXECUTE format('revoke all on function %s from public,anon,authenticated,service_role',f);END LOOP;
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('billing_finalize_automated_usage','resolve_whatsapp_company_by_meta_asset','whatsapp_store_meta_inbound','whatsapp_apply_meta_delivery_status','whatsapp_check_service_window','claim_whatsapp_send_attempt') LOOP EXECUTE format('revoke all on function %s from public,anon,authenticated',f);EXECUTE format('grant execute on function %s to service_role',f);END LOOP;
END;$acl$;
notify pgrst,'reload schema';commit;

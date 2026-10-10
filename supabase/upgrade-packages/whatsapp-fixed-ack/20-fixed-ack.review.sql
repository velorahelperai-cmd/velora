-- Local review only. Fixed response does not attest AI/model readiness.
begin;set local search_path='';set local lock_timeout='2s';set local statement_timeout='30s';
create table private.whatsapp_fixed_ack_settings(
 company_id uuid primary key references public.companies(id),link_id uuid not null references public.whatsapp_company_links(id),
 phone_number_id text not null,recipient_wa_id text not null check(recipient_wa_id~'^[1-9][0-9]{6,19}$'),
 enabled boolean not null default false,actor_user_id uuid not null,actor_session_id uuid not null,
 response_kind text not null default 'fixed_ack_v1' check(response_kind='fixed_ack_v1'),updated_at timestamptz not null default clock_timestamp());
alter table private.whatsapp_fixed_ack_settings enable row level security;
revoke all on private.whatsapp_fixed_ack_settings from public,anon,authenticated,service_role;
alter table public.whatsapp_inbound_jobs add column response_kind text check(response_kind is null or response_kind='fixed_ack_v1');
alter table public.whatsapp_send_intents add column response_kind text check(response_kind is null or response_kind='fixed_ack_v1'),
 add column fixed_ack_dispatch_token uuid,add column fixed_ack_authorized_at timestamptz;
create function private.whatsapp_fixed_ack_text() returns text language sql immutable set search_path='' as $$
 select 'أهلًا بيك 👋 شكرًا لتواصلك معانا، استلمنا رسالتك وفريقنا هيرد عليك قريبًا.'::text;$$;
revoke all on function private.whatsapp_fixed_ack_text() from public,anon,authenticated,service_role;
create function public.whatsapp_read_fixed_ack(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid;enabled boolean;begin
 if current_setting('role',true)<>'authenticated' then return jsonb_build_object('ok',false,'code','forbidden');end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','forbidden');end;
 if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select s.enabled into enabled from private.whatsapp_fixed_ack_settings s where s.company_id=p_company_id;
 return jsonb_build_object('ok',true,'enabled',coalesce(enabled,false),'response_kind','fixed_ack_v1');end;$$;
revoke all on function public.whatsapp_read_fixed_ack(uuid) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_read_fixed_ack(uuid) to authenticated;
create function public.whatsapp_configure_fixed_ack(p_company_id uuid,p_phone_number_id text,p_recipient_wa_id text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;l public.whatsapp_company_links%rowtype;begin
 if current_setting('role',true)<>'authenticated' then return jsonb_build_object('ok',false,'code','forbidden');end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','forbidden');end;
 if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 perform 1 from public.companies where id=p_company_id and status='active' for no key update;if not found then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if p_enabled is false then update private.whatsapp_fixed_ack_settings set enabled=false,actor_user_id=auth.uid(),actor_session_id=sid,updated_at=clock_timestamp() where company_id=p_company_id;return jsonb_build_object('ok',true,'enabled',false);end if;
 if p_enabled is distinct from true or p_recipient_wa_id is null or p_recipient_wa_id !~ '^[1-9][0-9]{6,19}$' then return jsonb_build_object('ok',false,'code','invalid_input');end if;
 select * into l from public.whatsapp_company_links where company_id=p_company_id and provider_phone_number_id=p_phone_number_id for share;
 if not found or private.whatsapp_meta_asset_binding(l.provider_waba_id,l.provider_phone_number_id)->>'eligible' is distinct from 'true'
 or regexp_replace(coalesce(l.verified_display_number,''),'[^0-9]','','g')=p_recipient_wa_id then return jsonb_build_object('ok',false,'code','binding_rejected');end if;
 insert into private.whatsapp_fixed_ack_settings(company_id,link_id,phone_number_id,recipient_wa_id,enabled,actor_user_id,actor_session_id)
 values(p_company_id,l.id,p_phone_number_id,p_recipient_wa_id,true,auth.uid(),sid) on conflict(company_id) do update set link_id=excluded.link_id,
 phone_number_id=excluded.phone_number_id,recipient_wa_id=excluded.recipient_wa_id,enabled=true,actor_user_id=excluded.actor_user_id,actor_session_id=excluded.actor_session_id,updated_at=clock_timestamp();
 return jsonb_build_object('ok',true,'enabled',true,'response_kind','fixed_ack_v1');end;$$;
revoke all on function public.whatsapp_configure_fixed_ack(uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_configure_fixed_ack(uuid,text,text,boolean) to authenticated;
create function private.whatsapp_fixed_ack_lock(p_job_id uuid,p_claim uuid default null) returns public.whatsapp_inbound_jobs
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;m public.whatsapp_messages%rowtype;c public.whatsapp_conversations%rowtype;s private.whatsapp_fixed_ack_settings%rowtype;l public.whatsapp_company_links%rowtype;begin
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id;
 if not found then return null;end if;
 perform 1 from public.companies where id=j.company_id and status='active' for no key update;if not found then return null;end if;
 select * into s from private.whatsapp_fixed_ack_settings where company_id=j.company_id and enabled for share;if not found then return null;end if;
 -- Pilot opt-in retains verified owner/session authority; logout, expiry or membership revocation stops new sends.
 if not private.whatsapp_signup_owner_valid(s.company_id,s.actor_user_id,s.actor_session_id) then return null;end if;
 select * into m from public.whatsapp_messages where id=j.message_id and company_id=j.company_id and wa_message_id=j.wa_message_id
 and direction='inbound' and sender='customer' and message_type='text' and received_at<=clock_timestamp();if not found then return null;end if;
 select * into c from public.whatsapp_conversations where id=m.conversation_id and company_id=j.company_id for update;
 if not found or c.status<>'open' or c.automation_allowed is distinct from true or c.phone_number_id<>s.phone_number_id or c.customer_wa_id<>s.recipient_wa_id
 or (j.expected_automation_generation is not null and j.expected_automation_generation<>c.automation_generation) then return null;end if;
 select * into l from public.whatsapp_company_links where id=s.link_id and company_id=j.company_id for share;
 if not found or l.provider_phone_number_id<>s.phone_number_id or private.whatsapp_meta_asset_binding(l.provider_waba_id,l.provider_phone_number_id)->>'eligible' is distinct from 'true'
 or regexp_replace(coalesce(l.verified_display_number,''),'[^0-9]','','g')=c.customer_wa_id then return null;end if;
 if private.whatsapp_service_window(j.company_id,c.id,c.phone_number_id,c.customer_wa_id)->>'ok' is distinct from 'true'
 or not exists(select 1 from private.whatsapp_meta_inbound_evidence e where e.message_id=m.id and e.company_id=j.company_id and e.conversation_id=c.id
 and e.wa_message_id=m.wa_message_id and e.waba_id=l.provider_waba_id and e.phone_number_id=c.phone_number_id) then return null;end if;
 if public.billing_read_company_operational_entitlement(j.company_id)->'active' is distinct from 'true'::jsonb then return null;end if;
 -- Exact paid service grant required; this does not activate the service or approve AI.
 if not exists(select 1 from private.billing_service_grants sg join private.billing_service_order_offers so on so.order_id=sg.order_id
 join private.billing_proven_entitlement_grants g on g.id=sg.entitlement_application_id and g.order_id=sg.order_id
 join public.billing_subscriptions bs on bs.id=g.subscription_id and bs.company_id=g.company_id and bs.plan_version_id=g.plan_version_id and bs.paid_through=g.applied_paid_through
 where g.company_id=j.company_id and so.service_code='noura' and sg.activated and g.provider_environment='live' and so.environment='live'
 and bs.environment='live' and bs.status in('active','cancel_at_period_end') and bs.paid_through>clock_timestamp() and private.billing_service_receipt_eligible(g.id)) then return null;end if;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id and company_id=s.company_id for update;
 if p_claim is not null and (j.status<>'claimed' or j.claim_token is distinct from p_claim or j.claim_expires_at<=clock_timestamp()) then return null;end if;
 -- Candidate cursors may precede a competing commit; recheck eligibility after the job row lock.
 if p_claim is null and (j.status not in('pending','retry_wait','claimed') or j.next_attempt_at>clock_timestamp() or j.attempt_count>=5
 or (j.response_kind is not null and j.response_kind<>'fixed_ack_v1')
 or (j.status='claimed' and (j.claim_expires_at is null or j.claim_expires_at>clock_timestamp()))) then return null;end if;
 -- Company/conversation locks serialize FIFO, concurrent claims and rate checks.
 if exists(select 1 from public.whatsapp_inbound_jobs other join public.whatsapp_messages om on om.id=other.message_id and om.company_id=other.company_id
 where other.company_id=j.company_id and om.conversation_id=c.id and other.id<>j.id
 and other.status in('pending','retry_wait','claimed')
 and ((other.created_at,other.id)<(j.created_at,j.id) or (other.status='claimed' and other.claim_expires_at>clock_timestamp()))) then return null;end if;
 if exists(select 1 from public.whatsapp_send_intents i where i.company_id=j.company_id and i.conversation_id=c.id
 and i.original_job_id is distinct from j.id
 and (i.outcome in('attempting','unknown') or (i.response_kind='fixed_ack_v1' and i.created_at>clock_timestamp()-interval '60 seconds')))
 or (select count(*) from public.whatsapp_send_intents i where i.company_id=j.company_id and i.recipient_wa_id=c.customer_wa_id
 and i.response_kind='fixed_ack_v1' and i.original_job_id is distinct from j.id and i.created_at>clock_timestamp()-interval '24 hours')>=3 then return null;end if;
 if j.staged_ai_attempt_id is not null or j.staged_citations is not null then return null;end if;
 if not private.whatsapp_signup_owner_valid(s.company_id,s.actor_user_id,s.actor_session_id) then return null;end if;
 return j;end;$$;
revoke all on function private.whatsapp_fixed_ack_lock(uuid,uuid) from public,anon,authenticated,service_role;
create function private.whatsapp_fixed_ack_identity() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='UPDATE' and old.response_kind is not null and new.response_kind is distinct from old.response_kind then raise exception 'FIXED_RESPONSE_KIND_IMMUTABLE';end if;
 if tg_op='UPDATE' and old.response_kind is null and new.response_kind='fixed_ack_v1'
 and (tg_table_name<>'whatsapp_inbound_jobs' or current_user<>'postgres' or coalesce(current_setting('velora.fixed_ack_stage',true),'')<>'1') then raise exception 'FIXED_ACK_STAGE_REQUIRED';end if;
 if new.response_kind='fixed_ack_v1' then
 if tg_table_name='whatsapp_inbound_jobs' then
 if tg_op='INSERT' then raise exception 'FIXED_ACK_STAGE_REQUIRED';end if;
 if new.staged_ai_attempt_id is not null or new.staged_citations is not null or (new.staged_reply is not null and new.staged_reply<>private.whatsapp_fixed_ack_text()) then raise exception 'FIXED_ACK_IS_NOT_AI';end if;
 else
 if new.body<>private.whatsapp_fixed_ack_text() or new.sender_kind<>'assistant' or new.original_job_id is null then raise exception 'FIXED_ACK_IDENTITY_REJECTED';end if;
 if tg_op='INSERT' and (current_user<>'postgres' or coalesce(current_setting('velora.fixed_ack_stage',true),'')<>'1') then raise exception 'FIXED_ACK_STAGE_REQUIRED';end if;
 if tg_op='UPDATE' and new.outcome in('accepted','unknown') and new.outcome is distinct from old.outcome and (old.fixed_ack_dispatch_token is null or (old.attempt_token is not null and old.fixed_ack_dispatch_token is distinct from old.attempt_token)) then raise exception 'FIXED_ACK_DISPATCH_REQUIRED';end if;
 if tg_op='UPDATE' and row(new.fixed_ack_dispatch_token,new.fixed_ack_authorized_at) is distinct from row(old.fixed_ack_dispatch_token,old.fixed_ack_authorized_at)
 and (current_user<>'postgres' or coalesce(current_setting('velora.fixed_ack_dispatch',true),'')<>'1' or old.fixed_ack_dispatch_token is not null or new.fixed_ack_dispatch_token is distinct from old.attempt_token) then raise exception 'FIXED_ACK_DISPATCH_IMMUTABLE';end if;
 end if;end if;return new;end;$$;
create trigger fixed_ack_job_identity before insert or update on public.whatsapp_inbound_jobs for each row execute function private.whatsapp_fixed_ack_identity();
create trigger fixed_ack_intent_identity before insert or update on public.whatsapp_send_intents for each row execute function private.whatsapp_fixed_ack_identity();
create function private.whatsapp_fixed_ack_no_ai() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.whatsapp_inbound_jobs where id=nullif(to_jsonb(new)->>'worker_job_id','')::uuid and response_kind='fixed_ack_v1') then raise exception 'FIXED_ACK_MODEL_CALL_FORBIDDEN';end if;return new;end;$$;
create trigger fixed_ack_no_ai_attempt before insert or update on public.ai_usage_ledger for each row execute function private.whatsapp_fixed_ack_no_ai();

create function public.whatsapp_claim_fixed_ack(p_company_id uuid,p_phone_number_id text,p_recipient_wa_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;j public.whatsapp_inbound_jobs%rowtype;c public.whatsapp_conversations%rowtype;token uuid;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from private.whatsapp_fixed_ack_settings where company_id=p_company_id and enabled and phone_number_id=p_phone_number_id and recipient_wa_id=p_recipient_wa_id) then return jsonb_build_object('ok',false,'code','opt_in_required');end if;
 for candidate in select x.id from public.whatsapp_inbound_jobs x join public.whatsapp_messages m on m.id=x.message_id and m.company_id=x.company_id
 join public.whatsapp_conversations y on y.id=m.conversation_id and y.company_id=x.company_id
 where x.company_id=p_company_id and y.phone_number_id=p_phone_number_id and y.customer_wa_id=p_recipient_wa_id and y.status='open'
 and m.direction='inbound' and m.sender='customer' and m.message_type='text' and (x.response_kind is null or x.response_kind='fixed_ack_v1')
 and x.status in('pending','claimed','retry_wait') and x.next_attempt_at<=clock_timestamp() and x.attempt_count<5
 and (x.status<>'claimed' or x.claim_expires_at<=clock_timestamp()) order by x.created_at,x.id limit 10 loop
 j:=private.whatsapp_fixed_ack_lock(candidate.id);if j.id is null then continue;end if;
 if exists(select 1 from public.ai_usage_ledger ai where to_jsonb(ai)->>'worker_job_id'=j.id::text and ai.status in('reserved','running','uncertain','success')) then continue;end if;
 select * into c from public.whatsapp_conversations where id=(select conversation_id from public.whatsapp_messages where id=j.message_id);
 token:=gen_random_uuid();perform set_config('velora.fixed_ack_stage','1',true);
 update public.whatsapp_inbound_jobs set status='claimed',response_kind='fixed_ack_v1',claim_token=token,claimed_at=clock_timestamp(),claim_expires_at=clock_timestamp()+interval '120 seconds',
 expected_automation_generation=coalesce(expected_automation_generation,c.automation_generation),attempt_count=attempt_count+1 where id=j.id;
 return jsonb_build_object('ok',true,'jobs',jsonb_build_array(jsonb_build_object('job_id',j.id,'company_id',j.company_id,'claim_token',token)));
 end loop;return jsonb_build_object('ok',true,'jobs','[]'::jsonb);end;$$;
create function public.whatsapp_stage_fixed_ack(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;c public.whatsapp_conversations%rowtype;l public.whatsapp_company_links%rowtype;r jsonb;i public.whatsapp_send_intents%rowtype;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 j:=private.whatsapp_fixed_ack_lock(p_job_id,p_claim_token);if j.id is null or j.response_kind is distinct from 'fixed_ack_v1' then return jsonb_build_object('ok',false,'code','authority_rejected');end if;
 select * into c from public.whatsapp_conversations where id=(select conversation_id from public.whatsapp_messages where id=j.message_id);
 select * into l from public.whatsapp_company_links where company_id=j.company_id and provider_phone_number_id=c.phone_number_id;
 if j.send_intent_id is null then
 r:=private.wa_fixed_reserve_usage(p_job_id,p_claim_token);if r->>'ok' is distinct from 'true' then return r;end if;
 perform set_config('velora.fixed_ack_stage','1',true);
 insert into public.whatsapp_send_intents(client_op_id,company_id,conversation_id,phone_number_id,recipient_wa_id,body,sender_kind,actor_user_id,outcome,
 expected_automation_generation,link_id,link_generation,original_job_id,response_kind) values('wa-job:'||j.id,j.company_id,c.id,c.phone_number_id,c.customer_wa_id,
 private.whatsapp_fixed_ack_text(),'assistant',null,'ready',j.expected_automation_generation,l.id,l.generation,j.id,'fixed_ack_v1') returning * into i;
 update public.whatsapp_inbound_jobs set staged_reply=private.whatsapp_fixed_ack_text(),send_intent_id=i.id where id=j.id;
 else select * into i from public.whatsapp_send_intents where id=j.send_intent_id and original_job_id=j.id and company_id=j.company_id and response_kind='fixed_ack_v1';end if;
 if i.id is null or i.body<>private.whatsapp_fixed_ack_text() or not private.whatsapp_intent_link_current(i) then return jsonb_build_object('ok',false,'code','binding_rejected');end if;
 return jsonb_build_object('ok',true,'intent',private.whatsapp_send_intent_public(i)||jsonb_build_object('link_id',i.link_id,'link_generation',i.link_generation,'response_kind','fixed_ack_v1','service_window_expires_at',private.whatsapp_service_window(j.company_id,c.id,c.phone_number_id,c.customer_wa_id)->>'valid_until'));
end;$$;
create function public.whatsapp_claim_fixed_ack_send(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;i public.whatsapp_send_intents%rowtype;token uuid;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 j:=private.whatsapp_fixed_ack_lock(p_job_id,p_claim_token);if j.id is null or j.response_kind is distinct from 'fixed_ack_v1' or j.usage_status is distinct from 'reserved'
 or j.usage_period_start is distinct from private.wa_worker_month() then return jsonb_build_object('ok',false,'code','authority_rejected');end if;
 select * into i from public.whatsapp_send_intents where id=j.send_intent_id and original_job_id=j.id and company_id=j.company_id and response_kind='fixed_ack_v1' for update;
 if not found or i.body<>private.whatsapp_fixed_ack_text() or i.expected_automation_generation<>j.expected_automation_generation or not private.whatsapp_intent_link_current(i) then return jsonb_build_object('ok',false,'code','binding_rejected');end if;
 if i.outcome<>'ready' then return jsonb_build_object('ok',true,'claimed',false,'intent',private.whatsapp_send_intent_public(i)||jsonb_build_object('link_id',i.link_id,'link_generation',i.link_generation,'response_kind','fixed_ack_v1'));end if;
 token:=gen_random_uuid();update public.whatsapp_send_intents set outcome='attempting',attempt_token=token,attempt_started_at=clock_timestamp(),attempt_expires_at=clock_timestamp()+interval '90 seconds' where id=i.id returning * into i;
 return jsonb_build_object('ok',true,'claimed',true,'attempt_token',token,'intent',private.whatsapp_send_intent_public(i)||jsonb_build_object('link_id',i.link_id,'link_generation',i.link_generation,'response_kind','fixed_ack_v1'));end;$$;
create function public.whatsapp_authorize_fixed_ack(p_job_id uuid,p_claim_token uuid,p_intent_id uuid,p_attempt_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;i public.whatsapp_send_intents%rowtype;service_window jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 j:=private.whatsapp_fixed_ack_lock(p_job_id,p_claim_token);if j.id is null or j.response_kind is distinct from 'fixed_ack_v1' or j.send_intent_id is distinct from p_intent_id
 or j.usage_status is distinct from 'reserved' or j.usage_period_start is distinct from private.wa_worker_month() then return jsonb_build_object('ok',false,'code','authority_rejected');end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id and company_id=j.company_id and original_job_id=j.id and response_kind='fixed_ack_v1' for update;
 if not found or i.body<>private.whatsapp_fixed_ack_text() or i.outcome<>'attempting' or i.attempt_token is distinct from p_attempt_token or i.attempt_expires_at<=clock_timestamp()
 or i.fixed_ack_dispatch_token is not null or i.expected_automation_generation<>j.expected_automation_generation or not private.whatsapp_intent_link_current(i) then return jsonb_build_object('ok',false,'code','dispatch_rejected');end if;
 service_window:=private.whatsapp_service_window(i.company_id,i.conversation_id,i.phone_number_id,i.recipient_wa_id);if service_window->>'ok' is distinct from 'true' then return service_window;end if;
 perform set_config('velora.fixed_ack_dispatch','1',true);update public.whatsapp_send_intents set fixed_ack_dispatch_token=p_attempt_token,fixed_ack_authorized_at=clock_timestamp() where id=i.id;
 return jsonb_build_object('ok',true,'intent_id',i.id,'company_id',i.company_id,'conversation_id',i.conversation_id,'phone_number_id',i.phone_number_id,'recipient_wa_id',i.recipient_wa_id,
 'link_id',i.link_id,'link_generation',i.link_generation,'response_kind','fixed_ack_v1','service_window_expires_at',service_window->>'valid_until');end;$$;
create function public.whatsapp_repair_fixed_ack(p_company_id uuid,p_phone_number_id text,p_recipient_wa_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i record;r jsonb;repaired integer:=0;pending integer:=0;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 for i in select x.id from public.whatsapp_send_intents x join public.whatsapp_inbound_jobs j on j.id=x.original_job_id and j.company_id=x.company_id
 where x.company_id=p_company_id and x.phone_number_id=p_phone_number_id and x.recipient_wa_id=p_recipient_wa_id and x.response_kind='fixed_ack_v1'
 and j.response_kind='fixed_ack_v1' and x.body=private.whatsapp_fixed_ack_text() and x.outcome='accepted' and j.status<>'completed' order by x.created_at,x.id limit 3 loop
 begin r:=public.retry_whatsapp_send_persist(i.id,null);if r->>'ok'='true' then r:=public.billing_finalize_automated_usage(p_company_id,i.id);end if;
 if r->>'status'='accepted' then repaired:=repaired+1;else pending:=pending+1;end if;exception when others then pending:=pending+1;end;
 end loop;return jsonb_build_object('ok',true,'repaired',repaired,'pending',pending);end;$$;
DO $acl$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('whatsapp_claim_fixed_ack','whatsapp_stage_fixed_ack','whatsapp_claim_fixed_ack_send','whatsapp_authorize_fixed_ack','whatsapp_repair_fixed_ack') LOOP EXECUTE format('revoke all on function %s from public,anon,authenticated',f);EXECUTE format('grant execute on function %s to service_role',f);END LOOP;
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('whatsapp_fixed_ack_identity','whatsapp_fixed_ack_no_ai') LOOP EXECUTE format('revoke all on function %s from public,anon,authenticated,service_role',f);END LOOP;
END;$acl$;
notify pgrst,'reload schema';commit;

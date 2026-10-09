-- Reuse the inbound processing ledger and outbound intents. No parallel queue.
begin;
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
create unique index whatsapp_worker_ai_company_uidx on public.ai_usage_ledger(id,company_id);
create unique index whatsapp_worker_subscription_company_uidx on public.billing_subscriptions(id,company_id);
alter table public.whatsapp_inbound_jobs add constraint whatsapp_worker_ai_company_fk
 foreign key(staged_ai_attempt_id,company_id) references public.ai_usage_ledger(id,company_id);
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
revoke all on function private.wa_worker_month() from public,anon,authenticated;

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
revoke all on function private.wa_worker_lock(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create or replace function public.claim_whatsapp_inbound_job(p_job_id uuid,p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;c public.whatsapp_conversations%rowtype;cid uuid;conv uuid;token uuid;unknown_work boolean;terminal_status text;
begin
 if current_setting('role',true)<>'service_role' then return jsonb_build_object('ok',false,'code','server_role_required');end if;
 select x.company_id,m.conversation_id into cid,conv from public.whatsapp_inbound_jobs x join public.whatsapp_messages m on m.id=x.message_id
 and m.company_id=x.company_id where x.id=p_job_id and m.direction='inbound' and m.sender='customer';
 if cid is null then return jsonb_build_object('ok',false,'code','not_found');end if;
 perform 1 from public.companies where id=cid for no key update;
 select * into c from public.whatsapp_conversations where id=conv and company_id=cid for update;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id and company_id=cid for update;
 if j.status in ('pending','retry_wait','claimed') and (j.status<>'claimed' or j.claim_expires_at is null or j.claim_expires_at<=clock_timestamp())
 and j.expected_automation_generation is not null and j.expected_automation_generation<>c.automation_generation then
 update public.whatsapp_inbound_jobs set status='review_required',claim_token=null,claim_expires_at=null,result_code='stale_generation_review',
 usage_status=case when exists(select 1 from public.ai_usage_ledger where worker_job_id=j.id and status in ('reserved','running','uncertain'))
 or exists(select 1 from public.whatsapp_send_intents where id=j.send_intent_id and outcome in ('attempting','unknown','accepted'))
 then 'unknown' else 'released' end where id=j.id;
 return jsonb_build_object('ok',false,'code','stale_generation_review');end if;
 if j.status in ('pending','retry_wait','claimed') and (j.status<>'claimed' or j.claim_expires_at is null or j.claim_expires_at<=clock_timestamp()) and j.attempt_count>=5 then
 unknown_work:=exists(select 1 from public.ai_usage_ledger where worker_job_id=j.id and status in ('reserved','running','uncertain'))
 or exists(select 1 from public.whatsapp_send_intents where id=j.send_intent_id and outcome in ('attempting','unknown','accepted'));
 terminal_status:=case when unknown_work then 'review_required' else 'dead_letter' end;
 update public.whatsapp_inbound_jobs set status=terminal_status,claim_token=null,claim_expires_at=null,result_code='attempts_exhausted',
 usage_status=case when unknown_work then 'unknown' else 'released' end where id=j.id;
 perform set_config('velora.conversation_control','1',true);
 if c.automation_generation=coalesce(j.expected_automation_generation,c.automation_generation) then
 update public.whatsapp_conversations set status='handed_over',automation_allowed=false,automation_generation=automation_generation+1,
 control_revision=control_revision+1,control_actor_id=null,control_acted_at=clock_timestamp() where id=c.id returning * into c;end if;
 insert into public.whatsapp_conversation_events(company_id,conversation_id,action,revision,automation_generation,detail)
 values(cid,c.id,'worker_escalation',c.control_revision,c.automation_generation,jsonb_build_object('job_id',j.id,'reason','attempts_exhausted','status',terminal_status)) on conflict do nothing;
 return jsonb_build_object('ok',false,'code','attempts_exhausted','status',terminal_status);end if;
 if j.status not in ('pending','retry_wait','claimed') or j.next_attempt_at>clock_timestamp()
 or (j.status='claimed' and j.claim_expires_at>clock_timestamp()) or j.attempt_count>=5 then return jsonb_build_object('ok',false,'code','not_claimable');end if;
 if exists(select 1 from public.whatsapp_inbound_jobs other join public.whatsapp_messages m on m.id=other.message_id
 where m.conversation_id=conv and other.id<>j.id and other.status in ('pending','retry_wait','claimed')
 and ((other.created_at,other.id)<(j.created_at,j.id) or (other.status='claimed' and other.claim_expires_at>clock_timestamp())))
 then return jsonb_build_object('ok',false,'code','conversation_order_blocked');end if;
 token:=gen_random_uuid();
 update public.whatsapp_inbound_jobs set status='claimed',claim_token=token,claimed_at=clock_timestamp(),
 claim_expires_at=clock_timestamp()+make_interval(secs=>greatest(60,least(coalesce(p_lease_seconds,120),300))),
 attempt_count=attempt_count+1,expected_automation_generation=coalesce(expected_automation_generation,c.automation_generation),updated_at=clock_timestamp()
 where id=j.id returning * into j;
 return jsonb_build_object('ok',true,'job_id',j.id,'message_id',j.message_id,'company_id',j.company_id,'wa_message_id',j.wa_message_id,
 'claim_token',j.claim_token,'claim_expires_at',j.claim_expires_at,'attempt_count',j.attempt_count);
end;$$;
revoke all on function public.claim_whatsapp_inbound_job(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_inbound_job(uuid,integer) to service_role;

create function public.whatsapp_claim_inbound_batch(p_limit integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;r jsonb;items jsonb:='[]';begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 for candidate in select j.id from public.whatsapp_inbound_jobs j join public.whatsapp_messages m on m.id=j.message_id
 join public.whatsapp_conversations c on c.id=m.conversation_id join public.companies co on co.id=j.company_id
 where j.status in ('pending','retry_wait','claimed') and c.status='open' and c.automation_allowed and co.status<>'suspended'
 and j.next_attempt_at<=clock_timestamp() and (j.status<>'claimed' or j.claim_expires_at<=clock_timestamp())
 and not exists(select 1 from public.whatsapp_inbound_jobs earlier join public.whatsapp_messages em on em.id=earlier.message_id
 where em.conversation_id=c.id and earlier.status in ('pending','retry_wait','claimed') and earlier.id<>j.id
 and ((earlier.created_at,earlier.id)<(j.created_at,j.id) or (earlier.status='claimed' and earlier.claim_expires_at>clock_timestamp())))
 order by j.created_at,j.id limit 100 loop
 r:=public.claim_whatsapp_inbound_job(candidate.id,120);
 if r->>'ok'='true' then items:=items||jsonb_build_array(r);end if;
 exit when jsonb_array_length(items)>=greatest(1,least(coalesce(p_limit,1),5));end loop;
 return jsonb_build_object('ok',true,'jobs',items);
end;$$;

create function public.whatsapp_reserve_job_usage(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;s public.billing_subscriptions%rowtype;proof jsonb;cap bigint;held bigint;period timestamptz:=private.wa_worker_month();
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 j:=private.wa_worker_lock(p_job_id,p_claim_token);if j.id is null then return jsonb_build_object('ok',false,'code','claim_or_automation_rejected');end if;
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

create function private.wa_worker_citations(p_company uuid,p_citations jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare x jsonb;k public.knowledge_sources%rowtype;begin
 if jsonb_typeof(p_citations) is distinct from 'array' or jsonb_array_length(p_citations)<1 or jsonb_array_length(p_citations)>40 then return false;end if;
 for x in select value from jsonb_array_elements(p_citations) loop
 select * into k from public.knowledge_sources where id=(x->>'sourceId')::uuid and company_id=p_company for share;
 if not found or k.status<>'ready' or not k.approved_for_answers or k.approved_version is distinct from k.content_version
 or k.content_version is distinct from (x->>'contentVersion')::integer or length(btrim(k.content))=0 then return false;end if;
 end loop;return true;
 exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;$$;
revoke all on function private.wa_worker_citations(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.whatsapp_stage_job_reply(p_job_id uuid,p_claim_token uuid,p_ai_attempt_id uuid,p_citations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;c public.whatsapp_conversations%rowtype;l public.whatsapp_company_links%rowtype;a record;r jsonb;i uuid;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 j:=private.wa_worker_lock(p_job_id,p_claim_token);if j.id is null then return jsonb_build_object('ok',false,'code','claim_or_automation_rejected');end if;
 if j.send_intent_id is not null then
 if j.staged_ai_attempt_id is distinct from p_ai_attempt_id or j.staged_citations is distinct from p_citations then return jsonb_build_object('ok',false,'code','staged_content_mismatch');end if;
 return jsonb_build_object('ok',true,'reused',true,'intent_id',j.send_intent_id);end if;
 if public.billing_read_company_operational_entitlement(j.company_id)->'active' is distinct from 'true'::jsonb
 or j.usage_status is distinct from 'reserved' or j.usage_period_start is distinct from private.wa_worker_month()
 then return jsonb_build_object('ok',false,'code','entitlement_or_usage_changed');end if;
 select * into a from public.ai_usage_ledger where id=p_ai_attempt_id and company_id=j.company_id
 and worker_job_id=j.id and automation_generation=j.expected_automation_generation and status='success';
 if not found or a.response_text is null or length(btrim(a.response_text)) not between 1 and 4096 then return jsonb_build_object('ok',false,'code','verified_reply_missing');end if;
 if p_citations is distinct from a.source_citations or not private.wa_worker_citations(j.company_id,p_citations)
 then return jsonb_build_object('ok',false,'code','citations_changed');end if;
 select * into c from public.whatsapp_conversations where id=(select conversation_id from public.whatsapp_messages where id=j.message_id);
 select * into l from public.whatsapp_company_links where company_id=j.company_id and status='verified' and provider_phone_number_id=c.phone_number_id for share;
 if not found then return jsonb_build_object('ok',false,'code','link_unavailable');end if;
 r:=public.create_whatsapp_assistant_send_intent('wa-job:'||j.id,c.id,a.response_text,c.phone_number_id,j.expected_automation_generation,l.id,l.generation);
 if r->>'ok' is distinct from 'true' then return r;end if;i:=(r->'intent'->>'id')::uuid;
 update public.whatsapp_send_intents set original_job_id=j.id where id=i and company_id=j.company_id;
 update public.whatsapp_inbound_jobs set staged_reply=a.response_text,staged_citations=p_citations,staged_ai_attempt_id=a.id,send_intent_id=i where id=j.id;
 return jsonb_build_object('ok',true,'reused',false,'intent_id',i);
end;$$;

create function public.billing_load_worker_frame(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;m public.whatsapp_messages%rowtype;c public.whatsapp_conversations%rowtype;l public.whatsapp_company_links%rowtype;a record;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 j:=private.wa_worker_lock(p_job_id,p_claim_token);if j.id is null then return jsonb_build_object('ok',false,'code','claim_or_automation_rejected');end if;
 select * into m from public.whatsapp_messages where id=j.message_id;select * into c from public.whatsapp_conversations where id=m.conversation_id;
 if m.message_type is distinct from 'text' then return jsonb_build_object('ok',false,'code','unsupported_message');end if;
 select * into l from public.whatsapp_company_links where company_id=j.company_id and status='verified' and provider_phone_number_id=c.phone_number_id;
 if not found then return jsonb_build_object('ok',false,'code','link_unavailable');end if;
 select id,status,response_text,source_citations into a from public.ai_usage_ledger where worker_job_id=j.id and automation_generation=j.expected_automation_generation order by attempt desc limit 1;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('job_id',j.id,'company_id',j.company_id,'message_id',m.id,'conversation_id',c.id,
 'phone_number_id',c.phone_number_id,'recipient_wa_id',c.customer_wa_id,'automation_generation',j.expected_automation_generation,
 'link_id',l.id,'link_generation',l.generation,'operation_key','wa-job:'||j.id,'question',m.body,'staged_citations',coalesce(j.staged_citations,a.source_citations),
 'reply_text',coalesce(j.staged_reply,a.response_text),'ai_attempt_id',coalesce(j.staged_ai_attempt_id,a.id),'ai_status',a.status,'intent_id',j.send_intent_id));
end;$$;

create function public.whatsapp_retry_inbound_job(p_job_id uuid,p_claim_token uuid,p_code text,p_uncertain boolean default false,p_terminal boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;c public.whatsapp_conversations%rowtype;terminal boolean;uncertain boolean;nextstatus text;delay int;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 j:=private.wa_worker_lock(p_job_id,p_claim_token,false);if j.id is null then return jsonb_build_object('ok',false,'code','claim_rejected');end if;
 -- An expired external attempt / running paid call is never a retry authorization.
 uncertain:=coalesce(p_uncertain,false) or exists(select 1 from public.ai_usage_ledger where worker_job_id=j.id and status in ('reserved','running','uncertain'))
 or exists(select 1 from public.whatsapp_send_intents where id=j.send_intent_id and outcome in ('attempting','unknown'));
 terminal:=coalesce(p_terminal,false) or uncertain or j.attempt_count>=5 or exists(select 1 from public.ai_usage_ledger where worker_job_id=j.id and status='incomplete')
 or exists(select 1 from public.whatsapp_send_intents where id=j.send_intent_id and outcome in ('attempting','unknown','accepted'));
 nextstatus:=case when uncertain then 'review_required' when terminal then 'dead_letter' else 'retry_wait' end;
 delay:=least(300,5*power(2,least(greatest(j.attempt_count-1,0),6))::int);
 update public.whatsapp_inbound_jobs set status=nextstatus,result_code=left(coalesce(p_code,'worker_unavailable'),120),
 next_attempt_at=clock_timestamp()+make_interval(secs=>delay),claim_token=null,claim_expires_at=null,
 usage_status=case when uncertain
 then 'unknown' when terminal then 'released' else usage_status end,updated_at=clock_timestamp() where id=j.id;
 if terminal then
 select * into c from public.whatsapp_conversations where id=(select conversation_id from public.whatsapp_messages where id=j.message_id);
 perform set_config('velora.conversation_control','1',true);
 if c.automation_generation=j.expected_automation_generation then
 update public.whatsapp_conversations set status='handed_over',automation_allowed=false,automation_generation=automation_generation+1,
 control_revision=control_revision+1,control_actor_id=null,control_acted_at=clock_timestamp() where id=c.id returning * into c;end if;
 insert into public.whatsapp_conversation_events(company_id,conversation_id,actor_user_id,action,revision,automation_generation,detail)
 values(j.company_id,c.id,null,'worker_escalation',c.control_revision,c.automation_generation,jsonb_build_object('job_id',j.id,'reason',left(p_code,120),'status',nextstatus)) on conflict do nothing;
 end if;
 return jsonb_build_object('ok',true,'status',nextstatus,'delay_seconds',delay);
end;$$;

create function public.whatsapp_heartbeat_inbound_job(p_job_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;begin
 if current_setting('role',true)<>'service_role' then return false;end if;
 j:=private.wa_worker_lock(p_job_id,p_claim_token);if j.id is null then return false;end if;
 update public.whatsapp_inbound_jobs set claim_expires_at=clock_timestamp()+interval '120 seconds' where id=j.id;return true;end;$$;

-- Staff send keeps its existing contract. Assistant sends require the original job.
alter function public.claim_whatsapp_send_attempt(uuid,uuid,integer) set schema private;
alter function private.claim_whatsapp_send_attempt(uuid,uuid,integer) rename to wa_claim_send_pre_integration;
revoke all on function private.wa_claim_send_pre_integration(uuid,uuid,integer) from public,anon,authenticated,service_role;
create function public.claim_whatsapp_send_attempt(p_intent_id uuid,p_actor_user_id uuid,p_lease_seconds integer default 90) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if exists(select 1 from public.whatsapp_send_intents where id=p_intent_id and sender_kind='assistant')
 then return jsonb_build_object('ok',false,'code','assistant_job_required');end if;
 return private.wa_claim_send_pre_integration(p_intent_id,p_actor_user_id,p_lease_seconds);end;$$;
revoke all on function public.claim_whatsapp_send_attempt(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_send_attempt(uuid,uuid,integer) to service_role;

create function public.whatsapp_claim_assistant_job_send(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;i public.whatsapp_send_intents%rowtype;token uuid;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 j:=private.wa_worker_lock(p_job_id,p_claim_token);if j.id is null then return jsonb_build_object('ok',false,'code','claim_or_automation_rejected');end if;
 if public.billing_read_company_operational_entitlement(j.company_id)->'active' is distinct from 'true'::jsonb
 or j.usage_status is distinct from 'reserved' or j.usage_period_start is distinct from private.wa_worker_month()
 or not private.wa_worker_citations(j.company_id,j.staged_citations) then return jsonb_build_object('ok',false,'code','entitlement_usage_or_knowledge_changed');end if;
 select * into i from public.whatsapp_send_intents where id=j.send_intent_id and company_id=j.company_id and original_job_id=j.id for update;
 if not found or i.sender_kind<>'assistant' or i.body is distinct from j.staged_reply or i.expected_automation_generation is distinct from j.expected_automation_generation
 or not private.whatsapp_intent_link_current(i) or not exists(select 1 from public.ai_usage_ledger a
 where a.id=j.staged_ai_attempt_id and a.company_id=j.company_id and a.worker_job_id=j.id and a.automation_generation=j.expected_automation_generation
 and a.status='success' and a.response_text=j.staged_reply and a.source_citations=j.staged_citations)
 then return jsonb_build_object('ok',false,'code','intent_binding_changed');end if;
 if i.outcome<>'ready' then return jsonb_build_object('ok',true,'claimed',false,'intent',private.whatsapp_send_intent_public(i));end if;
 token:=gen_random_uuid();update public.whatsapp_send_intents set outcome='attempting',attempt_token=token,
 attempt_started_at=clock_timestamp(),attempt_expires_at=clock_timestamp()+interval '90 seconds' where id=i.id returning * into i;
 return jsonb_build_object('ok',true,'claimed',true,'attempt_token',token,'intent',private.whatsapp_send_intent_public(i));
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

-- The existing owner dashboard reads the same durable reservations used by dispatch.
create or replace function public.billing_read_company_usage(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare period timestamptz:=private.wa_worker_month();accepted bigint;held bigint;cap jsonb;begin
 if not private.billing_ui_company_owner(p_company_id) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select count(*) filter(where j.usage_status='accepted' and i.outcome='accepted' and m.id is not null),
 count(*) filter(where j.usage_status in ('reserved','unknown')) into accepted,held
 from public.whatsapp_inbound_jobs j left join public.whatsapp_send_intents i on i.id=j.send_intent_id and i.company_id=j.company_id and i.original_job_id=j.id
 left join public.whatsapp_messages m on m.id=i.message_id and m.company_id=i.company_id and m.conversation_id=i.conversation_id
 and m.wa_message_id=i.wa_message_id and m.direction='outbound' and m.sender='assistant'
 where j.company_id=p_company_id and j.usage_period_start=period;
 select accepted+count(*) filter(where i.outcome='accepted' and m.id is not null and m.received_at>=period),
 held+count(*) filter(where (i.outcome in ('ready','attempting','unknown') and i.created_at>=period)
 or (i.outcome='accepted' and m.id is null and i.updated_at>=period)) into accepted,held
 from public.whatsapp_send_intents i left join public.whatsapp_messages m on m.id=i.message_id and m.company_id=i.company_id
 and m.conversation_id=i.conversation_id and m.wa_message_id=i.wa_message_id and m.direction='outbound' and m.sender='assistant'
 where i.company_id=p_company_id and i.sender_kind='assistant' and i.original_job_id is null;
 select v.limits->'automated_outbound_per_month' into cap from public.billing_subscriptions s join public.billing_plan_versions v on v.id=s.plan_version_id
 where s.company_id=p_company_id and s.environment='live';
 return jsonb_build_object('ok',true,'data',jsonb_build_object('month_start',to_char(period at time zone 'Asia/Muscat','YYYY-MM-DD'),
 'successful_automated_outbound',coalesce(accepted,0),'held_outbound_capacity',coalesce(held,0),'cap',cap));
end;$$;
revoke all on function public.billing_read_company_usage(uuid) from public,anon;
grant execute on function public.billing_read_company_usage(uuid) to authenticated;

-- Receipt persistence has an independent recovery lane. It never calls Meta/AI
-- and remains usable after handoff, expiry or disabling customer answering.
create function public.whatsapp_repair_accepted_jobs(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;r jsonb;u jsonb;repaired int:=0;pending int:=0;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 for candidate in select i.id,i.company_id from public.whatsapp_send_intents i join public.whatsapp_inbound_jobs j
 on j.id=i.original_job_id and j.company_id=i.company_id and j.send_intent_id=i.id
 where i.outcome='accepted' and i.wa_message_id is not null and (i.message_id is null or j.usage_status is distinct from 'accepted' or j.status<>'completed')
 order by i.updated_at,i.id limit greatest(1,least(coalesce(p_limit,10),50)) loop
 r:=public.retry_whatsapp_send_persist(candidate.id,null);
 if r->>'ok'='true' then
 u:=public.billing_finalize_automated_usage(candidate.company_id,candidate.id);
 if u->>'status'='accepted' then repaired:=repaired+1;else pending:=pending+1;end if;
 else pending:=pending+1;end if;end loop;
 return jsonb_build_object('ok',true,'repaired',repaired,'pending',pending);
end;$$;

-- Secret values stay in a separately configured Vault. This migration creates none.
alter table public.whatsapp_company_links add column access_secret_id uuid;
create unique index whatsapp_link_secret_uidx on public.whatsapp_company_links(access_secret_id) where access_secret_id is not null;
create function public.whatsapp_read_link_access_secret(p_company_id uuid,p_link_id uuid,p_phone_number_id text,p_link_generation bigint) returns jsonb
language plpgsql security definer set search_path='' as $$ declare secret_id uuid;token text;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select l.access_secret_id into secret_id from public.whatsapp_company_links l join public.companies c on c.id=l.company_id
 where l.id=p_link_id and l.company_id=p_company_id and c.status<>'suspended' and l.status='verified'
 and l.provider_phone_number_id=p_phone_number_id and l.generation=p_link_generation;
 if secret_id is null or not exists(select 1 from pg_extension where extname='supabase_vault')
 or to_regclass('vault.decrypted_secrets') is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where id=$1' into token using secret_id;
 if nullif(btrim(token),'') is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
 return jsonb_build_object('ok',true,'access_token',token,'company_id',p_company_id,'link_id',p_link_id,'phone_number_id',p_phone_number_id,'link_generation',p_link_generation);
end;$$;

do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('whatsapp_claim_inbound_batch','whatsapp_reserve_job_usage','whatsapp_stage_job_reply',
 'billing_load_worker_frame','whatsapp_retry_inbound_job','whatsapp_heartbeat_inbound_job','whatsapp_claim_assistant_job_send',
 'billing_finalize_automated_usage','whatsapp_read_link_access_secret','whatsapp_repair_accepted_jobs') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);end loop;
end;$$;
notify pgrst,'reload schema';
commit;

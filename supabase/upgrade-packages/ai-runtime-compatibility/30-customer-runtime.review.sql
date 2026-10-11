-- Scoped customer runtime dependencies. Existing worker/window/fixed-ack functions are reused, never replayed.
begin;
set local role postgres;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local search_path='';
-- Policy/column permission preflight; fail closed on widening or drift.
DO $ai_policy_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH targets AS (SELECT c.oid,n.nspname||'.'||c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))), policies AS (SELECT t.name,p.polname,p.polcmd,p.polpermissive,(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END) FROM unnest(p.polroles) r) roles,pg_get_expr(p.polqual,p.polrelid) using_expression,pg_get_expr(p.polwithcheck,p.polrelid) check_expression FROM targets t JOIN pg_policy p ON p.polrelid=t.oid), column_acl AS (SELECT t.name,a.attname,coalesce(r.rolname,'PUBLIC') grantee,x.privilege_type,x.is_grantable FROM targets t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN LATERAL aclexplode(a.attacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee) SELECT jsonb_build_object('policies',(SELECT jsonb_agg(to_jsonb(policies) ORDER BY name,polname) FROM policies),'column_acl',(SELECT jsonb_agg(to_jsonb(column_acl) ORDER BY name,attname,grantee,privilege_type,is_grantable) FROM column_acl))) q(data)) IS DISTINCT FROM '66e21932eaa60c5e4f0e6417694f8c6c' THEN RAISE EXCEPTION 'AI_COMPAT_POLICY_PREFLIGHT_DRIFT';END IF;END $ai_policy_guard$;
-- Exact structural preflight; no data or credentials included.
DO $ai_compat_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH fn AS (SELECT p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef definer,p.proconfig config,md5(replace(p.prosrc,chr(13),'')) body_md5,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private') AND p.proname IN ('ai_reserve_attempt','ai_start_attempt','ai_settle_attempt','ai_reconcile_attempt','ai_admin_snapshot','wa_worker_lock','wa_worker_month','whatsapp_job_service_window','whatsapp_service_window','billing_service_catalog_owner','billing_service_receipt_eligible','billing_financial_receipt_immutability','billing_service_immutable','billing_read_company_operational_entitlement','claim_whatsapp_inbound_job','ai_admin_snapshot','ai_answer_profile_binding_guard','ai_budget_account_binding','ai_budget_period','ai_budget_policy_immutable','ai_lock_authorized_whatsapp_job','ai_reconcile_attempt','ai_reserve_attempt','ai_reserve_whatsapp_attempt','ai_reserve_whatsapp_capacity_cost_attempt','ai_reserve_whatsapp_profile_attempt','ai_settle_admin','ai_settle_admin_attempt','ai_settle_attempt','ai_settle_whatsapp_attempt','ai_start_attempt','ai_start_whatsapp_attempt','ai_usage_ledger_guard_binding','ai_validate_cost','ai_validated_usage','ai_whatsapp_citations_current','billing_bind_ai_budget_draft','billing_load_worker_frame','claim_whatsapp_inbound_job','wa_noura_authority','wa_noura_binding_immutable','wa_worker_citations','whatsapp_answer_profile','whatsapp_attempt_profile_current','whatsapp_citations_include_current_instructions','whatsapp_claim_assistant_job_send','whatsapp_claim_inbound_batch','whatsapp_heartbeat_inbound_job','whatsapp_read_answer_profile','whatsapp_repair_accepted_jobs','whatsapp_reserve_job_usage','whatsapp_retrieve_approved_knowledge','whatsapp_retry_inbound_job','whatsapp_stage_job_reply')
), rel AS (
 SELECT n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
 (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
 (SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid) constraints,
 (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid=c.oid) indexes,
 (SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled::text,pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) triggers,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))
)
SELECT jsonb_build_object('functions',(SELECT jsonb_agg(to_jsonb(fn) ORDER BY signature) FROM fn),'relations',(SELECT jsonb_agg(to_jsonb(rel) ORDER BY name) FROM rel))) q(data)) IS DISTINCT FROM 'cba20e245166738454e29d65e5d82ce1' THEN RAISE EXCEPTION 'AI_COMPAT_PREFLIGHT_DRIFT';END IF;END $ai_compat_guard$;


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
 if j.response_kind is not null then return jsonb_build_object('ok',false,'code','FIXED_RESPONSE_JOB_REJECTED');end if;
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

create function public.whatsapp_claim_inbound_batch(p_limit integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;r jsonb;items jsonb:='[]';begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 for candidate in select j.id from public.whatsapp_inbound_jobs j join public.whatsapp_messages m on m.id=j.message_id
 join public.whatsapp_conversations c on c.id=m.conversation_id join public.companies co on co.id=j.company_id
 where j.response_kind is null and j.status in ('pending','retry_wait','claimed') and c.status='open' and c.automation_allowed and co.status<>'suspended'
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
 if j.response_kind is not null then return jsonb_build_object('ok',false,'code','FIXED_RESPONSE_JOB_REJECTED');end if;
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
 if j.response_kind is not null then return false;end if;
 update public.whatsapp_inbound_jobs set claim_expires_at=clock_timestamp()+interval '120 seconds' where id=j.id;return true;end;$$;

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

create function private.ai_lock_authorized_whatsapp_job(p_job_id uuid,p_claim_token uuid,p_generation integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype; c public.whatsapp_conversations%rowtype;
 cid uuid; conversation_id uuid; sub public.billing_subscriptions%rowtype; entitlement jsonb;
begin
 select job.company_id,m.conversation_id into cid,conversation_id
 from public.whatsapp_inbound_jobs job join public.whatsapp_messages m on m.id=job.message_id
 where job.id=p_job_id and m.company_id=job.company_id and m.wa_message_id=job.wa_message_id
   and m.direction='inbound' and m.sender='customer';
 if not found then return jsonb_build_object('ok',false,'code','ORIGINAL_INBOUND_REQUIRED'); end if;
 perform 1 from public.companies where id=cid and status<>'suspended' for no key update;
 if not found then return jsonb_build_object('ok',false,'code','COMPANY_UNAVAILABLE'); end if;
 select * into sub from public.billing_subscriptions where company_id=cid and environment='live' for no key update;
 if not found or sub.status not in ('active','cancel_at_period_end') or sub.paid_through is null
    or sub.paid_through<=clock_timestamp() or sub.plan_version_id is null
 then return jsonb_build_object('ok',false,'code','PAID_LIVE_SUBSCRIPTION_REQUIRED'); end if;
 entitlement:=public.billing_read_company_operational_entitlement(cid);
 if entitlement->>'ok' is distinct from 'true' or entitlement->>'active' is distinct from 'true'
   or entitlement->>'environment' is distinct from 'live'
   or (entitlement->>'plan_version_id')::uuid is distinct from sub.plan_version_id
   or (entitlement->>'paid_through')::timestamptz is distinct from sub.paid_through
 then return jsonb_build_object('ok',false,'code','PAID_LIVE_SUBSCRIPTION_REQUIRED'); end if;
 select * into c from public.whatsapp_conversations where id=conversation_id and company_id=cid for update;
 if not found then return jsonb_build_object('ok',false,'code','CONVERSATION_UNAVAILABLE'); end if;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id for update;
 if not found or j.company_id is distinct from cid or j.status<>'claimed' or j.claim_token is distinct from p_claim_token
    or p_claim_token is null or j.claim_expires_at is null or j.claim_expires_at<=clock_timestamp()
 then return jsonb_build_object('ok',false,'code','CLAIM_REJECTED'); end if;
 if not exists(select 1 from public.whatsapp_messages m where m.id=j.message_id and m.company_id=cid
   and m.conversation_id=c.id and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer')
 then return jsonb_build_object('ok',false,'code','ORIGINAL_INBOUND_REQUIRED'); end if;
 if c.status<>'open' or not c.automation_allowed or j.expected_automation_generation is null
    or c.automation_generation is distinct from j.expected_automation_generation
    or (p_generation is not null and p_generation is distinct from j.expected_automation_generation)
 then return jsonb_build_object('ok',false,'code','AUTOMATION_CHANGED'); end if;
 if j.usage_status is distinct from 'reserved' or j.usage_subscription_id is distinct from sub.id
    or j.usage_period_start is distinct from (date_trunc('month',clock_timestamp() at time zone 'Asia/Muscat') at time zone 'Asia/Muscat')
 then return jsonb_build_object('ok',false,'code','USAGE_RESERVATION_REQUIRED'); end if;
 return jsonb_build_object('ok',true,'company_id',cid,'automation_generation',c.automation_generation);
end; $$;
revoke all on function private.ai_lock_authorized_whatsapp_job(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function private.ai_lock_authorized_whatsapp_job(uuid,uuid,integer) to service_role;

-- The generation's original source versions travel with its reservation/draft.
-- Recovery may revalidate this snapshot; it may never replace it with new knowledge.
create function private.ai_whatsapp_citations_current(p_company_id uuid,p_citations jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare x jsonb; k public.knowledge_sources%rowtype; version_value numeric;
begin
 if jsonb_typeof(p_citations) is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_citations) not between 1 and 40 then return false; end if;
 for x in select value from jsonb_array_elements(p_citations) loop
  if jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'sourceId') is distinct from 'string'
   or jsonb_typeof(x->'contentVersion') is distinct from 'number' then return false; end if;
  version_value:=(x->>'contentVersion')::numeric;
  if version_value<1 or version_value>2147483647 or version_value<>trunc(version_value) then return false; end if;
  select * into k from public.knowledge_sources where id=(x->>'sourceId')::uuid and company_id=p_company_id for share;
  if not found or k.status<>'ready' or not k.approved_for_answers or k.approved_version is distinct from k.content_version
   or k.content_version is distinct from version_value::integer or length(btrim(k.content))=0
   or (x ? 'title' and x->>'title' is distinct from k.title) then return false; end if;
 end loop;
 return (select count(distinct value->>'sourceId')=jsonb_array_length(p_citations) from jsonb_array_elements(p_citations));
 exception when invalid_text_representation or numeric_value_out_of_range then return false;
end; $$;
revoke all on function private.ai_whatsapp_citations_current(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.ai_whatsapp_citations_current(uuid,jsonb) to service_role;

create function public.ai_reserve_whatsapp_attempt(p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,
 p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare gate jsonb; budget public.ai_budget_accounts%rowtype; cid uuid; generation integer;sub public.billing_subscriptions%rowtype;ceiling numeric;monthly_used numeric;
begin
 if p_id is null or p_attempt is null or p_attempt not between 1 and 3 or p_reserved_baisa is null
   or p_reserved_baisa<=0 or p_reserved_baisa>1000 or p_reserved_baisa::text in ('NaN','Infinity','-Infinity')
   or p_model_id is null or p_provider is null
   or not ((p_model_id='gemini-3.8-flash' and p_provider='google') or (p_model_id in ('gpt-6-luna','gpt-6.1-sol') and p_provider='openai'))
   or length(trim(coalesce(p_pricing_version,'')))=0 or jsonb_typeof(p_pricing_snapshot) is distinct from 'object'
   or p_pricing_snapshot->>'modelId' is distinct from p_model_id or p_pricing_snapshot->>'version' is distinct from p_pricing_version
 then raise exception 'INVALID_RESERVATION'; end if;
 gate:=private.ai_lock_authorized_whatsapp_job(p_job_id,p_claim_token);
 if gate->>'ok'<>'true' then return gate; end if;
 cid:=(gate->>'company_id')::uuid; generation:=(gate->>'automation_generation')::integer;
 if not private.ai_whatsapp_citations_current(cid,p_source_citations)
 then return jsonb_build_object('ok',false,'code','KNOWLEDGE_CHANGED'); end if;
 select * into sub from public.billing_subscriptions where company_id=cid and environment='live';
 select monthly_limit_baisa into ceiling from private.ai_plan_budget_policies where plan_version_id=sub.plan_version_id;
 if not found then return jsonb_build_object('ok',false,'code','BUDGET_POLICY_MISSING');end if;
 if exists(select 1 from public.ai_budget_accounts where scope='company_live' and company_id=cid
  and period_start=private.ai_budget_period(clock_timestamp()) and subscription_id is null)
 then return jsonb_build_object('ok',false,'code','LEGACY_BUDGET_REQUIRES_REVIEW');end if;
 insert into public.ai_budget_accounts(scope,company_id,limit_baisa,enabled,period_start,subscription_id,plan_version_id)
 values('company_live',cid,ceiling,true,private.ai_budget_period(clock_timestamp()),sub.id,sub.plan_version_id)
 on conflict (company_id,period_start,subscription_id,plan_version_id) where scope='company_live' and subscription_id is not null do nothing;
 select * into budget from public.ai_budget_accounts where scope='company_live' and company_id=cid
  and period_start=private.ai_budget_period(clock_timestamp()) and subscription_id=sub.id and plan_version_id=sub.plan_version_id for update;
 select coalesce(sum(spent_baisa+held_baisa),0) into monthly_used from public.ai_budget_accounts where scope='company_live'
  and company_id=cid and period_start=private.ai_budget_period(clock_timestamp());
 if not found or not budget.enabled then return jsonb_build_object('ok',false,'code','BUDGET_DISABLED'); end if;
 -- The original job is the logical execution. Changing a lease/generation cannot start it again.
 if exists(select 1 from public.ai_usage_ledger where id=p_id or (execution_id=p_job_id and attempt=p_attempt))
 then return jsonb_build_object('ok',false,'code','DUPLICATE_REQUEST'); end if;
 if exists(select 1 from public.ai_usage_ledger where worker_job_id=p_job_id and
   (automation_generation is distinct from generation or status<>'rejected' or cost_baisa is distinct from 0
    or cost_usd is distinct from 0 or error_code not in ('KEY_MISSING','PROVIDER_HTTP_403','PROVIDER_HTTP_404') or error_code is null))
 then return jsonb_build_object('ok',false,'code','PRIOR_ATTEMPT_NOT_RETRYABLE'); end if;
 if (select count(*) from public.ai_usage_ledger where worker_job_id=p_job_id and automation_generation=generation)<>p_attempt-1
   or (p_attempt>1 and not exists(select 1 from public.ai_usage_ledger where worker_job_id=p_job_id
     and automation_generation=generation and attempt=p_attempt-1 and worker_claim_token=p_claim_token))
 then return jsonb_build_object('ok',false,'code','ATTEMPT_SEQUENCE_REJECTED'); end if;
 if monthly_used+p_reserved_baisa>ceiling
 then return jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED'); end if;
 insert into public.ai_usage_ledger(id,budget_account_id,company_id,execution_id,attempt,usage_mode,model_id,provider,
   reserved_baisa,pricing_version,pricing_snapshot,worker_job_id,worker_claim_token,automation_generation,source_citations)
 values(p_id,budget.id,cid,p_job_id,p_attempt,'company_live',p_model_id,p_provider,p_reserved_baisa,
   p_pricing_version,p_pricing_snapshot,p_job_id,p_claim_token,generation,p_source_citations);
 update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
 return jsonb_build_object('ok',true,'id',p_id,'job_id',p_job_id,'company_id',cid,'automation_generation',generation,
   'remaining_baisa',ceiling-monthly_used-p_reserved_baisa);
end; $$;
revoke all on function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) to service_role;

create function public.ai_start_whatsapp_attempt(p_id uuid,p_claim_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype; gate jsonb;
begin
 select * into entry from public.ai_usage_ledger where id=p_id;
 if not found or entry.worker_job_id is null or entry.worker_claim_token is distinct from p_claim_token
    or entry.status<>'reserved' then return false; end if;
 gate:=private.ai_lock_authorized_whatsapp_job(entry.worker_job_id,p_claim_token,entry.automation_generation);
 if gate->>'ok'<>'true' then return false; end if;
 if not private.ai_whatsapp_citations_current(entry.company_id,entry.source_citations) then return false; end if;
 perform 1 from public.ai_budget_accounts where id=entry.budget_account_id and enabled
  and scope='company_live' and company_id=entry.company_id
  and period_start=private.ai_budget_period(clock_timestamp())
  and subscription_id=(select id from public.billing_subscriptions where company_id=entry.company_id and environment='live')
  and plan_version_id=entry.answer_plan_version_id for update;
 if not found then return false; end if;
 update public.ai_usage_ledger set status='running' where id=p_id and status='reserved'
  and worker_claim_token=p_claim_token;
 return found;
end; $$;
revoke all on function public.ai_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_start_whatsapp_attempt(uuid,uuid) to service_role;

create function public.ai_settle_whatsapp_attempt(p_id uuid,p_claim_token uuid,p_status text,
 p_cost_usd numeric,p_cost_baisa numeric,p_usage jsonb,p_request_id text,p_response_id text,
 p_actual_model_id text,p_response_text text,p_error_code text,p_latency_ms integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype; u jsonb; model_normalized text;
begin
 if p_status is null or p_status not in ('success','rejected','incomplete','uncertain')
   or p_latency_ms is null or p_latency_ms<0 then raise exception 'INVALID_SETTLEMENT'; end if;
 u:=private.ai_validated_usage(p_usage,p_status,true);
 if p_status<>'uncertain' and (p_cost_baisa is null or p_cost_usd is null)
   or p_cost_baisa<0 or p_cost_usd<0
   or p_cost_baisa::text in ('NaN','Infinity','-Infinity') or p_cost_usd::text in ('NaN','Infinity','-Infinity')
 then raise exception 'INVALID_COST'; end if;
 if p_status='rejected' and (p_cost_baisa<>0 or p_cost_usd<>0) then raise exception 'INVALID_REJECTION_COST'; end if;
 if (p_status='success' and length(trim(coalesce(p_response_text,'')))=0)
   or (p_status<>'success' and p_response_text is not null) or length(p_response_text)>32000
   or length(p_request_id)>200 or length(p_response_id)>200 or length(p_actual_model_id)>100
 then raise exception 'INVALID_RESPONSE_METADATA'; end if;
 select * into entry from public.ai_usage_ledger where id=p_id;
 if not found or entry.worker_job_id is null or p_claim_token is null
    or entry.worker_claim_token is distinct from p_claim_token then return false; end if;
 -- Recording already-incurred cost does not need today's automation/lease authority.
 -- Original reservation capability only; stage/send independently require the current claim.
 perform 1 from public.companies where id=entry.company_id for no key update;
 perform 1 from public.whatsapp_inbound_jobs where id=entry.worker_job_id for update;
 perform 1 from public.ai_budget_accounts where id=entry.budget_account_id for update;
 select * into entry from public.ai_usage_ledger where id=p_id for update;
 if p_status in ('success','incomplete') then
  model_normalized:=case when entry.provider='google' then regexp_replace(coalesce(p_actual_model_id,''),'^models/','')
    else coalesce(p_actual_model_id,'') end;
  if model_normalized<>entry.model_id and not (
    (entry.provider='google' and model_normalized~('^'||replace(entry.model_id,'.','\.')||'-[0-9]{3}$'))
    or (entry.provider='openai' and model_normalized~('^'||replace(entry.model_id,'.','\.')||'-[0-9]{4}-[0-9]{2}-[0-9]{2}$')))
  then raise exception 'PROVIDER_MODEL_MISMATCH'; end if;
 end if;
 if entry.status not in ('reserved','running') then
  -- Identical retries acknowledge the first transaction without charging twice.
  return entry.status=p_status and entry.cost_usd is not distinct from p_cost_usd and entry.cost_baisa is not distinct from p_cost_baisa
   and entry.prompt_tokens is not distinct from (u->>'promptTokens')::integer
   and entry.completion_tokens is not distinct from (u->>'completionTokens')::integer
   and entry.cached_tokens is not distinct from (u->>'cachedTokens')::integer
   and entry.reasoning_tokens is not distinct from (u->>'reasoningTokens')::integer
   and entry.cache_write_tokens is not distinct from (u->>'cacheWriteTokens')::integer
   and entry.total_tokens is not distinct from (u->>'totalTokens')::integer
   and entry.request_id is not distinct from p_request_id and entry.response_id is not distinct from p_response_id
   and entry.actual_model_id is not distinct from p_actual_model_id and entry.response_text is not distinct from p_response_text
   and entry.error_code is not distinct from left(p_error_code,80) and entry.latency_ms=p_latency_ms;
 end if;
 if p_status in ('success','incomplete') and entry.status<>'running' then return false; end if;
 if p_status<>'uncertain' then
  update public.ai_budget_accounts set held_baisa=held_baisa-entry.reserved_baisa,spent_baisa=spent_baisa+p_cost_baisa,
   enabled=enabled and spent_baisa+p_cost_baisa<=limit_baisa and p_cost_baisa<=entry.reserved_baisa
  where id=entry.budget_account_id;
 end if;
 update public.ai_usage_ledger set status=p_status,cost_usd=p_cost_usd,cost_baisa=p_cost_baisa,
  prompt_tokens=(u->>'promptTokens')::integer,completion_tokens=(u->>'completionTokens')::integer,
  cached_tokens=(u->>'cachedTokens')::integer,reasoning_tokens=(u->>'reasoningTokens')::integer,
  cache_write_tokens=(u->>'cacheWriteTokens')::integer,total_tokens=(u->>'totalTokens')::integer,
  request_id=p_request_id,response_id=p_response_id,actual_model_id=p_actual_model_id,response_text=p_response_text,
  error_code=left(p_error_code,80),latency_ms=p_latency_ms,finished_at=clock_timestamp() where id=p_id;
 return true;
end; $$;
revoke all on function public.ai_settle_whatsapp_attempt(uuid,uuid,text,numeric,numeric,jsonb,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.ai_settle_whatsapp_attempt(uuid,uuid,text,numeric,numeric,jsonb,text,text,text,text,text,integer) to service_role;


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


create function private.whatsapp_answer_profile(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;s public.billing_subscriptions%rowtype;proof jsonb;gate jsonb;plan_code text;persona text;
begin
 gate:=private.whatsapp_job_service_window(p_job_id,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 j:=private.wa_worker_lock(p_job_id,p_claim_token);
 if j.id is null then return jsonb_build_object('ok',false,'code','claim_or_automation_rejected');end if;
 if j.response_kind is not null then return jsonb_build_object('ok',false,'code','FIXED_RESPONSE_JOB_REJECTED');end if;
 select * into s from public.billing_subscriptions where company_id=j.company_id and environment='live';
 if not found or s.status not in ('active','cancel_at_period_end') or s.paid_through is null
 or s.paid_through<=clock_timestamp() or s.plan_version_id is null
 then return jsonb_build_object('ok',false,'code','subscription_inactive');end if;
 proof:=public.billing_read_company_operational_entitlement(j.company_id);
 if proof->>'ok' is distinct from 'true' or proof->>'active' is distinct from 'true' or proof->>'environment' is distinct from 'live'
 or proof->>'plan_version_id' is distinct from s.plan_version_id::text
 or (proof->>'paid_through')::timestamptz is distinct from s.paid_through
 then return jsonb_build_object('ok',false,'code','subscription_inactive');end if;
 select p.code into plan_code from public.billing_plan_versions v join public.billing_plans p on p.id=v.plan_id
 where v.id=s.plan_version_id and v.status in ('published','retired') for share of v,p;
 persona:=case plan_code when 'noor_basic' then 'noura' when 'noor_premium' then 'noura'
 when 'lina_basic' then 'lina' when 'lina_premium' then 'lina' when 'dana_basic' then 'dana' when 'dana_premium' then 'dana' end;
 if persona is null then return jsonb_build_object('ok',false,'code','canonical_paid_plan_required');end if;
 return jsonb_build_object('ok',true,'company_id',j.company_id,'job_id',j.id,'plan_version_id',s.plan_version_id,'plan_code',plan_code,'persona',persona);
end; $$;
revoke all on function private.whatsapp_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;

create function public.whatsapp_read_answer_profile(p_company_id uuid,p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare r jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 r:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if r->>'ok'='true' and r->>'company_id' is distinct from p_company_id::text
 then return jsonb_build_object('ok',false,'code','company_binding_rejected');end if;
 return r;
end; $$;

-- Pure lexical retrieval: OR the normalized search lexemes, using the simple
-- multilingual dictionary. No embeddings, provider calls or hidden source cuts.
-- Selection is one bounded locked database query, at most 41 full rows. Returning
-- every relevant complete source avoids dropping a contradictory price/policy.
create function public.whatsapp_retrieve_approved_knowledge(p_company_id uuid,p_job_id uuid,p_claim_token uuid,p_question text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gate jsonb;j public.whatsapp_inbound_jobs%rowtype;question text;query_text text;q tsquery;ids uuid[];n integer;chars bigint;knowledge_count integer;sources jsonb;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 gate:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 if gate->>'company_id' is distinct from p_company_id::text then return jsonb_build_object('ok',false,'code','company_binding_rejected');end if;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id and company_id=p_company_id;
 select m.body into question from public.whatsapp_messages m where m.id=j.message_id and m.company_id=p_company_id
 and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer';
 if p_question is null or p_question is distinct from question or length(btrim(p_question))=0 or length(p_question)>1000
 then return jsonb_build_object('ok',false,'code','question_binding_rejected');end if;
 select string_agg(quote_literal(word),' | ' order by word) into query_text
 from unnest(tsvector_to_array(to_tsvector('simple'::regconfig,p_question))) as tokens(word)
 where length(word)>1 and word<>all(array['a','an','the','is','are','was','were','do','does','did','how','what','when','where','which','who','why','can','could','would','please','me','my','your','you','it','its','to','for','of','in','on','at','and','or','about','have','has','هل','ما','ماذا','كيف','متى','وين','أين','من','في','على','عن','هذا','هذه','هو','هي','أنا','انا','لو','سمحت','ممكن','ابغى','أريد','اريد','عندكم','عندك']);
 if query_text is null then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 q:=to_tsquery('simple'::regconfig,query_text);
 with selected as materialized (
  select k.id,k.usage_role,length(k.title)+length(btrim(k.content))+5 as block_chars
  from public.knowledge_sources k where k.company_id=p_company_id and k.status='ready' and k.approved_for_answers
  and k.approved_version=k.content_version and length(btrim(k.content))>0
  and (k.usage_role='business_instructions' or to_tsvector('simple'::regconfig,k.title||' '||k.content)@@q)
  order by k.usage_role,k.id limit 41 for share of k
 ) select array_agg(id),count(*)::integer,coalesce(sum(block_chars),0)+greatest(count(*)-1,0)*2,
  count(*) filter(where usage_role='knowledge')::integer into ids,n,chars,knowledge_count from selected;
 if n>40 or chars>12000 then return jsonb_build_object('ok',false,'code','CONTEXT_OVERFLOW');end if;
 if knowledge_count=0 then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 select jsonb_agg(jsonb_build_object('id',k.id,'company_id',k.company_id,'title',k.title,'content',k.content,
  'content_version',k.content_version,'approved_version',k.approved_version,'approved_for_answers',k.approved_for_answers,
  'status',k.status,'kind',k.kind,'storage_path',k.storage_path,'byte_size',k.byte_size,'updated_at',k.updated_at,'usage_role',k.usage_role)
  order by k.usage_role,k.id) into sources from public.knowledge_sources k where k.id=any(ids) and k.company_id=p_company_id;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'job_id',p_job_id,'sources',sources,'context_chars',chars);
end; $$;

alter table public.ai_usage_ledger add column answer_persona text,
 add column answer_plan_version_id uuid references public.billing_plan_versions(id) on delete restrict;
alter table public.ai_usage_ledger add constraint ai_answer_profile_snapshot_pair check (
 (answer_persona is null and answer_plan_version_id is null)
 or (answer_persona in ('noura','lina','dana') and answer_persona is not null and answer_plan_version_id is not null and worker_job_id is not null));
grant select(answer_persona,answer_plan_version_id) on public.ai_usage_ledger to authenticated;

-- Legacy rows remain null and cannot dispatch. Only atomic reservation may bind
-- once; later settlement cannot replace or clear the plan/persona evidence.
create function private.ai_answer_profile_binding_guard() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if tg_op='INSERT' then new.answer_persona:=null;new.answer_plan_version_id:=null;return new;end if;
 if row(new.answer_persona,new.answer_plan_version_id) is distinct from row(old.answer_persona,old.answer_plan_version_id)
 and not (old.answer_persona is null and old.answer_plan_version_id is null and new.answer_persona is not null
 and new.answer_plan_version_id is not null and new.worker_job_id is not null and new.status='reserved'
 and coalesce(current_setting('velora.answer_profile_binding',true),'')='1')
 then raise exception 'ANSWER_PROFILE_BINDING_IMMUTABLE' using errcode='23514';end if;
 return new;
end; $$;
revoke all on function private.ai_answer_profile_binding_guard() from public,anon,authenticated,service_role;
create trigger ai_answer_profile_binding_guard before insert or update on public.ai_usage_ledger
 for each row execute function private.ai_answer_profile_binding_guard();

create function private.whatsapp_citations_include_current_instructions(p_company_id uuid,p_citations jsonb) returns boolean
language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.knowledge_sources k where k.company_id=p_company_id and k.usage_role='business_instructions'
 and k.status='ready' and k.approved_for_answers and k.approved_version=k.content_version and length(btrim(k.content))>0) then return true;end if;
 if jsonb_typeof(p_citations) is distinct from 'array' then return false;end if;
 return not exists(select 1 from public.knowledge_sources k where k.company_id=p_company_id and k.usage_role='business_instructions'
 and k.status='ready' and k.approved_for_answers and k.approved_version=k.content_version and length(btrim(k.content))>0
 and not exists(select 1 from jsonb_array_elements(p_citations) x where x->>'sourceId'=k.id::text
 and x->>'contentVersion'=k.content_version::text and x->>'title'=k.title));
end; $$;
revoke all on function private.whatsapp_citations_include_current_instructions(uuid,jsonb) from public,anon,authenticated,service_role;

-- Chain policy143000's window/authorization wrappers. Never bypass its guards.
alter function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) set schema private;
alter function private.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) rename to wa_ai_reserve_pre_answer_profile;
revoke all on function private.wa_ai_reserve_pre_answer_profile(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.ai_reserve_whatsapp_attempt(p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,
 p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$ declare profile jsonb;r jsonb;bound uuid;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 profile:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if profile->>'ok' is distinct from 'true' then return profile;end if;
 if not private.whatsapp_citations_include_current_instructions((profile->>'company_id')::uuid,p_source_citations)
 then return jsonb_build_object('ok',false,'code','KNOWLEDGE_CHANGED');end if;
 r:=private.wa_ai_reserve_pre_answer_profile(p_id,p_job_id,p_claim_token,p_attempt,p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
 if r->>'ok' is distinct from 'true' then return r;end if;
 perform set_config('velora.answer_profile_binding','1',true);
 update public.ai_usage_ledger set answer_persona=profile->>'persona',answer_plan_version_id=(profile->>'plan_version_id')::uuid
 where id=p_id and worker_job_id=p_job_id and worker_claim_token=p_claim_token and company_id=(profile->>'company_id')::uuid
 and status='reserved' and answer_persona is null and answer_plan_version_id is null returning id into bound;
 perform set_config('velora.answer_profile_binding','0',true);
 if bound is null then raise exception 'ANSWER_PROFILE_BINDING_FAILED';end if;
 return r||jsonb_build_object('answer_persona',profile->>'persona','answer_plan_version_id',profile->>'plan_version_id');
end; $$;

-- The pre-read system persona must agree with the atomic reservation snapshot.
create function public.ai_reserve_whatsapp_profile_attempt(p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,
 p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb,
 p_expected_persona text,p_expected_plan_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$ declare profile jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 profile:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if profile->>'ok' is distinct from 'true' then return profile;end if;
 if p_expected_persona is null or p_expected_plan_version_id is null or profile->>'persona' is distinct from p_expected_persona
 or profile->>'plan_version_id' is distinct from p_expected_plan_version_id::text
 then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return public.ai_reserve_whatsapp_attempt(p_id,p_job_id,p_claim_token,p_attempt,p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
end; $$;

create function private.whatsapp_attempt_profile_current(p_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$ declare a public.ai_usage_ledger%rowtype;profile jsonb;begin
 select * into a from public.ai_usage_ledger where id=p_id;
 if not found or a.worker_job_id is null or a.answer_persona is null or a.answer_plan_version_id is null then return false;end if;
 -- Reserved/running execution remains bound to its original lease. A settled
 -- successful draft may be recovered with a new live lease, never a new AI call.
 if a.status<>'success' and a.worker_claim_token is distinct from p_claim_token then return false;end if;
 profile:=private.whatsapp_answer_profile(a.worker_job_id,p_claim_token);
 if profile->>'ok' is distinct from 'true' or profile->>'company_id' is distinct from a.company_id::text
 or profile->>'persona' is distinct from a.answer_persona or profile->>'plan_version_id' is distinct from a.answer_plan_version_id::text
 then return false;end if;
 if not exists(select 1 from public.whatsapp_inbound_jobs where id=a.worker_job_id and company_id=a.company_id
 and expected_automation_generation=a.automation_generation) then return false;end if;
 if not private.whatsapp_citations_include_current_instructions(a.company_id,a.source_citations) then return false;end if;
 perform 1 from public.ai_usage_ledger where id=a.id and answer_persona=a.answer_persona and answer_plan_version_id=a.answer_plan_version_id
 and worker_claim_token=a.worker_claim_token and status=a.status for update;
 return found;
end; $$;
revoke all on function private.whatsapp_attempt_profile_current(uuid,uuid) from public,anon,authenticated,service_role;

alter function public.ai_start_whatsapp_attempt(uuid,uuid) set schema private;
alter function private.ai_start_whatsapp_attempt(uuid,uuid) rename to wa_ai_start_pre_answer_profile;
revoke all on function private.wa_ai_start_pre_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;
create function public.ai_start_whatsapp_attempt(p_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$ begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if not private.whatsapp_attempt_profile_current(p_id,p_claim_token) then return false;end if;
 return private.wa_ai_start_pre_answer_profile(p_id,p_claim_token);
end; $$;

-- An already paid draft cannot be sent under a changed plan/persona either.
alter function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) set schema private;
alter function private.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) rename to wa_stage_pre_answer_profile;
revoke all on function private.wa_stage_pre_answer_profile(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.whatsapp_stage_job_reply(p_job_id uuid,p_claim_token uuid,p_ai_attempt_id uuid,p_citations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from public.ai_usage_ledger where id=p_ai_attempt_id and worker_job_id=p_job_id)
 or not private.whatsapp_attempt_profile_current(p_ai_attempt_id,p_claim_token)
 then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return private.wa_stage_pre_answer_profile(p_job_id,p_claim_token,p_ai_attempt_id,p_citations);
end; $$;

alter function public.whatsapp_claim_assistant_job_send(uuid,uuid) set schema private;
alter function private.whatsapp_claim_assistant_job_send(uuid,uuid) rename to wa_send_pre_answer_profile;
revoke all on function private.wa_send_pre_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_claim_assistant_job_send(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare attempt uuid;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select staged_ai_attempt_id into attempt from public.whatsapp_inbound_jobs where id=p_job_id;
 if attempt is null or not private.whatsapp_attempt_profile_current(attempt,p_claim_token)
 then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return private.wa_send_pre_answer_profile(p_job_id,p_claim_token);
end; $$;


create function public.ai_reserve_whatsapp_capacity_cost_attempt(p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,
 p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb,
 p_expected_persona text default null,p_expected_plan_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare capacity jsonb;reservation jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 -- The capacity guard obtains the shared company -> subscription -> conversation
 -- -> job locks first. The cost guard reuses them before its citation/budget locks.
 -- An inner exception block is a PostgreSQL subtransaction: a denied cost/profile
 -- rolls back only writes from this joint operation, including a new message slot.
 -- Existing reservations and settled/uncertain cost predate this block and survive.
 begin
  capacity:=public.whatsapp_reserve_job_usage(p_job_id,p_claim_token);
  if capacity->>'ok' is distinct from 'true' then
   reservation:=capacity;
   raise exception 'ATOMIC_RESERVATION_DENIED' using errcode='PWA01';
  end if;
  if p_expected_persona is not null or p_expected_plan_version_id is not null then
   reservation:=public.ai_reserve_whatsapp_profile_attempt(p_id,p_job_id,p_claim_token,p_attempt,
    p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations,
    p_expected_persona,p_expected_plan_version_id);
  else
   reservation:=public.ai_reserve_whatsapp_attempt(p_id,p_job_id,p_claim_token,p_attempt,
    p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
  end if;
  if reservation->>'ok' is distinct from 'true' then
   raise exception 'ATOMIC_RESERVATION_DENIED' using errcode='PWA01';
  end if;
  return reservation;
 exception when sqlstate 'PWA01' then
  return reservation;
 end;
end; $$;
revoke all on function public.ai_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid)
 from public,anon,authenticated;
grant execute on function public.ai_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid)
 to service_role;
comment on function public.ai_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid) is
 'Service-only joint message capacity and AI cost reservation. Denials roll back new writes; previous cost and quota evidence is preserved.';


-- Reservation/start already have guarded definer wrappers for window, plan/persona
-- and joint capacity. Keep that chain intact; wrap only the remaining invoker write.
alter function public.ai_settle_whatsapp_attempt(uuid,uuid,text,numeric,numeric,jsonb,text,text,text,text,text,integer) set schema private;
alter function private.ai_settle_whatsapp_attempt(uuid,uuid,text,numeric,numeric,jsonb,text,text,text,text,text,integer) rename to ai_settle_whatsapp_pre_security;
create function public.ai_settle_whatsapp_attempt(p_id uuid,p_claim_token uuid,p_status text,p_cost_usd numeric,p_cost_baisa numeric,
 p_usage jsonb,p_request_id text,p_response_id text,p_actual_model_id text,p_response_text text,p_error_code text,p_latency_ms integer)
returns boolean language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 perform private.ai_validate_cost(p_status,p_cost_usd,p_cost_baisa);
 return private.ai_settle_whatsapp_pre_security(p_id,p_claim_token,p_status,p_cost_usd,p_cost_baisa,p_usage,p_request_id,p_response_id,
 p_actual_model_id,p_response_text,p_error_code,p_latency_ms);
end;$$;


DO $acl$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(array['ai_reserve_whatsapp_attempt','ai_reserve_whatsapp_capacity_cost_attempt','ai_reserve_whatsapp_profile_attempt','ai_settle_whatsapp_attempt','ai_start_whatsapp_attempt','billing_load_worker_frame','claim_whatsapp_inbound_job','whatsapp_claim_assistant_job_send','whatsapp_claim_inbound_batch','whatsapp_heartbeat_inbound_job','whatsapp_read_answer_profile','whatsapp_repair_accepted_jobs','whatsapp_reserve_job_usage','whatsapp_retrieve_approved_knowledge','whatsapp_retry_inbound_job','whatsapp_stage_job_reply']) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public,anon,authenticated,service_role',f);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f);END LOOP;
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname=ANY(array['ai_answer_profile_binding_guard','ai_lock_authorized_whatsapp_job','ai_settle_whatsapp_pre_security','ai_whatsapp_citations_current','noura_pre_ai_reserve_whatsapp_attempt','noura_pre_ai_start_whatsapp_attempt','noura_pre_whatsapp_claim_assistant_job_send','noura_pre_whatsapp_retrieve_approved_knowledge','noura_pre_whatsapp_stage_job_reply','wa_ai_reserve_pre_answer_profile','wa_ai_reserve_pre_meta_policy','wa_ai_start_pre_answer_profile','wa_ai_start_pre_meta_policy','wa_answer_profile_pre_noura_authority','wa_claim_assistant_pre_meta_policy','wa_frame_pre_meta_policy','wa_frame_pre_noura_authority','wa_noura_authority','wa_noura_binding_immutable','wa_reserve_usage_pre_meta_policy','wa_reserve_usage_pre_noura_authority','wa_send_pre_answer_profile','wa_stage_pre_answer_profile','wa_worker_citations','whatsapp_answer_profile','whatsapp_attempt_profile_current','whatsapp_citations_include_current_instructions']) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public,anon,authenticated,service_role',f);END LOOP;
 END $acl$;

do $$ declare dep record;begin
 for dep in select * from (values
 ('private.whatsapp_answer_profile(uuid,uuid)','0d834a5c14b62ee5cbb4b279d1d7c964',true),
 ('private.whatsapp_attempt_profile_current(uuid,uuid)','faa429eba2663ff3f3778bd09a5f68ae',true),
 ('private.wa_worker_lock(uuid,uuid,boolean)','640a38a1b04404aa7617ee2f9167f8cb',true),
 ('private.billing_service_receipt_eligible(uuid)','b7d82e7e8fefc05c22f876f1ac00b7c2',false),
 ('private.billing_service_immutable()','17b4d16be72ea6e2e3e44401c7680fd2',false),
 ('public.whatsapp_reserve_job_usage(uuid,uuid)','b071381f7a927cbe43f8218c7fb012dd',true),
 ('public.billing_load_worker_frame(uuid,uuid)','d5d44bc789f0c58a0560f2fcb6cc4060',true),
 ('public.ai_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid)','74e31c07c93b44dececdfdf26ce67dd1',true),
 ('public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text)','cd50d8ffe3d991c1094c451d64a8954c',true),
 ('public.ai_start_whatsapp_attempt(uuid,uuid)','391d88704db13210484733b7c33ba841',true),
 ('public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb)','8e20548d90371197057bbe5bcc4eeb07',true),
 ('public.whatsapp_claim_assistant_job_send(uuid,uuid)','e814855031032f6bded47937f15ba355',true),
 ('public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb)','a6dd5eb64f6a17b8d4742bf9e31fea6c',true),
 ('public.ai_reserve_whatsapp_profile_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid)','2161b5e69d287460f094c4139c04973a',true)) dependencies(signature,body_hash,definer) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(dep.signature)
  and md5(replace(prosrc,chr(13),''))=dep.body_hash and prosecdef=dep.definer
  and array_to_string(proconfig,',')='search_path=""') then
   raise exception 'NOURA_WORKER_PREREQUISITE_MISMATCH: %',dep.signature using errcode='55000';
  end if;
  if dep.signature like 'public.%' and (has_function_privilege('anon',to_regprocedure(dep.signature),'EXECUTE')
  or has_function_privilege('authenticated',to_regprocedure(dep.signature),'EXECUTE')
  or not has_function_privilege('service_role',to_regprocedure(dep.signature),'EXECUTE')) then
   raise exception 'NOURA_WORKER_RPC_ACL_MISMATCH: %',dep.signature using errcode='55000';
  end if;
 end loop;
 if md5(replace(pg_get_viewdef('private.billing_proven_entitlement_grants'::regclass,true),chr(13),''))<>'aa061659aa08afb861a76c830b339b41'
 or md5(replace(pg_get_viewdef('private.billing_verified_collection_history'::regclass,true),chr(13),''))<>'329b440feaaaf7f2602b96651e932622'
 or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.billing_financial_receipt_immutability()'::regprocedure)<>'7b28f06702c177c5b65e3d9b23a7e1d4'
 then raise exception 'NOURA_WORKER_RECEIPT_PREREQUISITE_MISMATCH' using errcode='55000';end if;
 if (select count(*) from pg_trigger where tgfoid='private.billing_financial_receipt_immutability()'::regprocedure
 and not tgisinternal and tgenabled in ('O','A') and (tgrelid,tgname) in (
 ('public.billing_provider_events'::regclass,'billing_provider_receipt_immutability'),
 ('public.billing_entitlement_applications'::regclass,'billing_entitlement_receipt_immutability'),
 ('public.billing_settlement_outcomes'::regclass,'billing_settlement_receipt_immutability'),
 ('public.billing_provider_events'::regclass,'billing_provider_receipt_no_truncate'),
 ('public.billing_entitlement_applications'::regclass,'billing_entitlement_receipt_no_truncate'),
 ('public.billing_settlement_outcomes'::regclass,'billing_settlement_receipt_no_truncate')))<>6
 or (select count(*) from pg_trigger where tgfoid='private.billing_service_immutable()'::regprocedure
 and not tgisinternal and tgenabled in ('O','A') and (tgrelid,tgname) in (
 ('private.billing_service_offers'::regclass,'service_offer_immutable'),
 ('private.billing_service_order_offers'::regclass,'service_order_offer_immutable'),
 ('private.billing_service_grants'::regclass,'service_grant_immutable'),
 ('private.billing_service_offers'::regclass,'service_offer_no_truncate'),
 ('private.billing_service_order_offers'::regclass,'service_order_offer_no_truncate'),
 ('private.billing_service_grants'::regclass,'service_grant_no_truncate')))<>6 then
  raise exception 'NOURA_WORKER_IMMUTABLE_GUARD_MISSING' using errcode='55000';
 end if;
 if exists(select 1 from pg_class where oid in ('private.billing_service_offers'::regclass,'private.billing_service_order_offers'::regclass,'private.billing_service_grants'::regclass) and not relrowsecurity)
 or exists(select 1 from (values('anon'),('authenticated'),('service_role')) roles(name)
 cross join (values('private.billing_service_offers'),('private.billing_service_order_offers'),('private.billing_service_grants')) tables(name)
 where has_table_privilege(roles.name,tables.name,'SELECT,INSERT,UPDATE,DELETE')) then
  raise exception 'NOURA_WORKER_SERVICE_TABLE_BOUNDARY_MISMATCH' using errcode='55000';end if;
end; $$;

-- Original-job provenance, not a new counter or ledger. No historical backfill.
alter table public.whatsapp_inbound_jobs
 add column noura_entitlement_id uuid references private.billing_service_grants(entitlement_application_id) on delete restrict,
 add column noura_subscription_id uuid references public.billing_subscriptions(id) on delete restrict,
 add column noura_plan_version_id uuid references public.billing_plan_versions(id) on delete restrict,
 add column noura_paid_through timestamptz,
 add column noura_allowance_cap bigint,
 add column noura_allowance_period_start timestamptz,
 add constraint wa_noura_binding_complete check (
 (noura_entitlement_id is null and noura_subscription_id is null and noura_plan_version_id is null and noura_paid_through is null and noura_allowance_cap is null and noura_allowance_period_start is null)
 or (noura_entitlement_id is not null and noura_subscription_id is not null and noura_plan_version_id is not null and noura_paid_through is not null and noura_allowance_cap between 1 and 999999999 and noura_allowance_cap is not null and noura_allowance_period_start is not null));
create function private.wa_noura_binding_immutable() returns trigger
language plpgsql set search_path='' as $$ begin
 if tg_op='INSERT' then
  if new.noura_entitlement_id is not null then raise exception 'NOURA_BINDING_SERVER_ONLY' using errcode='23514';end if;
 elsif row(new.noura_entitlement_id,new.noura_subscription_id,new.noura_plan_version_id,new.noura_paid_through,new.noura_allowance_cap,new.noura_allowance_period_start)
 is distinct from row(old.noura_entitlement_id,old.noura_subscription_id,old.noura_plan_version_id,old.noura_paid_through,old.noura_allowance_cap,old.noura_allowance_period_start) then
  if old.noura_entitlement_id is not null or new.noura_entitlement_id is null or new.status<>'claimed'
  or old.usage_status is not null or old.send_intent_id is not null
  or coalesce(current_setting('velora.noura_job_binding',true),'')<>'1' then
   raise exception 'NOURA_BINDING_IMMUTABLE' using errcode='23514';end if;
 end if;return new;
end; $$;
revoke all on function private.wa_noura_binding_immutable() from public,anon,authenticated,service_role;
create trigger whatsapp_jobs_noura_binding before insert or update on public.whatsapp_inbound_jobs for each row execute function private.wa_noura_binding_immutable();

create function private.wa_noura_authority(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;g record;cap bigint;period timestamptz;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 -- Shared established order: company -> subscription -> conversation -> job.
 j:=private.wa_worker_lock(p_job_id,p_claim_token);
 if j.id is null then return jsonb_build_object('ok',false,'code','claim_or_automation_rejected');end if;
 if j.response_kind is not null then return jsonb_build_object('ok',false,'code','FIXED_RESPONSE_JOB_REJECTED');end if;
 select sg.entitlement_application_id,proof.subscription_id,proof.plan_version_id,proof.applied_paid_through,v.limits into g
 from private.billing_service_grants sg join private.billing_service_order_offers so on so.order_id=sg.order_id
 join private.billing_proven_entitlement_grants proof on proof.id=sg.entitlement_application_id and proof.order_id=so.order_id
 join public.billing_subscriptions s on s.id=proof.subscription_id and s.company_id=proof.company_id
 join public.billing_plan_versions v on v.id=proof.plan_version_id
 where proof.company_id=j.company_id and proof.provider_environment='live' and so.environment='live' and s.environment='live'
 and sg.activated and so.service_code='noura' and so.tier in ('basic','premium')
 and so.capabilities=array['noura.knowledge.read']::text[] and so.plan_version_id=proof.plan_version_id
 and private.billing_service_receipt_eligible(proof.id) and v.status in ('published','retired')
 and s.status in ('active','cancel_at_period_end') and s.plan_version_id=proof.plan_version_id and s.paid_through=proof.applied_paid_through
 and proof.applied_paid_through>clock_timestamp()
 and exists(select 1 from public.companies where id=j.company_id and status='active')
 order by proof.applied_at desc,proof.id limit 1 for share of sg,v nowait;
 if not found then return jsonb_build_object('ok',false,'code','NOURA_SERVICE_NOT_ACTIVE');end if;
 period:=private.wa_worker_month();
 -- Existing immutable published-version allowance only; no numeric default.
 if coalesce(g.limits->>'automated_outbound_per_month','')!~'^[1-9][0-9]{0,8}$' then return jsonb_build_object('ok',false,'code','usage_not_configured');end if;
 cap:=(g.limits->>'automated_outbound_per_month')::bigint;
 if j.noura_entitlement_id is null then
  -- Prior paid work cannot be retroactively authorized under a new receipt.
  if j.usage_status is not null or j.send_intent_id is not null
  or exists(select 1 from public.ai_usage_ledger where worker_job_id=j.id) then
   return jsonb_build_object('ok',false,'code','NOURA_LEGACY_JOB_REQUIRES_REVIEW');end if;
  perform set_config('velora.noura_job_binding','1',true);
  update public.whatsapp_inbound_jobs set noura_entitlement_id=g.entitlement_application_id,noura_subscription_id=g.subscription_id,
   noura_plan_version_id=g.plan_version_id,noura_paid_through=g.applied_paid_through,noura_allowance_cap=cap,noura_allowance_period_start=period where id=j.id;
  perform set_config('velora.noura_job_binding','0',true);
 elsif row(j.noura_entitlement_id,j.noura_subscription_id,j.noura_plan_version_id,j.noura_paid_through,j.noura_allowance_cap,j.noura_allowance_period_start)
 is distinct from row(g.entitlement_application_id,g.subscription_id,g.plan_version_id,g.applied_paid_through,cap,period)
 or (j.usage_status is not null and (j.usage_subscription_id is distinct from g.subscription_id or j.usage_period_start is distinct from period)) then
  return jsonb_build_object('ok',false,'code','NOURA_JOB_AUTHORITY_CHANGED');
 end if;
 return jsonb_build_object('ok',true,'company_id',j.company_id,'plan_version_id',g.plan_version_id,'entitlement_application_id',g.entitlement_application_id);
 exception when lock_not_available then return jsonb_build_object('ok',false,'code','NOURA_AUTHORITY_BUSY');
end; $$;
revoke all on function private.wa_noura_authority(uuid,uuid) from public,anon,authenticated,service_role;

-- Preserve the entire legacy window/profile/paid-proof implementation. Every
-- retrieval, model reservation/start, stage and assistant claim already uses
-- this pinned common profile guard. Service identity never comes from persona.
alter function private.whatsapp_answer_profile(uuid,uuid) rename to wa_answer_profile_pre_noura_authority;
revoke all on function private.wa_answer_profile_pre_noura_authority(uuid,uuid) from public,anon,authenticated,service_role;
create function private.whatsapp_answer_profile(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare profile jsonb;authority jsonb;begin
 profile:=private.wa_answer_profile_pre_noura_authority(p_job_id,p_claim_token);
 if profile->>'ok' is distinct from 'true' then return profile;end if;
 authority:=private.wa_noura_authority(p_job_id,p_claim_token);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 if profile->>'company_id' is distinct from authority->>'company_id' or profile->>'plan_version_id' is distinct from authority->>'plan_version_id'
 or profile->>'persona' is distinct from 'noura' then return jsonb_build_object('ok',false,'code','NOURA_PROFILE_MISMATCH');end if;
 return profile;
end; $$;
revoke all on function private.whatsapp_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;

alter function public.whatsapp_reserve_job_usage(uuid,uuid) set schema private;
alter function private.whatsapp_reserve_job_usage(uuid,uuid) rename to wa_reserve_usage_pre_noura_authority;
revoke all on function private.wa_reserve_usage_pre_noura_authority(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_reserve_job_usage(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 return private.wa_reserve_usage_pre_noura_authority(p_job_id,p_claim_token);
end; $$;
revoke all on function public.whatsapp_reserve_job_usage(uuid,uuid) from public,anon,authenticated;
grant execute on function public.whatsapp_reserve_job_usage(uuid,uuid) to service_role;

alter function public.billing_load_worker_frame(uuid,uuid) set schema private;
alter function private.billing_load_worker_frame(uuid,uuid) rename to wa_frame_pre_noura_authority;
revoke all on function private.wa_frame_pre_noura_authority(uuid,uuid) from public,anon,authenticated,service_role;
create function public.billing_load_worker_frame(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 return private.wa_frame_pre_noura_authority(p_job_id,p_claim_token);
end; $$;
revoke all on function public.billing_load_worker_frame(uuid,uuid) from public,anon,authenticated;
grant execute on function public.billing_load_worker_frame(uuid,uuid) to service_role;
-- Checks before the operation alone are insufficient: downstream source,
-- budget and AI-ledger locks may wait past expiry. Recheck after all backing
-- work. A subtransaction discards only newly made writes on final denial,
-- preserving earlier reservations, actual cost and uncertain provider evidence.
alter function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) set schema private;
alter function private.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) rename to noura_pre_whatsapp_retrieve_approved_knowledge;
revoke all on function private.noura_pre_whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.whatsapp_retrieve_approved_knowledge(p_company_id uuid,p_job_id uuid,p_claim_token uuid,p_question text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 begin
  result:=private.noura_pre_whatsapp_retrieve_approved_knowledge(p_company_id,p_job_id,p_claim_token,p_question);
  if result->>'ok' is distinct from 'true' then return result;end if;
  authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
  if authority->>'ok' is distinct from 'true' then raise exception 'NOURA_FINAL_AUTHORITY_DENIED' using errcode='PNA01';end if;
  return result;
 exception when sqlstate 'PNA01' then return authority;end;
end; $$;
revoke all on function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) to service_role;

alter function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) set schema private;
alter function private.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) rename to noura_pre_ai_reserve_whatsapp_attempt;
revoke all on function private.noura_pre_ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.ai_reserve_whatsapp_attempt(p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 begin
  result:=private.noura_pre_ai_reserve_whatsapp_attempt(p_id,p_job_id,p_claim_token,p_attempt,p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
  if result->>'ok' is distinct from 'true' then return result;end if;
  authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
  if authority->>'ok' is distinct from 'true' then raise exception 'NOURA_FINAL_AUTHORITY_DENIED' using errcode='PNA01';end if;
  return result;
 exception when sqlstate 'PNA01' then return authority;end;
end; $$;
revoke all on function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) to service_role;

alter function public.ai_start_whatsapp_attempt(uuid,uuid) set schema private;
alter function private.ai_start_whatsapp_attempt(uuid,uuid) rename to noura_pre_ai_start_whatsapp_attempt;
revoke all on function private.noura_pre_ai_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated,service_role;
create function public.ai_start_whatsapp_attempt(p_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare result boolean;authority jsonb;job uuid;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 begin
  result:=private.noura_pre_ai_start_whatsapp_attempt(p_id,p_claim_token);
  if result is distinct from true then return result;end if;
  select worker_job_id into job from public.ai_usage_ledger where id=p_id;
  authority:=private.whatsapp_answer_profile(job,p_claim_token);
  if authority->>'ok' is distinct from 'true' then raise exception 'NOURA_FINAL_AUTHORITY_DENIED' using errcode='PNA01';end if;
  return result;
 exception when sqlstate 'PNA01' then return false;end;
end; $$;
revoke all on function public.ai_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_start_whatsapp_attempt(uuid,uuid) to service_role;

alter function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) set schema private;
alter function private.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) rename to noura_pre_whatsapp_stage_job_reply;
revoke all on function private.noura_pre_whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.whatsapp_stage_job_reply(p_job_id uuid,p_claim_token uuid,p_ai_attempt_id uuid,p_citations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 begin
  result:=private.noura_pre_whatsapp_stage_job_reply(p_job_id,p_claim_token,p_ai_attempt_id,p_citations);
  if result->>'ok' is distinct from 'true' then return result;end if;
  authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
  if authority->>'ok' is distinct from 'true' then raise exception 'NOURA_FINAL_AUTHORITY_DENIED' using errcode='PNA01';end if;
  return result;
 exception when sqlstate 'PNA01' then return authority;end;
end; $$;
revoke all on function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) to service_role;

alter function public.whatsapp_claim_assistant_job_send(uuid,uuid) set schema private;
alter function private.whatsapp_claim_assistant_job_send(uuid,uuid) rename to noura_pre_whatsapp_claim_assistant_job_send;
revoke all on function private.noura_pre_whatsapp_claim_assistant_job_send(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_claim_assistant_job_send(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 begin
  result:=private.noura_pre_whatsapp_claim_assistant_job_send(p_job_id,p_claim_token);
  if result->>'ok' is distinct from 'true' then return result;end if;
  authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
  if authority->>'ok' is distinct from 'true' then raise exception 'NOURA_FINAL_AUTHORITY_DENIED' using errcode='PNA01';end if;
  return result;
 exception when sqlstate 'PNA01' then return authority;end;
end; $$;
revoke all on function public.whatsapp_claim_assistant_job_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.whatsapp_claim_assistant_job_send(uuid,uuid) to service_role;

notify pgrst,'reload schema';

DO $acl$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(array['ai_reserve_whatsapp_attempt','ai_reserve_whatsapp_capacity_cost_attempt','ai_reserve_whatsapp_profile_attempt','ai_settle_whatsapp_attempt','ai_start_whatsapp_attempt','billing_load_worker_frame','claim_whatsapp_inbound_job','whatsapp_claim_assistant_job_send','whatsapp_claim_inbound_batch','whatsapp_heartbeat_inbound_job','whatsapp_read_answer_profile','whatsapp_repair_accepted_jobs','whatsapp_reserve_job_usage','whatsapp_retrieve_approved_knowledge','whatsapp_retry_inbound_job','whatsapp_stage_job_reply']) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public,anon,authenticated,service_role',f);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f);END LOOP;
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname=ANY(array['ai_answer_profile_binding_guard','ai_lock_authorized_whatsapp_job','ai_settle_whatsapp_pre_security','ai_whatsapp_citations_current','noura_pre_ai_reserve_whatsapp_attempt','noura_pre_ai_start_whatsapp_attempt','noura_pre_whatsapp_claim_assistant_job_send','noura_pre_whatsapp_retrieve_approved_knowledge','noura_pre_whatsapp_stage_job_reply','wa_ai_reserve_pre_answer_profile','wa_ai_reserve_pre_meta_policy','wa_ai_start_pre_answer_profile','wa_ai_start_pre_meta_policy','wa_answer_profile_pre_noura_authority','wa_claim_assistant_pre_meta_policy','wa_frame_pre_meta_policy','wa_frame_pre_noura_authority','wa_noura_authority','wa_noura_binding_immutable','wa_reserve_usage_pre_meta_policy','wa_reserve_usage_pre_noura_authority','wa_send_pre_answer_profile','wa_stage_pre_answer_profile','wa_worker_citations','whatsapp_answer_profile','whatsapp_attempt_profile_current','whatsapp_citations_include_current_instructions']) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public,anon,authenticated,service_role',f);END LOOP;
 END $acl$;
notify pgrst,'reload schema';

-- Policy/column permission postflight; fail closed on widening or drift.
DO $ai_policy_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH targets AS (SELECT c.oid,n.nspname||'.'||c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))), policies AS (SELECT t.name,p.polname,p.polcmd,p.polpermissive,(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END) FROM unnest(p.polroles) r) roles,pg_get_expr(p.polqual,p.polrelid) using_expression,pg_get_expr(p.polwithcheck,p.polrelid) check_expression FROM targets t JOIN pg_policy p ON p.polrelid=t.oid), column_acl AS (SELECT t.name,a.attname,coalesce(r.rolname,'PUBLIC') grantee,x.privilege_type,x.is_grantable FROM targets t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN LATERAL aclexplode(a.attacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee) SELECT jsonb_build_object('policies',(SELECT jsonb_agg(to_jsonb(policies) ORDER BY name,polname) FROM policies),'column_acl',(SELECT jsonb_agg(to_jsonb(column_acl) ORDER BY name,attname,grantee,privilege_type,is_grantable) FROM column_acl))) q(data)) IS DISTINCT FROM '81b4093b74ade15c32463fe79f10331c' THEN RAISE EXCEPTION 'AI_COMPAT_POLICY_POSTFLIGHT_DRIFT';END IF;END $ai_policy_guard$;
-- Exact structural postflight; no data or credentials included.
DO $ai_compat_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH fn AS (SELECT p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef definer,p.proconfig config,md5(replace(p.prosrc,chr(13),'')) body_md5,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private') AND p.proname IN ('ai_reserve_attempt','ai_start_attempt','ai_settle_attempt','ai_reconcile_attempt','ai_admin_snapshot','wa_worker_lock','wa_worker_month','whatsapp_job_service_window','whatsapp_service_window','billing_service_catalog_owner','billing_service_receipt_eligible','billing_financial_receipt_immutability','billing_service_immutable','billing_read_company_operational_entitlement','claim_whatsapp_inbound_job','ai_admin_snapshot','ai_answer_profile_binding_guard','ai_budget_account_binding','ai_budget_period','ai_budget_policy_immutable','ai_lock_authorized_whatsapp_job','ai_reconcile_attempt','ai_reserve_attempt','ai_reserve_whatsapp_attempt','ai_reserve_whatsapp_capacity_cost_attempt','ai_reserve_whatsapp_profile_attempt','ai_settle_admin','ai_settle_admin_attempt','ai_settle_attempt','ai_settle_whatsapp_attempt','ai_start_attempt','ai_start_whatsapp_attempt','ai_usage_ledger_guard_binding','ai_validate_cost','ai_validated_usage','ai_whatsapp_citations_current','billing_bind_ai_budget_draft','billing_load_worker_frame','claim_whatsapp_inbound_job','wa_noura_authority','wa_noura_binding_immutable','wa_worker_citations','whatsapp_answer_profile','whatsapp_attempt_profile_current','whatsapp_citations_include_current_instructions','whatsapp_claim_assistant_job_send','whatsapp_claim_inbound_batch','whatsapp_heartbeat_inbound_job','whatsapp_read_answer_profile','whatsapp_repair_accepted_jobs','whatsapp_reserve_job_usage','whatsapp_retrieve_approved_knowledge','whatsapp_retry_inbound_job','whatsapp_stage_job_reply')
), rel AS (
 SELECT n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
 (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
 (SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid) constraints,
 (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid=c.oid) indexes,
 (SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled::text,pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) triggers,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))
)
SELECT jsonb_build_object('functions',(SELECT jsonb_agg(to_jsonb(fn) ORDER BY signature) FROM fn),'relations',(SELECT jsonb_agg(to_jsonb(rel) ORDER BY name) FROM rel))) q(data)) IS DISTINCT FROM '65dd4e93dd82467da59476a9d4541646' THEN RAISE EXCEPTION 'AI_COMPAT_POSTFLIGHT_DRIFT';END IF;END $ai_compat_guard$;
commit;

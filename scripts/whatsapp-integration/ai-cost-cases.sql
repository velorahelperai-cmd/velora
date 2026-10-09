-- TEST ONLY: synthetic isolated PostgreSQL fixtures. No provider/cloud/key access.
-- Source budget accounts and the existing attempt ledger are authoritative. Roll back all fixtures.
begin;
create function pg_temp.ai_fixture(p_env text default 'live',p_proven boolean default true) returns jsonb language plpgsql as $$
declare uid uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid(); lid uuid:=gen_random_uuid();
 conv uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); job uuid:=gen_random_uuid();
 plan uuid:=gen_random_uuid(); version uuid:=gen_random_uuid(); sub uuid:=gen_random_uuid();
 bid uuid:=gen_random_uuid(); knowledge_id uuid:=gen_random_uuid(); token uuid; r jsonb; n text:=gen_random_uuid()::text;
 order_id uuid:=gen_random_uuid(); attempt_id uuid:=gen_random_uuid(); event_id uuid:=gen_random_uuid(); grant_id uuid:=gen_random_uuid();
 paid_until timestamptz:=clock_timestamp()+interval '1 day'; tx text; raw jsonb;pv int; sid uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(uid,'ai-fixture-'||n||'@example.invalid');
 insert into public.companies(id,display_name,status,created_by) values(cid,'Synthetic AI cost tenant','active',uid);
 insert into public.whatsapp_company_links(id,company_id,status,provider_phone_number_id) values(lid,cid,'verified','synthetic-'||n);
 insert into auth.sessions(id,user_id) values(sid,uid);
 update whatsapp_company_links set provider_waba_id='synthetic-waba-'||n,authorization_status='active',
 authorization_verified_at=clock_timestamp(),authorization_expires_at=clock_timestamp()+interval '60 days',
 authorization_app_id='synthetic-app',authorization_scopes='["whatsapp_business_management","whatsapp_business_messaging"]',
 authorization_user_id=uid,authorization_session_id=sid,access_secret_id=vault.create_secret('synthetic-ai-token-'||n) where id=lid;
 perform set_config('velora.conversation_control','1',true);
 insert into public.whatsapp_conversations(id,company_id,phone_number_id,customer_wa_id,status,automation_allowed)
 values(conv,cid,'synthetic-'||n,'synthetic-recipient-'||n,'open',true);
 r:=public.whatsapp_store_meta_inbound(cid,'synthetic-waba-'||n,'synthetic-'||n,'synthetic-recipient-'||n,'',
 'synthetic-inbound-'||n,'Synthetic customer question','text',clock_timestamp());
 mid:=(r->>'message_id')::uuid;job:=(r->>'job_id')::uuid;
 r:=public.claim_whatsapp_inbound_job(job,120);
 if r->>'ok'<>'true' then raise exception 'fixture claim failed: %',r; end if;
 token:=(r->>'claim_token')::uuid;
 insert into public.knowledge_sources(id,company_id,kind,title,content,status,created_by)
 values(knowledge_id,cid,'text','Synthetic AI source','Synthetic approved content','ready',uid);
 perform set_config('velora.knowledge_approval','1',true);
 update public.knowledge_sources set approved_for_answers=true where id=knowledge_id;
 insert into public.billing_plans(id,code,name,status) values(plan,'noor_basic','Synthetic AI plan','active') on conflict(code) do update set code=excluded.code returning id into plan;
 select coalesce(max(v.version),0)+1 into pv from billing_plan_versions v where v.plan_id=plan;
 update billing_plan_versions set status='retired' where plan_id=plan and status='published';
 insert into public.billing_plan_versions(id,plan_id,version,amount_baisa,period_days,period_unit,period_count,status,limits)
 values(version,plan,pv,1000,30,'day',30,'published','{"automated_outbound_per_month":100}');
 insert into public.billing_subscriptions(id,company_id,plan_version_id,status,environment,paid_through)
 values(sub,cid,version,'active',p_env,paid_until);
 if p_proven then
  -- Complete synthetic receiver attestation plus immutable financial identity.
  -- A future paid_through by itself is deliberately insufficient.
  tx:='synthetic-ai-tx-'||n;
  insert into public.billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,
   provider_account_ref,provider_environment,provider_amount,provider_amount_unit,special_reference,client_op_id,input_fingerprint,
   status,product_code,purchase_purpose,created_by,deadline_policy_approved)
  values(order_id,cid,version,1000,'OMR',30,'day',30,'901',p_env,12345,'paymob_amount','synthetic-ai-ref-'||n,
   'synthetic-ai-op-'||n,'synthetic-ai-fp-'||n,'closed','velora_ai_staff','initial',uid,true);
  insert into public.billing_payment_attempts(id,order_id,company_id,status,provider_order_id)
  values(attempt_id,order_id,cid,'paid','synthetic-ai-order-'||n);
  raw:=jsonb_build_object('provider_transaction_id',tx,'provider_order_id','synthetic-ai-order-'||n,'hmac_verified',true,
   'event_status','success','amount_cents',12345,'currency','OMR','integration_id',901,'signed_owner','900'::text,
   'pending',false,'success',true,'error_occured',false,'is_auth',false,'is_capture',false,'is_refunded',false,
   'is_voided',false,'has_parent_transaction',false,'is_standalone_payment',true);
  insert into public.billing_provider_events(id,payment_attempt_id,provider_account_ref,provider_environment,provider_transaction_id,
   event_status,company_id,amount_baisa_expected,currency_expected,raw_summary)
  values(event_id,attempt_id,'901',p_env,tx,'success',cid,1000,'OMR',raw);
  insert into public.billing_entitlement_applications(id,company_id,order_id,subscription_id,payment_attempt_id,
   provider_account_ref,provider_environment,provider_transaction_id,provider_event_id,applied_paid_through,period_days,period_unit,period_count)
  values(grant_id,cid,order_id,sub,attempt_id,'901',p_env,tx,event_id,paid_until,30,'day',30);
  insert into public.billing_settlement_outcomes(company_id,order_id,payment_attempt_id,provider_account_ref,provider_environment,
   provider_transaction_id,provider_event_id,entitlement_application_id,outcome,evidence_marker,authenticity_method,applied_paid_through)
  values(cid,order_id,attempt_id,'901',p_env,tx,event_id,grant_id,'granted','VEL_PAYMOB_SERVER_HMAC_VERIFIED','paymob_hmac_verified',paid_until);
 end if;
 update public.whatsapp_inbound_jobs set expected_automation_generation=0,usage_status='reserved',usage_subscription_id=sub,
  usage_period_start=date_trunc('month',clock_timestamp() at time zone 'Asia/Muscat') at time zone 'Asia/Muscat' where id=job;
 perform test_fixture.ai_budget(cid,10,bid);
 return jsonb_build_object('job',job,'claim',token,'company',cid,'conversation',conv,'subscription',sub,'budget',bid,'knowledge',knowledge_id);
end; $$;
create function pg_temp.ai_reserve(f jsonb, p_id uuid, p_attempt integer default 1) returns jsonb language sql as $$
 select public.ai_reserve_whatsapp_attempt(p_id,(f->>'job')::uuid,(f->>'claim')::uuid,p_attempt,'gpt-6-luna','openai',5,
 'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}',
 jsonb_build_array(jsonb_build_object('sourceId',f->>'knowledge','title','Synthetic AI source','contentVersion',1)));
$$;
create function pg_temp.ai_success(f jsonb,p_id uuid,p_claim uuid default null,p_usage jsonb default '{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"cacheWriteTokens":3,"reasoningTokens":4,"totalTokens":30}')
returns boolean language sql as $$
 select public.ai_settle_whatsapp_attempt(p_id,coalesce(p_claim,(f->>'claim')::uuid),'success',0.0026008,1,p_usage,
 'synthetic-request','synthetic-response','gpt-6-luna','Synthetic persisted answer',null,12);
$$;
set local role service_role;

do $$ declare f jsonb:=pg_temp.ai_fixture('test'); r jsonb; begin
 r:=pg_temp.ai_reserve(f,gen_random_uuid());
 if r->>'ok' is distinct from 'false' then raise exception 'Test subscription authorized cost: %',r; end if;
 if exists(select 1 from public.ai_usage_ledger where worker_job_id=(f->>'job')::uuid) then raise exception 'denied cost persisted'; end if;
end; $$;
select 'PASS|D4 Test-only subscription cannot reserve AI cost';

do $$ declare f jsonb:=pg_temp.ai_fixture('live',false); r jsonb; begin
 r:=pg_temp.ai_reserve(f,gen_random_uuid());
 if r->>'ok' is distinct from 'false' then raise exception 'unproved active Live authorized cost: %',r; end if;
 if exists(select 1 from public.ai_usage_ledger where worker_job_id=(f->>'job')::uuid) then raise exception 'unproved cost persisted'; end if;
end; $$;
select 'PASS|D4 raw active future-dated Live subscription is not payment proof';

do $$ declare f jsonb:=pg_temp.ai_fixture(); r jsonb; begin
 r:=pg_temp.ai_reserve(f||jsonb_build_object('claim',gen_random_uuid()),gen_random_uuid());
 if r->>'ok' is distinct from 'false' then raise exception 'wrong claim authorized: %',r; end if;
 update public.whatsapp_inbound_jobs set claim_expires_at=clock_timestamp()-interval '1 second' where id=(f->>'job')::uuid;
 r:=pg_temp.ai_reserve(f,gen_random_uuid());
 if r->>'ok' is distinct from 'false' then raise exception 'expired claim authorized: %',r; end if;
end; $$;
select 'PASS|D4 wrong and expired claims cannot reserve AI cost';

do $$ declare f jsonb:=pg_temp.ai_fixture(); r jsonb; begin
 update public.whatsapp_inbound_jobs set usage_status=null where id=(f->>'job')::uuid;
 r:=pg_temp.ai_reserve(f,gen_random_uuid());
 if r->>'code'<>'USAGE_RESERVATION_REQUIRED' then raise exception 'missing message quota authorized: %',r; end if;
 update public.whatsapp_inbound_jobs set usage_status='reserved',usage_period_start=usage_period_start-interval '1 month' where id=(f->>'job')::uuid;
 r:=pg_temp.ai_reserve(f,gen_random_uuid());
 if r->>'code'<>'USAGE_RESERVATION_REQUIRED' then raise exception 'old month quota authorized: %',r; end if;
end; $$;
select 'PASS|D4 missing or stale message quota cannot reserve AI cost';

do $$ declare f jsonb:=pg_temp.ai_fixture(); r jsonb; begin
 perform test_fixture.ai_budget_change((f->>'budget')::uuid,null,false);
 r:=pg_temp.ai_reserve(f,gen_random_uuid());
 if r->>'code'<>'BUDGET_DISABLED' then raise exception 'disabled budget authorized: %',r; end if;
 perform test_fixture.ai_budget_change((f->>'budget')::uuid,null,true,6);
 r:=pg_temp.ai_reserve(f,gen_random_uuid());
 if r->>'code'<>'BUDGET_EXCEEDED' then raise exception 'cap oversubscribed: %',r; end if;
end; $$;
select 'PASS|D4 disabled and exhausted configured cost budgets deny dispatch';

do $$ declare f jsonb:=pg_temp.ai_fixture(); attempt_id uuid:=gen_random_uuid(); r jsonb; begin
 r:=pg_temp.ai_reserve(f,attempt_id);
 if r->>'ok'<>'true' then raise exception 'valid cost reservation rejected: %',r; end if;
 if not exists(select 1 from public.ai_usage_ledger where id=attempt_id and company_id=(f->>'company')::uuid
   and execution_id=(f->>'job')::uuid and worker_claim_token=(f->>'claim')::uuid
   and actor_user_id is null and actor_session_id is null and reserved_baisa=5 and status='reserved')
 then raise exception 'reservation did not derive worker binding'; end if;
 r:=pg_temp.ai_reserve(f,gen_random_uuid());
 if r->>'code'<>'DUPLICATE_REQUEST' then raise exception 'logical job repeated: %',r; end if;
 r:=pg_temp.ai_reserve(f,gen_random_uuid(),2);
 if r->>'code'<>'PRIOR_ATTEMPT_NOT_RETRYABLE' then raise exception 'concurrent fallback allowed: %',r; end if;
 begin
  update public.ai_usage_ledger set worker_claim_token=gen_random_uuid() where id=attempt_id;
  raise exception 'original reservation capability changed';
 exception when check_violation or insufficient_privilege then null; end;
 if (select held_baisa from public.ai_budget_accounts where id=(f->>'budget')::uuid)<>5 then raise exception 'duplicate charged hold'; end if;
end; $$;
select 'PASS|D4 original job binding prevents duplicate and concurrent paid attempts';

do $$ declare f jsonb:=pg_temp.ai_fixture(); attempt_id uuid:=gen_random_uuid(); begin
 perform pg_temp.ai_reserve(f,attempt_id);
 perform set_config('velora.conversation_control','1',true);
 update public.whatsapp_conversations set automation_generation=automation_generation+1 where id=(f->>'conversation')::uuid;
 if public.ai_start_whatsapp_attempt(attempt_id,(f->>'claim')::uuid) then raise exception 'stale generation started'; end if;
 if public.ai_start_attempt(attempt_id) then raise exception 'owner-session start bypassed worker claim'; end if;
 if not public.ai_settle_whatsapp_attempt(attempt_id,(f->>'claim')::uuid,'rejected',0,0,'{}',null,null,null,null,'AUTHORIZATION_CHANGED_BEFORE_EXECUTION',0)
 then raise exception 'definitely unstarted hold not released'; end if;
 if (select held_baisa from public.ai_budget_accounts where id=(f->>'budget')::uuid)<>0 then raise exception 'unstarted cost still held'; end if;
end; $$;
select 'PASS|D4 stale automation generation stops start and releases only unstarted cost';

do $$ declare f jsonb:=pg_temp.ai_fixture(); attempt_id uuid:=gen_random_uuid(); r jsonb; begin
 perform pg_temp.ai_reserve(f,attempt_id);
 if not public.ai_start_whatsapp_attempt(attempt_id,(f->>'claim')::uuid) then raise exception 'valid attempt did not start'; end if;
 if public.ai_start_whatsapp_attempt(attempt_id,(f->>'claim')::uuid) then raise exception 'attempt started twice'; end if;
 if pg_temp.ai_success(f,attempt_id,gen_random_uuid()) then raise exception 'wrong original token settled'; end if;
 update public.whatsapp_inbound_jobs set claim_expires_at=clock_timestamp()-interval '1 second',claim_token=gen_random_uuid()
 where id=(f->>'job')::uuid;
 perform set_config('velora.conversation_control','1',true);
 update public.whatsapp_conversations set status='handed_over',automation_allowed=false,automation_generation=automation_generation+1
 where id=(f->>'conversation')::uuid;
 if not pg_temp.ai_success(f,attempt_id) or not pg_temp.ai_success(f,attempt_id) then raise exception 'expired original capability settlement not idempotent'; end if;
 if (select spent_baisa=1 and held_baisa=0 from public.ai_budget_accounts where id=(f->>'budget')::uuid) is distinct from true
 then raise exception 'actual cost not charged once'; end if;
 if not exists(select 1 from public.ai_usage_ledger where id=attempt_id and status='success' and response_text='Synthetic persisted answer'
  and prompt_tokens=20 and completion_tokens=10 and cached_tokens=5 and cache_write_tokens=3 and reasoning_tokens=4 and total_tokens=30
  and actual_model_id='gpt-6-luna' and response_id='synthetic-response' and request_id='synthetic-request' and latency_ms=12)
 then raise exception 'draft/actual usage transaction incomplete'; end if;
end; $$;
select 'PASS|D4 known cost and durable draft settle once after lease expiry and handoff';

do $$ declare f jsonb:=pg_temp.ai_fixture(); attempt_id uuid:=gen_random_uuid(); r jsonb; begin
 perform pg_temp.ai_reserve(f,attempt_id); perform public.ai_start_whatsapp_attempt(attempt_id,(f->>'claim')::uuid);
 if not public.ai_settle_whatsapp_attempt(attempt_id,(f->>'claim')::uuid,'uncertain',null,null,'{}','synthetic-request',null,null,null,'TIMEOUT',31)
 then raise exception 'uncertain state not saved'; end if;
 if (select spent_baisa=0 and held_baisa=5 from public.ai_budget_accounts where id=(f->>'budget')::uuid) is distinct from true
 then raise exception 'unknown cost hold released'; end if;
 r:=pg_temp.ai_reserve(f,gen_random_uuid(),2);
 if r->>'code'<>'PRIOR_ATTEMPT_NOT_RETRYABLE' then raise exception 'uncertain attempt retried: %',r; end if;
end; $$;
select 'PASS|D4 unknown provider outcome keeps funds held and cannot retry';

do $$ declare f jsonb:=pg_temp.ai_fixture(); attempt_id uuid:=gen_random_uuid(); r jsonb; begin
 perform pg_temp.ai_reserve(f,attempt_id); perform public.ai_start_whatsapp_attempt(attempt_id,(f->>'claim')::uuid);
 perform public.ai_settle_whatsapp_attempt(attempt_id,(f->>'claim')::uuid,'rejected',0,0,'{}',null,null,null,null,'PROVIDER_HTTP_404',1);
 r:=pg_temp.ai_reserve(f,gen_random_uuid(),2);
 if r->>'ok'<>'true' then raise exception 'definite rejection fallback blocked: %',r; end if;
 if (select held_baisa=5 and spent_baisa=0 from public.ai_budget_accounts where id=(f->>'budget')::uuid) is distinct from true
 then raise exception 'fallback did not separately reserve'; end if;
end; $$;
select 'PASS|D4 definite zero cost whitelisted rejection alone permits fallback';

do $$ declare f jsonb:=pg_temp.ai_fixture(); attempt_id uuid:=gen_random_uuid(); begin
 perform pg_temp.ai_reserve(f,attempt_id); perform public.ai_start_whatsapp_attempt(attempt_id,(f->>'claim')::uuid);
 begin
  perform pg_temp.ai_success(f,attempt_id,null,'{"promptTokens":20,"completionTokens":10,"cachedTokens":21,"cacheWriteTokens":3,"reasoningTokens":4,"totalTokens":30}');
  raise exception 'invalid usage accepted';
 exception when others then
  if sqlerrm<>'INVALID_PROVIDER_USAGE' then raise; end if;
 end;
 begin
  perform pg_temp.ai_success(f,attempt_id,null,'{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"cacheWriteTokens":3,"reasoningTokens":4,"totalTokens":31}');
  raise exception 'wrong total accepted';
 exception when others then
  if sqlerrm<>'INVALID_PROVIDER_USAGE' then raise; end if;
 end;
 if (select held_baisa from public.ai_budget_accounts where id=(f->>'budget')::uuid)<>5 then raise exception 'invalid usage released funds'; end if;
end; $$;
select 'PASS|D4 inconsistent actual token counters cannot release cost holds';

do $$ declare f jsonb:=pg_temp.ai_fixture(); attempt_id uuid:=gen_random_uuid(); r jsonb; begin
 r:=public.ai_reserve_whatsapp_attempt(attempt_id,(f->>'job')::uuid,(f->>'claim')::uuid,1,'gpt-6-luna','openai',5,
  'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}');
 if r->>'code'<>'KNOWLEDGE_CHANGED' then raise exception 'missing knowledge snapshot authorized cost: %',r; end if;
 perform pg_temp.ai_reserve(f,attempt_id);
 update public.knowledge_sources set content='Synthetic changed context before dispatch' where id=(f->>'knowledge')::uuid;
 update public.knowledge_sources set approved_for_answers=true where id=(f->>'knowledge')::uuid;
 if public.ai_start_whatsapp_attempt(attempt_id,(f->>'claim')::uuid) then raise exception 'changed approved version dispatched'; end if;
end; $$;
select 'PASS|D4 missing and superseded source snapshots cannot start a provider attempt';

do $$ declare f jsonb:=pg_temp.ai_fixture(); attempt_id uuid:=gen_random_uuid(); r jsonb; snapshot jsonb; begin
 perform pg_temp.ai_reserve(f,attempt_id); perform public.ai_start_whatsapp_attempt(attempt_id,(f->>'claim')::uuid);
 if not pg_temp.ai_success(f,attempt_id) then raise exception 'synthetic successful draft not persisted'; end if;
 select source_citations into snapshot from public.ai_usage_ledger where id=attempt_id;
 update public.knowledge_sources set content='Synthetic newly approved changed answer' where id=(f->>'knowledge')::uuid;
 update public.knowledge_sources set approved_for_answers=true where id=(f->>'knowledge')::uuid;
 if snapshot is distinct from (select source_citations from public.ai_usage_ledger where id=attempt_id)
    or snapshot->0->>'contentVersion'<>'1' then raise exception 'successful original source snapshot replaced'; end if;
 r:=public.whatsapp_stage_job_reply((f->>'job')::uuid,(f->>'claim')::uuid,attempt_id,
  jsonb_build_array(jsonb_build_object('sourceId',f->>'knowledge','title','Synthetic AI source','contentVersion',2)));
 if r->>'ok'='true' then raise exception 'old draft staged using newly loaded source version: %',r; end if;
 if exists(select 1 from public.whatsapp_send_intents where original_job_id=(f->>'job')::uuid) then raise exception 'stale source draft created send intent'; end if;
end; $$;
select 'PASS|D4 recovered successful draft cannot borrow newly approved citation versions';
reset role;

set local role service_role;
do $$ declare f jsonb:=test_fixture.ai_admin(false);cid uuid; owner_id uuid; session_id uuid;
 attempt_id uuid:=gen_random_uuid(); r jsonb; begin
 cid:=(f->>'company')::uuid;owner_id:=(f->>'actor')::uuid;session_id:=(f->>'session')::uuid;
 begin
  perform public.ai_reserve_attempt(attempt_id,gen_random_uuid(),1,cid,owner_id,session_id,
   'gpt-6-luna','openai',1000,'fixture','{"modelId":"gpt-6-luna","version":"fixture"}','admin_test');
  raise exception 'owner with no active session reserved';
 exception when others then if sqlerrm<>'APP_SESSION_EXPIRED' then raise; end if; end;
 f:=test_fixture.ai_admin();cid:=(f->>'company')::uuid;owner_id:=(f->>'actor')::uuid;session_id:=(f->>'session')::uuid;
 r:=public.ai_reserve_attempt(attempt_id,gen_random_uuid(),1,cid,owner_id,session_id,
   'gpt-6-luna','openai',1000,'fixture','{"modelId":"gpt-6-luna","version":"fixture"}','admin_test');
 if r->>'ok'<>'true' then raise exception 'authorized administrative path regressed: %',r; end if;
 r:=public.ai_reserve_attempt(gen_random_uuid(),gen_random_uuid(),1,cid,owner_id,session_id,
   'gpt-6.1-sol','openai',1,'fixture','{"modelId":"gpt-6.1-sol","version":"fixture"}','admin_test');
 if r->>'code'<>'BUDGET_EXCEEDED' then raise exception 'global administrative budget exceeded: %',r; end if;
 if not public.ai_settle_attempt(attempt_id,'rejected',0,0,'{}',null,'SYNTHETIC_NO_DISPATCH',0)
 then raise exception 'administrative zero cost settlement regressed'; end if;
end; $$;
select 'PASS|D4 administrative trials still require owner session and share the lifetime budget';

do $$ begin
 if has_function_privilege('authenticated','public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb)','EXECUTE')
   or has_function_privilege('anon','public.ai_settle_whatsapp_attempt(uuid,uuid,text,numeric,numeric,jsonb,text,text,text,text,text,integer)','EXECUTE')
   or has_column_privilege('authenticated','public.ai_usage_ledger','worker_claim_token','SELECT')
   or has_column_privilege('authenticated','public.ai_usage_ledger','response_text','SELECT')
 then raise exception 'worker cost capability exposed to browser role'; end if;
 if public.ai_reserve_attempt(gen_random_uuid(),gen_random_uuid(),1,null,null,null,'gpt-6-luna','openai',1,'fixture','{}','company_live')->>'code'<>'LIVE_AI_DISABLED'
 then raise exception 'owner-session company_live branch reactivated'; end if;
 begin
  update public.ai_budget_accounts set limit_baisa=1001 where scope='admin_test';
  raise exception 'administrative lifetime cap raised';
 exception when check_violation or insufficient_privilege then null; end;
end; $$;
select 'PASS|D4 browser roles cannot access worker capabilities and lifetime admin cap remains 1 OMR';
rollback;

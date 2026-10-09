-- TEST ONLY. Existing isolated PostgreSQL harness; synthetic evidence and no AI calls.
begin;
create function pg_temp.atomic_fixture(p_budget numeric default 10,p_cap integer default 2,p_stamp timestamptz default null) returns jsonb
language plpgsql as $$
declare f jsonb:=test_fixture.company(true,p_cap);j uuid;r jsonb;c public.whatsapp_conversations%rowtype;l public.whatsapp_company_links%rowtype;begin
 if p_stamp is null then j:=test_fixture.job(f);else
  select * into c from public.whatsapp_conversations where id=(f->>'conversation')::uuid;
  select * into l from public.whatsapp_company_links where id=(f->>'link')::uuid;
  r:=public.whatsapp_store_meta_inbound((f->>'company')::uuid,l.provider_waba_id,c.phone_number_id,c.customer_wa_id,
   'Synthetic customer','synthetic-atomic-'||gen_random_uuid(),'Synthetic question','text',p_stamp);
  if r->>'ok' is distinct from 'true' then raise exception 'Synthetic atomic ingress rejected: %',r;end if;
  j:=(r->>'job_id')::uuid;
 end if;
 r:=public.claim_whatsapp_inbound_job(j,120);
 if r->>'ok' is distinct from 'true' then raise exception 'Synthetic atomic claim rejected: %',r;end if;
 perform test_fixture.ai_budget((f->>'company')::uuid,p_budget);
 return f||jsonb_build_object('job',j,'claim',r->>'claim_token');
end; $$;
create function pg_temp.atomic_reserve(f jsonb,a uuid,p_attempt integer default 1,p_cost numeric default 1,
 p_persona text default 'noura',p_plan uuid default null,p_citations jsonb default null) returns jsonb
language plpgsql as $$ begin
 return public.ai_reserve_whatsapp_capacity_cost_attempt(a,(f->>'job')::uuid,(f->>'claim')::uuid,p_attempt,
  'gpt-6-luna','openai',p_cost,'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}',
  coalesce(p_citations,jsonb_build_array(jsonb_build_object('sourceId',f->>'knowledge','title','Synthetic knowledge','contentVersion',1))),
  p_persona,coalesce(p_plan,(f->>'plan_version')::uuid));
end; $$;
create function pg_temp.assert_no_atomic_reservation(f jsonb) returns void language plpgsql as $$ begin
 if not exists(select 1 from public.whatsapp_inbound_jobs where id=(f->>'job')::uuid
 and usage_status is null and usage_period_start is null and usage_subscription_id is null)
 then raise exception 'Rejected atomic operation left newly reserved message capacity';end if;
 if exists(select 1 from public.ai_usage_ledger where worker_job_id=(f->>'job')::uuid)
 or not exists(select 1 from public.ai_budget_accounts where company_id=(f->>'company')::uuid and held_baisa=0 and spent_baisa=0)
 then raise exception 'Rejected atomic operation left AI cost reservation';end if;
end; $$;

set local role service_role;
do $$ declare f jsonb:=pg_temp.atomic_fixture(1);r jsonb;begin
 r:=pg_temp.atomic_reserve(f,gen_random_uuid(),1,2);
 if r->>'code' is distinct from 'BUDGET_EXCEEDED' then raise exception 'Budget denial missing: %',r;end if;
 perform pg_temp.assert_no_atomic_reservation(f);
end; $$;
select 'PASS|Atomic budget denial rolls back newly reserved message capacity and AI cost';

do $$ declare f jsonb:=pg_temp.atomic_fixture();r jsonb;begin
 r:=pg_temp.atomic_reserve(f,gen_random_uuid(),1,1,'lina');
 if r->>'code' is distinct from 'ANSWER_PROFILE_CHANGED' then raise exception 'Profile denial missing: %',r;end if;
 perform pg_temp.assert_no_atomic_reservation(f);
end; $$;
select 'PASS|Atomic profile denial leaves no new message capacity or AI reservation';

do $$ declare f jsonb:=pg_temp.atomic_fixture();r jsonb;begin
 perform test_fixture.ai_budget_change(null,(f->>'company')::uuid,false);
 r:=pg_temp.atomic_reserve(f,gen_random_uuid());
 if r->>'code' is distinct from 'BUDGET_DISABLED' then raise exception 'Disabled budget denial missing: %',r;end if;
 perform pg_temp.assert_no_atomic_reservation(f);
end; $$;
select 'PASS|Atomic disabled budget does not consume message capacity';

do $$ declare f jsonb:=pg_temp.atomic_fixture();r jsonb;begin
 update public.knowledge_sources set approved_for_answers=false where id=(f->>'knowledge')::uuid;
 r:=pg_temp.atomic_reserve(f,gen_random_uuid());
 if r->>'code' is distinct from 'KNOWLEDGE_CHANGED' then raise exception 'Citation denial missing: %',r;end if;
 perform pg_temp.assert_no_atomic_reservation(f);
end; $$;
select 'PASS|Atomic stale citations leave message capacity and AI cost unreserved';

do $$ declare f jsonb:=pg_temp.atomic_fixture();r jsonb;begin
 update public.billing_subscriptions set paid_through=clock_timestamp()-interval '1 second'
 where id=(f->>'subscription')::uuid;
 r:=pg_temp.atomic_reserve(f,gen_random_uuid());
 if r->>'ok' is distinct from 'false' then raise exception 'Expired paid subscription allocated work: %',r;end if;
 perform pg_temp.assert_no_atomic_reservation(f);
end; $$;
select 'PASS|Atomic paid subscription expiry rejects capacity and cost';

do $$ declare f jsonb:=pg_temp.atomic_fixture();r jsonb;begin
 update public.whatsapp_inbound_jobs set claim_expires_at=clock_timestamp()-interval '1 second' where id=(f->>'job')::uuid;
 r:=pg_temp.atomic_reserve(f,gen_random_uuid());
 if r->>'ok' is distinct from 'false' then raise exception 'Expired claim reserved: %',r;end if;
 perform pg_temp.assert_no_atomic_reservation(f);
end; $$;
select 'PASS|Atomic expired claims cannot allocate capacity or cost';

do $$ declare f jsonb:=pg_temp.atomic_fixture();r jsonb;begin
 perform set_config('velora.conversation_control','1',true);
 update public.whatsapp_conversations set status='handed_over',automation_allowed=false,automation_generation=automation_generation+1
 where id=(f->>'conversation')::uuid;
 r:=pg_temp.atomic_reserve(f,gen_random_uuid());
 if r->>'ok' is distinct from 'false' then raise exception 'Handoff allocated paid work: %',r;end if;
 perform pg_temp.assert_no_atomic_reservation(f);
end; $$;
select 'PASS|Atomic handoff generation fence rejects both reservations';

do $$ declare f jsonb:=pg_temp.atomic_fixture(10,2,clock_timestamp()-interval '25 hours');r jsonb;begin
 r:=pg_temp.atomic_reserve(f,gen_random_uuid());
 if r->>'ok' is distinct from 'false' then raise exception 'Expired window allocated paid work: %',r;end if;
 perform pg_temp.assert_no_atomic_reservation(f);
end; $$;
select 'PASS|Atomic service window expiry rejects both reservations';

do $$ declare f jsonb:=pg_temp.atomic_fixture();a uuid:=gen_random_uuid();r jsonb;b public.ai_budget_accounts%rowtype;begin
 r:=pg_temp.atomic_reserve(f,a);
 if r->>'ok' is distinct from 'true' or r->>'id' is distinct from a::text or r->>'answer_persona' is distinct from 'noura'
 or r->>'answer_plan_version_id' is distinct from f->>'plan_version' then raise exception 'Atomic reservation failed: %',r;end if;
 if not exists(select 1 from public.whatsapp_inbound_jobs where id=(f->>'job')::uuid and usage_status='reserved'
 and usage_subscription_id=(f->>'subscription')::uuid
 and usage_period_start=(date_trunc('month',clock_timestamp() at time zone 'Asia/Muscat') at time zone 'Asia/Muscat'))
 then raise exception 'AI allocation missing message reservation';end if;
 r:=pg_temp.atomic_reserve(f,a);
 if r->>'code' is distinct from 'DUPLICATE_REQUEST' then raise exception 'Atomic replay accepted: %',r;end if;
 select * into b from public.ai_budget_accounts where company_id=(f->>'company')::uuid;
 if b.held_baisa<>1 or b.spent_baisa<>0 or (select count(*) from public.ai_usage_ledger where worker_job_id=(f->>'job')::uuid)<>1
 or (select count(*) from public.whatsapp_inbound_jobs where company_id=(f->>'company')::uuid and usage_status='reserved')<>1
 then raise exception 'Atomic replay duplicated capacity or cost';end if;
 if not public.ai_start_whatsapp_attempt(a,(f->>'claim')::uuid) or public.ai_start_whatsapp_attempt(a,(f->>'claim')::uuid)
 then raise exception 'Atomic replay allowed repeated provider start';end if;
end; $$;
select 'PASS|Atomic success binds both reservations and replay cannot duplicate capacity, cost or start';

do $$ declare f jsonb:=pg_temp.atomic_fixture(2);a uuid:=gen_random_uuid();r jsonb;prior public.whatsapp_inbound_jobs%rowtype;begin
 r:=pg_temp.atomic_reserve(f,a);
 if r->>'ok' is distinct from 'true' or not public.ai_start_whatsapp_attempt(a,(f->>'claim')::uuid)
 or not public.ai_settle_whatsapp_attempt(a,(f->>'claim')::uuid,'rejected',0,0,'{}',null,null,null,null,'KEY_MISSING',0)
 then raise exception 'Synthetic definite failure rejected: %',r;end if;
 select * into prior from public.whatsapp_inbound_jobs where id=(f->>'job')::uuid;
 r:=pg_temp.atomic_reserve(f,gen_random_uuid(),2,3);
 if r->>'code' is distinct from 'BUDGET_EXCEEDED' then raise exception 'Fallback budget denial missing: %',r;end if;
 if not exists(select 1 from public.whatsapp_inbound_jobs where id=prior.id and usage_status='reserved'
 and usage_period_start=prior.usage_period_start and usage_subscription_id=prior.usage_subscription_id)
 or not exists(select 1 from public.ai_usage_ledger where id=a and status='rejected' and cost_baisa=0)
 or not exists(select 1 from public.ai_budget_accounts where company_id=(f->>'company')::uuid and held_baisa=0 and spent_baisa=0)
 or (select count(*) from public.ai_usage_ledger where worker_job_id=(f->>'job')::uuid)<>1
 then raise exception 'Fallback failure changed existing capacity or known zero cost';end if;
 r:=pg_temp.atomic_reserve(f,gen_random_uuid(),2,1);
 if r->>'ok' is distinct from 'true' or (select count(*) from public.ai_usage_ledger where worker_job_id=(f->>'job')::uuid)<>2
 or (select count(*) from public.whatsapp_inbound_jobs where company_id=(f->>'company')::uuid and usage_status='reserved')<>1
 then raise exception 'Definite permitted fallback failed to reuse one message slot: %',r;end if;
end; $$;
select 'PASS|Atomic fallback denial preserves prior quota and known zero cost, then permitted fallback reuses quota';

do $$ declare f jsonb:=pg_temp.atomic_fixture();a uuid:=gen_random_uuid();r jsonb;begin
 r:=pg_temp.atomic_reserve(f,a);
 if r->>'ok' is distinct from 'true' or not public.ai_start_whatsapp_attempt(a,(f->>'claim')::uuid)
 or not public.ai_settle_whatsapp_attempt(a,(f->>'claim')::uuid,'success',0.0026008,1,
 '{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"cacheWriteTokens":3,"reasoningTokens":4,"totalTokens":30}',
 'synthetic-request','synthetic-response','gpt-6-luna','Synthetic persisted atomic answer',null,12)
 then raise exception 'Synthetic paid settlement failed: %',r;end if;
 r:=pg_temp.atomic_reserve(f,gen_random_uuid(),2);
 if r->>'code' is distinct from 'PRIOR_ATTEMPT_NOT_RETRYABLE' then raise exception 'Paid attempt allowed fallback: %',r;end if;
 if not exists(select 1 from public.whatsapp_inbound_jobs where id=(f->>'job')::uuid and usage_status='reserved')
 or not exists(select 1 from public.ai_usage_ledger where id=a and status='success' and cost_baisa=1 and cost_usd=0.0026008
 and response_text='Synthetic persisted atomic answer')
 or not exists(select 1 from public.ai_budget_accounts where company_id=(f->>'company')::uuid and held_baisa=0 and spent_baisa=1)
 or (select count(*) from public.ai_usage_ledger where worker_job_id=(f->>'job')::uuid)<>1
 then raise exception 'Rejected paid replay changed prior quota or incurred cost';end if;
end; $$;
select 'PASS|Atomic paid replay preserves prior message capacity and known charged cost';

do $$ declare f jsonb:=pg_temp.atomic_fixture();a uuid:=gen_random_uuid();r jsonb;begin
 r:=pg_temp.atomic_reserve(f,a);
 if r->>'ok' is distinct from 'true' or not public.ai_start_whatsapp_attempt(a,(f->>'claim')::uuid)
 or not public.ai_settle_whatsapp_attempt(a,(f->>'claim')::uuid,'uncertain',null,null,'{}',null,null,null,null,'PROVIDER_NETWORK_ERROR',12)
 then raise exception 'Synthetic uncertain settlement failed: %',r;end if;
 r:=pg_temp.atomic_reserve(f,gen_random_uuid(),2);
 if r->>'code' is distinct from 'PRIOR_ATTEMPT_NOT_RETRYABLE' then raise exception 'Uncertain attempt allowed fallback: %',r;end if;
 if not exists(select 1 from public.whatsapp_inbound_jobs where id=(f->>'job')::uuid and usage_status='reserved')
 or not exists(select 1 from public.ai_usage_ledger where id=a and status='uncertain' and cost_baisa is null)
 or not exists(select 1 from public.ai_budget_accounts where company_id=(f->>'company')::uuid and held_baisa=1 and spent_baisa=0)
 or (select count(*) from public.ai_usage_ledger where worker_job_id=(f->>'job')::uuid)<>1
 then raise exception 'Rejected uncertain replay changed prior held cost or capacity';end if;
end; $$;
select 'PASS|Atomic uncertain replay keeps prior held cost and capacity without another paid attempt';

reset role;
do $$ declare f regprocedure:='public.ai_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid)'::regprocedure;begin
 if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
 or not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'Atomic reservation role grants unsafe';end if;
end; $$;
select 'PASS|Atomic reservation is callable only by the service role';
rollback;

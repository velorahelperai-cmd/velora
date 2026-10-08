-- TEST ONLY. Run against the task-labelled disposable PostgreSQL target.
-- Every test is a subtransaction, and all fixtures/temporary helpers are rolled back.
begin;
create temporary table ai_security_results(name text,passed boolean,detail text);
grant select,insert on ai_security_results to service_role;

create function pg_temp.ai_fixture(p_expired boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;sid uuid:=gen_random_uuid();cid uuid:=gen_random_uuid();other_cid uuid:=gen_random_uuid();
 delegated uuid:=gen_random_uuid();member_id uuid:=gen_random_uuid();other_sid uuid:=gen_random_uuid();
begin
 select user_id into actor from public.platform_admins where role='owner' and status='active';
 if actor is null then raise exception 'TEST_OWNER_MISSING';end if;
 insert into public.companies(id,display_name,status,created_by)
 values(cid,'Synthetic C1 admin trial','active',actor),(other_cid,'Synthetic C1 second tenant','active',actor);
 insert into auth.users(id,email) values(delegated,delegated||'@example.invalid'),(member_id,member_id||'@example.invalid');
 insert into public.platform_admins(user_id,role,status) values(delegated,'delegated','active');
 insert into public.company_members(company_id,user_id,role,status) values(cid,member_id,'owner','active');
 insert into auth.sessions(id,user_id) values(sid,actor),(other_sid,delegated);
 insert into private.app_session_activity(session_id,user_id,last_activity_at)
 values(sid,actor,clock_timestamp()-case when p_expired then interval '3 hours' else interval '0 seconds' end),
 (other_sid,delegated,clock_timestamp());
 -- SQL administrator fixture setup. The service role must be unable to do this.
 update public.ai_budget_accounts set limit_baisa=1000,spent_baisa=0,held_baisa=0,enabled=true where scope='admin_test';
 return jsonb_build_object('actor',actor,'session',sid,'company',cid,'other_company',other_cid,
  'delegated',delegated,'member',member_id,'other_session',other_sid);
end;$$;

create function pg_temp.ai_reserve(f jsonb,p_id uuid,p_execution uuid default null,p_attempt integer default 1,
 p_reserve numeric default 10,p_snapshot jsonb default '{"modelId":"gpt-6-luna","version":"synthetic-c1"}')
returns jsonb language sql as $$
 select public.ai_reserve_attempt(p_id,coalesce(p_execution,p_id),p_attempt,(f->>'company')::uuid,
  (f->>'actor')::uuid,(f->>'session')::uuid,'gpt-6-luna','openai',p_reserve,'synthetic-c1',p_snapshot,'admin_test');
$$;
create function pg_temp.ai_known(p_id uuid,p_status text default 'success',p_cost numeric default 1,
 p_usage jsonb default '{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"reasoningTokens":4,"cacheWriteTokens":3,"totalTokens":30}',
 p_model text default 'gpt-6-luna',p_response text default 'synthetic-response') returns boolean
language plpgsql as $$begin
 -- The baseline takes its real legacy path, then fails the persisted evidence assertions.
 if to_regprocedure('public.ai_settle_admin_attempt(uuid,text,numeric,numeric,jsonb,text,text,integer,text,text)') is null then
  return public.ai_settle_attempt(p_id,p_status,p_cost*0.0026008,p_cost,p_usage,'synthetic-request',null,12);
 end if;
 return public.ai_settle_admin_attempt(p_id,p_status,p_cost*0.0026008,p_cost,p_usage,'synthetic-request',null,12,p_response,p_model);
end;$$;

create function pg_temp.ai_case(p_name text,p_sql text) returns text language plpgsql as $$
declare passed boolean:=false;detail text;
begin
 begin
  execute p_sql;
  -- Roll back successful test fixtures as well as unsuccessful ones.
  raise exception 'TEST_CASE_ROLLBACK' using errcode='PAI01';
 exception when sqlstate 'PAI01' then passed:=true;
 when others then detail:=sqlerrm;
 end;
 insert into pg_temp.ai_security_results values(p_name,passed,detail);
 return case when passed then 'PASS|' else 'FAIL|' end||p_name||coalesce('|'||detail,'');
end;$$;

set local role service_role;
select pg_temp.ai_case('AI service direct CRUD cannot reset lifetime accounting',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();begin
 begin update public.ai_budget_accounts set spent_baisa=0,held_baisa=0 where scope='admin_test';raise exception 'service reset accounting';
 exception when insufficient_privilege then null;end;
 begin delete from public.ai_budget_accounts where scope='admin_test';raise exception 'service deleted singleton';
 exception when insufficient_privilege then null;end;
 begin insert into public.ai_budget_accounts(scope,company_id,limit_baisa) values('company_live',(f->>'company')::uuid,1000);raise exception 'service provisioned budget';
 exception when insufficient_privilege then null;end;
 begin update public.ai_usage_ledger set cost_baisa=0;raise exception 'service overwrote ledger';
 exception when insufficient_privilege then null;end;
 begin delete from public.ai_usage_ledger;raise exception 'service deleted evidence';
 exception when insufficient_privilege then null;end;
 begin truncate public.ai_usage_ledger cascade;raise exception 'service truncated evidence';
 exception when insufficient_privilege then null;end;
end;$$;$test$);

select pg_temp.ai_case('AI browser RPC and capability ACLs stay closed',$test$
do $$declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('ai_reserve_attempt','ai_start_attempt','ai_settle_attempt',
 'ai_settle_admin_attempt','ai_reconcile_attempt','ai_admin_snapshot','ai_reserve_whatsapp_attempt',
 'ai_start_whatsapp_attempt','ai_settle_whatsapp_attempt','ai_reserve_whatsapp_profile_attempt','ai_reserve_whatsapp_capacity_cost_attempt') loop
  if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE')
  then raise exception 'browser RPC exposed: %',fn;end if;
 end loop;
 if has_table_privilege('authenticated','public.ai_budget_accounts','UPDATE')
 or has_column_privilege('authenticated','public.ai_usage_ledger','worker_claim_token','SELECT')
 or has_column_privilege('authenticated','public.ai_usage_ledger','response_text','SELECT') then raise exception 'browser accounting capability exposed';end if;
end;$$;$test$);

select pg_temp.ai_case('AI owner and active session remain required',$test$
do $$declare f jsonb:=pg_temp.ai_fixture(true);begin
 begin perform pg_temp.ai_reserve(f,gen_random_uuid());raise exception 'expired owner reserved';
 exception when others then if sqlerrm<>'APP_SESSION_EXPIRED' then raise;end if;end;
 begin perform pg_temp.ai_reserve(f||jsonb_build_object('actor',f->>'delegated','session',f->>'other_session'),gen_random_uuid());raise exception 'delegated reserved';
 exception when others then if sqlerrm<>'OWNER_REQUIRED' then raise;end if;end;
end;$$;$test$);

select pg_temp.ai_case('AI admin reservation rejects a pricing snapshot for another model',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();begin
 begin perform pg_temp.ai_reserve(f,gen_random_uuid(),null,1,10,'{"modelId":"gpt-6.1-sol","version":"synthetic-c1"}');raise exception 'wrong model snapshot accepted';
 exception when others then if sqlerrm<>'INVALID_RESERVATION' then raise;end if;end;
 begin perform pg_temp.ai_reserve(f,gen_random_uuid(),null,1,10,'{"modelId":"gpt-6-luna","version":"other-version"}');raise exception 'wrong version snapshot accepted';
 exception when others then if sqlerrm<>'INVALID_RESERVATION' then raise;end if;end;
 if (select held_baisa from public.ai_budget_accounts where scope='admin_test')<>0 then raise exception 'invalid snapshot held money';end if;
end;$$;$test$);

select pg_temp.ai_case('AI execution cannot skip attempt one',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();r jsonb;begin
 r:=pg_temp.ai_reserve(f,gen_random_uuid(),gen_random_uuid(),2);
 if r->>'code' is distinct from 'ATTEMPT_SEQUENCE_REJECTED' then raise exception 'out of sequence reserve: %',r;end if;
end;$$;$test$);

select pg_temp.ai_case('AI retry execution stays bound to tenant and owner session',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();a uuid:=gen_random_uuid();e uuid:=gen_random_uuid();r jsonb;begin
 r:=pg_temp.ai_reserve(f,a,e);if r->>'ok'<>'true' then raise exception 'fixture reserve failed: %',r;end if;
 perform public.ai_settle_attempt(a,'rejected',0,0,'{}',null,'PROVIDER_HTTP_404',1);
 r:=pg_temp.ai_reserve(f||jsonb_build_object('company',f->>'other_company'),gen_random_uuid(),e,2);
 if r->>'code' is distinct from 'EXECUTION_BINDING_REJECTED' then raise exception 'cross tenant execution accepted: %',r;end if;
end;$$;$test$);

select pg_temp.ai_case('AI unknown attempt cannot authorize a fallback',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();a uuid:=gen_random_uuid();e uuid:=gen_random_uuid();r jsonb;begin
 perform pg_temp.ai_reserve(f,a,e);perform public.ai_start_attempt(a);
 perform public.ai_settle_attempt(a,'uncertain',null,null,'{}','synthetic-request','TIMEOUT',20);
 r:=pg_temp.ai_reserve(f,gen_random_uuid(),e,2);
 if r->>'code' is distinct from 'PRIOR_ATTEMPT_NOT_RETRYABLE' then raise exception 'unknown fallback allowed: %',r;end if;
 if (select held_baisa from public.ai_budget_accounts where scope='admin_test')<>10 then raise exception 'unknown hold changed';end if;
end;$$;$test$);

select pg_temp.ai_case('AI known provider work requires a running attempt',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();a uuid:=gen_random_uuid();begin
 perform pg_temp.ai_reserve(f,a);
 if pg_temp.ai_known(a) then raise exception 'unstarted success accepted';end if;
 if (select held_baisa=10 and spent_baisa=0 from public.ai_budget_accounts where scope='admin_test') is distinct from true then raise exception 'unstarted hold changed';end if;
end;$$;$test$);

select pg_temp.ai_case('AI known settlement persists complete evidence and acknowledges identical retry',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();a uuid:=gen_random_uuid();begin
 perform pg_temp.ai_reserve(f,a);if not public.ai_start_attempt(a) then raise exception 'start failed';end if;
 if not pg_temp.ai_known(a) then raise exception 'known settle failed';end if;
 if not exists(select 1 from public.ai_usage_ledger where id=a and cost_baisa=1 and response_id='synthetic-response'
 and actual_model_id='gpt-6-luna' and cache_write_tokens=3 and total_tokens=30 and prompt_tokens=20 and completion_tokens=10
 and cached_tokens=5 and reasoning_tokens=4 and request_id='synthetic-request' and status='success') then raise exception 'provider evidence lost';end if;
 if not pg_temp.ai_known(a) then raise exception 'identical retry unacknowledged';end if;
 if pg_temp.ai_known(a,'success',2) then raise exception 'conflicting retry accepted';end if;
 if (select held_baisa=0 and spent_baisa=1 from public.ai_budget_accounts where scope='admin_test') is distinct from true then raise exception 'known charge not atomic once';end if;
end;$$;$test$);

select pg_temp.ai_case('AI uncertain outcome retains only unknown costs and its original hold',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();a uuid:=gen_random_uuid();begin
 perform pg_temp.ai_reserve(f,a);perform public.ai_start_attempt(a);
 begin perform public.ai_settle_attempt(a,'uncertain',0.0026008,1,'{}','synthetic-request','TIMEOUT',20);raise exception 'uncertain known cost accepted';
 exception when others then if sqlerrm<>'INVALID_COST' then raise;end if;end;
 if not public.ai_settle_attempt(a,'uncertain',null,null,'{}','synthetic-request','TIMEOUT',20) then raise exception 'unknown settle failed';end if;
 if not public.ai_settle_attempt(a,'uncertain',null,null,'{}','synthetic-request','TIMEOUT',20) then raise exception 'unknown retry unacknowledged';end if;
 if (select held_baisa=10 and spent_baisa=0 from public.ai_budget_accounts where scope='admin_test') is distinct from true
 or not exists(select 1 from public.ai_usage_ledger where id=a and status='uncertain' and cost_baisa is null and cost_usd is null) then raise exception 'unknown accounting changed';end if;
end;$$;$test$);

select pg_temp.ai_case('AI actual provider model cannot be priced as the requested model',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();a uuid:=gen_random_uuid();begin
 perform pg_temp.ai_reserve(f,a);perform public.ai_start_attempt(a);
 begin perform pg_temp.ai_known(a,'success',1,'{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"reasoningTokens":4,"cacheWriteTokens":3,"totalTokens":30}','gpt-6.1-sol');raise exception 'wrong actual model accepted';
 exception when others then if sqlerrm<>'PROVIDER_MODEL_MISMATCH' then raise;end if;end;
 if (select held_baisa from public.ai_budget_accounts where scope='admin_test')<>10 then raise exception 'wrong model released hold';end if;
end;$$;$test$);

select pg_temp.ai_case('AI invalid token breakdown and costs cannot release money',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();a uuid:=gen_random_uuid();begin
 perform pg_temp.ai_reserve(f,a);perform public.ai_start_attempt(a);
 begin perform pg_temp.ai_known(a,'success',1,'{"promptTokens":20,"completionTokens":10,"cachedTokens":19,"reasoningTokens":4,"cacheWriteTokens":3,"totalTokens":30}');raise exception 'invalid tokens accepted';
 exception when others then if sqlerrm<>'INVALID_PROVIDER_USAGE' then raise;end if;end;
 begin perform public.ai_settle_attempt(a,'success','NaN'::numeric,1,'{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"reasoningTokens":4}',null,null,12);raise exception 'NaN cost accepted';
 exception when others then if sqlerrm<>'INVALID_COST' then raise;end if;end;
 begin perform public.ai_settle_attempt(a,'success',1,0,'{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"reasoningTokens":4}',null,null,12);raise exception 'USD cost erased in baisa';
 exception when others then if sqlerrm<>'INVALID_COST' then raise;end if;end;
 if (select held_baisa=10 and spent_baisa=0 from public.ai_budget_accounts where scope='admin_test') is distinct from true then raise exception 'invalid accounting released hold';end if;
end;$$;$test$);

select pg_temp.ai_case('AI reconciliation is evidence bound and identical idempotent',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();a uuid:=gen_random_uuid();u jsonb:='{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"reasoningTokens":4,"cacheWriteTokens":3,"totalTokens":30}';begin
 perform pg_temp.ai_reserve(f,a);perform public.ai_start_attempt(a);
 begin perform public.ai_reconcile_attempt(a,0.0026008,1,u,'synthetic-provider-lookup');raise exception 'in flight reconciled';
 exception when others then if sqlerrm<>'REQUEST_STILL_IN_FLIGHT' then raise;end if;end;
 perform public.ai_settle_attempt(a,'uncertain',null,null,'{}','synthetic-request','TIMEOUT',20);
 if not public.ai_reconcile_attempt(a,0.0026008,1,u,'synthetic-provider-lookup') then raise exception 'evidence reconciliation failed';end if;
 if not public.ai_reconcile_attempt(a,0.0026008,1,u,'synthetic-provider-lookup') then raise exception 'reconcile retry unacknowledged';end if;
 if public.ai_reconcile_attempt(a,0.0026008,1,u,'other-provider-lookup') then raise exception 'conflicting reconciliation accepted';end if;
 if (select held_baisa=0 and spent_baisa=1 from public.ai_budget_accounts where scope='admin_test') is distinct from true then raise exception 'reconciliation double charge';end if;
end;$$;$test$);

select pg_temp.ai_case('AI owner trials share one global lifetime cap across tenants',$test$
do $$declare f jsonb:=pg_temp.ai_fixture();r jsonb;begin
 r:=pg_temp.ai_reserve(f,gen_random_uuid(),null,1,600);if r->>'ok'<>'true' then raise exception 'first global hold denied';end if;
 r:=pg_temp.ai_reserve(f||jsonb_build_object('company',f->>'other_company'),gen_random_uuid(),null,1,600);
 if r->>'code' is distinct from 'BUDGET_EXCEEDED' then raise exception 'global budget split by tenant: %',r;end if;
end;$$;$test$);

reset role;
do $$begin if exists(select 1 from pg_temp.ai_security_results where not passed) then
 raise exception 'AI_SECURITY_FAILURES=%',(select count(*) from pg_temp.ai_security_results where not passed);
end if;end;$$;
rollback;

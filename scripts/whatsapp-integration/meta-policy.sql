-- TEST ONLY: real PostgreSQL policy assertions; no provider/network execution.
begin;
do $$ begin
 if to_regprocedure('public.resolve_whatsapp_company_by_meta_asset(text,text)') is null
 or to_regprocedure('public.whatsapp_check_service_window(uuid,uuid,text,text)') is null
 or to_regprocedure('public.whatsapp_store_meta_inbound(uuid,text,text,text,text,text,text,text,timestamp with time zone)') is null
 then raise exception 'META_ROUTING_WINDOW_POLICY_MISSING'; end if;
end; $$;

-- Fixtures are admin-created synthetic authorization. No token value is needed.
create or replace function test_fixture.meta_company() returns jsonb language plpgsql as $$
declare f jsonb:=test_fixture.company(); w text:='synthetic-waba-'||gen_random_uuid();begin
 update public.whatsapp_company_links set provider_waba_id=w,authorization_status='active',
   authorization_verified_at=clock_timestamp(),authorization_expires_at=clock_timestamp()+interval '2 days',
   authorization_app_id='synthetic-app',authorization_scopes='["whatsapp_business_management","whatsapp_business_messaging"]'::jsonb
   where id=(f->>'link')::uuid;
 return f||jsonb_build_object('waba',w,'phone',(select phone_number_id from public.whatsapp_conversations where id=(f->>'conversation')::uuid),
   'recipient',(select customer_wa_id from public.whatsapp_conversations where id=(f->>'conversation')::uuid));
end; $$;
grant execute on function test_fixture.meta_company() to service_role;

set local role service_role;
do $$ declare f jsonb:=test_fixture.meta_company();r jsonb;begin
 r:=public.resolve_whatsapp_company_by_meta_asset(f->>'waba',f->>'phone');
 if r->>'company_id' is distinct from f->>'company' or r->>'provider_waba_id' is distinct from f->>'waba' then raise exception 'exact asset did not resolve: %',r;end if;
 r:=public.resolve_whatsapp_company_by_meta_asset('foreign-waba',f->>'phone');
 if r->>'ok' is distinct from 'false' then raise exception 'foreign WABA resolved known phone';end if;
 r:=public.resolve_whatsapp_company_by_meta_asset(null,f->>'phone');
 if r->>'ok' is distinct from 'false' then raise exception 'missing WABA resolved known phone';end if;
 update public.whatsapp_company_links set authorization_user_id=null where id=(f->>'link')::uuid;
 r:=public.resolve_whatsapp_company_by_meta_asset(f->>'waba',f->>'phone');
 if r->>'ok' is distinct from 'false' then raise exception 'incomplete owner-bound token proof resolved';end if;
 update public.whatsapp_company_links set authorization_user_id=(f->>'user')::uuid where id=(f->>'link')::uuid;
 update public.whatsapp_company_links set authorization_expires_at=clock_timestamp()-interval '1 second' where id=(f->>'link')::uuid;
 r:=public.resolve_whatsapp_company_by_meta_asset(f->>'waba',f->>'phone');
 if r->>'ok' is distinct from 'false' then raise exception 'expired authorization resolved';end if;
end; $$;
select 'PASS|Meta exact WABA/phone routing rejects mismatched, absent and expired authorization';

do $$ declare first_tenant jsonb:=test_fixture.meta_company();second_tenant jsonb:=test_fixture.meta_company();r jsonb;begin
 update public.whatsapp_company_links set provider_waba_id=first_tenant->>'waba' where id=(second_tenant->>'link')::uuid;
 r:=public.resolve_whatsapp_company_by_meta_asset(first_tenant->>'waba',first_tenant->>'phone');
 if r->>'company_id' is distinct from first_tenant->>'company' then raise exception 'shared WABA lost first phone tenant';end if;
 r:=public.resolve_whatsapp_company_by_meta_asset(first_tenant->>'waba',second_tenant->>'phone');
 if r->>'company_id' is distinct from second_tenant->>'company' then raise exception 'shared WABA incorrectly unique or cross-routed second phone';end if;
end; $$;
select 'PASS|A WABA may contain multiple phones with exact separate tenant bindings';

do $$ declare f jsonb:=test_fixture.meta_company();r jsonb;j uuid;token uuid;stamp timestamptz:=clock_timestamp()-interval '1 hour';begin
 r:=public.whatsapp_store_meta_inbound((f->>'company')::uuid,f->>'waba',f->>'phone',f->>'recipient','',
   'signed-fresh-'||gen_random_uuid(),'hi','text',stamp);
 j:=(r->>'job_id')::uuid;
 r:=public.whatsapp_check_service_window((f->>'company')::uuid,(f->>'conversation')::uuid,f->>'phone',f->>'recipient');
 if r->>'ok' is distinct from 'true' or (r->>'valid_until')::timestamptz is distinct from stamp+interval '24 hours'
 or r->>'company_id' is distinct from f->>'company' then raise exception 'fresh signed inbound window rejected: %',r;end if;
 r:=public.claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;
 r:=public.billing_load_worker_frame(j,token);
 if r->>'ok' is distinct from 'true' or (r->'data'->>'service_window_expires_at')::timestamptz is distinct from stamp+interval '24 hours'
 then raise exception 'worker frame omitted fresh evidence: %',r;end if;
end; $$;
select 'PASS|Fresh signed timestamp opens exact 24-hour window and appears in worker frame';

do $$ declare f jsonb:=test_fixture.meta_company();r jsonb;j uuid;token uuid;intent uuid:=gen_random_uuid();wid text:='signed-old-'||gen_random_uuid();begin
 r:=public.whatsapp_store_meta_inbound((f->>'company')::uuid,f->>'waba',f->>'phone',f->>'recipient','',wid,'hi','text',clock_timestamp()-interval '25 hours');
 j:=(r->>'job_id')::uuid;
 -- A redelivery's new arrival time and changed provider timestamp cannot rewrite the original.
 perform public.whatsapp_store_meta_inbound((f->>'company')::uuid,f->>'waba',f->>'phone',f->>'recipient','',wid,'hi','text',clock_timestamp());
 r:=public.whatsapp_check_service_window((f->>'company')::uuid,(f->>'conversation')::uuid,f->>'phone',f->>'recipient');
 if r->>'code' is distinct from 'service_window_closed' then raise exception 'old replay extended window: %',r;end if;
 r:=public.claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;
 r:=public.whatsapp_reserve_job_usage(j,token);
 if r->>'code' is distinct from 'service_window_closed' or (select usage_status from public.whatsapp_inbound_jobs where id=j) is not null
 then raise exception 'closed window reserved paid capacity: %',r;end if;
 r:=public.ai_reserve_whatsapp_attempt(gen_random_uuid(),j,token,1,'gpt-6-luna','openai',1,'synthetic-v1',
   '{"modelId":"gpt-6-luna","version":"synthetic-v1"}',null);
 if r->>'code' is distinct from 'service_window_closed' or exists(select 1 from public.ai_usage_ledger where worker_job_id=j)
 then raise exception 'closed window created AI reservation: %',r;end if;
 r:=public.billing_load_worker_frame(j,token);
 if r->>'code' is distinct from 'service_window_closed' then raise exception 'closed worker frame loaded: %',r;end if;
 r:=public.whatsapp_claim_assistant_job_send(j,token);
 if r->>'ok' is distinct from 'false' or exists(select 1 from public.whatsapp_send_intents where original_job_id=j and outcome='attempting')
 then raise exception 'closed assistant send claimed: %',r;end if;
 insert into public.whatsapp_send_intents(id,client_op_id,company_id,conversation_id,phone_number_id,recipient_wa_id,body,sender_kind,actor_user_id,link_id,link_generation)
 select intent,'stale-staff-'||gen_random_uuid(),(f->>'company')::uuid,(f->>'conversation')::uuid,f->>'phone',f->>'recipient','staff reply','staff',
   (f->>'user')::uuid,l.id,l.generation from public.whatsapp_company_links l where l.id=(f->>'link')::uuid;
 r:=public.claim_whatsapp_send_attempt(intent,(f->>'user')::uuid,90);
 if r->>'code' is distinct from 'service_window_closed' or (select outcome from public.whatsapp_send_intents where id=intent)<>'ready'
 or (select attempt_token from public.whatsapp_send_intents where id=intent) is not null then raise exception 'closed staff send consumed attempt: %',r;end if;
end; $$;
select 'PASS|Stale replay cannot extend window, reserve capacity/AI, load worker frame or claim staff/assistant send';

do $$ declare f jsonb:=test_fixture.meta_company();r jsonb;begin
 perform public.whatsapp_store_meta_inbound((f->>'company')::uuid,f->>'waba',f->>'phone',f->>'recipient','',
   'signed-future-'||gen_random_uuid(),'hi','text',clock_timestamp()+interval '1 hour');
 r:=public.whatsapp_check_service_window((f->>'company')::uuid,(f->>'conversation')::uuid,f->>'phone',f->>'recipient');
 if r->>'code' is distinct from 'service_window_closed' then raise exception 'future inbound opened window';end if;
 perform public.save_whatsapp_inbound((f->>'company')::uuid,f->>'phone',f->>'recipient','',
   'unsigned-legacy-'||gen_random_uuid(),'hi','text',clock_timestamp());
 r:=public.whatsapp_check_service_window((f->>'company')::uuid,(f->>'conversation')::uuid,f->>'phone',f->>'recipient');
 if r->>'code' is distinct from 'service_window_closed' then raise exception 'unvalidated legacy inbound opened window';end if;
end; $$;
select 'PASS|Future and unvalidated legacy timestamps cannot open service window';

-- Future provider evidence must be rejected at ingress, not merely ignored until
-- that timestamp arrives. Admin inspection does not execute a provider call.
reset role;
do $$ begin
 if exists(select 1 from private.whatsapp_meta_inbound_evidence e join public.whatsapp_messages m on m.id=e.message_id
 where m.wa_message_id like 'signed-future-%') then raise exception 'future provider time retained eligible evidence';end if;
end; $$;
set local role service_role;
select 'PASS|Future provider time never mints evidence that could become eligible later';

do $$ declare f jsonb:=test_fixture.meta_company();other jsonb:=test_fixture.meta_company();r jsonb;begin
 r:=public.whatsapp_store_meta_inbound((other->>'company')::uuid,f->>'waba',f->>'phone',f->>'recipient','',
   'wrong-company-'||gen_random_uuid(),'hi','text',clock_timestamp());
 if r->>'ok' is distinct from 'false' or exists(select 1 from public.whatsapp_messages where company_id=(other->>'company')::uuid)
 then raise exception 'caller company overrode signed asset binding';end if;
end; $$;
select 'PASS|Durable inbound wrapper rejects client company mismatch before persistence';

do $$ declare f jsonb:=test_fixture.meta_company();other jsonb:=test_fixture.meta_company();r jsonb;begin
 r:=public.whatsapp_apply_meta_delivery_status((other->>'company')::uuid,f->>'waba',f->>'phone',
   'status-wrong-company-'||gen_random_uuid(),'delivered',f->>'recipient',clock_timestamp());
 if r->>'ok' is distinct from 'false' or exists(select 1 from public.whatsapp_delivery_statuses where company_id=(other->>'company')::uuid)
 then raise exception 'caller company overrode signed delivery asset';end if;
end; $$;
select 'PASS|Durable delivery wrapper rejects caller company mismatch';

do $$ declare f jsonb:=test_fixture.meta_company();r jsonb;j uuid;token uuid;a uuid:=gen_random_uuid();cit jsonb;begin
 j:=test_fixture.job(f);r:=public.claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;
 perform public.whatsapp_reserve_job_usage(j,token);
 insert into public.ai_budget_accounts(scope,company_id,limit_baisa,enabled) values('company_live',(f->>'company')::uuid,10,true) on conflict do nothing;
 cit:=jsonb_build_array(jsonb_build_object('sourceId',f->>'knowledge','title','Synthetic knowledge','contentVersion',1));
 r:=public.ai_reserve_whatsapp_attempt(a,j,token,1,'gpt-6-luna','openai',1,'synthetic-v1',
   '{"modelId":"gpt-6-luna","version":"synthetic-v1"}',cit);
 if r->>'ok' is distinct from 'true' then raise exception 'valid reservation denied: %',r;end if;
 update public.whatsapp_company_links set authorization_expires_at=clock_timestamp()-interval '1 second' where id=(f->>'link')::uuid;
 if public.ai_start_whatsapp_attempt(a,token) then raise exception 'AI started after eligibility closed';end if;
 if (select status from public.ai_usage_ledger where id=a)<>'reserved' then raise exception 'closed start changed paid execution state';end if;
end; $$;
select 'PASS|AI start rechecks current window and cannot run a previously reserved closed grant';

do $$ declare f jsonb:=test_fixture.meta_company();r jsonb;j uuid;token uuid;a uuid:=gen_random_uuid();cit jsonb;begin
 j:=test_fixture.job(f);r:=public.claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;
 perform public.whatsapp_reserve_job_usage(j,token);
 insert into public.ai_budget_accounts(scope,company_id,limit_baisa,enabled) values('company_live',(f->>'company')::uuid,10,true) on conflict do nothing;
 cit:=jsonb_build_array(jsonb_build_object('sourceId',f->>'knowledge','title','Synthetic knowledge','contentVersion',1));
 r:=public.ai_reserve_whatsapp_attempt(a,j,token,1,'gpt-6-luna','openai',1,'synthetic-v1',
   '{"modelId":"gpt-6-luna","version":"synthetic-v1"}',cit);
 if r->>'ok' is distinct from 'true' or not public.ai_start_whatsapp_attempt(a,token) then raise exception 'fresh AI fixture failed: %',r;end if;
 update public.whatsapp_company_links set authorization_expires_at=clock_timestamp()-interval '1 second' where id=(f->>'link')::uuid;
 if not public.ai_settle_whatsapp_attempt(a,token,'success',0.0026008,1,
   '{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"cacheWriteTokens":3,"reasoningTokens":4,"totalTokens":30}',
   'synthetic-request','synthetic-response','gpt-6-luna','Synthetic persisted answer',null,12)
 then raise exception 'closed window prevented settlement of incurred cost';end if;
 if (select spent_baisa from public.ai_budget_accounts where company_id=(f->>'company')::uuid and scope='company_live')<>1
 then raise exception 'known paid cost did not settle after window closed';end if;
end; $$;
select 'PASS|Window closure never blocks settlement of already incurred AI cost';

reset role;
do $$ declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('resolve_whatsapp_company_by_meta_asset','whatsapp_store_meta_inbound','whatsapp_apply_meta_delivery_status','whatsapp_check_service_window') loop
 if has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute')
 or not has_function_privilege('service_role',fn,'execute') then raise exception 'invalid policy RPC ACL: %',fn;end if;
 end loop;
 if has_table_privilege('service_role','private.whatsapp_meta_inbound_evidence','insert') then raise exception 'service role can mint direct provenance';end if;
end; $$;
select 'PASS|Meta policy RPCs are service-only and evidence table is not directly writable';
rollback;

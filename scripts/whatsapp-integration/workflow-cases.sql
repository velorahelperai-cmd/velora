-- Synthetic real PostgreSQL lifecycle tests. No Graph or AI provider requests.
begin;set local role service_role;
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;token uuid;begin
 r:=claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;
 r:=whatsapp_reserve_job_usage(j,token);if r->>'ok'<>'true' then raise exception 'paid proof did not reserve quota: %',r;end if;
 r:=whatsapp_reserve_job_usage(j,token);if r->>'reused'<>'true' then raise exception 'quota replay double reserved';end if;
end;$$;
select 'PASS|D4 canonical paid proof reserves message capacity once';
do $$ declare f jsonb:=test_fixture.company(false);j uuid:=test_fixture.job(f);r jsonb;begin
 r:=claim_whatsapp_inbound_job(j,120);r:=whatsapp_reserve_job_usage(j,(r->>'claim_token')::uuid);
 if r->>'code'<>'subscription_inactive' then raise exception 'unpaid authorized quota: %',r;end if;end;$$;
select 'PASS|D4 unpaid tenant cannot reserve message capacity';
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;token uuid;begin
 r:=claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;
 r:=whatsapp_retry_inbound_job(j,token,'database_unavailable',false);
 if r->>'status'<>'retry_wait' or (r->>'delay_seconds')::int<>5 then raise exception 'missing bounded backoff: %',r;end if;
 r:=claim_whatsapp_inbound_job(j,120);if r->>'ok'='true' then raise exception 'claimed before retry deadline';end if;
 if whatsapp_heartbeat_inbound_job(j,token) then raise exception 'stale token renewed retry';end if;
end;$$;
select 'PASS|D2 retry persists backoff and fences the old capability';
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;token uuid;id uuid:=gen_random_uuid();begin
 insert into ai_budget_accounts(scope,company_id,limit_baisa,enabled) values('company_live',(f->>'company')::uuid,10,true);
 r:=claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;perform whatsapp_reserve_job_usage(j,token);
 r:=ai_reserve_whatsapp_attempt(id,j,token,1,'gpt-6-luna','openai',1,'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}',
 jsonb_build_array(jsonb_build_object('sourceId',f->>'knowledge','title','Synthetic knowledge','contentVersion',1)));
 if r->>'ok'<>'true' then raise exception 'AI fixture reserve denied: %',r;end if;
 if not ai_start_whatsapp_attempt(id,token) then raise exception 'AI fixture start denied';end if;
 r:=whatsapp_retry_inbound_job(j,token,'worker_crash',false);
 if (select x.usage_status from whatsapp_inbound_jobs x where x.id=j)<>'unknown' then raise exception 'D4 unknown running AI incorrectly released quota';end if;
end;$$;
select 'PASS|D2/D4 stored running AI retains both holds independent of caller flag';
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;begin
 update whatsapp_inbound_jobs set status='claimed',expected_automation_generation=0,claim_token=null,claim_expires_at=null where id=j;
 r:=whatsapp_reserve_job_usage(j,null);
 if r->>'ok'='true' then raise exception 'D2 malformed NULL claim authorized work';end if;end;$$;
select 'PASS|D2 malformed NULL claim cannot authorize work';
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;token uuid;a uuid;cit jsonb;i uuid;begin
 r:=claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;perform whatsapp_reserve_job_usage(j,token);
 a:=test_fixture.draft(f,j,token);select source_citations into cit from ai_usage_ledger where id=a;
 r:=whatsapp_stage_job_reply(j,token,a,cit);if r->>'ok'<>'true' then raise exception 'atomic stage denied: %',r;end if;i:=(r->>'intent_id')::uuid;
 r:=whatsapp_stage_job_reply(j,token,a,cit);if r->>'reused'<>'true' then raise exception 'stage not idempotent';end if;
 if (select count(*) from whatsapp_send_intents where original_job_id=j)<>1 then raise exception 'duplicate logical outbound intent';end if;
 r:=whatsapp_claim_assistant_job_send(j,token);if r->>'claimed'<>'true' then raise exception 'assistant send claim denied: %',r;end if;
 perform finalize_whatsapp_send_attempt(i,(r->>'attempt_token')::uuid,'accepted','synthetic-accepted-'||gen_random_uuid(),null,null);
 r:=billing_finalize_automated_usage((f->>'company')::uuid,i);if r->>'status'<>'accepted' then raise exception 'actual accepted usage not counted: %',r;end if;
 r:=billing_finalize_automated_usage((f->>'company')::uuid,i);if r->>'reused'<>'true' then raise exception 'accepted quota duplicated';end if;
 if (select status from whatsapp_inbound_jobs where id=j)<>'completed' then raise exception 'accepted job not complete';end if;
end;$$;
select 'PASS|D3 draft, original job and intent bind once; acceptance settles quota idempotently';
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;token uuid;a uuid;cit jsonb;begin
 r:=claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;perform whatsapp_reserve_job_usage(j,token);
 a:=test_fixture.draft(f,j,token);select source_citations into cit from ai_usage_ledger where id=a;
 r:=billing_load_worker_frame(j,token);
 if r->'data'->>'reply_text'<>'Synthetic persisted answer' or r->'data'->'staged_citations' is distinct from cit then raise exception 'crash recovery lost original draft/provenance';end if;
 update knowledge_sources set content='New synthetic knowledge' where id=(f->>'knowledge')::uuid;
 perform set_config('velora.knowledge_approval','1',true);
 update knowledge_sources set approved_for_answers=true,approved_version=content_version,approved_at=clock_timestamp(),approved_by=(f->>'user')::uuid where id=(f->>'knowledge')::uuid;
 cit:=jsonb_build_array(jsonb_build_object('sourceId',f->>'knowledge','title','Synthetic knowledge','contentVersion',2));
 r:=whatsapp_stage_job_reply(j,token,a,cit);if r->>'code'<>'citations_changed' then raise exception 'old draft relabelled with new citations: %',r;end if;
end;$$;
select 'PASS|D3 crashed generation retains original draft and cannot adopt new source versions';
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;token uuid;a uuid;cit jsonb;begin
 r:=claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;perform whatsapp_reserve_job_usage(j,token);
 a:=test_fixture.draft(f,j,token);select source_citations into cit from ai_usage_ledger where id=a;
 perform set_config('velora.conversation_control','1',true);
 update whatsapp_conversations set automation_allowed=false,status='handed_over',automation_generation=automation_generation+1 where id=(f->>'conversation')::uuid;
 r:=whatsapp_stage_job_reply(j,token,a,cit);if r->>'ok'='true' then raise exception 'AI staged after human takeover';end if;
 if (select cost_baisa from ai_usage_ledger where id=a)<>1 then raise exception 'takeover erased incurred AI cost';end if;
end;$$;
select 'PASS|D5 takeover during generation blocks stage while retaining actual AI charge';
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;token uuid;a uuid;cit jsonb;begin
 r:=claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;perform whatsapp_reserve_job_usage(j,token);
 a:=test_fixture.draft(f,j,token);select source_citations into cit from ai_usage_ledger where id=a;perform whatsapp_stage_job_reply(j,token,a,cit);
 update billing_subscriptions set paid_through=clock_timestamp()-interval '1 second',status='ended' where id=(f->>'subscription')::uuid;
 r:=whatsapp_claim_assistant_job_send(j,token);if r->>'claimed'='true' then raise exception 'expired subscription authorized external send';end if;
end;$$;
select 'PASS|D4 subscription expiry after AI generation prevents dispatch';
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;token uuid;a uuid;cit jsonb;i uuid;begin
 r:=claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;perform whatsapp_reserve_job_usage(j,token);
 a:=test_fixture.draft(f,j,token);select source_citations into cit from ai_usage_ledger where id=a;r:=whatsapp_stage_job_reply(j,token,a,cit);i:=(r->>'intent_id')::uuid;
 r:=whatsapp_claim_assistant_job_send(j,token);perform finalize_whatsapp_send_attempt(i,(r->>'attempt_token')::uuid,'unknown',null,'synthetic-timeout',null);
 r:=whatsapp_claim_assistant_job_send(j,token);if r->>'claimed'='true' then raise exception 'unknown outcome reauthorized send';end if;
 r:=billing_finalize_automated_usage((f->>'company')::uuid,i);if r->>'status'<>'unknown' then raise exception 'unknown send released capacity';end if;
 if (select status from whatsapp_inbound_jobs where id=j)='completed' then raise exception 'unknown send falsely completed';end if;
end;$$;
select 'PASS|D3 unknown send preserves capacity and never receives another attempt';
do $$ declare f jsonb:=test_fixture.company(false);j uuid:=test_fixture.job(f);r jsonb;begin
 update whatsapp_inbound_jobs set attempt_count=5 where id=j;r:=claim_whatsapp_inbound_job(j,120);
 if (select status from whatsapp_inbound_jobs where id=j)<>'dead_letter' then raise exception 'D2 exhausted job remains stuck in claimable queue';end if;
 if (select automation_allowed from whatsapp_conversations where id=(f->>'conversation')::uuid) then raise exception 'dead letter did not escalate to human';end if;
end;$$;
select 'PASS|D2 exhausted crash recovery becomes durable dead letter instead of blocking queue forever';
rollback;

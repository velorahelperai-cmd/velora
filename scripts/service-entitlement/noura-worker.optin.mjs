import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isolatedPostgres,lit } from '../g03-review-acceptance/postgres.mjs';
let db;
const migration='supabase/migrations/20261010084102_noura_claimed_job_authority.sql';
const parse=s=>JSON.parse(s.split('\n').find(x=>x.startsWith('{')));
const srv=q=>db.sql(`BEGIN;SET LOCAL ROLE service_role;${q}COMMIT;`);
const call=(name,args)=>`SELECT public.${name}(${args});`;
beforeAll(async()=>{
 db=await isolatedPostgres();await db.bootstrap({throughMigration:'20261008173000_vel_staff_paid_send_entitlement.sql'});
 await db.sql('CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;');
 await db.file('supabase/migrations/20261010053446_service_entitlement_read_contract.sql');
 await db.file('supabase/migrations/20261010073549_service_purchase_settlement_orchestration.sql');
 let fixture=readFileSync('scripts/whatsapp-integration/fixtures.sql','utf8').replaceAll("30,'day',30","30,'month',1");
 const anchor="values(v,p,pv,5000,'OMR',30,'month',1,'published',jsonb_build_object('automated_outbound_per_month',p_cap));";
 expect(fixture).toContain(anchor);
 fixture=fixture.replace(anchor,"values(v,p,pv,5000,'OMR',30,'month',1,'draft',jsonb_build_object('automated_outbound_per_month',p_cap));\n perform public.billing_define_service_offer(v,'noura','basic',array['noura.knowledge.read']);\n update public.billing_plan_versions set status='published' where id=v;");
 fixture=fixture.replace('status,product_code,purchase_purpose,created_by,deadline_policy_approved)', 'status,product_code,purchase_purpose,created_by,deadline_policy_approved,created_at)').replace("'locked','velora_ai_staff','initial',u,true);","'locked','velora_ai_staff','initial',u,true,clock_timestamp());");
 fixture=fixture.replace(' insert into billing_payment_attempts(id,order_id,company_id,status,provider_order_id)'," r:=public.billing_snapshot_service_order(o);if r->>'ok' is distinct from 'true' then raise exception 'Synthetic snapshot denied: %',r;end if;\n insert into billing_payment_attempts(id,order_id,company_id,status,provider_order_id)");
 await db.sql(fixture);
 console.log('NOURA_DEPENDENCIES',await db.sql("SELECT n.nspname||'.'||p.proname||'|'||md5(replace(p.prosrc,chr(13),''))||'|'||p.prosecdef||'|'||coalesce(array_to_string(p.proconfig,','),'') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN ('whatsapp_answer_profile','whatsapp_reserve_job_usage','billing_load_worker_frame','billing_service_receipt_eligible','wa_worker_lock','whatsapp_attempt_profile_current','ai_reserve_whatsapp_capacity_cost_attempt','billing_service_immutable') ORDER BY 1;"));
 if(process.env.NOURA_AUTHORITY_BASELINE!=='true'){
  const signature='private.whatsapp_answer_profile(uuid,uuid)',original=await db.sql(`SELECT pg_get_functiondef(${lit(signature)}::regprocedure);`);
  await db.sql(original.replace('declare j public.whatsapp_inbound_jobs','declare j  public.whatsapp_inbound_jobs'));
  await expect(db.file(migration)).rejects.toThrow(/NOURA_WORKER_PREREQUISITE_MISMATCH/);await db.sql(original);
  await db.sql('GRANT EXECUTE ON FUNCTION public.whatsapp_reserve_job_usage(uuid,uuid) TO authenticated;');
  await expect(db.file(migration)).rejects.toThrow(/NOURA_WORKER_RPC_ACL_MISMATCH/);await db.sql('REVOKE EXECUTE ON FUNCTION public.whatsapp_reserve_job_usage(uuid,uuid) FROM authenticated;');
  await db.sql('ALTER TABLE private.billing_service_grants DISABLE TRIGGER service_grant_immutable;');
  await expect(db.file(migration)).rejects.toThrow(/NOURA_WORKER_IMMUTABLE_GUARD_MISSING/);await db.sql('ALTER TABLE private.billing_service_grants ENABLE TRIGGER service_grant_immutable;');
  await db.file('supabase/upgrade-packages/noura-worker-authority/preflight.readonly.sql');await db.file(migration);
 }
 const source=readFileSync('scripts/whatsapp-integration/staff-paid-entitlement.sql','utf8');
 const begin=source.indexOf('create function pg_temp.staff_paid_fixture('),end=source.indexOf('\nset local role service_role;',begin);
 let short=source.slice(begin,end).replace('create function pg_temp.staff_paid_fixture(','create function test_fixture.short_receipt(').replaceAll("30,'day',30","30,'month',1");
 short=short.replace('status,product_code,purchase_purpose,created_by,deadline_policy_approved)', 'status,product_code,purchase_purpose,created_by,deadline_policy_approved,created_at)').replace("'closed','velora_ai_staff','initial',(f->>'user')::uuid,true);","'locked','velora_ai_staff','initial',(f->>'user')::uuid,true,clock_timestamp());");
 short=short.replace('   insert into public.billing_payment_attempts',"   perform public.billing_snapshot_service_order(oid);update public.billing_orders set status='closed' where id=oid;\n   insert into public.billing_payment_attempts");
 short=short.replace('   if p_reversed then',"   perform public.billing_apply_service_grant(gid);\n   if p_reversed then");await db.sql(short);

});
afterAll(async()=>{if(db)await db.close();});
async function fixture({active=true,cap=2}={}){
 const f=parse(await srv(`SELECT test_fixture.company(true,${cap});`));
 f.application=await db.sql(`SELECT entitlement_application_id FROM private.billing_service_grants WHERE order_id IN(SELECT id FROM billing_orders WHERE company_id=${lit(f.company)});`);
 if(active)expect(parse(await srv(call('billing_activate_service_grant',`${lit(f.application)},true`)))).toMatchObject({ok:true});
 f.job=await srv(`SELECT test_fixture.job(${lit(JSON.stringify(f))}::jsonb);`);
 const r=parse(await srv(call('claim_whatsapp_inbound_job',`${lit(f.job)},120`)));expect(r.ok).toBe(true);f.claim=r.claim_token;
 f.question='Synthetic question';f.citations=[{sourceId:f.knowledge,title:'Synthetic knowledge',contentVersion:1}];
 return f;
}
const retrieve=f=>srv(call('whatsapp_retrieve_approved_knowledge',`${lit(f.company)},${lit(f.job)},${lit(f.claim)},${lit(f.question)}`)).then(parse);
it('denies approved knowledge to a paid job whose Noura service grant is inactive',async()=>{
 const f=await fixture({active:false});expect(await retrieve(f)).toMatchObject({ok:false});
 expect(await db.sql(`SELECT coalesce(usage_status,'none') FROM whatsapp_inbound_jobs WHERE id=${lit(f.job)};`)).toBe('none');
});

async function claimed(f){const next=randomUUID();await db.sql(`INSERT INTO whatsapp_conversations(id,company_id,phone_number_id,customer_wa_id,automation_allowed) SELECT ${lit(next)},company_id,phone_number_id,${lit('synthetic-recipient-'+randomUUID())},true FROM whatsapp_conversations WHERE id=${lit(f.conversation)};`);f.conversation=next;f.job=await srv(`SELECT test_fixture.job(${lit(JSON.stringify(f))}::jsonb);`);const c=parse(await srv(call('claim_whatsapp_inbound_job',`${lit(f.job)},120`)));expect(c.ok).toBe(true);f.claim=c.claim_token;f.question='Synthetic question';f.citations=[{sourceId:f.knowledge,title:'Synthetic knowledge',contentVersion:1}];return f;}
async function reserve(f,{id=randomUUID(),attempt=1,cost=1}={}){
 await srv(`SELECT test_fixture.ai_budget(${lit(f.company)},10);`);
 const r=parse(await srv(call('ai_reserve_whatsapp_capacity_cost_attempt',`${lit(id)},${lit(f.job)},${lit(f.claim)},${attempt},'gpt-6-luna','openai',${cost},'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}'::jsonb,${lit(JSON.stringify(f.citations))}::jsonb,'noura',${lit(f.plan_version)}`)));return {...r,attemptId:id};
}
const start=(f,id)=>srv(call('ai_start_whatsapp_attempt',`${lit(id)},${lit(f.claim)}`));
const settle=(f,id,status='success')=>srv(call('ai_settle_whatsapp_attempt',`${lit(id)},${lit(f.claim)},${lit(status)},${status==='rejected'?0:0.0026008},${status==='rejected'?0:1},${lit(status==='rejected'?'{}':'{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"cacheWriteTokens":3,"reasoningTokens":4,"totalTokens":30}')}::jsonb,'synthetic-request','synthetic-response','gpt-6-luna',${status==='success'?lit('Synthetic persisted answer'):'null'},${status==='rejected'?lit('KEY_MISSING'):'null'},12`));
const stage=(f,id)=>srv(call('whatsapp_stage_job_reply',`${lit(f.job)},${lit(f.claim)},${lit(id)},${lit(JSON.stringify(f.citations))}::jsonb`)).then(parse);
const claimSend=f=>srv(call('whatsapp_claim_assistant_job_send',`${lit(f.job)},${lit(f.claim)}`)).then(parse);
const deactivate=f=>srv(call('billing_activate_service_grant',`${lit(f.application)},false`));
async function draft(f){const r=await reserve(f);expect(r.ok).toBe(true);expect(await start(f,r.attemptId)).toBe('t');expect(await settle(f,r.attemptId)).toBe('t');return r.attemptId;}
async function none(f){expect(await db.sql(`SELECT coalesce(usage_status,'none') FROM whatsapp_inbound_jobs WHERE id=${lit(f.job)};`)).toBe('none');expect(await db.sql(`SELECT count(*) FROM ai_usage_ledger WHERE worker_job_id=${lit(f.job)};`)).toBe('0');}
it('binds one immutable exact receipt version paid period and existing allowance before knowledge',async()=>{
 const f=await fixture();expect(await retrieve(f)).toMatchObject({ok:true});const query=`SELECT noura_entitlement_id=${lit(f.application)}::uuid AND noura_subscription_id=${lit(f.subscription)}::uuid AND noura_plan_version_id=${lit(f.plan_version)}::uuid AND noura_paid_through=(SELECT paid_through FROM billing_subscriptions WHERE id=${lit(f.subscription)}) AND noura_allowance_cap=2 AND noura_allowance_period_start=private.wa_worker_month() FROM whatsapp_inbound_jobs WHERE id=${lit(f.job)}`;
 expect(await db.sql(query)).toBe('t');expect(await retrieve(f)).toMatchObject({ok:true});expect(await db.sql(query)).toBe('t');
 await expect(srv(`UPDATE whatsapp_inbound_jobs SET noura_allowance_cap=99 WHERE id=${lit(f.job)};`)).rejects.toThrow(/NOURA_BINDING_IMMUTABLE/);
});
it('denies inactive service frame capacity and direct paid reservation without creating holds',async()=>{
 const f=await fixture({active:false});for(const rpc of ['billing_load_worker_frame','whatsapp_reserve_job_usage'])expect(parse(await srv(call(rpc,`${lit(f.job)},${lit(f.claim)}`)))).toMatchObject({ok:false,code:'NOURA_SERVICE_NOT_ACTIVE'});expect(await reserve(f)).toMatchObject({ok:false,code:'NOURA_SERVICE_NOT_ACTIVE'});await none(f);
});
it('rejects foreign company and claim substitutions before any knowledge body',async()=>{
 const a=await fixture(),b=await fixture();expect(await retrieve({...a,company:b.company})).toMatchObject({ok:false});expect(await retrieve({...a,claim:b.claim})).toMatchObject({ok:false});await none(a);
});
it('rolls back new receipt provenance and capacity together when AI budget denies',async()=>{
 const f=await fixture();await srv(`SELECT test_fixture.ai_budget(${lit(f.company)},1);`);expect(await reserve(f,{cost:2})).toMatchObject({ok:false,code:'BUDGET_EXCEEDED'});await none(f);expect(await db.sql(`SELECT noura_entitlement_id IS NULL FROM whatsapp_inbound_jobs WHERE id=${lit(f.job)};`)).toBe('t');
});
it('one logical job keeps one capacity slot across explicitly rejected model fallback and duplicate reserve',async()=>{
 const f=await fixture({cap:1}),a=await reserve(f);expect(a.ok).toBe(true);expect(await start(f,a.attemptId)).toBe('t');expect(await settle(f,a.attemptId,'rejected')).toBe('t');const b=await reserve(f,{attempt:2});expect(b.ok).toBe(true);expect(await reserve(f,{id:b.attemptId,attempt:2})).toMatchObject({ok:false,code:'DUPLICATE_REQUEST'});expect(await db.sql(`SELECT count(*) FROM whatsapp_inbound_jobs WHERE company_id=${lit(f.company)} AND usage_status='reserved';`)).toBe('1');expect(await db.sql(`SELECT held_baisa=1 AND spent_baisa=0 FROM ai_budget_accounts WHERE company_id=${lit(f.company)};`)).toBe('t');
});
it.each(['model start','stage','send claim'])('revalidates activation at %s without losing actual cost or releasing an ambiguous attempt',async(boundary)=>{
 const f=await fixture();let id;
 if(boundary==='model start'){const r=await reserve(f);expect(r.ok).toBe(true);id=r.attemptId;}
 else{id=await draft(f);if(boundary==='send claim')expect(await stage(f,id)).toMatchObject({ok:true});}
 await deactivate(f);
 if(boundary==='model start')expect(await start(f,id)).toBe('f');else if(boundary==='stage')expect(await stage(f,id)).toMatchObject({ok:false});else expect(await claimSend(f)).toMatchObject({ok:false});
 expect(await db.sql(`SELECT usage_status FROM whatsapp_inbound_jobs WHERE id=${lit(f.job)};`)).toBe('reserved');expect(await db.sql(`SELECT status FROM ai_usage_ledger WHERE id=${lit(id)};`)).toBe(boundary==='model start'?'reserved':'success');
});
it('denies pending refund evidence before retrieval and model start',async()=>{
 const f=await fixture(),a=await reserve(f);expect(a.ok).toBe(true);
 await db.sql(`INSERT INTO billing_provider_events(payment_attempt_id,company_id,provider_account_ref,provider_environment,provider_transaction_id,event_status,observation_key,amount_baisa_expected,currency_expected,raw_summary) SELECT payment_attempt_id,company_id,provider_account_ref,provider_environment,provider_transaction_id,'refunded',${lit('refund_'+randomUUID())},amount_baisa_expected,currency_expected,raw_summary||'{"is_refunded":true}'::jsonb FROM billing_provider_events WHERE id=(SELECT provider_event_id FROM billing_entitlement_applications WHERE id=${lit(f.application)});`);
 expect(await retrieve(f)).toMatchObject({ok:false});expect(await start(f,a.attemptId)).toBe('f');expect(await db.sql(`SELECT status FROM ai_usage_ledger WHERE id=${lit(a.attemptId)};`)).toBe('reserved');
});
it('does not rebind an original job to a renewed paid period',async()=>{
 const f=await fixture();expect(await retrieve(f)).toMatchObject({ok:true});await db.sql(`UPDATE billing_subscriptions SET paid_through=paid_through+interval '1 day' WHERE id=${lit(f.subscription)};`);expect(await retrieve(f)).toMatchObject({ok:false});expect(await db.sql(`SELECT noura_entitlement_id=${lit(f.application)}::uuid FROM whatsapp_inbound_jobs WHERE id=${lit(f.job)};`)).toBe('t');
});
it('rejects allowance period rollover without changing the original job snapshot',async()=>{
 const f=await fixture();expect(await retrieve(f)).toMatchObject({ok:true});const original=await db.sql("SELECT pg_get_functiondef('private.wa_worker_month()'::regprocedure);");
 try{await db.sql("CREATE OR REPLACE FUNCTION private.wa_worker_month() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT date_trunc('month',clock_timestamp() at time zone 'Asia/Muscat') at time zone 'Asia/Muscat'+interval '1 month'$$;");expect(await retrieve(f)).toMatchObject({ok:false,code:'NOURA_JOB_AUTHORITY_CHANGED'});}finally{await db.sql(original);}
});
it('does not authorize a historical unbound already-reserved job',async()=>{
 const f=await fixture();await db.sql(`UPDATE whatsapp_inbound_jobs SET usage_status='reserved',usage_subscription_id=${lit(f.subscription)},usage_period_start=private.wa_worker_month() WHERE id=${lit(f.job)};`);expect(await retrieve(f)).toMatchObject({ok:false,code:'NOURA_LEGACY_JOB_REQUIRES_REVIEW'});expect(await db.sql(`SELECT noura_entitlement_id IS NULL FROM whatsapp_inbound_jobs WHERE id=${lit(f.job)};`)).toBe('t');
});
async function observe(name,predicate){for(let n=0;n<60;n++){const rows=JSON.parse(await db.sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'wait',wait_event,'type',wait_event_type)),'[]') FROM pg_stat_activity WHERE application_name=${lit(name)};`));if(rows.some(predicate))return rows.find(predicate);await new Promise(r=>setTimeout(r,50));}throw Error('NOURA_PG_BARRIER_NOT_OBSERVED');}
it('serializes competing final-slot reservations with one capacity and one cost hold',async()=>{
 const f=await fixture({cap:1}),other=await claimed({...f}),suffix=randomUUID().slice(0,8);await srv(`SELECT test_fixture.ai_budget(${lit(f.company)},10);`);
 const sql=x=>call('ai_reserve_whatsapp_capacity_cost_attempt',`${lit(randomUUID())},${lit(x.job)},${lit(x.claim)},1,'gpt-6-luna','openai',1,'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}'::jsonb,${lit(JSON.stringify(x.citations))}::jsonb,'noura',${lit(x.plan_version)}`);
 const a=db.session(`BEGIN;SELECT 1 FROM companies WHERE id=${lit(f.company)} FOR NO KEY UPDATE;SELECT pg_sleep(3);SET LOCAL ROLE service_role;${sql(f)}COMMIT;`,`noura_slot_a_${suffix}`);const blocker=await observe(`noura_slot_a_${suffix}`,r=>r.wait==='PgSleep');
 const b=db.session(`BEGIN;SET LOCAL ROLE service_role;${sql(other)}COMMIT;`,`noura_slot_b_${suffix}`);const waiter=await observe(`noura_slot_b_${suffix}`,r=>r.type==='Lock');expect(blocker.pid).not.toBe(waiter.pid);console.log('NOURA_SLOT_LOCK',JSON.stringify({blocker,waiter}));
 const results=await Promise.all([a.done,b.done]);expect(parse(results[0])).toMatchObject({ok:true});expect(parse(results[1])).toMatchObject({ok:false,code:'usage_limit_reached'});expect(await db.sql(`SELECT count(*) FROM ai_usage_ledger WHERE company_id=${lit(f.company)};`)).toBe('1');
});
it('rechecks deactivation committed during the company-lock wait',async()=>{
 const f=await fixture(),tag=randomUUID().slice(0,8);const blocker=db.session(`BEGIN;SELECT 1 FROM companies WHERE id=${lit(f.company)} FOR UPDATE;`,`noura_off_a_${tag}`,{keepOpen:true});await observe(`noura_off_a_${tag}`,x=>x.wait==='ClientRead');
 const waiter=db.session(`BEGIN;SET lock_timeout='25s';SET statement_timeout='30s';SET LOCAL ROLE service_role;${call('whatsapp_retrieve_approved_knowledge',`${lit(f.company)},${lit(f.job)},${lit(f.claim)},${lit(f.question)}`)}COMMIT;`,`noura_off_b_${tag}`);waiter.done.catch(()=>{});
 try{const waiting=await observe(`noura_off_b_${tag}`,x=>x.type==='Lock');console.log('NOURA_OFF_LOCK',JSON.stringify(waiting));blocker.child.stdin.end(`UPDATE private.billing_service_grants SET activated=false WHERE entitlement_application_id=${lit(f.application)};COMMIT;\n`);await blocker.done;expect(parse(await waiter.done)).toMatchObject({ok:false,code:'NOURA_SERVICE_NOT_ACTIVE'});await none(f);}finally{if(!blocker.child.stdin.destroyed)blocker.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([blocker.done,waiter.done]);}
});
it('takeover during the company wait blocks knowledge and keeps the original job',async()=>{
 const f=await fixture(),tag=randomUUID().slice(0,8);const blocker=db.session(`BEGIN;SELECT 1 FROM companies WHERE id=${lit(f.company)} FOR UPDATE;`,`noura_take_a_${tag}`,{keepOpen:true});await observe(`noura_take_a_${tag}`,x=>x.wait==='ClientRead');
 const waiter=db.session(`BEGIN;SET lock_timeout='25s';SET statement_timeout='30s';SET LOCAL ROLE service_role;${call('whatsapp_retrieve_approved_knowledge',`${lit(f.company)},${lit(f.job)},${lit(f.claim)},${lit(f.question)}`)}COMMIT;`,`noura_take_b_${tag}`);waiter.done.catch(()=>{});
 try{await observe(`noura_take_b_${tag}`,x=>x.type==='Lock');blocker.child.stdin.end(`SELECT set_config('velora.conversation_control','1',true);UPDATE whatsapp_conversations SET automation_allowed=false,automation_generation=automation_generation+1 WHERE id=${lit(f.conversation)};COMMIT;\n`);await blocker.done;expect(parse(await waiter.done)).toMatchObject({ok:false});await none(f);}finally{if(!blocker.child.stdin.destroyed)blocker.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([blocker.done,waiter.done]);}
});
it('a real short paid receipt expires while a blocked job waits without returning knowledge',async()=>{
 const f=parse(await srv("SELECT test_fixture.short_receipt('live',interval '20 seconds');"));f.application=f.grant;expect(parse(await srv(call('billing_activate_service_grant',`${lit(f.application)},true`)))).toMatchObject({ok:true});await claimed(f);
 const tag=randomUUID().slice(0,8),blocker=db.session(`BEGIN;SELECT 1 FROM companies WHERE id=${lit(f.company)} FOR UPDATE;`,`noura_exp_a_${tag}`,{keepOpen:true});await observe(`noura_exp_a_${tag}`,x=>x.wait==='ClientRead');const waiter=db.session(`BEGIN;SET lock_timeout='25s';SET statement_timeout='30s';SET LOCAL ROLE service_role;${call('whatsapp_retrieve_approved_knowledge',`${lit(f.company)},${lit(f.job)},${lit(f.claim)},${lit(f.question)}`)}COMMIT;`,`noura_exp_b_${tag}`);waiter.done.catch(()=>{});
 try{await observe(`noura_exp_b_${tag}`,x=>x.type==='Lock');expect(await db.sql(`SELECT clock_timestamp()<${lit(f.deadline)}::timestamptz;`)).toBe('t');await db.sql(`SET statement_timeout='25s';SELECT pg_sleep(greatest(0,extract(epoch FROM(${lit(f.deadline)}::timestamptz-clock_timestamp())))+0.1);`);blocker.child.stdin.end('COMMIT;\n');await blocker.done;expect(parse(await waiter.done)).toMatchObject({ok:false});await none(f);}finally{if(!blocker.child.stdin.destroyed)blocker.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([blocker.done,waiter.done]);}
});
it.each(['accepted','rejected','unknown'])('preserves the existing %s settlement and repeat-recovery semantics',async(outcome)=>{
 const f=await fixture(),id=await draft(f);expect(await stage(f,id)).toMatchObject({ok:true});const send=await claimSend(f);expect(send).toMatchObject({ok:true,claimed:true});const intent=send.intent.id,wamid=outcome==='accepted'?'wamid.synthetic.noura.'+randomUUID():null;
 expect(parse(await srv(call('finalize_whatsapp_send_attempt',`${lit(intent)},${lit(send.attempt_token)},${lit(outcome)},${wamid?lit(wamid):'null'},null,null`)))).toMatchObject({ok:true});
 const finish=()=>srv(call('billing_finalize_automated_usage',`${lit(f.company)},${lit(intent)}`)).then(parse);const status=outcome==='rejected'?'released':outcome;
 expect(await finish()).toMatchObject({ok:true,status});await deactivate(f);expect(await finish()).toMatchObject({ok:true,status,reused:true});expect(await db.sql(`SELECT usage_status FROM whatsapp_inbound_jobs WHERE id=${lit(f.job)};`)).toBe(status);expect(await db.sql(`SELECT spent_baisa=1 FROM ai_budget_accounts WHERE company_id=${lit(f.company)};`)).toBe('t');
});

it.each([null,0])('does not invent an allowance when the stored approved cap is %s',async(cap)=>{
 const f=await fixture({cap});expect(await retrieve(f)).toMatchObject({ok:false,code:'usage_not_configured'});expect(await reserve(f)).toMatchObject({ok:false,code:'usage_not_configured'});await none(f);
});
it('denies revoked financial receipts without changing the bound job or actual cost',async()=>{
 const f=await fixture(),a=await reserve(f);expect(a.ok).toBe(true);await db.sql(`UPDATE billing_entitlement_applications SET status='revoked' WHERE id=${lit(f.application)};`);expect(await retrieve(f)).toMatchObject({ok:false});expect(await start(f,a.attemptId)).toBe('f');expect(await db.sql(`SELECT noura_entitlement_id=${lit(f.application)}::uuid FROM whatsapp_inbound_jobs WHERE id=${lit(f.job)};`)).toBe('t');
});
it('keeps interrupted model work held for reconciliation and never allocates a second attempt',async()=>{
 const f=await fixture(),a=await reserve(f);expect(a.ok).toBe(true);expect(await start(f,a.attemptId)).toBe('t');expect(await reserve(f,{attempt:2})).toMatchObject({ok:false,code:'PRIOR_ATTEMPT_NOT_RETRYABLE'});expect(parse(await srv(call('whatsapp_retry_inbound_job',`${lit(f.job)},${lit(f.claim)},'synthetic_interrupted',true,false`)))).toMatchObject({ok:true,status:'review_required'});expect(await db.sql(`SELECT usage_status FROM whatsapp_inbound_jobs WHERE id=${lit(f.job)};`)).toBe('unknown');expect(await db.sql(`SELECT held_baisa=1 AND spent_baisa=0 FROM ai_budget_accounts WHERE company_id=${lit(f.company)};`)).toBe('t');
});

it.each(['knowledge','budget'])('rechecks paid expiry after the downstream %s lock wait and rolls back new work',async(boundary)=>{
 const f=parse(await srv("SELECT test_fixture.short_receipt('live',interval '20 seconds');"));f.application=f.grant;expect(parse(await srv(call('billing_activate_service_grant',`${lit(f.application)},true`)))).toMatchObject({ok:true});await claimed(f);await srv(`SELECT test_fixture.ai_budget(${lit(f.company)},10);`);
 const tag=randomUUID().slice(0,8),row=boundary==='knowledge'?`knowledge_sources WHERE id=${lit(f.knowledge)}`:`ai_budget_accounts WHERE company_id=${lit(f.company)}`;
 const blocker=db.session(`BEGIN;SELECT 1 FROM ${row} FOR UPDATE;`,`noura_late_a_${tag}`,{keepOpen:true});await observe(`noura_late_a_${tag}`,x=>x.wait==='ClientRead');
 const query=boundary==='knowledge'?call('whatsapp_retrieve_approved_knowledge',`${lit(f.company)},${lit(f.job)},${lit(f.claim)},${lit(f.question)}`):call('ai_reserve_whatsapp_capacity_cost_attempt',`${lit(randomUUID())},${lit(f.job)},${lit(f.claim)},1,'gpt-6-luna','openai',1,'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}'::jsonb,${lit(JSON.stringify(f.citations))}::jsonb,'noura',${lit(f.plan_version)}`);
 const waiter=db.session(`BEGIN;SET lock_timeout='25s';SET statement_timeout='30s';SET LOCAL ROLE service_role;${query}COMMIT;`,`noura_late_b_${tag}`);waiter.done.catch(()=>{});
 try{const blocked=await observe(`noura_late_b_${tag}`,x=>x.type==='Lock');expect(await db.sql(`SELECT clock_timestamp()<${lit(f.deadline)}::timestamptz;`)).toBe('t');console.log('NOURA_DOWNSTREAM_EXPIRY',JSON.stringify({boundary,blocked}));await db.sql(`SET statement_timeout='25s';SELECT pg_sleep(greatest(0,extract(epoch FROM(${lit(f.deadline)}::timestamptz-clock_timestamp())))+0.1);`);blocker.child.stdin.end('COMMIT;\n');await blocker.done;expect(parse(await waiter.done)).toMatchObject({ok:false});await none(f);expect(await db.sql(`SELECT held_baisa=0 AND spent_baisa=0 FROM ai_budget_accounts WHERE company_id=${lit(f.company)};`)).toBe('t');}
 finally{if(!blocker.child.stdin.destroyed)blocker.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([blocker.done,waiter.done]);}
});

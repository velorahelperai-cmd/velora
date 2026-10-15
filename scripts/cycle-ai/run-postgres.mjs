import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {verify,session} from "../instagram-connection/postgres.mjs";
const db=`cycle_credit_fixture_${randomBytes(6).toString("hex")}`;
const id=n=>`ac000000-0000-4000-8000-${String(n).padStart(12,"0")}`,cid=id(1),sub=id(2),receipt=id(3),pv=id(4),owner=id(5),sid=id(6);
const sql=async q=>{await verify();return session(q,{db}).done;};
const server=q=>sql(`set role service_role;set request.jwt.claims='{"role":"service_role"}';${q}`);
const rpc=(name,args)=>server(`select public.${name}(${args})`).then(JSON.parse);
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const ownerRead=()=>sql(`set role authenticated;set request.jwt.claims='{"role":"authenticated","sub":"${owner}","session_id":"${sid}"}';select public.master_read_ai_cycle('${cid}')`).then(JSON.parse);
async function native(file,name){const text=readFileSync(file,"utf8");const matcher=new RegExp(`create(?: or replace)? function ${name.replaceAll('.','\\.')}\\(`,"i");const start=matcher.exec(text)?.index;if(start===undefined)throw Error(`NATIVE_MISSING ${name}`);await sql(text.slice(start,text.indexOf('$$;',start)+3));}
async function setup(){await sql(`begin;insert into auth.users values('${owner}',null,null);insert into auth.sessions values('${sid}','${owner}',null);
 insert into public.companies values('${cid}','active','UTC');insert into public.company_members values('${cid}','${owner}','owner','active');
 insert into public.billing_plans values('${id(7)}','noor_basic'),('${id(8)}','noor_premium');
 insert into public.billing_plan_versions values('${pv}','${id(7)}','{"automated_outbound_per_month":500}','published',45000,'OMR'),('${id(9)}','${id(8)}','{"automated_outbound_per_month":1500}','published',90000,'OMR');
 insert into public.billing_orders values('${receipt}','${cid}','initial',45000,'OMR','${pv}');
 insert into public.billing_subscriptions values('${sub}','${cid}','live','active','${pv}',now()+interval '10 days');
 insert into public.billing_entitlement_applications values('${receipt}','${cid}','${sub}','${receipt}','${pv}','live',null,now()+interval '10 days',now()-interval '20 days');
 insert into private.billing_service_grants values('${receipt}','${receipt}',true);insert into private.billing_service_order_offers values('${receipt}','live','noura','basic',array['noura.knowledge.read'],'${pv}');
 insert into private.master_subscription_activation values('${receipt}','${cid}','${sub}','${pv}',now()-interval '20 days',now()+interval '17 days',now()+interval '10 days');
 insert into private.company_selected_channels values('${cid}','${pv}',array['whatsapp']);insert into private.plan_channel_entitlements values('${pv}',1);commit;`);}
async function job(n){const job=id(100+n),conv=id(200+n),message=id(300+n),claim=id(400+n);await sql(`insert into public.whatsapp_conversations values('${conv}','${cid}','open',true,1);
 insert into public.whatsapp_messages values('${message}','${cid}','${conv}','inbound','customer','in-${n}',null,null,now());
 insert into public.whatsapp_inbound_jobs(id,company_id,message_id,wa_message_id,status,claim_token,claim_expires_at,expected_automation_generation,created_at) values('${job}','${cid}','${message}','in-${n}','claimed','${claim}',now()+interval '5 minutes',1,now());`);return {job,conv,message,claim};}
await verify();await session(`create database ${db}`,{db:"postgres"}).done;
try{
 await sql(readFileSync("scripts/cycle-ai/dependencies.sql","utf8"));
 for(const fn of ['private.wa_worker_month','private.wa_worker_lock','public.whatsapp_reserve_job_usage','public.whatsapp_stage_job_reply','public.whatsapp_claim_assistant_job_send'])await native('supabase/migrations/20261008132000_vel_wa_worker_atomic_integration.sql',fn);
 await native('supabase/migrations/20261008133000_vel_ai_whatsapp_reservation_integration.sql','private.ai_lock_authorized_whatsapp_job');
 await native('supabase/migrations/20261010084102_noura_claimed_job_authority.sql','private.wa_noura_authority');
 await native('supabase/migrations/20261010084102_noura_claimed_job_authority.sql','private.wa_noura_binding_immutable');await sql('create trigger actual_noura_immutable before insert or update on public.whatsapp_inbound_jobs for each row execute function private.wa_noura_binding_immutable()');
 const activationSource=readFileSync('supabase/migrations/20261014033001_master_subscription_activation.sql','utf8');await sql(activationSource.slice(activationSource.indexOf('do $$declare f record;d text;before text;begin',activationSource.indexOf('-- Backing WhatsApp profile/cost/staff functions')),activationSource.indexOf('create or replace function public.billing_expiry_candidates')));
 await sql(`create or replace function private.whatsapp_answer_profile(p_job uuid,p_claim uuid) returns jsonb language plpgsql as $$begin return private.wa_noura_authority(p_job,p_claim);end;$$;`);
 for(const fn of ['private.wa_acceptance_lock','private.wa_accepted_receipt_guard','public.billing_finalize_automated_usage'])await native('supabase/migrations/20261011233153_wa_accepted_usage_compatibility.sql',fn);
 await sql('create trigger native_accepted_job_guard before insert or update on public.whatsapp_inbound_jobs for each row execute function private.wa_accepted_receipt_guard();create trigger native_accepted_intent_guard before insert or update on public.whatsapp_send_intents for each row execute function private.wa_accepted_receipt_guard();');
 await sql(readFileSync('supabase/migrations/20261014033004_master_cycle_ai_credits.sql','utf8'));await setup();
 await sql('update private.master_activation_policy set enabled=true');
 const captured=await rpc('master_capture_ai_cycle',`'${cid}','${receipt}'`);assert.equal(captured.ok,true,JSON.stringify(captured));checks++;
 const first=await job(1);const reserved=await rpc('whatsapp_reserve_job_usage',`'${first.job}','${first.claim}'`);assert.equal(reserved.ok,true,JSON.stringify(reserved));checks++;
 eq(await sql(`select usage_period_start=(select subscription_started_at from private.master_subscription_activation) from public.whatsapp_inbound_jobs where id='${first.job}'`),'t');
 const snapshot=await sql(`set role authenticated;set request.jwt.claims='{"role":"authenticated","sub":"${owner}","session_id":"${sid}"}';select public.master_read_ai_cycle('${cid}')`).then(JSON.parse);
 eq(snapshot.data.credits.base.held,1);eq(snapshot.data.totalRemaining,499);
 eq((await rpc('master_apply_ai_topup',`'${cid}','${receipt}'`)).code,'UNCONFIGURED');
 eq((await rpc('master_record_ai_cycle_evidence',`'${cid}','${receipt}','velora','missing-config','outage',array['whatsapp'],now()-interval '2 hours',now()-interval '1 hour'`)).code,'UNCONFIGURED');
 await sql(readFileSync('scripts/cycle-ai/native-reply-fixture.sql','utf8'));
 const modelGuard=await server(`select private.ai_lock_authorized_whatsapp_job('${first.job}','${first.claim}',1)`).then(JSON.parse);eq(modelGuard.ok,true);
 eq(await sql(`select expires_at=(select paid_through from public.billing_subscriptions)+interval '7 days' from private.master_ai_cycles`),'t');
 await assert.rejects(sql(`update public.whatsapp_inbound_jobs set noura_allowance_cap=1500 where id='${first.job}'`),/NOURA_BINDING_IMMUTABLE/);checks++;
 const unreserved=await sql(`begin;delete from private.master_ai_reply_slots where job_id='${first.job}';set role service_role;select private.ai_lock_authorized_whatsapp_job('${first.job}','${first.claim}',1);rollback;`).then(JSON.parse);eq(unreserved.code,'CYCLE_CREDIT_RESERVATION_REQUIRED');
 // Provider facts and model output below are explicit offline fixtures. They
 // pass the actual native receipt/proof/settlement functions; no provider runs.
 await server(`select private.fixture_cycle_reply(2,clock_timestamp()-interval '8 days',true)`);
 eq((await ownerRead()).data.credits.base.consumed,1);
 eq((await rpc('billing_finalize_automated_usage',`'${cid}','${id(502)}'`)).reused,true);
 eq((await ownerRead()).data.credits.base.consumed,1);
 await sql(`update public.whatsapp_inbound_jobs set usage_status='unknown' where id='${first.job}'`);
 eq((await rpc('whatsapp_reserve_job_usage',`'${first.job}','${first.claim}'`)).code,'usage_already_final_or_unknown');
 eq((await ownerRead()).data.credits.base.held,1);
 await sql(`update public.whatsapp_inbound_jobs set usage_status='released' where id='${first.job}'`);
 eq((await ownerRead()).data.totalRemaining,499);
 // Replay/conflicting source and foreign-workspace gates.
 await assert.rejects(sql(`set role authenticated;select public.master_apply_ai_topup('${cid}','${receipt}')`),/permission denied/);checks++;
 await assert.rejects(sql(`set role authenticated;set request.jwt.claims='{"sub":"${owner}","session_id":"${id(99)}"}';select public.master_read_ai_cycle('${cid}')`),/privilege|permission denied/);checks++;
 await sql(`update auth.users set banned_until=now()+interval '1 day' where id='${owner}'`);await assert.rejects(ownerRead(),/privilege|permission denied/);checks++;await sql(`update auth.users set banned_until=null where id='${owner}'`);
 eq((await rpc('master_reserve_instagram_ai_credit',`'${cid}','${first.job}','${first.claim}'`)).code,'INSTAGRAM_AI_UNCONFIGURED');
 // Concurrent last-unit claim serializes by native company/subscription locks.
 await server(`do $$begin for n in 3..500 loop perform private.fixture_cycle_reply(n,date_trunc('day',clock_timestamp()-interval '8 days')+interval '3 hours 30 minutes',false);end loop;end;$$`);
 const lastA=await job(501),lastB=await job(502);
 const last=await Promise.all([rpc('whatsapp_reserve_job_usage',`'${lastA.job}','${lastA.claim}'`),rpc('whatsapp_reserve_job_usage',`'${lastB.job}','${lastB.claim}'`)]);
 eq(last.filter(r=>r.ok).length,1);eq(last.filter(r=>r.code==='usage_limit_reached').length,1);
 eq((await ownerRead()).data.totalRemaining,0);
 await server(`do $$begin for n in 3..500 loop perform public.billing_finalize_automated_usage('${cid}',('ac000000-0000-4000-8000-'||lpad((500+n)::text,12,'0'))::uuid);end loop;end;$$`);
 // 499 accepted + the last held slot; one more accepted triggers 100% exactly once.
 const winner=last[0].ok?lastA:lastB;await server(`select private.fixture_cycle_reply(${winner===lastA?501:502},clock_timestamp(),true)`);
 eq(await sql(`select string_agg(threshold::text,',' order by threshold) from private.master_ai_usage_notices`),'80,100');
 eq((await ownerRead()).data.totalConsumed,500);
 await server(`select public.billing_finalize_automated_usage('${cid}','${id(500+(winner===lastA?501:502))}')`);eq(await sql('select count(*) from private.master_ai_usage_notices'),'2');
 // Disabled legal/source policy is not inferred from elapsed subscription time.
 await sql(`insert into private.master_ai_evidence_contracts values('velora','OFFLINE-COLLECTOR-DOUBLE',true);`);
 const evidence=(ref,kind,start,end,channels="array['whatsapp']")=>rpc('master_record_ai_cycle_evidence',`'${cid}','${receipt}','velora','${ref}','${kind}',${channels},${start},${end}`);
 eq((await evidence('partial','outage',"now()-interval '2 days'","now()-interval '2 days'+interval '1 hour'","array['instagram']")).code,'ALL_SELECTED_CHANNELS_REQUIRED');
 eq((await evidence('before-cycle','outage',"now()-interval '40 days'","now()-interval '39 days'")).code,'INVALID_EVIDENCE');
 // >7 actual healthy days, but missing the comparable 03:00-06:00 window.
 await server(`do $$declare r jsonb;begin for n in 7..19 loop r:=public.master_record_ai_cycle_evidence('${cid}','${receipt}','velora','healthy-'||n,'healthy',array['whatsapp'],date_trunc('day',now())-make_interval(days=>n)+interval '6 hours',date_trunc('day',now())-make_interval(days=>n-1)+interval '3 hours');if r->>'ok'<>'true' then raise exception 'FIXTURE_HEALTH_FAILED:%',r;end if;end loop;end;$$`);
 await sql(`update private.master_ai_credit_legal set compensation_expiry_reference='OFFLINE-LEGAL-DOUBLE';`);
 const missing=await evidence('missing-sample','outage',"date_trunc('day',now()-interval '2 days')+interval '3 hours'","date_trunc('day',now()-interval '2 days')+interval '5 hours'");
 eq((await rpc('master_assess_ai_compensation',`'${cid}','${missing.data.observationId}'`)).data.outcome,'INSUFFICIENT_COMPARABLE_HISTORY');
 eq((await evidence('actual-sample','healthy',"date_trunc('day',now()-interval '8 days')+interval '3 hours'","date_trunc('day',now()-interval '8 days')+interval '6 hours'")).ok,true);
 await sql(`update private.master_ai_credit_legal set compensation_expiry_reference=null;`);
 const outage=await evidence('outage','outage',"date_trunc('day',now()-interval '1 day')+interval '3 hours'","date_trunc('day',now()-interval '1 day')+interval '5 hours'");eq(outage.ok,true);
 eq((await rpc('master_assess_ai_compensation',`'${cid}','${outage.data.observationId}'`)).code,'LEGAL_REVIEW_REQUIRED');
 await sql(`update private.master_ai_credit_legal set compensation_expiry_reference='OFFLINE-LEGAL-DOUBLE';`);
 await sql(`update public.companies set timezone='NOT-A-TIMEZONE' where id='${cid}'`);eq((await rpc('master_assess_ai_compensation',`'${cid}','${outage.data.observationId}'`)).code,'COMPARISON_TIMEZONE_UNCONFIGURED');await sql(`update public.companies set timezone='UTC' where id='${cid}'`);
 const compensated=await rpc('master_assess_ai_compensation',`'${cid}','${outage.data.observationId}'`);eq(compensated.ok,true);eq(compensated.data.awardedUnits,50);
 eq((await rpc('master_assess_ai_compensation',`'${cid}','${outage.data.observationId}'`)).code,'REPLAY');eq((await ownerRead()).data.credits.compensation.remaining,50);
 eq((await evidence('overlap','outage',"date_trunc('day',now()-interval '1 day')+interval '4 hours'","date_trunc('day',now()-interval '1 day')+interval '6 hours'")).code,'EVIDENCE_OVERLAP_REVIEW_REQUIRED');
 const another=await evidence('outage-2','outage',"now()-interval '12 hours'","now()-interval '10 hours'");eq(another.ok,true);eq((await rpc('master_assess_ai_compensation',`'${cid}','${another.data.observationId}'`)).data.awardedUnits,0);eq((await ownerRead()).data.credits.compensation.granted,50);
 // Top-up fixtures use an explicit price/legal double and proven-finance port,
 // never a launch catalog seed. Missing native purpose cannot fabricate a grant.
 await sql(`insert into private.master_ai_topup_catalog values('OFFLINE-SKU',20,12345,'${id(9)}','OFFLINE-PRICE','OFFLINE-TERMS',true);
 begin;insert into public.billing_orders values('${id(50)}','${cid}','topup',12345,'OMR','${id(9)}');insert into public.billing_entitlement_applications values('${id(50)}','${cid}','${sub}','${id(50)}','${id(9)}','live',now()+interval '10 days',now()+interval '10 days',now());insert into private.master_ai_topup_contracts select '${id(50)}',id,'OFFLINE-SKU',expires_at,'${owner}',now()-interval '1 second','OFFLINE-TERMS' from private.master_ai_cycles;commit;`);
 eq((await rpc('master_apply_ai_topup',`'${cid}','${receipt}'`)).code,'TOPUP_PAYMENT_PROOF_REQUIRED');eq((await rpc('master_apply_ai_topup',`'${cid}','${id(50)}'`)).ok,true);eq((await rpc('master_apply_ai_topup',`'${cid}','${id(50)}'`)).code,'REPLAY');
 const paidNext=await job(503);eq((await rpc('whatsapp_reserve_job_usage',`'${paidNext.job}','${paidNext.claim}'`)).ok,true);eq(await sql(`select g.kind from private.master_ai_reply_slots s join private.master_ai_credit_grants g on g.id=s.grant_id where s.job_id='${paidNext.job}'`),'topup');
 await server(`do $$begin for n in 504..522 loop perform private.fixture_cycle_reply(n,clock_timestamp(),false);end loop;end;$$`);
 const freeNext=await job(523);eq((await rpc('whatsapp_reserve_job_usage',`'${freeNext.job}','${freeNext.claim}'`)).ok,true);eq(await sql(`select g.kind from private.master_ai_reply_slots s join private.master_ai_credit_grants g on g.id=s.grant_id where s.job_id='${freeNext.job}'`),'compensation');
 // Exact immutable upgrade mapping shape supplied by D; payment rows are
 // synthetic here. The separate native-financial integration suite covers D/E.
 await sql(`create table private.master_checkout_upgrades(order_id uuid,company_id uuid,subscription_id uuid,cycle_receipt_id uuid,prior_plan_version_id uuid,target_plan_version_id uuid,original_paid_through timestamptz,effective_expires_at timestamptz,subscription_started_at timestamptz);
 insert into public.billing_orders values('${id(51)}','${cid}','upgrade',45000,'OMR','${id(9)}');insert into public.billing_entitlement_applications select '${id(51)}','${cid}','${sub}','${id(51)}','${id(9)}','live',paid_through,paid_through,now() from public.billing_subscriptions;
 insert into private.master_checkout_upgrades select '${id(51)}',company_id,subscription_id,id,'${pv}','${id(9)}',(select paid_through from public.billing_subscriptions),expires_at,starts_at from private.master_ai_cycles;
 update public.billing_subscriptions set plan_version_id='${id(9)}';`);
 const end=await sql('select expires_at from private.master_ai_cycles');eq((await rpc('master_apply_cycle_upgrade',`'${cid}','${id(51)}'`)).ok,true);eq((await rpc('master_apply_cycle_upgrade',`'${cid}','${id(51)}'`)).code,'REPLAY');eq(await sql('select expires_at from private.master_ai_cycles'),end);
 const upgradeBalance=(await ownerRead()).data;eq(upgradeBalance.baseCap,1500);eq(upgradeBalance.credits.base.remaining,1500);eq(upgradeBalance.credits.topup.held,20);eq(upgradeBalance.credits.compensation.held,1);eq(upgradeBalance.credits.compensation.remaining,49);
 eq((await rpc('master_ai_cycle_costs',`'${cid}','${receipt}'`)).data.basis,'native_usage_tariff_estimate');
 eq(await sql(`select count(*) from private.master_ai_attempt_credit_binding`),'519');
 // A calendar-era reservation cannot be hidden by recapturing a paid cycle.
 await sql(`insert into public.whatsapp_inbound_jobs(id,company_id,usage_status,usage_subscription_id,created_at) values('${id(7777)}','${cid}','reserved','${sub}',now()-interval '2 days')`);
 eq((await rpc('master_capture_ai_cycle',`'${cid}','${receipt}'`)).code,'PAID_CYCLE_PROOF_REQUIRED');
 eq((await ownerRead()).code,'CYCLE_ACCOUNTING_REVIEW_REQUIRED');await sql(`delete from public.whatsapp_inbound_jobs where id='${id(7777)}'`);
 // Expiry is tested by the disposable fixture's clock projection only.
 await sql(`begin;update private.master_ai_cycles set expires_at=now()-interval '1 second';update private.master_subscription_activation set expires_at=now()-interval '1 second';update private.master_ai_credit_grants set expires_at=now()-interval '1 second';commit;`);
 const expired=(await ownerRead()).data;eq(expired.active,false);eq(expired.totalRemaining,0);eq(expired.credits.base.expired,1500);eq(expired.credits.compensation.expired,49);
 console.log(`Cycle credits: ${checks} actual local PostgreSQL assertions passed; external financial/activation ports are synthetic; no provider calls.`);
}finally{await session(`drop database ${db} with(force)`,{db:"postgres"}).done;}

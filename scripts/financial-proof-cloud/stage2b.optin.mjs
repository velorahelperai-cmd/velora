import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isolatedPostgres, lit } from '../g03-review-acceptance/postgres.mjs';
import { evidence } from '../service-entitlement/evidence.mjs';
import {readFileSync} from 'node:fs';
import {stage2Baseline,directory,captureBaseline,functionQuery} from './stage2b-fixture-replay.mjs';
const state=vi.hoisted(()=>({client:null,adminClient:null}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>state.client}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>state.adminClient}));
import * as catalogActions from '@/lib/billing/catalog-backend/actions';
import { createAtomicPurchasePersistRpc } from '@/lib/billing/wiring/purchase-persist-rpc';
import { settleHmacVerifiedViaRpc } from '@/lib/billing/wiring/store';
let db,legacy,legacyBefore;
const legacySnapshot=()=>db.sql('SELECT to_jsonb(g) FROM public.billing_entitlement_applications g WHERE id='+lit(legacy.grant));
let owner, ownerSession;
const migration=directory+'10-stage2b.review.sql';
const install=()=>db.sql('SET ROLE postgres;'+readFileSync(migration,'utf8'));
const parse=out=>JSON.parse(out.split('\n').find(line=>line.startsWith('{')));
const srv=query=>db.sql(`BEGIN;SET LOCAL ROLE service_role;${query}COMMIT;`);
const call=(name,args)=>`SELECT public.${name}(${args});`;
async function fixture({environment='test',bound=true,code='noor_basic',tier='basic',publish=true}={}) {
 const f={actor:randomUUID(),session:randomUUID(),company:randomUUID(),version:randomUUID(),environment,reference:`synthetic_${randomUUID()}`};
 await db.sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${lit(f.actor)},'synthetic@example.invalid',now());INSERT INTO auth.sessions(id,user_id) VALUES(${lit(f.session)},${lit(f.actor)});INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(f.session)},${lit(f.actor)},clock_timestamp());
 INSERT INTO companies(id,display_name,status,created_by) VALUES(${lit(f.company)},'Synthetic purchase','active',${lit(f.actor)});INSERT INTO company_members(company_id,user_id,role,status) VALUES(${lit(f.company)},${lit(f.actor)},'owner','active');
 INSERT INTO billing_plans(code,name,status) VALUES(${lit(code)},'Synthetic explicit offer','active') ON CONFLICT(code) DO NOTHING;
 INSERT INTO billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status,limits) SELECT ${lit(f.version)},p.id,(SELECT coalesce(max(version),0)+1 FROM billing_plan_versions WHERE plan_id=p.id),5000,'OMR',30,'month',1,'draft','{"automated_outbound_per_month":1000,"feature_availability":{"knowledge":"target"}}'::jsonb FROM billing_plans p WHERE code=${lit(code)};`);
 if(bound) expect(parse(await srv(call('billing_define_service_offer',`${lit(f.version)},'noura',${lit(tier)},ARRAY['noura.knowledge.read']`)))).toMatchObject({ok:true});
 if(publish) await db.sql(`UPDATE billing_plan_versions SET status='retired' WHERE plan_id=(SELECT plan_id FROM billing_plan_versions WHERE id=${lit(f.version)}) AND status='published';UPDATE billing_plan_versions SET status='published' WHERE id=${lit(f.version)};`);
 f.input={p_company_id:f.company,p_product_code:'velora_ai_staff',p_purchase_purpose:'initial',p_plan_version_id:f.version,p_requested_plan_id:null,p_client_op_id:randomUUID(),p_input_fingerprint:randomUUID(),p_special_reference:f.reference,p_amount_baisa:5000,p_currency:'OMR',p_period_days:30,p_period_unit:'month',p_period_count:1,p_provider_account_ref:'74001',p_provider_environment:environment,p_created_by:f.actor};return f;
}
async function purchase(f,input=f.input){
 const sql=input.p_provider_environment==='test'?call('billing_create_test_checkout_order',`${lit(JSON.stringify(input))}::jsonb,1000`):call('billing_create_or_reuse_subscription_order',Object.values(input).map(v=>v===null?'null':lit(v)).join(','));
 const result=parse(await srv(sql));
 if(result.ok){f.order=result.order_id;f.attempt=result.payment_attempt_id;}return result;
}
beforeAll(async()=>{
 db=await isolatedPostgres();legacy=await stage2Baseline(db);legacyBefore=await legacySnapshot();
 const signature="public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)";
 const original=await db.sql(`SELECT pg_get_functiondef(${lit(signature)}::regprocedure);`);
 await db.sql(original.replace('v_now timestamptz','v_now  timestamptz'));
 await expect(install()).rejects.toThrow(/STAGE2B_CATALOG_PREREQUISITE_MISMATCH/);
 expect(await db.sql("SELECT to_regprocedure('public.billing_bind_noura_basic_draft(uuid,bigint)') IS NULL;")).toBe('t');
 await db.sql(original);
 await db.sql(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`);
 await expect(install()).rejects.toThrow(/STAGE2B_CATALOG_PREREQUISITE_MISMATCH/);
 await db.sql(`REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated;`);
 const receiptView=await db.sql("SELECT pg_get_viewdef('private.billing_proven_entitlement_grants'::regclass,true);");
 const weakenedView=receiptView.replace(/h.status\s*=\s*'active'::text/,'true');expect(weakenedView).not.toBe(receiptView);
 await db.sql(`CREATE OR REPLACE VIEW private.billing_proven_entitlement_grants AS ${weakenedView}`);
 await expect(install()).rejects.toThrow(/STAGE2B_PROOF_VIEWS_MISMATCH/);
 await db.sql(`CREATE OR REPLACE VIEW private.billing_proven_entitlement_grants AS ${receiptView}`);
 await db.sql('ALTER TABLE billing_provider_events DISABLE TRIGGER billing_provider_receipt_immutability;');
 await expect(install()).rejects.toThrow(/STAGE2B_CATALOG_PREREQUISITE_MISMATCH/);
 await db.sql('ALTER TABLE billing_provider_events ENABLE TRIGGER billing_provider_receipt_immutability;');
 const read=JSON.parse(await db.file(directory+'preflight.readonly.sql'));
 const pinned=JSON.parse(readFileSync(directory+'manifest.json','utf8'));
 expect(read.functions).toEqual(pinned.baseline_functions);expect(read.service_relations).toEqual(pinned.service_relations);expect(read.auth_namespace).toEqual(pinned.auth_namespace);
 await db.sql('ALTER FUNCTION public.billing_cancel_at_period_end(uuid) OWNER TO supabase_admin;');
 await expect(install()).rejects.toThrow(/STAGE2B_CATALOG_PREREQUISITE_MISMATCH/);
 await db.sql('ALTER FUNCTION public.billing_cancel_at_period_end(uuid) OWNER TO postgres;');
 await db.sql("ALTER FUNCTION public.has_company_capability(uuid,text) SET search_path=public;");
 await expect(install()).rejects.toThrow(/STAGE2B_CATALOG_PREREQUISITE_MISMATCH/);
 await db.sql("ALTER FUNCTION public.has_company_capability(uuid,text) SET search_path='';");
 await db.sql('GRANT CREATE ON SCHEMA auth TO authenticated;');
 await expect(install()).rejects.toThrow(/STAGE2B_AUTH_NAMESPACE_MISMATCH/);
 await db.sql('REVOKE CREATE ON SCHEMA auth FROM authenticated;');
 const baseline=await captureBaseline(db);
 const interrupted=readFileSync(migration,'utf8').replace(/commit;\s*$/i,"DO $stop$ BEGIN RAISE EXCEPTION 'SYNTHETIC_STAGE2B_INTERRUPTION';END;$stop$;COMMIT;");
 await expect(db.sql('SET ROLE postgres;'+interrupted)).rejects.toThrow(/SYNTHETIC_STAGE2B_INTERRUPTION/);
 expect(await captureBaseline(db)).toEqual(baseline);expect(await db.sql("SELECT to_regclass('private.billing_service_offers') IS NULL")).toBe('t');
 const blocker=db.session('BEGIN;LOCK public.billing_payment_attempts IN ROW EXCLUSIVE MODE;SELECT \'stage2b-lock-ready\';','stage2b_install_block',{keepOpen:true});
 try {for(let n=0;n<60&&!blocker.output().includes('stage2b-lock-ready');n++)await new Promise(r=>setTimeout(r,50));expect(blocker.output()).toContain('stage2b-lock-ready');await expect(install()).rejects.toThrow(/lock timeout/);}
 finally{blocker.child.stdin.end('ROLLBACK;\n');await blocker.done;}
 expect(await captureBaseline(db)).toEqual(baseline);
 await install();
 expect(await legacySnapshot()).toBe(legacyBefore);
 owner=await db.sql("SELECT md5('g03-synthetic-platform-owner')::uuid;");ownerSession=randomUUID();
 await db.sql(`INSERT INTO auth.sessions(id,user_id) VALUES(${lit(ownerSession)},${lit(owner)});INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(ownerSession)},${lit(owner)},clock_timestamp());`);

});
afterAll(async()=>{if(db)await db.close();});
it('snapshots the explicit service offer before creating the actual checkout attempt',async()=>{
 const f=await fixture();expect(await purchase(f)).toMatchObject({ok:true});
 expect(await db.sql(`SELECT count(*) FROM private.billing_service_order_offers s JOIN billing_payment_attempts a ON a.order_id=s.order_id WHERE s.order_id=${lit(f.order)} AND s.service_code='noura' AND s.tier='basic' AND s.environment='test';`)).toBe('1');
});

const authenticated=(actor,session,query)=>db.sql(`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL "request.jwt.claim.sub"=${lit(actor)};SET LOCAL "request.jwt.claims"=${lit(JSON.stringify({sub:actor,session_id:session,role:'authenticated'}))};${query}COMMIT;`);
async function bind(f,revision){return parse(await authenticated(owner,ownerSession,call('billing_bind_noura_basic_draft',`${lit(f.version)},${revision}`)));}
async function revision(){return Number(await db.sql('SELECT revision FROM billing_catalog_revision WHERE singleton;'));}
async function stored(f,{tx=f.tx??randomUUID(),status='success',flags={}}={}){
 f.providerOrder??=String(BigInt('0x'+randomUUID().replaceAll('-','').slice(0,12)));
 await db.sql(`UPDATE billing_payment_attempts SET provider_order_id=${lit(f.providerOrder)},status='provider_submitted' WHERE id=${lit(f.attempt)} AND provider_order_id IS NULL;`);
 const e=evidence(f,tx);e.event_status=status;e.raw={...e.raw,...flags};f.tx=tx;const payload={...e};delete payload.raw;
 await db.sql(`INSERT INTO billing_provider_events(payment_attempt_id,company_id,provider,provider_account_ref,provider_environment,provider_transaction_id,event_status,observation_key,amount_baisa_expected,currency_expected,raw_summary) VALUES(${lit(f.attempt)},${lit(f.company)},'paymob','74001',${lit(f.environment)},${lit(tx)},${lit(status)},${lit(e.observation_key)},5000,'OMR',${lit(JSON.stringify(e.raw))}::jsonb);`);
 return payload;
}
const settle=e=>srv(call('billing_settle_paymob_hmac_verified',`${lit(JSON.stringify(e))}::jsonb`)).then(parse);
const counts=f=>db.sql(`SELECT (SELECT count(*) FROM billing_entitlement_applications WHERE order_id=${lit(f.order)})||'|'||(SELECT count(*) FROM private.billing_service_grants WHERE order_id=${lit(f.order)})||'|'||(SELECT count(*) FROM billing_settlement_outcomes WHERE order_id=${lit(f.order)})||'|'||(SELECT count(*) FROM billing_subscriptions WHERE company_id=${lit(f.company)} AND environment=${lit(f.environment)});`);
it('binds only an explicit draft Basic version through actual owner session/revision and server action',async()=>{
 const f=await fixture({bound:false,publish:false});const r=await revision();
 state.client={rpc:async(name,args)=>{try{return {data:parse(await authenticated(owner,ownerSession,call(name,`${lit(args.p_plan_version_id)},${args.p_expected_revision}`))),error:null};}catch{return {data:null,error:{code:'SQL_FAILED'}};}}};
 expect(await catalogActions.bindNouraBasicDraftAction(f.version,r)).toMatchObject({ok:true,data:{version_id:f.version,revision:r+1}});
 expect(await db.sql(`SELECT service_code||'|'||tier||'|'||array_to_string(capabilities,',') FROM private.billing_service_offers WHERE plan_version_id=${lit(f.version)};`)).toBe('noura|basic|noura.knowledge.read');
 expect(await bind(f,r)).toEqual({ok:false,code:'conflict'});
 expect(await bind(f,r+1)).toMatchObject({ok:true,data:{version_id:f.version,revision:r+1}});
 await db.sql(`UPDATE billing_plan_versions SET status='retired' WHERE status='published' AND plan_id=(SELECT plan_id FROM billing_plan_versions WHERE id=${lit(f.version)});UPDATE billing_plan_versions SET status='published' WHERE id=${lit(f.version)};`);
 expect(await bind(f,r+1)).toEqual({ok:false,code:'immutable'});
});
it('denies client roles, outsiders, expired direct owner sessions and unsupported draft variants',async()=>{
 const f=await fixture({bound:false,publish:false}),r=await revision();
 for(const role of ['anon','service_role']) await expect(db.sql(`BEGIN;SET LOCAL ROLE ${role};${call('billing_bind_noura_basic_draft',`${lit(f.version)},${r}`)}COMMIT;`)).rejects.toThrow(/permission denied/);
 expect(parse(await authenticated(f.actor,f.session,call('billing_bind_noura_basic_draft',`${lit(f.version)},${r}`)))).toEqual({ok:false,code:'forbidden'});
 await db.sql(`UPDATE private.app_session_settings SET enabled=false;UPDATE private.app_session_activity SET last_activity_at=clock_timestamp()-interval '3 hours' WHERE session_id=${lit(ownerSession)};`);
 expect(await bind(f,r)).toEqual({ok:false,code:'forbidden'});
 await db.sql(`UPDATE private.app_session_activity SET last_activity_at=clock_timestamp(),expired_at=null WHERE session_id=${lit(ownerSession)};UPDATE private.app_session_settings SET enabled=true;`);
 for(const code of ['noor_premium','lina_basic','dana_basic']){const x=await fixture({bound:false,publish:false,code});expect(await bind(x,r)).toEqual({ok:false,code:'invalid_input'});}
});
it('observes snapshot presence at the actual BEFORE-attempt INSERT boundary',async()=>{
 await db.sql(`CREATE FUNCTION private.test_snapshot_ordering() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $t$ BEGIN IF EXISTS(SELECT 1 FROM private.billing_service_offers f JOIN public.billing_orders o ON o.plan_version_id=f.plan_version_id WHERE o.id=NEW.order_id) AND NOT EXISTS(SELECT 1 FROM private.billing_service_order_offers WHERE order_id=NEW.order_id) THEN RAISE EXCEPTION 'TEST_SNAPSHOT_NOT_BEFORE_ATTEMPT';END IF;RETURN NEW;END;$t$;CREATE TRIGGER test_snapshot_ordering BEFORE INSERT ON billing_payment_attempts FOR EACH ROW EXECUTE FUNCTION private.test_snapshot_ordering();`);
 try{const f=await fixture();expect(await purchase(f)).toMatchObject({ok:true});}finally{await db.sql('DROP TRIGGER test_snapshot_ordering ON billing_payment_attempts;DROP FUNCTION private.test_snapshot_ordering();');}
});
it('does not let forged actor/tenant, wrong product or unsupported bound tier create durable orders',async()=>{
 const f=await fixture(),outsider=await fixture({bound:false,code:'legacy_outsider_'+randomUUID()});
 for(const input of [{...f.input,p_created_by:outsider.actor},{...f.input,p_company_id:outsider.company},{...f.input,p_product_code:'invented_product'}])await expect(purchase(f,input)).rejects.toThrow(/SERVICE_PURCHASE_/);
 expect(await db.sql(`SELECT count(*) FROM billing_orders WHERE plan_version_id=${lit(f.version)};`)).toBe('0');
 await purchase(f);await expect(purchase(f,{...f.input,p_created_by:outsider.actor})).rejects.toThrow(/SERVICE_PURCHASE_ACTOR_FORBIDDEN/);
 const x=await fixture({code:'noor_premium',tier:'premium'});await expect(purchase(x)).rejects.toThrow(/SERVICE_PURCHASE_UNSUPPORTED/);
});
it('rolls back order, snapshot and attempt together when snapshot insertion fails',async()=>{
 const f=await fixture();await db.sql(`CREATE FUNCTION private.test_snapshot_fail() RETURNS trigger LANGUAGE plpgsql AS $t$ BEGIN RAISE EXCEPTION 'TEST_SNAPSHOT_FAILURE';END;$t$;CREATE TRIGGER test_snapshot_fail BEFORE INSERT ON private.billing_service_order_offers FOR EACH ROW EXECUTE FUNCTION private.test_snapshot_fail();`);
 try{await expect(purchase(f)).rejects.toThrow(/TEST_SNAPSHOT_FAILURE/);}finally{await db.sql('DROP TRIGGER test_snapshot_fail ON private.billing_service_order_offers;DROP FUNCTION private.test_snapshot_fail();');}
 expect(await db.sql(`SELECT count(*) FROM billing_orders WHERE company_id=${lit(f.company)};`)).toBe('0');
});
it('atomically settles proven payment and grants the bound service inactive',async()=>{
 const f=await fixture();await purchase(f);const e=await stored(f);const result=await settle(e);expect(result).toMatchObject({ok:true,outcome:'granted'});expect(await counts(f)).toBe('1|1|1|1');
 expect(await db.sql(`SELECT activated FROM private.billing_service_grants WHERE order_id=${lit(f.order)};`)).toBe('f');
 expect(await settle(e)).toMatchObject({ok:true,outcome:'idempotent_replay',entitlement_application_id:result.entitlement_application_id});expect(await counts(f)).toBe('1|1|1|1');
 expect(await db.sql(`SELECT activated FROM private.billing_service_grants WHERE order_id=${lit(f.order)};`)).toBe('f');
});
it('rolls back payment receipt, subscription, attempt and order lifecycle when service grant fails',async()=>{
 const f=await fixture();await purchase(f);const e=await stored(f);
 await db.sql(`CREATE FUNCTION private.test_grant_fail() RETURNS trigger LANGUAGE plpgsql AS $t$ BEGIN RAISE EXCEPTION 'TEST_GRANT_FAILURE';END;$t$;CREATE TRIGGER test_grant_fail BEFORE INSERT ON private.billing_service_grants FOR EACH ROW EXECUTE FUNCTION private.test_grant_fail();`);
 try{await expect(settle(e)).rejects.toThrow(/TEST_GRANT_FAILURE/);}finally{await db.sql('DROP TRIGGER test_grant_fail ON private.billing_service_grants;DROP FUNCTION private.test_grant_fail();');}
 expect(await counts(f)).toBe('0|0|0|0');expect(await db.sql(`SELECT status FROM billing_orders WHERE id=${lit(f.order)};`)).toBe('locked');expect(await db.sql(`SELECT status FROM billing_payment_attempts WHERE id=${lit(f.attempt)};`)).toBe('provider_submitted');
 expect(await db.sql(`SELECT count(*) FROM billing_provider_events WHERE payment_attempt_id=${lit(f.attempt)};`)).toBe('1');
 expect(await settle(e)).toMatchObject({ok:true,outcome:'granted'});expect(await counts(f)).toBe('1|1|1|1');
});
it('denies forged stored evidence, tenant/environment and client settlement calls without partial grants',async()=>{
 const f=await fixture();await purchase(f);const e=await stored(f);
 for(const forged of [{...e,company_id:randomUUID()},{...e,provider_environment:'live'},{...e,amount_baisa:6000},{...e,evidence_marker:'VEL_BILLING_SYNTHETIC_TEST_EVIDENCE'},{...e,signature_verified:true}]) expect(await settle(forged)).toMatchObject({ok:false,code:'INVALID_STORED_EVIDENCE'});
 for(const role of ['anon','authenticated'])await expect(db.sql(`BEGIN;SET LOCAL ROLE ${role};${call('billing_settle_paymob_hmac_verified',`${lit(JSON.stringify(e))}::jsonb`)}COMMIT;`)).rejects.toThrow(/permission denied/);
 await expect(srv("SELECT private.billing_settle_paymob_hmac_verified_pre_service('{}'::jsonb);")).rejects.toThrow(/permission denied/);
 expect(await counts(f)).toBe('0|0|0|0');
});
it('preserves unbound legacy outcomes and does not add service grants on replay or duplicate collection',async()=>{
 const f=await fixture({bound:false,code:'legacy_'+randomUUID()});await purchase(f);const e=await stored(f);
 expect(await settle(e)).toMatchObject({ok:true,outcome:'granted'});expect(await counts(f)).toBe('1|0|1|1');expect(await settle(e)).toMatchObject({ok:true,outcome:'idempotent_replay'});
 const duplicate=await stored(f,{tx:randomUUID()});expect(await settle(duplicate)).toMatchObject({ok:true,outcome:'duplicate_collection_review'});expect(await db.sql(`SELECT count(*) FROM private.billing_service_grants WHERE order_id=${lit(f.order)};`)).toBe('0');
});
it('retains signed refund/void evidence, denies stale success and never reactivates or deletes the grant',async()=>{
 for(const status of ['refunded','voided']){const f=await fixture();await purchase(f);const success=await stored(f);expect(await settle(success)).toMatchObject({outcome:'granted'});
 const reversal=await stored(f,{status,flags:{[status==='refunded'?'is_refunded':'is_voided']:true}});expect(await settle(reversal)).toMatchObject({ok:true,outcome:'lifecycle_review',entitlement_changed:false});expect(await settle(success)).toMatchObject({ok:true,outcome:'lifecycle_review'});
 expect(await db.sql(`SELECT activated FROM private.billing_service_grants WHERE order_id=${lit(f.order)};`)).toBe('f');expect(await db.sql(`SELECT count(*) FROM private.billing_lifecycle_reviews WHERE order_id=${lit(f.order)};`)).toBe('1');}
});
it('keeps Test separate from Live and preserves paid period cancellation without activation',async()=>{
 const f=await fixture();await purchase(f);const e=await stored(f);await settle(e);
 expect(await db.sql(`SELECT count(*) FROM billing_subscriptions WHERE company_id=${lit(f.company)} AND environment='live';`)).toBe('0');
 expect(parse(await authenticated(f.actor,f.session,call('billing_cancel_at_period_end',lit(f.company))))).toMatchObject({ok:false});
 await expect(srv(call('billing_create_test_checkout_order',`${lit(JSON.stringify({...f.input,p_provider_environment:'live'}))}::jsonb,1000`))).rejects.toThrow(/test only/);
});
async function activity(name,predicate){for(let n=0;n<60;n++){const r=JSON.parse(await db.sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'wait',wait_event,'type',wait_event_type)),'[]') FROM pg_stat_activity WHERE application_name=${lit(name)};`));if(r.some(predicate))return r[0];await new Promise(r=>setTimeout(r,50));}throw Error('PG_BARRIER_NOT_OBSERVED');}
it('serializes concurrent verified settlement with one payment and inactive service grant',async()=>{
 const f=await fixture();await purchase(f);const e=await stored(f),suffix=randomUUID().slice(0,8),aName=`purchase_a_${suffix}`,bName=`purchase_b_${suffix}`,sql=call('billing_settle_paymob_hmac_verified',`${lit(JSON.stringify(e))}::jsonb`);
 const a=db.session(`BEGIN;SELECT 1 FROM companies WHERE id=${lit(f.company)} FOR UPDATE;SELECT 'company-lock-ready';`,aName,{keepOpen:true});
 let b;
 try{
  for(let n=0;n<60&&!a.output().includes('company-lock-ready');n++)await new Promise(r=>setTimeout(r,50));expect(a.output()).toContain('company-lock-ready');
  const blocker=await activity(aName,r=>r.wait==='ClientRead');
  // Bounded test-session deadlines tolerate slow disposable-host planning; package lock_timeout remains 2s.
  b=db.session(`BEGIN;SET LOCAL lock_timeout='25s';SET LOCAL statement_timeout='45s';SET LOCAL ROLE service_role;${sql}COMMIT;`,bName);
  const waiter=await activity(bName,r=>r.type==='Lock');expect(blocker.pid).not.toBe(waiter.pid);console.log('PG_ORCHESTRATION_LOCK_EVIDENCE',JSON.stringify({blocker,waiter}));
  a.child.stdin.end(`SET LOCAL statement_timeout='45s';SET LOCAL ROLE service_role;${sql}COMMIT;\n`);
  const done=await Promise.all([a.done,b.done]);expect(parse(done[0])).toMatchObject({outcome:'granted'});expect(parse(done[1])).toMatchObject({outcome:'idempotent_replay'});expect(await counts(f)).toBe('1|1|1|1');
 }finally{if(!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([a.done,...(b?[b.done]:[])]);}

});

it('does not backfill an originally missing service grant on historical payment replay',async()=>{
 const f=await fixture();await purchase(f);const e=await stored(f);
 // Original financial settlement in a local-owner fixture represents historical
 // missing orchestration. No receipts or service history are edited/deleted.
 const result=parse(await db.sql(`SELECT private.billing_settle_paymob_hmac_verified_pre_service(${lit(JSON.stringify(e))}::jsonb);`));expect(result).toMatchObject({outcome:'granted'});expect(await counts(f)).toBe('1|0|1|1');
 await expect(settle(e)).rejects.toThrow(/SERVICE_GRANT_REPLAY_REQUIRES_REVIEW/);expect(await counts(f)).toBe('1|0|1|1');
});

it('preserves actual paid Live cancellation and keeps both environments and grants inactive',async()=>{
 const f=await fixture({environment:'live'});f.order=randomUUID();f.attempt=randomUUID();f.providerOrder=String(BigInt('0x'+randomUUID().replaceAll('-','').slice(0,12)));
 // INSERT-only local financial fixture, not a Live checkout or provider call.
 await db.sql(`INSERT INTO billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,provider,provider_account_ref,provider_environment,provider_amount,provider_amount_unit,special_reference,client_op_id,input_fingerprint,status,product_code,purchase_purpose,created_by,expires_at,deadline_policy_approved) VALUES(${lit(f.order)},${lit(f.company)},${lit(f.version)},5000,'OMR',30,'month',1,'paymob','74001','live',5000,'paymob_amount',${lit(f.reference)},${lit(randomUUID())},${lit(randomUUID())},'locked','velora_ai_staff','initial',${lit(f.actor)},clock_timestamp()+interval '2 hours',true);`);
 expect(parse(await srv(call('billing_snapshot_service_order',lit(f.order))))).toMatchObject({ok:true});
 await db.sql(`INSERT INTO billing_payment_attempts(id,order_id,company_id,status,provider_order_id) VALUES(${lit(f.attempt)},${lit(f.order)},${lit(f.company)},'provider_submitted',${lit(f.providerOrder)});`);
 const e=await stored(f);expect(await settle(e)).toMatchObject({outcome:'granted'});const paid=await db.sql(`SELECT paid_through FROM billing_subscriptions WHERE company_id=${lit(f.company)} AND environment='live';`);
 expect(parse(await authenticated(f.actor,f.session,call('billing_cancel_at_period_end',lit(f.company))))).toMatchObject({ok:true,data:{cancel_at_period_end:true}});
 expect(await db.sql(`SELECT paid_through FROM billing_subscriptions WHERE company_id=${lit(f.company)} AND environment='live';`)).toBe(paid);expect(await db.sql(`SELECT status FROM billing_subscriptions WHERE company_id=${lit(f.company)} AND environment='live';`)).toBe('cancel_at_period_end');
 expect(await settle(e)).toMatchObject({outcome:'idempotent_replay'});expect(await db.sql(`SELECT activated FROM private.billing_service_grants WHERE order_id=${lit(f.order)};`)).toBe('f');
 expect(await db.sql(`SELECT count(*) FROM billing_subscriptions WHERE company_id=${lit(f.company)} AND environment='test';`)).toBe('0');
 expect(parse(await authenticated(f.actor,f.session,call('billing_read_service_access',`${lit(f.company)},'noura.knowledge.read'`)))).toEqual({ok:false,code:'SERVICE_NOT_ACTIVE'});
});
it('reuses the immutable service snapshot and serializes concurrent purchases before dispatch',async()=>{
 const f=await fixture(),suffix=randomUUID().slice(0,8),aName=`order_a_${suffix}`,bName=`order_b_${suffix}`,sql=call('billing_create_test_checkout_order',`${lit(JSON.stringify(f.input))}::jsonb,1000`);
 const a=db.session(`BEGIN;SELECT 1 FROM companies WHERE id=${lit(f.company)} FOR UPDATE;SELECT pg_sleep(3);SET LOCAL ROLE service_role;${sql}COMMIT;`,aName);const blocker=await activity(aName,r=>r.wait==='PgSleep');
 const b=db.session(`BEGIN;SET LOCAL ROLE service_role;${sql}COMMIT;`,bName);const waiter=await activity(bName,r=>r.type==='Lock');expect(blocker.pid).not.toBe(waiter.pid);console.log('PG_PURCHASE_LOCK_EVIDENCE',JSON.stringify({blocker,waiter}));
 const results=await Promise.all([a.done,b.done]),first=parse(results[0]),second=parse(results[1]);expect(first).toMatchObject({ok:true});expect(second).toMatchObject({ok:true,action:'reuse',order_id:first.order_id,payment_attempt_id:first.payment_attempt_id});
 expect(await db.sql(`SELECT count(*) FROM private.billing_service_order_offers WHERE order_id=${lit(first.order_id)};`)).toBe('1');expect(await db.sql(`SELECT count(*) FROM billing_payment_attempts WHERE order_id=${lit(first.order_id)};`)).toBe('1');
});

it('runs the existing purchase and shared settlement adapters against the actual new transaction boundary',async()=>{
 const f=await fixture();const admin={rpc:async(name,args)=>{
  const query=name==='billing_create_test_checkout_order'?call(name,`${lit(JSON.stringify(args.p_input))}::jsonb,${args.p_units_per_omr}`):name==='billing_settle_paymob_hmac_verified'?call(name,`${lit(JSON.stringify(args.p_evidence))}::jsonb`):null;
  if(!query)throw Error('UNEXPECTED_ADAPTER_RPC');
  try{return {data:parse(await srv(query)),error:null};}catch{return {data:null,error:{code:'SQL_FAILED'}};}
 }};
 vi.stubEnv('PAYMOB_OMR_CONVERSION_VERIFIED','true');vi.stubEnv('PAYMOB_OMR_UNITS_PER_OMR','1000');state.adminClient=admin;
 try{
 const input=f.input;const result=await createAtomicPurchasePersistRpc(admin)({companyId:input.p_company_id,productCode:input.p_product_code,purchasePurpose:input.p_purchase_purpose,planVersionId:input.p_plan_version_id,requestedPlanId:null,clientOpId:input.p_client_op_id,inputFingerprint:input.p_input_fingerprint,specialReference:input.p_special_reference,amountBaisa:input.p_amount_baisa,currency:input.p_currency,periodDays:input.p_period_days,periodUnit:input.p_period_unit,periodCount:input.p_period_count,providerAccountRef:input.p_provider_account_ref,providerEnvironment:input.p_provider_environment,createdBy:input.p_created_by});
 expect(result).toMatchObject({ok:true,action:'insert'});f.order=result.orderId;f.attempt=result.paymentAttemptId;
 const e=await stored(f);expect(await settleHmacVerifiedViaRpc(e)).toEqual({ok:true,outcome:'granted'});expect(await counts(f)).toBe('1|1|1|1');
 expect(await settleHmacVerifiedViaRpc(e)).toEqual({ok:true,outcome:'idempotent_replay'});
 expect(await settleHmacVerifiedViaRpc({...e,amount_baisa:6000})).toEqual({ok:false,code:'INVALID_STORED_EVIDENCE'});
 expect(await db.sql(`SELECT activated FROM private.billing_service_grants WHERE order_id=${lit(f.order)};`)).toBe('f');
 }finally{vi.unstubAllEnvs();state.adminClient=null;}
});

it('rejects owner revocation committed while binding waits for the plan version',async()=>{
 const f=await fixture({bound:false,publish:false}),r=await revision(),suffix=randomUUID().slice(0,8);
 const blocker=db.session(`BEGIN;SELECT 1 FROM billing_plan_versions WHERE id=${lit(f.version)} FOR UPDATE;`, `bind_block_${suffix}`,{keepOpen:true});
 await activity(`bind_block_${suffix}`,x=>x.wait==='ClientRead');
 const waiter=db.session(`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL "request.jwt.claim.sub"=${lit(owner)};SET LOCAL "request.jwt.claims"=${lit(JSON.stringify({sub:owner,session_id:ownerSession,role:'authenticated'}))};${call('billing_bind_noura_basic_draft',`${lit(f.version)},${r}`)}COMMIT;`,`bind_wait_${suffix}`);
 try{
  const waiting=await activity(`bind_wait_${suffix}`,x=>x.type==='Lock');console.log('PG_BIND_REVOCATION_WAIT',JSON.stringify(waiting));
  await db.sql(`UPDATE platform_admins SET status='disabled' WHERE user_id=${lit(owner)};`);
  blocker.child.stdin.end('COMMIT;\n');await blocker.done;
  expect(parse(await waiter.done)).toEqual({ok:false,code:'forbidden'});
  expect(await db.sql(`SELECT count(*) FROM private.billing_service_offers WHERE plan_version_id=${lit(f.version)};`)).toBe('0');
  expect(await revision()).toBe(r);
 }finally{if(!blocker.child.stdin.destroyed)blocker.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([blocker.done,waiter.done]);await db.sql(`UPDATE platform_admins SET role='owner',status='active' WHERE user_id=${lit(owner)};`);}
});

const authSql=query=>`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL "request.jwt.claim.sub"=${lit(owner)};SET LOCAL "request.jwt.claims"=${lit(JSON.stringify({sub:owner,session_id:ownerSession,role:'authenticated'}))};${query}COMMIT;`;
async function restoreOwner(){await db.sql(`UPDATE auth.users SET email_confirmed_at=clock_timestamp() WHERE id=${lit(owner)};UPDATE platform_admins SET role='owner',status='active' WHERE user_id=${lit(owner)};INSERT INTO auth.sessions(id,user_id) VALUES(${lit(ownerSession)},${lit(owner)}) ON CONFLICT(id) DO NOTHING;INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at,expired_at) VALUES(${lit(ownerSession)},${lit(owner)},clock_timestamp(),null) ON CONFLICT(session_id) DO UPDATE SET last_activity_at=excluded.last_activity_at,expired_at=null;UPDATE private.app_session_settings SET enabled=true;`);}
const invalidations=[
 ['owner status',()=>`UPDATE platform_admins SET status='disabled' WHERE user_id=${lit(owner)};`],
 ['owner role',()=>`UPDATE platform_admins SET role='delegated' WHERE user_id=${lit(owner)};`],
 ['session deletion',()=>`DELETE FROM auth.sessions WHERE id=${lit(ownerSession)};`],
 ['activity revocation',()=>`UPDATE private.app_session_activity SET expired_at=clock_timestamp() WHERE session_id=${lit(ownerSession)};`],
 ['identity verification',()=>`UPDATE auth.users SET email_confirmed_at=null,phone_confirmed_at=null WHERE id=${lit(owner)};`],
 ['natural idle expiry',()=>`SELECT pg_sleep(greatest(0,extract(epoch FROM(last_activity_at+interval '2 hours'-clock_timestamp())))+0.1) FROM private.app_session_activity WHERE session_id=${lit(ownerSession)};`],
];
it.each(['catalog','version'].flatMap(target=>invalidations.map(([label,change])=>[target,label,change])))('rejects %s wait followed by %s without retaining an offer',async(target,label,change)=>{
 const f=await fixture({bound:false,publish:false}),r=await revision(),suffix=randomUUID().slice(0,8);
 await restoreOwner();
 if(label==='natural idle expiry')await db.sql(`UPDATE private.app_session_activity SET last_activity_at=clock_timestamp()-interval '2 hours'+interval '8 seconds' WHERE session_id=${lit(ownerSession)};UPDATE private.app_session_settings SET enabled=false;`);
 const row=target==='catalog'?'billing_catalog_revision WHERE singleton':`billing_plan_versions WHERE id=${lit(f.version)}`;
 const blocker=db.session(`BEGIN;SELECT 1 FROM ${row} FOR UPDATE;`,`auth_block_${suffix}`,{keepOpen:true});
 await activity(`auth_block_${suffix}`,x=>x.wait==='ClientRead');
 const waiter=db.session(authSql(call('billing_bind_noura_basic_draft',`${lit(f.version)},${r}`)),`auth_wait_${suffix}`);
 try{
  const blocked=await activity(`auth_wait_${suffix}`,x=>x.type==='Lock');console.log('PG_BIND_AUTH_WAIT',JSON.stringify({target,label,blocked}));
  if(label==='natural idle expiry')expect(await db.sql(`SELECT last_activity_at+interval '2 hours'>clock_timestamp() FROM private.app_session_activity WHERE session_id=${lit(ownerSession)};`)).toBe('t');
  await db.sql(change());
  blocker.child.stdin.end('COMMIT;\n');await blocker.done;
  expect(parse(await waiter.done)).toEqual({ok:false,code:'forbidden'});
  expect(await db.sql(`SELECT count(*) FROM private.billing_service_offers WHERE plan_version_id=${lit(f.version)};`)).toBe('0');expect(await revision()).toBe(r);
 }finally{if(!blocker.child.stdin.destroyed)blocker.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([blocker.done,waiter.done]);await restoreOwner();}
});
it.each(['auth.users','auth.sessions','private.app_session_activity','public.platform_admins'])('keeps the %s authorization row locked through binding commit',async(table)=>{
 const f=await fixture({bound:false,publish:false}),r=await revision(),suffix=randomUUID().slice(0,8);await restoreOwner();
 // Hold the binding AFTER its guard at the real mutation boundary, then prove
 // each revoker waits for commit rather than changing the guard's read set.
 await db.sql(`CREATE FUNCTION private.test_binding_pause() RETURNS trigger LANGUAGE plpgsql AS $t$ BEGIN PERFORM pg_sleep(3);RETURN NEW;END;$t$;CREATE TRIGGER test_binding_pause BEFORE INSERT ON private.billing_service_offers FOR EACH ROW EXECUTE FUNCTION private.test_binding_pause();`);
 const binding=db.session(authSql(call('billing_bind_noura_basic_draft',`${lit(f.version)},${r}`)),`bind_commit_${suffix}`);
 let revoker;
 try{
  const bound=await activity(`bind_commit_${suffix}`,x=>x.wait==='PgSleep');
  const change=table==='auth.users'?`UPDATE auth.users SET email_confirmed_at=null WHERE id=${lit(owner)}`:table==='auth.sessions'?`DELETE FROM auth.sessions WHERE id=${lit(ownerSession)}`:table==='private.app_session_activity'?`UPDATE private.app_session_activity SET expired_at=clock_timestamp() WHERE session_id=${lit(ownerSession)}`:`UPDATE platform_admins SET status='disabled' WHERE user_id=${lit(owner)}`;
  revoker=db.session(`${change};`,`bind_revoke_${suffix}`);const revoked=await activity(`bind_revoke_${suffix}`,x=>x.type==='Lock');expect(bound.pid).not.toBe(revoked.pid);console.log('PG_BIND_AUTH_SERIALIZATION',JSON.stringify({table,bound,revoked}));
  const results=await Promise.all([binding.done,revoker.done]);expect(parse(results[0])).toMatchObject({ok:true});expect(await db.sql(`SELECT count(*) FROM private.billing_service_offers WHERE plan_version_id=${lit(f.version)};`)).toBe('1');expect(await revision()).toBe(r+1);
 }finally{await Promise.allSettled([binding.done,...(revoker?[revoker.done]:[])]);await db.sql('DROP TRIGGER test_binding_pause ON private.billing_service_offers;DROP FUNCTION private.test_binding_pause();');await restoreOwner();}
});
it.each(['auth.users','auth.sessions','private.app_session_activity','public.platform_admins'])('fails closed on a contended %s lock without a catalog/auth lock inversion',async(table)=>{
 const f=await fixture({bound:false,publish:false}),r=await revision(),suffix=randomUUID().slice(0,8);await restoreOwner();
 const predicate=table==='auth.users'?`id=${lit(owner)}`:table==='auth.sessions'?`id=${lit(ownerSession)}`:table==='private.app_session_activity'?`session_id=${lit(ownerSession)}`:`user_id=${lit(owner)}`;
 const revoker=db.session(`BEGIN;SELECT 1 FROM ${table} WHERE ${predicate} FOR UPDATE;`,`reverse_auth_${suffix}`,{keepOpen:true});
 try{
  await activity(`reverse_auth_${suffix}`,x=>x.wait==='ClientRead');
  expect(await bind(f,r)).toEqual({ok:false,code:'forbidden'});
  // Reverse-order actor can immediately acquire the business locks after the
  // denied binding; NOWAIT guard cannot wait in a cycle or persist partial work.
  revoker.child.stdin.end(`SELECT 1 FROM billing_catalog_revision WHERE singleton FOR UPDATE;SELECT 1 FROM billing_plan_versions WHERE id=${lit(f.version)} FOR UPDATE;COMMIT;\n`);await revoker.done;
  expect(await db.sql(`SELECT count(*) FROM private.billing_service_offers WHERE plan_version_id=${lit(f.version)};`)).toBe('0');expect(await revision()).toBe(r);
 }finally{if(!revoker.child.stdin.destroyed)revoker.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([revoker.done]);await restoreOwner();}
});

it('does not substitute delegated company scopes for revoked platform ownership',async()=>{
 const f=await fixture({bound:false,publish:false}),r=await revision();await restoreOwner();
 await db.sql(`UPDATE platform_admins SET role='delegated' WHERE user_id=${lit(owner)};INSERT INTO platform_admin_scopes(admin_user_id,company_id,usable_capabilities,delegable_capabilities) VALUES(${lit(owner)},${lit(f.company)},ARRAY['knowledge.write','billing.read'],ARRAY['knowledge.write']);`);
 try{expect(await bind(f,r)).toEqual({ok:false,code:'forbidden'});expect(await db.sql(`SELECT count(*) FROM private.billing_service_offers WHERE plan_version_id=${lit(f.version)};`)).toBe('0');expect(await revision()).toBe(r);}
 finally{await restoreOwner();}
});

it('preserves cumulative finance, corrected INSERT ambiguity and installed helper contracts',async()=>{
 const manifest=JSON.parse(readFileSync(directory+'manifest.json','utf8'));
 const signatures=manifest.baseline_functions.map(f=>f.signature).filter(s=>!s.startsWith('public.billing_create_or_reuse_subscription_order(')&&!s.startsWith('public.billing_settle_paymob_hmac_verified('));
 const actual=JSON.parse(await db.sql("BEGIN READ ONLY;SET LOCAL search_path='';"+functionQuery(signatures)+'COMMIT;'));
 for(const expected of manifest.baseline_functions.filter(f=>signatures.includes(f.signature)))expect(actual.find(f=>f.signature===expected.signature)).toEqual(expected);
 expect(await legacySnapshot()).toBe(legacyBefore);expect(await db.sql('SELECT count(*) FROM private.billing_service_grants WHERE entitlement_application_id='+lit(legacy.grant))).toBe('0');
 const f=await fixture();await purchase(f);
 await expect(srv('INSERT INTO public.billing_payment_attempts(order_id,company_id,attempt_seq,provider_order_id) VALUES('+lit(f.order)+','+lit(f.company)+",2,'99001');")).rejects.toThrow(/LEGACY_PROVIDER_ORDER_SCOPE_AMBIGUOUS/);
 await expect(srv('UPDATE public.billing_payment_attempts SET provider_order_id=\'99001\' WHERE id='+lit(f.attempt)+';')).rejects.toThrow(/LEGACY_PROVIDER_ORDER_SCOPE_AMBIGUOUS/);
 expect(await db.sql('SELECT count(*) FROM public.billing_payment_attempts WHERE order_id='+lit(f.order))).toBe('1');
 expect(await db.sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'::regprocedure")).toBe(manifest.post_purchase_body_md5);
 for(const [name,entry] of Object.entries(manifest.reviewed_new_function_bodies)){const digest=typeof entry==='string'?entry:(entry&&entry.algorithm==='md5'?entry.digest:null);if(typeof digest!=='string')throw Error('REVIEWED_BODY_DIGEST_METADATA_INVALID:'+name);expect(await db.sql('SELECT md5(replace(prosrc,chr(13),\'\')) FROM pg_proc WHERE pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='+lit(name.split('.')[0])+') AND proname='+lit(name.split('.')[1]))).toBe(digest);}
});

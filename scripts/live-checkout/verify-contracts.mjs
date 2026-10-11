import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {attachIsolate,lit} from "./postgres.mjs";
const db=await attachIsolate();let count=0;
const parse=s=>JSON.parse(s.split("\n").find(x=>x.startsWith("{")));
const srv=q=>db.sql("BEGIN;SET LOCAL ROLE service_role;"+q+"COMMIT;");
const make=async args=>parse(await db.sql("SELECT test_fixture.live_context("+ (args??"")+");"));
const create=(f,op="synthetic-op",changes={})=>{const a={...f,...changes};return srv("SELECT public.billing_create_live_checkout_order("+[a.company,a.actor,a.session,a.version,op].map(lit).join(",")+","+[a.revision,a.integration,lit("1001"),a.factor].join(",")+");").then(parse);};
const claim=(f,o,changes={})=>{const a={...f,...changes};return srv("SELECT public.billing_claim_live_checkout("+[a.company,o.order_id,o.payment_attempt_id,a.actor,a.session].map(lit).join(",")+");").then(parse);};
const checkoutUrl="https://om.checkout.paymob.com/?publicKey=om_pk_live_SYNTHETIC&clientSecret=synthetic_live_secret";
const complete=(f,o,over={})=>{const a={company:f.company,order:o.order_id,attempt:o.payment_attempt_id,actor:f.actor,session:f.session,provider:"900001",url:checkoutUrl,intention:"synthetic-live-intention",...over};return srv("SELECT public.billing_complete_live_checkout("+[a.company,a.order,a.attempt,a.actor,a.session,a.provider,a.url,a.intention].map(lit).join(",")+");");};
async function test(name,fn){try{await fn();console.log("PASS|"+name);count++;}catch(e){console.error("FAIL|"+name);throw e;}}
await test("new RPCs are service-only and private configuration has no client/service CRUD",async()=>{
 for(const fn of ["billing_create_live_checkout_order","billing_claim_live_checkout","billing_complete_live_checkout","billing_settle_live_paymob_hmac_verified"]){assert.equal(await db.sql("SELECT bool_and(NOT has_function_privilege(r,p.oid,'EXECUTE')) FROM pg_proc p CROSS JOIN (VALUES('anon'),('authenticated'))x(r) WHERE p.proname="+lit(fn)+";"),"t");}
 for(const name of ["billing_live_merchant_contracts","billing_live_order_bindings","billing_live_checkouts"]){assert.equal(await db.sql("SELECT bool_and(NOT has_table_privilege(r,"+lit("private."+name)+",'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) FROM (VALUES('anon'),('authenticated'),('service_role'))x(r);"),"t");}
});
for(const tier of ["basic","premium"])await test(tier+" copies published money and immutable service quota/budget",async()=>{const f=await make(lit(tier)),o=await create(f);assert.equal(o.ok,true,JSON.stringify(o));assert.equal(o.locked.provider_environment,"live");assert.equal(o.locked.provider_amount,45000);assert.equal(o.locked.plan_version_id,f.version);assert.equal(o.service.tier,tier);assert.equal(o.service.allowance_cap,500);assert.equal(o.service.monthly_limit_baisa,5000);assert.equal(await db.sql("SELECT count(*) FROM private.billing_service_grants WHERE order_id="+lit(o.order_id)+";"),"0");});
await test("owner/session/company substitution denied before order mutation",async()=>{const a=await make(),b=await make();for(const change of [{company:b.company},{actor:b.actor},{session:b.session}])assert.equal((await create(a,"foreign-"+randomUUID(),change)).ok,false);assert.equal(await db.sql("SELECT count(*) FROM public.billing_orders WHERE company_id="+lit(a.company)+";"),"0");});
await test("expired owner session cannot create or claim",async()=>{const f=await make(),o=await create(f);await db.sql("UPDATE private.app_session_activity SET last_activity_at=clock_timestamp()-interval '3 hours' WHERE session_id="+lit(f.session)+";");assert.equal((await create(f,"expired")).code,"FORBIDDEN");assert.equal((await claim(f,o)).kind,"rejected");});
await test("stale revision or unpublished version does not collect",async()=>{const f=await make();assert.equal((await create(f,"stale",{revision:f.revision+1})).code,"CATALOG_REVISION_CONFLICT");await db.sql("UPDATE public.billing_plan_versions SET status='retired' WHERE id="+lit(f.version)+";");assert.equal((await create(f)).code,"PLAN_NOT_PUBLISHED");});
await test("merchant configuration and factor cannot be guessed or replaced",async()=>{const f=await make();assert.equal((await create(f,"wrong-merchant",{integration:f.integration+999})).code,"LIVE_MERCHANT_NOT_CONFIGURED");assert.equal((await create(f,"wrong-factor",{factor:100})).code,"LIVE_MERCHANT_NOT_CONFIGURED");await assert.rejects(db.sql("UPDATE private.billing_live_merchant_contracts SET units_per_omr=100 WHERE id="+lit(f.contract)+";"),/SERVICE_EVIDENCE_IMMUTABLE/);});
await test("missing immutable budget or quota refuses Live",async()=>{for(const args of ["'basic',1000,45000,false,true","'premium',1000,45000,true,false"]){const f=await make(args);assert.equal((await create(f)).code,"LIVE_SERVICE_BUDGET_QUOTA_REQUIRED");}});
await test("fractional provider unit is rejected without persistent order",async()=>{const f=await make("'basic',100,1");await assert.rejects(create(f),/LIVE_PROVIDER_AMOUNT_NOT_EXACT/);assert.equal(await db.sql("SELECT count(*) FROM public.billing_orders WHERE company_id="+lit(f.company)+";"),"0");});
await test("replay and competing claims send only one collection",async()=>{const f=await make(),o=await create(f),replay=await create(f);assert.equal(replay.order_id,o.order_id);assert.equal(replay.payment_attempt_id,o.payment_attempt_id);const result=await Promise.all([claim(f,o),claim(f,o)]);assert.deepEqual(result.map(x=>x.kind).sort(),["claimed","pending"]);assert.equal(await db.sql("SELECT status FROM public.billing_payment_attempts WHERE id="+lit(o.payment_attempt_id)+";"),"unresolved");assert.equal((await claim(f,o)).kind,"pending");assert.equal((await create(f,"another-op")).block_new_collection,true);});
await test("completion is owner-bound and exact-idempotent; Test URL and forged redirect rejected",async()=>{const f=await make(),o=await create(f),other=await make();assert.equal((await claim(f,o)).kind,"claimed");assert.equal(await complete(f,o,{company:other.company}),"f");assert.equal(await complete(f,o,{url:"https://evil.example/?success=true"}),"f");assert.equal(await complete(f,o,{url:checkoutUrl.replace("pk_live_","pk_test_")}),"f");assert.equal(await complete(f,o),"t");assert.equal(await complete(f,o),"t");assert.equal((await claim(f,o)).kind,"ready");assert.equal(await complete(f,o,{provider:"900002"}),"f");assert.equal(await db.sql("SELECT count(*) FROM public.billing_entitlement_applications WHERE order_id="+lit(o.order_id)+";"),"0");});
await test("ready same-operation action sequence reuses unchanged checkout without another collection",async()=>{
 const f=await make(),o=await create(f,"ready-repeat");assert.equal((await claim(f,o)).kind,"claimed");assert.equal(await complete(f,o),"t");
 const snapshot=()=>db.sql("SELECT jsonb_build_object('order',(SELECT to_jsonb(x) FROM public.billing_orders x WHERE id="+lit(o.order_id)+"),'attempt',(SELECT to_jsonb(x) FROM public.billing_payment_attempts x WHERE id="+lit(o.payment_attempt_id)+"),'checkout',(SELECT to_jsonb(x) FROM private.billing_live_checkouts x WHERE payment_attempt_id="+lit(o.payment_attempt_id)+"));");
 const before=await snapshot();
 for(let i=0;i<2;i++){const replay=await create(f,"ready-repeat");assert.equal(replay.ok,true,JSON.stringify(replay));assert.equal(replay.order_id,o.order_id);assert.equal(replay.payment_attempt_id,o.payment_attempt_id);assert.deepEqual(await claim(f,replay),{kind:"ready",url:checkoutUrl});}
 assert.equal(await snapshot(),before);assert.equal((await create(f,"different-operation")).code,"LIVE_COLLECTION_REQUIRES_RECONCILIATION");
 assert.equal(await db.sql("SELECT count(*) FROM public.billing_orders WHERE company_id="+lit(f.company)+";"),"1");
});
await test("locked provider amount cannot be edited",async()=>{const f=await make(),o=await create(f);await assert.rejects(db.sql("UPDATE public.billing_orders SET provider_amount=1 WHERE id="+lit(o.order_id)+";"),/immutable/i);});

async function receipt(f,o,{tx="800001",status="success",amount=45000,refunded=false,pending=false,success=true}={}){
 const id=randomUUID(),observation="synthetic-observation-"+randomUUID();
 const raw={hmac_verified:true,provider_transaction_id:tx,provider_order_id:"900001",event_status:status,amount_cents:amount,currency:"OMR",integration_id:f.integration,signed_owner:"1001",pending,success,error_occured:false,is_auth:false,is_capture:false,is_voided:false,is_refunded:refunded,has_parent_transaction:false,is_standalone_payment:true};
 await srv("INSERT INTO public.billing_provider_events(id,payment_attempt_id,company_id,provider_account_ref,provider_environment,provider_transaction_id,event_status,observation_key,amount_baisa_expected,currency_expected,raw_summary) VALUES("+[id,o.payment_attempt_id,f.company,String(f.integration),"live",tx,status,observation].map(lit).join(",")+",45000,'OMR',"+lit(JSON.stringify(raw))+"::jsonb);");
 return {evidence_marker:"VEL_PAYMOB_SERVER_HMAC_VERIFIED",authenticity:{source:"server_adapter_attestation",verified:true,method:"paymob_hmac_sha512"},company_id:f.company,order_id:o.order_id,payment_attempt_id:o.payment_attempt_id,provider:"paymob",provider_account_ref:String(f.integration),provider_environment:"live",provider_transaction_id:tx,special_reference:o.special_reference,amount_baisa:45000,currency:"OMR",currency_expected:"OMR",event_status:status,observation_key:observation,provider_event_id:id};
}
const settle=e=>srv("SELECT public.billing_settle_live_paymob_hmac_verified("+lit(JSON.stringify(e))+"::jsonb);").then(parse);
for(const tier of ["basic","premium"])await test(tier+" signed durable settlement grants exactly once without activation",async()=>{
 const f=await make(lit(tier)),o=await create(f);await claim(f,o);assert.equal(await complete(f,o),"t");
 const e=await receipt(f,o),r=await settle(e);assert.equal(r.outcome,"granted",JSON.stringify(r));
 assert.equal((await settle(e)).outcome,"idempotent_replay");assert.equal(await db.sql("SELECT count(*) FROM private.billing_service_grants WHERE order_id="+lit(o.order_id)+";"),"1");
 assert.equal(await db.sql("SELECT activated FROM private.billing_service_grants WHERE order_id="+lit(o.order_id)+";"),"f");
});
await test("forged redirect, Test evidence and cross-tenant evidence cannot grant",async()=>{
 const f=await make(),o=await create(f),other=await make();await claim(f,o);await complete(f,o);
 const e=await receipt(f,o);
 assert.equal((await settle({...e,provider_environment:"test"})).ok,false);
 assert.equal((await settle({...e,company_id:other.company})).ok,false);
 assert.equal((await settle({...e,observation_key:"browser-success",authenticity:{verified:true,source:"browser",method:"redirect"}})).ok,false);
 assert.equal(await db.sql("SELECT count(*) FROM public.billing_entitlement_applications WHERE order_id="+lit(o.order_id)+";"),"0");
});
await test("partial refund retains history and denies activation without another grant",async()=>{
 const f=await make(),o=await create(f);await claim(f,o);await complete(f,o);
 const e=await receipt(f,o),r=await settle(e);assert.equal(r.outcome,"granted");
 const refund=await receipt(f,o,{status:"refunded",refunded:true,amount:4500});
 const reversed=await settle(refund);assert.equal(reversed.outcome,"lifecycle_review",JSON.stringify(reversed));
 assert.equal(await db.sql("SELECT count(*) FROM private.billing_service_grants WHERE order_id="+lit(o.order_id)+";"),"1");
 assert.equal(await db.sql("SELECT private.billing_service_receipt_eligible("+lit(r.entitlement_application_id)+");"),"f");
 assert.equal(parse(await srv("SELECT public.billing_activate_service_grant("+lit(r.entitlement_application_id)+",true);")).ok,false);
});

await test("ineligible pending reversal rolls back all financial settlement mutations",async()=>{
 const f=await make(),o=await create(f);await claim(f,o);await complete(f,o);
 await receipt(f,o,{status:"pending",refunded:true,pending:true,success:false});
 const e=await receipt(f,o);
 const financial=()=>db.sql("SELECT jsonb_build_object('order',(SELECT to_jsonb(x) FROM public.billing_orders x WHERE id="+lit(o.order_id)+"),'attempt',(SELECT to_jsonb(x) FROM public.billing_payment_attempts x WHERE id="+lit(o.payment_attempt_id)+"),'applications',(SELECT jsonb_agg(to_jsonb(x)) FROM public.billing_entitlement_applications x WHERE order_id="+lit(o.order_id)+"),'subscriptions',(SELECT jsonb_agg(to_jsonb(x)) FROM public.billing_subscriptions x WHERE company_id="+lit(f.company)+"),'outcomes',(SELECT jsonb_agg(to_jsonb(x)) FROM public.billing_settlement_outcomes x WHERE order_id="+lit(o.order_id)+"));");
 const before=await financial();
 await assert.rejects(settle(e),/LIVE_RECEIPT_INELIGIBLE/);
 assert.equal(await financial(),before);
 assert.equal(await db.sql("SELECT count(*) FROM private.billing_service_grants WHERE order_id="+lit(o.order_id)+";"),"0");
 await assert.rejects(settle(e),/LIVE_RECEIPT_INELIGIBLE/);
 assert.equal(await financial(),before);
});

console.log("PASS|"+count+" Live PostgreSQL cases");

import assert from "node:assert/strict";import{attachIsolate,lit}from"./postgres.mjs";
const db=await attachIsolate();const parse=s=>JSON.parse(s.split("\n").find(x=>x.startsWith("{")));
const srv=q=>db.sql("BEGIN;SET LOCAL ROLE service_role;"+q+"COMMIT;");
const make=()=>db.sql("SELECT test_fixture.live_context();").then(parse);
const create=(f,op)=>srv("SELECT public.billing_create_live_checkout_order("+[f.company,f.actor,f.session,f.version,op].map(lit).join(",")+","+[f.revision,f.integration,lit("1001"),f.factor].join(",")+");").then(parse);
await db.file("scripts/live-checkout/expired-fixtures.sql");
let cases=0;
for(const mode of ["claimed_unknown","submitted_unpaid"]){
 const f=await make(),first=parse(await db.sql("SELECT test_fixture.expired_live_collection("+lit(JSON.stringify(f))+"::jsonb,"+lit(mode)+");"));
 const before=await db.sql("SELECT jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.billing_orders o WHERE company_id="+lit(f.company)+"),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.billing_payment_attempts a WHERE company_id="+lit(f.company)+"),'checkouts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY payment_attempt_id) FROM private.billing_live_checkouts c WHERE company_id="+lit(f.company)+"));");
 const originalOp=await db.sql("SELECT client_op_id FROM public.billing_orders WHERE id="+lit(first.order_id)+";");
 assert.equal((await create(f,originalOp)).code,"LIVE_COLLECTION_REQUIRES_RECONCILIATION","expired same-operation checkout must remain blocked");
 const replies=await Promise.all(Array.from({length:4},(_,i)=>create(f,"second-"+mode+"-"+i)));
 console.log("ORIGINAL_ORDER",first.order_id,"CURRENT_ORDER_COUNT",await db.sql("SELECT count(*) FROM public.billing_orders WHERE company_id="+lit(f.company)+";"));
 console.log("EXPIRY_OUTCOME",mode,JSON.stringify(replies.map(x=>({ok:x.ok,code:x.code,order_id:x.order_id}))));
 assert(replies.every(x=>x.ok===false&&x.code==="LIVE_COLLECTION_REQUIRES_RECONCILIATION"));
 const after=await db.sql("SELECT jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.billing_orders o WHERE company_id="+lit(f.company)+"),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.billing_payment_attempts a WHERE company_id="+lit(f.company)+"),'checkouts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY payment_attempt_id) FROM private.billing_live_checkouts c WHERE company_id="+lit(f.company)+"));");
 assert.equal(after,before,"expired unknown evidence must remain byte-identical");
 assert.equal(await db.sql("SELECT count(*) FROM public.billing_orders WHERE company_id="+lit(f.company)+";"),"1");
 assert.equal(await db.sql("SELECT count(*) FROM public.billing_entitlement_applications WHERE company_id="+lit(f.company)+";"),"0");cases++;console.log("PASS expiry replay and concurrent creation "+mode);
}

{
 const f=await make(),testOrder=await db.sql("SELECT test_fixture.expired_test_collection("+lit(JSON.stringify(f))+"::jsonb);");
 const state=()=>db.sql("SELECT jsonb_build_object('order',(SELECT to_jsonb(o) FROM public.billing_orders o WHERE id="+lit(testOrder)+"),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.billing_payment_attempts a WHERE order_id="+lit(testOrder)+"));");
 const before=await state(),live=await create(f,"isolated-live-after-test");assert.equal(live.ok,false,JSON.stringify(live));assert.equal(live.code,"UNIQUE_VIOLATION");assert.equal(await state(),before);assert.equal(await db.sql("SELECT count(*) FROM public.billing_orders WHERE company_id="+lit(f.company)+" AND provider_environment='live';"),"0");assert.equal(await db.sql("SELECT count(*) FROM public.billing_entitlement_applications WHERE company_id="+lit(f.company)+";"),"0");
 cases++;console.log("PASS inherited open-purpose guard denies Live without converting or mutating Test evidence");
}
console.log("PASS "+cases+" real PostgreSQL expiry/concurrency regressions");

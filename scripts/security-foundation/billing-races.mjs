// TEST ONLY: actual transactions, synthetic receipts/approved policies, no payment.
import assert from "node:assert/strict";
import {fixture,storedEvent,settle,settleSql} from "../billing-acceptance/fixtures.mjs";
import {sql,rows,session,lit,verifyLocalContainer} from "../billing-acceptance/postgres.mjs";
const parse=x=>JSON.parse(x.split("\n").find(line=>line.startsWith("{")));
async function wait(name,condition){for(let i=0;i<100;i++){const a=(await rows(`SELECT pid,state,wait_event,wait_event_type FROM pg_stat_activity WHERE application_name=${lit(name)}`))[0];if(a&&condition(a))return a;await new Promise(r=>setTimeout(r,25));}throw Error("C1_BILLING_LOCK_NOT_OBSERVED");}
async function race(first,second){const suffix=crypto.randomUUID().slice(0,8),an=`c1_bill_a_${suffix}`,bn=`c1_bill_b_${suffix}`;
 const a=session(`BEGIN;SET LOCAL ROLE service_role;${settleSql(first)}`,an,{keepOpen:true});a.done.catch(()=>{});let b;
 try{const ap=await wait(an,x=>x.state==="idle in transaction"&&x.wait_event==="ClientRead");
  b=session(`SET ROLE service_role;${settleSql(second)}`,bn);b.done.catch(()=>{});
  const bp=await wait(bn,x=>x.wait_event_type==="Lock");assert.notEqual(ap.pid,bp.pid);
  console.log("C1_REFUND_RENEWAL_LOCK",JSON.stringify({first:ap.pid,second:bp.pid,wait:bp.wait_event_type}));
  a.child.stdin.end("COMMIT;\n");return (await Promise.all([a.done,b.done])).map(parse);
 }catch(e){if(!a.child.stdin.destroyed)a.child.stdin.end("ROLLBACK;\n");await Promise.allSettled([a.done,...(b?[b.done]:[])]);throw e;}}
await verifyLocalContainer();let passed=0,failed=0;
async function test(name,body){try{await body();passed++;console.log(`PASS|${name}`);}catch(e){failed++;console.log(`FAIL|${name}|${e.message}`);}}
async function payments(){const older=await fixture({environment:"live",providerOrderId:crypto.randomUUID(),deadlinePolicyApproved:true});
 const oldSuccess=await storedEvent(older,crypto.randomUUID());assert.equal((await settle(oldSuccess)).outcome,"granted");
 const newer=await fixture({environment:"live",companyId:older.companyId,providerOrderId:crypto.randomUUID(),deadlinePolicyApproved:true,purchasePurpose:"renew"});
 return {older,newer,oldSuccess,renewal:await storedEvent(newer,crypto.randomUUID()),refund:await storedEvent(older,oldSuccess.provider_transaction_id,{eventStatus:"other",observationKey:"synthetic-refund",flags:{is_refunded:true}})};}
for(const refundFirst of [true,false])await test(`${refundFirst?"refund then renewal":"renewal then older refund"} concurrent transactions preserve new paid entitlement`,async()=>{
 const f=await payments(),[first,second]=await race(refundFirst?f.refund:f.renewal,refundFirst?f.renewal:f.refund);
 assert.equal((refundFirst?first:second).outcome,"lifecycle_review");assert.equal((refundFirst?second:first).outcome,"granted");
 const state=(await rows(`SELECT s.status,s.paid_through,(SELECT count(*) FROM billing_entitlement_applications a WHERE a.subscription_id=s.id) AS grants FROM billing_subscriptions s WHERE s.company_id=${lit(f.older.companyId)}::uuid AND s.environment='live'`))[0];
 assert.equal(state.status,"active");assert.equal(state.grants,2);
 const active=(await rows(`SELECT status,applied_paid_through FROM billing_entitlement_applications WHERE order_id=${lit(f.newer.orderId)}::uuid`))[0];assert.equal(active.status,"active");assert.equal(state.paid_through,active.applied_paid_through);
 const before=JSON.stringify(state);assert.equal((await settle(f.oldSuccess)).outcome,"lifecycle_review");
 assert.equal(JSON.stringify((await rows(`SELECT s.status,s.paid_through,(SELECT count(*) FROM billing_entitlement_applications a WHERE a.subscription_id=s.id) AS grants FROM billing_subscriptions s WHERE s.company_id=${lit(f.older.companyId)}::uuid AND s.environment='live'`))[0]),before);
});
await test("rolled-back settlement retains inbound evidence without a grant or paid-through change",async()=>{
 const f=await payments(),before=await rows(`SELECT status,paid_through FROM billing_subscriptions WHERE company_id=${lit(f.older.companyId)}::uuid AND environment='live'`);
 const result=parse(await sql(`BEGIN;SET LOCAL ROLE service_role;${settleSql(f.renewal)}ROLLBACK;`));assert.equal(result.outcome,"granted");
 assert.deepEqual(await rows(`SELECT status,paid_through FROM billing_subscriptions WHERE company_id=${lit(f.older.companyId)}::uuid AND environment='live'`),before);
 assert.equal((await rows(`SELECT count(*) n FROM billing_entitlement_applications WHERE order_id=${lit(f.newer.orderId)}::uuid`))[0].n,0);
 assert.equal((await rows(`SELECT count(*) n FROM billing_provider_events WHERE payment_attempt_id=${lit(f.newer.attemptId)}::uuid`))[0].n,1);
});
console.log("C1_BILLING_RACES_RESULT",JSON.stringify({passed,failed,notRun:0}));if(failed)process.exitCode=1;

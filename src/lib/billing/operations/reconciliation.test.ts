import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({hold:"",release:null as null|((v:unknown)=>void),settle:vi.fn(),claimed:false,finish:vi.fn(),reads:[] as string[]}));
vi.mock("server-only",()=>({}));
vi.mock("../wiring/flags",()=>({readBillingPaymobWiringFlags:()=>({settleEnabled:true,liveEnabled:false}),blocksSettlement:()=>null}));
vi.mock("../paymob/config",()=>({getPaymobOmrConversionState:()=>({status:"CONFIGURED"})}));
vi.mock("../paymob/server-config",()=>({readPaymobServerConfig:vi.fn()}));
vi.mock("../wiring/store",()=>({settleHmacVerifiedViaRpc:state.settle}));
vi.mock("./db",()=>({operationRpc:async(name:string,args:unknown)=>{
 if(name==="billing_claim_processing"){if(state.claimed)return {ok:true,data:[]};state.claimed=true;return {ok:true,data:[{event_id:"00000000-0000-4000-8000-000000000001",lease_token:"00000000-0000-4000-8000-000000000002",attempts:1}]};}
 state.finish(args);return {ok:true,data:{}};
}}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({from:(table:string)=>{
 const row=table==="billing_provider_events"?{id:"00000000-0000-4000-8000-000000000001",company_id:"company",payment_attempt_id:"attempt",provider_transaction_id:"910001",event_status:"success",provider_account_ref:"71610",amount_baisa_expected:45000,observation_key:"observation",provider_environment:"test",raw_summary:{event_status:"success",pending:false,success:true,error_occured:false,is_auth:false,is_capture:false,is_voided:false,is_refunded:false,has_parent_transaction:false,is_standalone_payment:true}}:table==="billing_payment_attempts"?{order_id:"order"}:{id:"order",special_reference:"reference",amount_baisa:45000,provider_environment:"test",provider_account_ref:"71610",currency:"OMR"};
 const query={select:()=>query,eq:()=>query,maybeSingle:()=>{state.reads.push(table);return table===state.hold?new Promise(r=>{state.release=r;}):Promise.resolve({data:row,error:null});}};
 if(table===state.hold){state.release=null;const real=query.maybeSingle;query.maybeSingle=()=>{const pending=real();const release=state.release!;state.release=()=>release({data:row,error:null});return pending;};}
 return query;
}})}));
import { reconcileStoredBillingEvent, runStoredBillingReconciliation } from "./reconciliation";
beforeEach(()=>{vi.clearAllMocks();state.hold="";state.release=null;state.claimed=false;state.reads=[];state.settle.mockResolvedValue({ok:true,outcome:"granted"});});
describe("actual reconciliation abort boundary",()=>{
 it.each(["billing_provider_events","billing_payment_attempts","billing_orders"])("cannot dispatch settlement after a delayed %s read exceeds runner timeout",async table=>{
  vi.useFakeTimers();try{
   state.hold=table;const pending=runStoredBillingReconciliation(1);await vi.advanceTimersByTimeAsync(45001);
   expect(await pending).toMatchObject({ok:true,data:{outcomes:{retry:1}}});expect(state.release).toBeTypeOf("function");state.release!(null);await vi.advanceTimersByTimeAsync(1);
   expect(state.settle).not.toHaveBeenCalled();expect(state.finish).toHaveBeenCalledWith(expect.objectContaining({p_outcome:"retry"}));
  }finally{vi.useRealTimers();}
 });
 it("preserves the authoritative result of a settlement already dispatched before abort",async()=>{
  let release!:(v:unknown)=>void;state.settle.mockImplementation(()=>new Promise(r=>{release=r;}));const controller=new AbortController();const pending=reconcileStoredBillingEvent("event",controller.signal);
  await vi.waitFor(()=>expect(state.settle).toHaveBeenCalledOnce());controller.abort();release({ok:true,outcome:"idempotent_replay"});expect(await pending).toEqual({kind:"done",code:"idempotent_replay"});
 });
});

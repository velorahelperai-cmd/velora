import {describe,it,expect,vi,beforeEach} from "vitest";
const state=vi.hoisted(()=>({now:0,next:0,deadlines:new Map<string,number>(),limits:[] as number[]}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/billing/wiring/flags",()=>({readBillingPaymobWiringFlags:()=>({settleEnabled:true,liveEnabled:false})}));
vi.mock("./db",()=>({operationRpc:vi.fn(async(name:string,args:Record<string,unknown>)=>{
 if(name==="billing_claim_processing"){
  const limit=Number(args.p_limit);state.limits.push(limit);const jobs=[];
  while(jobs.length<limit&&state.next<3){const id=String(++state.next);state.deadlines.set(id,state.now+60000);jobs.push({event_id:id,lease_token:id,attempts:1});}
  return {ok:true,data:jobs};
 }
 if(name==="billing_finish_processing")return state.now<(state.deadlines.get(String(args.p_event_id))??0)?{ok:true,data:{}}:{ok:false,code:"lease_invalid"};
 throw Error("unexpected RPC");
})}));
import {processDurableBillingJobs} from "./processing";
beforeEach(()=>{state.now=0;state.next=0;state.deadlines.clear();state.limits=[];});
describe("durable processing lease scheduling",()=>{
 it("claims each job just before work so slower preceding jobs cannot consume its lease",async()=>{
  const result=await processDurableBillingJobs(async()=>{state.now+=31000;return {kind:"done",code:"confirmed"};},3);
  expect(result).toEqual({ok:true,data:{processed:3,outcomes:{done:3}}});
  expect(state.limits).toEqual([1,1,1]);
 });
 it("stops at an empty queue without claiming unused work",async()=>{
  const settle=vi.fn(async()=>({kind:"done" as const,code:"confirmed"}));
  expect(await processDurableBillingJobs(settle,5)).toEqual({ok:true,data:{processed:3,outcomes:{done:3}}});
  expect(settle).toHaveBeenCalledTimes(3);expect(state.limits).toEqual([1,1,1,1]);
 });
});

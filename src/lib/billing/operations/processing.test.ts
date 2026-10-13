import {describe,it,expect,vi,beforeEach} from "vitest";
const state=vi.hoisted(()=>({now:0,next:0,deadlines:new Map<string,number>(),limits:[] as number[],flags:{settleEnabled:true,liveEnabled:false,webhookEnabled:true},config:vi.fn(),admin:vi.fn(),event:vi.fn(),finished:[] as Record<string,unknown>[]}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/billing/wiring/flags",()=>({readBillingPaymobWiringFlags:()=>state.flags}));
vi.mock("./db",()=>({operationRpc:vi.fn(async(name:string,args:Record<string,unknown>)=>{
 if(name==="billing_claim_processing"){
  const limit=Number(args.p_limit);state.limits.push(limit);const jobs=[];
  while(jobs.length<limit&&state.next<3){const id="00000000-0000-4000-8000-00000000000"+String(++state.next);state.deadlines.set(id,state.now+60000);jobs.push({event_id:id,lease_token:id,attempts:1});}
  return {ok:true,data:jobs};
 }
 if(name==="billing_finish_processing"){state.finished.push(args);return state.now<(state.deadlines.get(String(args.p_event_id))??0)?{ok:true,data:{}}:{ok:false,code:"lease_invalid"};}
 throw Error("unexpected RPC");
})}));
vi.mock("../paymob/server-config",()=>({readPaymobServerConfig:state.config}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:state.admin}));
import {processDurableBillingJobs} from "./processing";
import {operationRpc} from "./db";
beforeEach(()=>{state.now=0;state.next=0;state.deadlines.clear();state.limits=[];state.finished=[];state.flags={settleEnabled:true,liveEnabled:false,webhookEnabled:true};state.config.mockReturnValue({ok:true,config:{environment:"live",integrationId:98765,merchantOwnerId:"1001",verifiedOmrUnitsPerOmr:1000}});vi.stubEnv("PAYMOB_INTEGRATION_ID_TEST","71610");const query={select:()=>query,eq:()=>query,maybeSingle:state.event};state.admin.mockReturnValue({from:()=>query});state.event.mockResolvedValue({data:{provider_environment:"live",provider_account_ref:"98765",amount_baisa_expected:45000,currency_expected:"OMR",event_status:"success",raw_summary:{hmac_verified:true,signed_owner:"1001",integration_id:98765,currency:"OMR",amount_cents:45000,pending:false,success:true,error_occured:false,is_refunded:false,is_voided:false,event_status:"success",is_auth:false,is_capture:false,has_parent_transaction:false,is_standalone_payment:true}},error:null});});
describe("durable processing lease scheduling",()=>{
 it("rejects malformed leases before evidence or reconciliation",async()=>{
  state.flags.liveEnabled=true;vi.mocked(operationRpc).mockResolvedValueOnce({ok:true,data:[{event_id:"bad",lease_token:"bad",attempts:1}]});state.event.mockClear();const settle=vi.fn();
  expect(await processDurableBillingJobs(settle,1)).toEqual({ok:false,code:"processing_claim_invalid"});expect(state.event).not.toHaveBeenCalled();expect(settle).not.toHaveBeenCalled();
 });
 it("does not begin settlement after a scoped evidence read outlives the lease work timeout",async()=>{
  vi.useFakeTimers();try{
   state.flags.liveEnabled=true;const valid=await state.event();let release!:(v:unknown)=>void;state.event.mockImplementation(()=>new Promise(r=>{release=r;}));const settle=vi.fn();const pending=processDurableBillingJobs(settle,1);
   await vi.advanceTimersByTimeAsync(45001);expect(await pending).toMatchObject({ok:true,data:{outcomes:{retry:1}}});release(valid);await vi.advanceTimersByTimeAsync(1);expect(settle).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
 });
 it("preserves retry/review outcomes without calling an event done on failure",async()=>{
  state.flags.liveEnabled=true;const settle=vi.fn().mockRejectedValueOnce(new Error("synthetic uncertain failure")).mockResolvedValueOnce({kind:"review",code:"duplicate_collection_review"}).mockResolvedValueOnce({kind:"done",code:"idempotent_replay"});
  expect(await processDurableBillingJobs(settle,3)).toEqual({ok:true,data:{processed:3,outcomes:{retry:1,review:1,done:1}}});expect(state.finished.map(x=>x.p_outcome)).toEqual(["retry","review","done"]);
 });
 it("settles qualified stored Live events while new payment creation is disabled",async()=>{
  state.flags.liveEnabled=true;vi.stubEnv("BILLING_PAYMOB_CREATE_ENABLED","false");
  const settle=vi.fn(async()=>({kind:"done" as const,code:"idempotent_replay"}));
  expect(await processDurableBillingJobs(settle,1)).toEqual({ok:true,data:{processed:1,outcomes:{done:1}}});expect(settle).toHaveBeenCalledExactlyOnceWith("00000000-0000-4000-8000-000000000001",expect.any(AbortSignal));
 });
 it.each(["webhook","settle","configuration","shared-integration"])("refuses disabled or unverified Live %s before claiming",async gate=>{
  state.flags.liveEnabled=true;if(gate==="webhook")state.flags.webhookEnabled=false;if(gate==="settle")state.flags.settleEnabled=false;if(gate==="configuration")state.config.mockReturnValue({ok:false});if(gate==="shared-integration")vi.stubEnv("PAYMOB_INTEGRATION_ID_TEST","98765");
  const settle=vi.fn();expect((await processDurableBillingJobs(settle,1)).ok).toBe(false);expect(state.limits).toEqual([]);expect(settle).not.toHaveBeenCalled();
 });
 it.each(["environment","account","owner","units","unsigned","failed","unknown"])("does not settle %s Live evidence",async mismatch=>{
  state.flags.liveEnabled=true;const original=await state.event();const event=original.data;
  if(mismatch==="environment")event.provider_environment="test";if(mismatch==="account")event.provider_account_ref="71610";if(mismatch==="owner")event.raw_summary.signed_owner="1002";if(mismatch==="units")event.raw_summary.amount_cents=4500;if(mismatch==="unsigned")event.raw_summary.hmac_verified=false;if(mismatch==="failed")event.event_status="failed";if(mismatch==="unknown")event.raw_summary.pending=true;
  state.event.mockResolvedValue({data:event,error:null});const settle=vi.fn();const result=await processDurableBillingJobs(settle,1);
  expect(result).toMatchObject({ok:true,data:{processed:1}});expect(settle).not.toHaveBeenCalled();expect(state.finished[0].p_outcome).toBe("review");
 });
 it("transient Live evidence reads retry without invoking settlement",async()=>{
  state.flags.liveEnabled=true;state.event.mockResolvedValue({data:null,error:{code:"synthetic"}});const settle=vi.fn();
  expect(await processDurableBillingJobs(settle,1)).toMatchObject({ok:true,data:{outcomes:{retry:1}}});expect(settle).not.toHaveBeenCalled();
 });
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

/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic boundary fixtures */
import {describe,it,expect} from "vitest";
import {dashboardBillingSnapshot} from "@/lib/customer/dashboard-billing-model";
// Execute the real candidate mapper. Fourth argument is the proposed SERVER-only
// evidence contract; the pinned mapper ignores it. No expected guards in adapter.
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
const future="2099-11-01T00:00:00Z",past="2020-11-01T00:00:00Z";
const journey=(status="active",paid_through:string|null=future)=>({subscription:{company_id:A,status,paid_through}});
const usage={company_id:A,month_start:"2026-10-01",successful_automated_outbound:4,held_outbound_capacity:2,cap:100};
const proof={companyId:A,billingPaid:true,operationalEligible:true,channelReady:"unavailable",usageCompanyId:A,qualifiedPaidThrough:future};
function map(j:any=journey(),u:any=usage,e:any=proof){return (dashboardBillingSnapshot as any)(A,j,u,e);}
describe("slice 1 server evidence projection",()=>{
 it("qualified Live entitlement exposes current allowance",()=>{expect(map()).toMatchObject({status:"ready",billingPaid:true,operationalEligible:true,channelReady:"unavailable",remaining:94,sent:4,held:2});});
 it.each(["legacy-active","test-receipt","revoked-proof","refund-review","suspended"])("%s never implies usable allowance",kind=>{
  const j=journey(kind==="suspended"?"suspended":"active",kind==="legacy-active"?null:future);
  expect(map(j,usage,{...proof,billingPaid:kind==="suspended",operationalEligible:false})).toMatchObject({status:"ready",operationalEligible:false,remaining:null,usedPercent:null,sent:4,held:2});
 });
 it("paid expired period retains financial history and accepted usage",()=>{expect(map(journey("active",past),usage,{...proof,operationalEligible:false,qualifiedPaidThrough:past})).toMatchObject({billingPaid:true,operationalEligible:false,remaining:null,sent:4,held:2});});
 it("cancellation at period end keeps qualified allowance until expiry",()=>{expect(map(journey("cancel_at_period_end"))).toMatchObject({billingPaid:true,operationalEligible:true,remaining:94});});
 it("unavailable entitlement preserves independently confirmed usage",()=>{expect(map(journey(),usage,{...proof,billingPaid:"unavailable",operationalEligible:"unavailable"})).toMatchObject({status:"ready",billingPaid:"unavailable",operationalEligible:"unavailable",remaining:null,sent:4,held:2});});
 it("unavailable usage is not zero and does not erase separately confirmed billing",()=>{expect(map(journey(),null,{...proof,usageCompanyId:null})).toMatchObject({status:"ready",billingPaid:true,remaining:null,sent:null,held:null,usedPercent:null});});
 it("wrong usage tenant cannot expose counts or balance",()=>{expect(map(journey(),usage,{...proof,usageCompanyId:B})).toMatchObject({status:"ready",remaining:null,sent:null,held:null});});
 it("wrong entitlement tenant cannot claim paid/current access",()=>{expect(map(journey(),usage,{...proof,companyId:B})).toMatchObject({status:"ready",billingPaid:"unavailable",operationalEligible:"unavailable",remaining:null});});
 it("missing evidence never trusts raw Active",()=>{expect(map(journey(),usage,null)).toMatchObject({status:"ready",billingPaid:"unavailable",operationalEligible:"unavailable",remaining:null,sent:4,held:2});});
 it("unknown cap stays null",()=>{expect(map(journey(),{...usage,cap:null})).toMatchObject({remaining:null,usedPercent:null});});
 it("confirmed exhaustion is exactly zero",()=>{expect(map(journey(),{...usage,cap:6})).toMatchObject({remaining:0,usedPercent:100});});
 it("confirmed zero cap is zero usable allowance without division",()=>{expect(map(journey(),{...usage,cap:0})).toMatchObject({remaining:0,usedPercent:null});});
 it("nonready channel does not erase allowance and grants no sendability",()=>{const s=map(journey(),usage,{...proof,channelReady:false});expect(s).toMatchObject({channelReady:false,remaining:94});expect(s).not.toHaveProperty("canSend",true);});
 it("wrong subscription company rejects the snapshot",()=>{expect(map({subscription:{...journey().subscription,company_id:B}})).toEqual({status:"unavailable"});});
 it("explicit absence alone is empty",()=>{expect(map({subscription:null},null,null)).toEqual({status:"empty",companyId:A});});
});

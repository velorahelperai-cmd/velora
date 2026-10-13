import { describe, expect, it } from "vitest";
import { qualifyLiveOffer } from "./live-offer";
const offer={versionId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",planId:"22222222-2222-4222-8222-222222222222",persona:"level_1" as const,package:"premium" as const,term:"monthly" as const,amountBaisa:90000,currency:"OMR" as const,automatedOutboundPerMonth:1500,quotaEnforcement:"not_verified" as const,features:[]};
const snapshot={ok:true,data:{version_id:offer.versionId,plan_id:offer.planId,amount_baisa:90000,allowance_cap:1500,tier:"premium",catalog_revision:7}};
describe("Live display qualification",()=>{
 it("accepts only matching server qualification and pins reviewed revision",()=>{expect(qualifyLiveOffer(snapshot,offer)).toEqual({liveCheckoutReady:true,catalogRevision:7});});
 it.each([{version_id:offer.planId},{plan_id:offer.versionId},{amount_baisa:1},{allowance_cap:1},{tier:"basic"},{catalog_revision:0}])("rejects stale or mismatched qualification %j",change=>{expect(qualifyLiveOffer({ok:true,data:{...snapshot.data,...change}},offer)).toBeNull();});
 it("does not allow planned personas or yearly terms",()=>{expect(qualifyLiveOffer(snapshot,{...offer,persona:"level_2"})).toBeNull();expect(qualifyLiveOffer(snapshot,{...offer,term:"yearly"})).toBeNull();});
 it("rejects denied and malformed server reads",()=>{for(const value of [null,{ok:false},[],{ok:true,data:null}])expect(qualifyLiveOffer(value,offer)).toBeNull();});
});

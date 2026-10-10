import {describe,it,expect} from "vitest";
import {billingChannelReadiness} from "./billing-channel-readiness";
const companyId="company";
const link={ok:true,data:{companyId,status:"verified",authorizationReady:true,authorizationExpiresAt:"2099-11-01T00:00:00Z",receptionSendTested:true,inboundTestedAt:"2020-01-01T00:00:00Z",outboundTestedAt:"2020-01-01T00:00:00Z"}};
describe("independent channel evidence",()=>{
 it("verified tested authorized current link is ready without reading payment",()=>expect(billingChannelReadiness(link,companyId,true)).toBe(true));
 it("a disabled rollout remains not ready",()=>expect(billingChannelReadiness(link,companyId,false)).toBe(false));
 it("expired authorization remains not ready",()=>expect(billingChannelReadiness({...link,data:{...link.data,authorizationExpiresAt:"2020-01-01T00:00:00Z"}},companyId,true)).toBe(false));
 it("another company is unavailable",()=>expect(billingChannelReadiness(link,"other",true)).toBe("unavailable"));
 it("missing read is unavailable",()=>expect(billingChannelReadiness({ok:false},companyId,true)).toBe("unavailable"));
 it("missing authorization contract is unavailable",()=>expect(billingChannelReadiness({...link,data:{...link.data,authorizationReady:undefined}},companyId,true)).toBe("unavailable"));
 it("old tests do not make a disconnected link ready",()=>expect(billingChannelReadiness({...link,data:{...link.data,status:"disconnected"}},companyId,true)).toBe(false));
 it("a malformed authorization deadline cannot confirm readiness",()=>expect(billingChannelReadiness({...link,data:{...link.data,authorizationExpiresAt:"invalid"}},companyId,true)).toBe("unavailable"));
});

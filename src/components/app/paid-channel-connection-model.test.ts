import {expect,it} from "vitest";
import type {PaidBranchConnectionRead} from "@/lib/tenancy/paid-branch-connection-contracts";
import {channelConnectionLabel,derivePaidChannelConnectionViewModel,scopedChannelConnection} from "./paid-channel-connection-model";
const scope={expectedAccountId:"account",companyId:"company",branchId:"branch",channel:"whatsapp" as const};
const read:PaidBranchConnectionRead={schemaVersion:1,...scope,sourceStatus:"ready",asOf:"2026-10-20T00:00:00Z",revision:"1",connection:{state:"pending",flow:"wa_coexistence",attempt:{id:"attempt",generation:2,expiresAt:"2026-10-20T01:00:00Z",status:"pending"},link:null,verified:false,reasonCodes:[]},capabilities:{canStart:false,canRecover:false,canCancel:false,allowedFlows:[]}};
it('shows a safe exit for expired pending attempts without permitting recovery or inventing cancellation',()=>{
 const expired={...read,asOf:'2026-10-20T02:00:00Z',capabilities:{...read.capabilities,canRecover:true,canCancel:true}};
 for(const locale of ['ar','en'] as const){
  const model=derivePaidChannelConnectionViewModel(expired,locale);
  expect(model.uiState).toBe('expired');expect(model.canRecover).toBe(false);
  expect(model.canCancel).toBe(true);expect(model.canStart).toBe(false);expect(model.guidance).toBeTruthy();
 }
 expect(expired.connection.attempt?.status).toBe('pending');
});
it.each(["expectedAccountId","companyId","branchId","channel"] as const)("rejects stale flat %s",field=>{
 expect(scopedChannelConnection({...read,[field]:"other"},scope)).toBeNull();
});
it("preserves negative capabilities and pending coexistence truth",()=>{
 const value=scopedChannelConnection(read,scope);expect(value?.capabilities.canStart).toBe(false);expect(channelConnectionLabel(value,"en")).toBe("Connection pending");
});
it("does not infer verification from connected-looking state without proof",()=>{
 const value=scopedChannelConnection({...read,connection:{...read.connection,state:"connected"}},scope);
 expect(channelConnectionLabel(value,"en")).toBe("Connection pending");
 expect(scopedChannelConnection({...read,connection:{...read.connection,state:"connected",verified:true}},scope)).toBeNull();
});
it("accepts exact scoped verified evidence without modifying it",()=>{
 const value={...read,connection:{...read.connection,state:"connected" as const,verified:true,link:{id:"link",generation:2}}};
 expect(scopedChannelConnection(value,scope)).toBe(value);expect(channelConnectionLabel(value,"en")).toBe("Connection verified for this branch");
});
it("rejects wrong-channel flows and unavailable reads",()=>{
 expect(scopedChannelConnection({...read,connection:{...read.connection,flow:"instagram_direct"}},scope)).toBeNull();
 expect(scopedChannelConnection({...read,sourceStatus:"unavailable"},scope)).toBeNull();
});
it("maps all 8 channel connection states honestly in Arabic and English",()=>{
 const notConnected:PaidBranchConnectionRead={...read,connection:{state:"not_connected",flow:null,attempt:null,link:null,verified:false,reasonCodes:[]},capabilities:{canStart:true,canRecover:false,canCancel:false,allowedFlows:["wa_new_number","wa_coexistence"]}};
 expect(derivePaidChannelConnectionViewModel(notConnected,"ar").uiState).toBe("not_connected");
 expect(derivePaidChannelConnectionViewModel(notConnected,"ar").badgeLabel).toBe("غير مربوط");
 expect(derivePaidChannelConnectionViewModel(read,"ar").uiState).toBe("authorizing");
 expect(derivePaidChannelConnectionViewModel(read,"ar").badgeLabel).toBe("جاري التفويض");

 const unverified={...read,connection:{...read.connection,state:"connected" as const,verified:false}};
 expect(derivePaidChannelConnectionViewModel(unverified,"ar").uiState).toBe("connected_unverified");
 expect(derivePaidChannelConnectionViewModel(unverified,"ar").badgeLabel).toBe("مربوط لكن غير جاهز");

 const readyState={...read,connection:{...read.connection,state:"connected" as const,verified:true,link:{id:"link",generation:1}}};
 expect(derivePaidChannelConnectionViewModel(readyState,"ar").uiState).toBe("ready");
 expect(derivePaidChannelConnectionViewModel(readyState,"ar").badgeLabel).toBe("جاهز");

 const expired:PaidBranchConnectionRead={...notConnected,connection:{...notConnected.connection,attempt:{id:"attempt",generation:1,expiresAt:"2026-10-20T01:00:00Z",status:"expired"},reasonCodes:["expired"]}};
 expect(derivePaidChannelConnectionViewModel(expired,"ar").uiState).toBe("expired");
 expect(derivePaidChannelConnectionViewModel(expired,"ar").badgeLabel).toBe("صلاحيات منتهية");

 const reconnect:PaidBranchConnectionRead={...notConnected,connection:{...notConnected.connection,attempt:{id:"attempt",generation:1,expiresAt:"2026-10-20T01:00:00Z",status:"cancelled"}}};
 expect(derivePaidChannelConnectionViewModel(reconnect,"ar").uiState).toBe("reconnect_ready");
 expect(derivePaidChannelConnectionViewModel(reconnect,"ar").badgeLabel).toBe("إعادة ربط");

 const recoverable:PaidBranchConnectionRead={...read,connection:{...read.connection,state:"reconciliation_required",attempt:{id:"attempt",generation:2,expiresAt:"2026-10-20T01:00:00Z",status:"unknown"},reasonCodes:["reconciliation_required"]},capabilities:{canStart:false,canRecover:true,canCancel:false,allowedFlows:[]}};
 expect(derivePaidChannelConnectionViewModel(recoverable,"ar").uiState).toBe("recoverable_failure");
 expect(derivePaidChannelConnectionViewModel(recoverable,"ar").badgeLabel).toBe("فشل قابل للاسترداد");
 expect(derivePaidChannelConnectionViewModel(recoverable,"ar").canRecover).toBe(true);

 const actionReq:PaidBranchConnectionRead={...notConnected,connection:{...notConnected.connection,reasonCodes:["setup_required"]},capabilities:{canStart:false,canRecover:false,canCancel:false,allowedFlows:[]}};
 expect(derivePaidChannelConnectionViewModel(actionReq,"ar").uiState).toBe("action_required");
 expect(derivePaidChannelConnectionViewModel(actionReq,"ar").badgeLabel).toBe("يحتاج إجراء");
});

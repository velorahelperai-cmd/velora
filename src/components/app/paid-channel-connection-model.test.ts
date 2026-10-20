import {expect,it} from "vitest";
import type {PaidBranchConnectionRead} from "@/lib/tenancy/paid-branch-connection-contracts";
import {channelConnectionLabel,scopedChannelConnection} from "./paid-channel-connection-model";
const scope={expectedAccountId:"account",companyId:"company",branchId:"branch",channel:"whatsapp" as const};
const read:PaidBranchConnectionRead={schemaVersion:1,...scope,sourceStatus:"ready",asOf:"2026-10-20T00:00:00Z",revision:"1",connection:{state:"pending",flow:"wa_coexistence",attempt:{id:"attempt",generation:2,expiresAt:"2026-10-20T01:00:00Z",status:"pending"},link:null,verified:false,reasonCodes:[]},capabilities:{canStart:false,canRecover:false,canCancel:false,allowedFlows:[]}};
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

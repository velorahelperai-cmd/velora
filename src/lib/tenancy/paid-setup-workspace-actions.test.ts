import {beforeEach,expect,it,vi} from "vitest";
import {readOwnedPaidSetupWorkspaceAction} from "./paid-setup-workspace-actions";
import {projectTrustedBoundSelection,mergePaidBranchChannelProof} from "./paid-setup-contracts";
import {unavailablePaidBranchConnectionRead} from "./paid-branch-connection-contracts";
const m=vi.hoisted(()=>({access:vi.fn(),setup:vi.fn(),connection:vi.fn()}));
vi.mock("./access",()=>({getCompanyAccess:m.access}));
vi.mock("./paid-setup-actions",()=>({readOwnedPaidBranchSetupAction:m.setup}));
vi.mock("./paid-branch-connection-actions",()=>({readOwnedPaidBranchConnectionAction:m.connection}));
const scope={expectedAccountId:"11111111-1111-4111-8111-111111111111",companyId:"22222222-2222-4222-8222-222222222222",branchId:"33333333-3333-4333-8333-333333333333"};
const base=projectTrustedBoundSelection({...scope,branchLabel:"Main",orderGroupId:"order",slotIndex:0,persona:"level_2",package:"basic",term:"monthly",maxChannels:1,employeesExcludingOwner:2,clockState:"waiting_readiness",asOf:"now"},{channels:["whatsapp"]});
beforeEach(()=>{
 vi.resetAllMocks();
 m.access.mockResolvedValue({ok:true,context:{userId:scope.expectedAccountId,company:{id:scope.companyId},membership:{role:"owner"}}});
 m.setup.mockResolvedValue(mergePaidBranchChannelProof(base,[{...scope,channel:"whatsapp",verified:true,generation:2,revoked:false,stale:false}]));
 m.connection.mockResolvedValue({...unavailablePaidBranchConnectionRead({...scope,channel:"whatsapp"},"now","source_failed"),sourceStatus:"ready",revision:"2",connection:{state:"connected",verified:true,flow:"wa_new_number",attempt:null,link:{id:"link",generation:2},reasonCodes:[]}});
});
it("confirms stable B3 proof around a matching B1 projection using read actions only",async()=>{
 const result=await readOwnedPaidSetupWorkspaceAction(scope);expect(result?.confirmedChannels).toEqual(["whatsapp"]);
 expect(m.setup).toHaveBeenCalledTimes(2);expect(m.connection).toHaveBeenCalledTimes(2);
 expect(m.setup).toHaveBeenCalledWith(scope);
});
it.each(["invalid","actor","company","staff","workspace"])("rejects %s before scoped reads",async kind=>{
 if(kind==="actor")m.access.mockResolvedValue({ok:true,context:{userId:"foreign",company:{id:scope.companyId},membership:{role:"owner"}}});
 if(kind==="company")m.access.mockResolvedValue({ok:true,context:{userId:scope.expectedAccountId,company:{id:"foreign"},membership:{role:"owner"}}});
 if(kind==="staff")m.access.mockResolvedValue({ok:true,context:{userId:scope.expectedAccountId,company:{id:scope.companyId},membership:{role:"staff"}}});
 if(kind==="workspace")m.access.mockResolvedValue({ok:true,context:{needsCompanyContext:true}});
 expect(await readOwnedPaidSetupWorkspaceAction({...scope,branchId:kind==="invalid"?"bad":scope.branchId})).toBeNull();
 expect(m.setup).not.toHaveBeenCalled();
});
it.each(["generation","revision","unknown","unverified","unavailable","projection"])("does not expose completed progress for %s disagreement",async kind=>{
 const first=await m.connection();m.connection.mockClear();
 const last=structuredClone(first);
 if(kind==="generation")last.connection.link.generation=3;
 if(kind==="revision")last.revision="3";
 if(kind==="unknown")last.connection.state="reconciliation_required";
 if(kind==="unverified")last.connection.verified=false;
 if(kind==="unavailable"){last.sourceStatus="unavailable";last.connection.verified=false;}
 if(kind==="projection")m.setup.mockResolvedValue(base);
 m.connection.mockResolvedValueOnce(first).mockResolvedValueOnce(last);
 const result=await readOwnedPaidSetupWorkspaceAction(scope);
 expect(result?.confirmedChannels??[]).toEqual([]);
 if(kind==="projection")expect(result?.read.progress.verified).toBe(0);
 else{expect(result).toBeNull();expect(result?.read.progress.verified).toBeUndefined();}
});
it("rejects a foreign branch read and changed entitlement",async()=>{
 m.setup.mockResolvedValueOnce({...base,selectedBranchId:"foreign"});
 expect(await readOwnedPaidSetupWorkspaceAction(scope)).toBeNull();
 m.setup.mockResolvedValueOnce(base).mockResolvedValueOnce({...base,entitlement:null});
 expect(await readOwnedPaidSetupWorkspaceAction(scope)).toBeNull();
});

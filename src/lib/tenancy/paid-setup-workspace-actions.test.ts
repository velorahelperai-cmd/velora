import {beforeEach,expect,it,vi} from "vitest";
import {readOwnedPaidSetupWorkspaceAction,readOwnedPaidSetupDetailsAction} from "./paid-setup-workspace-actions";
import {projectTrustedBoundSelection,mergePaidBranchChannelProof} from "./paid-setup-contracts";
import {unavailablePaidBranchConnectionRead} from "./paid-branch-connection-contracts";
const m=vi.hoisted(()=>({access:vi.fn(),setup:vi.fn(),connection:vi.fn(),summary:vi.fn(),activation:vi.fn()}));
vi.mock('@/lib/billing/es02/account-order-actions',()=>({readEs02ActivationFoundationAction:m.activation}));
vi.mock('./paid-launch-actions',()=>({readOwnedBranchLaunchSummaryAction:m.summary}));
vi.mock("./access",()=>({getCompanyAccess:m.access}));
vi.mock("./paid-setup-actions",()=>({readOwnedPaidBranchSetupAction:m.setup}));
vi.mock("./paid-branch-connection-actions",()=>({readOwnedPaidBranchConnectionAction:m.connection}));
const scope={expectedAccountId:"11111111-1111-4111-8111-111111111111",companyId:"22222222-2222-4222-8222-222222222222",branchId:"33333333-3333-4333-8333-333333333333"};
const base=projectTrustedBoundSelection({...scope,branchLabel:"Main",orderGroupId:"order",slotIndex:0,persona:"level_2",package:"basic",term:"monthly",maxChannels:1,employeesExcludingOwner:2,clockState:"waiting_readiness",asOf:"now"},{channels:["whatsapp"]});
beforeEach(()=>{
 vi.resetAllMocks();
 m.summary.mockResolvedValue(null);
 m.activation.mockResolvedValue({ok:false,code:'UNAVAILABLE'});
 m.access.mockResolvedValue({ok:true,context:{userId:scope.expectedAccountId,company:{id:scope.companyId},membership:{role:"owner"}}});
 m.setup.mockResolvedValue(mergePaidBranchChannelProof(base,[{...scope,channel:"whatsapp",verified:true,generation:2,revoked:false,stale:false}]));
 m.connection.mockResolvedValue({...unavailablePaidBranchConnectionRead({...scope,channel:"whatsapp"},"now","source_failed"),sourceStatus:"ready",revision:"2",connection:{state:"connected",verified:true,flow:"wa_new_number",attempt:null,link:{id:"link",generation:2},reasonCodes:[]}});
});
it("confirms stable B3 proof around a matching B1 projection using read actions only",async()=>{
 const result=await readOwnedPaidSetupWorkspaceAction(scope);expect(result?.confirmedChannels).toEqual(["whatsapp"]);
 expect(m.setup).toHaveBeenCalledTimes(2);expect(m.connection).toHaveBeenCalledTimes(2);
 expect(m.setup).toHaveBeenCalledWith(scope);
});
it('exposes the native clock only for the exact paid company and order',async()=>{
 const data={companyId:scope.companyId,orderGroupId:'order',clockState:'waiting_readiness',termUnit:'month',subscriptionStartedAt:null,paidThroughAt:null};
 m.activation.mockResolvedValue({ok:true,data});expect((await readOwnedPaidSetupWorkspaceAction(scope))?.activation).toEqual(data);
 m.activation.mockResolvedValue({ok:true,data:{...data,orderGroupId:'foreign'}});expect((await readOwnedPaidSetupWorkspaceAction(scope))?.activation).toBeNull();
});
it('keeps native clock unknown when its read rejects',async()=>{m.activation.mockRejectedValue(new Error('offline'));expect((await readOwnedPaidSetupWorkspaceAction(scope))?.activation).toBeNull();});
it('shows a genuinely disconnected zero-progress branch without waiting for optional metadata',async()=>{
 m.setup.mockResolvedValue(base);
 m.connection.mockResolvedValue({...unavailablePaidBranchConnectionRead({...scope,channel:'whatsapp'},'now','source_failed'),sourceStatus:'ready',revision:'1',connection:{state:'not_connected',verified:false,flow:null,attempt:null,link:null,reasonCodes:[]},capabilities:{canStart:true,canRecover:false,canCancel:false,allowedFlows:['wa_new_number']}});
 m.summary.mockImplementation(()=>new Promise(()=>{}));m.activation.mockImplementation(()=>new Promise(()=>{}));
 const result=await readOwnedPaidSetupWorkspaceAction({...scope,connectionFirst:true});
 expect(result?.read.progress.verified).toBe(0);expect(result?.confirmedChannels).toEqual([]);expect(result?.connectionReads.whatsapp?.connection.state).toBe('not_connected');expect(m.setup).toHaveBeenCalledTimes(1);expect(m.connection).toHaveBeenCalledTimes(1);expect(m.summary).not.toHaveBeenCalled();expect(m.activation).not.toHaveBeenCalled();
});
it('retains both proof reads for a previously connected branch in connection-first mode',async()=>{const result=await readOwnedPaidSetupWorkspaceAction({...scope,connectionFirst:true});expect(result?.confirmedChannels).toEqual(['whatsapp']);expect(m.setup).toHaveBeenCalledTimes(2);expect(m.connection).toHaveBeenCalledTimes(2);expect(m.summary).not.toHaveBeenCalled();expect(m.activation).not.toHaveBeenCalled();});
it('reads optional metadata separately and rejects a foreign account before its reads',async()=>{const result=await readOwnedPaidSetupDetailsAction(scope,'order');expect(result?.scope).toEqual(scope);expect(m.summary).toHaveBeenCalledTimes(1);m.summary.mockClear();m.activation.mockClear();expect(await readOwnedPaidSetupDetailsAction({...scope,expectedAccountId:'99999999-9999-4999-8999-999999999999'},'order')).toBeNull();expect(m.summary).not.toHaveBeenCalled();expect(m.activation).not.toHaveBeenCalled();});
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

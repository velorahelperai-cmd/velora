import {beforeEach,expect,it,vi} from "vitest";
import Page from "./page";
import {PaidWhatsappRoute} from "@/components/app/paid-whatsapp-route";
import {AccessGate} from "@/components/app/access-gate";
import {paidSetupUnavailable} from "@/lib/tenancy/paid-setup-contracts";
import {unavailablePaidBranchConnectionRead} from "@/lib/tenancy/paid-branch-connection-contracts";
const mocks=vi.hoisted(()=>({access:vi.fn(),read:vi.fn(),connection:vi.fn()}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:mocks.access,loginPathForReturn:(path:string)=>"/login?next="+encodeURIComponent(path)}));
vi.mock("@/lib/tenancy/paid-setup-actions",()=>({readOwnedPaidBranchSetupAction:mocks.read}));
vi.mock("@/lib/tenancy/paid-branch-connection-actions",()=>({readOwnedPaidBranchConnectionAction:mocks.connection}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw Error("REDIRECT "+path);},notFound:()=>{throw Error("NOT_FOUND");}}));
vi.mock("@/components/app/paid-whatsapp-route",()=>({PaidWhatsappRoute:()=>null}));
vi.mock("@/components/app/access-gate",()=>({AccessGate:()=>null}));
const branchId="11111111-1111-4111-8111-111111111111";
const scope={expectedAccountId:"actor",companyId:"company",branchId};
const run=()=>Page({params:Promise.resolve({branchId})});
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ok:true,context:{userId:"actor",company:{id:"company"},membership:{role:"owner"}}});
  mocks.read.mockResolvedValue({...paidSetupUnavailable({...scope,asOf:"now",blockedReasons:[]}),companyId:scope.companyId,sourceStatus:"ready",selectedBranchId:branchId,branches:[{id:branchId,label:"Main"}],selectedChannels:["whatsapp"],entitlement:{package:"basic"}});
  mocks.connection.mockResolvedValue(unavailablePaidBranchConnectionRead({...scope,channel:"whatsapp"},"now","source_failed"));
});
it("uses session-owned company and actor and only existing read actions",async()=>{
  const result=await run();expect(result.type).toBe(PaidWhatsappRoute);
  expect(mocks.access).toHaveBeenCalledWith("owner");expect(mocks.read).toHaveBeenCalledWith(scope);
  expect(mocks.connection).toHaveBeenCalledWith({...scope,channel:"whatsapp"});
  expect(result.props.confirmedGeneration).toBeNull();
});
it.each(["../admin","%2fadmin","bad",""])("rejects malformed path before authority reads %s",async value=>{
  await expect(Page({params:Promise.resolve({branchId:value})})).rejects.toThrow("NOT_FOUND");
  expect(mocks.access).not.toHaveBeenCalled();expect(mocks.connection).not.toHaveBeenCalled();
});
it.each(["UNAUTHENTICATED","UNVERIFIED"])("preserves deep link for %s",async code=>{
  mocks.access.mockResolvedValue({ok:false,code});
  await expect(run()).rejects.toThrow(encodeURIComponent(`/setup/branches/${branchId}/whatsapp`));
  expect(mocks.connection).not.toHaveBeenCalled();
});
it.each(["staff","missing-company","workspace"])("denies or selects context before reads: %s",async kind=>{
  mocks.access.mockResolvedValue({ok:true,context:{userId:"actor",company:kind==="missing-company"?null:{id:"company"},membership:{role:kind==="staff"?"staff":"owner"},needsCompanyContext:kind==="workspace"}});
  if(kind==="workspace")await expect(run()).rejects.toThrow("REDIRECT /app?next=");
  else expect((await run()).type).toBe(AccessGate);
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each(["foreign","unpaid","unentitled","unavailable","unselected"])("fails closed for %s branch",async kind=>{
  const read=await mocks.read();
  if(kind==="foreign")read.companyId="foreign";
  if(kind==="unpaid")read.entitlement=null;
  if(kind==="unentitled")read.selectedChannels=["instagram"];
  if(kind==="unavailable")read.sourceStatus="unavailable";
  if(kind==="unselected")read.selectedBranchId="other";
  expect((await run()).type).toBe(AccessGate);
});
it.each([false,true])("brackets B1 with matching B3 generation; drift=%s",async drift=>{
  const connection={...await mocks.connection(),sourceStatus:"ready",revision:"r2",connection:{state:"connected",verified:true,link:{id:"link",generation:2},reasonCodes:[],attempt:null,flow:"wa_new_number"}};
  mocks.connection.mockResolvedValueOnce(connection).mockResolvedValueOnce({...connection,revision:drift?"r3":"r2",connection:{...connection.connection,link:{id:"link",generation:drift?3:2}}});
  expect((await run()).props.confirmedGeneration).toBe(drift?null:2);
});

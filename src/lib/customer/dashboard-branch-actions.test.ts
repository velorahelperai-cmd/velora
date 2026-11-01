import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({access:vi.fn(),entry:vi.fn(),summary:vi.fn()}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:mocks.access}));
vi.mock("@/lib/tenancy/paid-setup-actions",()=>({readOwnedPaidBranchSetupEntryAction:mocks.entry}));
vi.mock("@/lib/tenancy/paid-launch-actions",()=>({readOwnedBranchLaunchSummaryAction:mocks.summary}));
import {readDashboardBranch} from "./dashboard-branch-actions";
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({ok:true,context:{company:{id:"company"},userId:"owner",membership:{role:"owner"}}});mocks.entry.mockResolvedValue({sourceStatus:"selection_required",companyId:"company",branches:[{id:"branch",label:"Branch"}]});mocks.summary.mockResolvedValue({scope:{companyId:"company",branchId:"branch",expectedAccountId:"owner"},activation:{status:"launched"}});});
describe("dashboard paid branch read",()=>{
 it("reads the existing receipt for the only branch without creating a launch",async()=>{expect(await readDashboardBranch({expectedCompanyId:"company"})).toMatchObject({status:"ready",selectedId:"branch",summary:{activation:{status:"launched"}}});expect(mocks.summary).toHaveBeenCalledWith({companyId:"company",branchId:"branch",expectedAccountId:"owner"});});
 it("does not choose the first branch when multiple exist",async()=>{mocks.entry.mockResolvedValue({sourceStatus:"selection_required",companyId:"company",branches:[{id:"a",label:"A"},{id:"b",label:"B"}]});expect(await readDashboardBranch({expectedCompanyId:"company"})).toMatchObject({status:"ready",selectedId:null,summary:null});expect(mocks.summary).not.toHaveBeenCalled();});
 it("rejects a changed workspace before reading branches",async()=>{expect(await readDashboardBranch({expectedCompanyId:"other"})).toEqual({status:"scope_changed"});expect(mocks.entry).not.toHaveBeenCalled();});
 it("rejects a foreign branch before reading its summary",async()=>{expect(await readDashboardBranch({expectedCompanyId:"company",branchId:"foreign"})).toEqual({status:"forbidden"});expect(mocks.summary).not.toHaveBeenCalled();});
 it("rejects a summary for a different actor",async()=>{mocks.summary.mockResolvedValue({scope:{companyId:"company",branchId:"branch",expectedAccountId:"different"}});expect(await readDashboardBranch({expectedCompanyId:"company"})).toEqual({status:"scope_changed"});});
 it("keeps inventory without inventing status when the summary is unavailable",async()=>{mocks.summary.mockResolvedValue(null);expect(await readDashboardBranch({expectedCompanyId:"company"})).toMatchObject({status:"ready",selectedId:"branch",summary:null});});
 it("does not expose owner inventory to staff",async()=>{mocks.access.mockResolvedValue({ok:false,code:"FORBIDDEN"});expect(await readDashboardBranch({expectedCompanyId:"company"})).toEqual({status:"forbidden"});expect(mocks.entry).not.toHaveBeenCalled();});
 it("fails closed on a failed inventory or transport",async()=>{mocks.entry.mockResolvedValue({sourceStatus:"unavailable",companyId:"company"});expect(await readDashboardBranch({expectedCompanyId:"company"})).toEqual({status:"unavailable"});mocks.entry.mockRejectedValue(Error("network"));expect(await readDashboardBranch({expectedCompanyId:"company"})).toEqual({status:"unavailable"});});
});

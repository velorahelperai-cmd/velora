import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({gate:vi.fn(),rpc:vi.fn(),knowledge:vi.fn(),whatsapp:vi.fn()}));
vi.mock("@/lib/tenancy/access",()=>({requirePlatformAdmin:mocks.gate,getCompanyAccess:vi.fn(),pathForAccess:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock("@/lib/knowledge/actions",()=>({adminListCompanyKnowledge:mocks.knowledge}));
vi.mock("@/lib/whatsapp/connection-actions",()=>({adminGetWhatsappCompanyLink:mocks.whatsapp}));
vi.mock("@/components/app/admin-company-detail",()=>({AdminCompanyDetail:()=>null}));
vi.mock("@/components/app/access-gate",()=>({AccessGate:()=>null}));
import Page from "./page";
beforeEach(()=>{
  vi.clearAllMocks();mocks.gate.mockResolvedValue({ok:true});
  mocks.rpc.mockResolvedValue({data:{company:{id:"synthetic-company"},members:[]},error:null});
  mocks.knowledge.mockResolvedValue({ok:false});mocks.whatsapp.mockResolvedValue({ok:false});
});
describe("company detail route return context",()=>{
  it.each(["/admin?companySearch=Synthetic&companyStatus=active#companies","/admin/billing?environment=test&cursor=synthetic"])("passes safe return %s to the detail view",async returnTo=>{
    const tree=await Page({params:Promise.resolve({id:"synthetic-company"}),searchParams:Promise.resolve({returnTo})});
    expect(tree.props.returnTo).toBe(returnTo);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_get_company",{p_company_id:"synthetic-company"});
  });
  it.each(["//evil.invalid",["/admin","/admin/billing"],"/app/settings"])("falls back for untrusted return %j",async returnTo=>{
    const tree=await Page({params:Promise.resolve({id:"synthetic-company"}),searchParams:Promise.resolve({returnTo})});
    expect(tree.props.returnTo).toBe("/admin#companies");
  });
  it("return context does not bypass the existing authorization gate",async()=>{
    mocks.gate.mockResolvedValue({ok:false,code:"UNAVAILABLE"});
    const tree=await Page({params:Promise.resolve({id:"synthetic-company"}),searchParams:Promise.resolve({returnTo:"/admin?companyStatus=active#companies"})});
    expect(tree.props.code).toBe("UNAVAILABLE");expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

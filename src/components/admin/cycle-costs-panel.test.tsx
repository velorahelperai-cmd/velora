import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {beforeEach,expect,it,vi} from "vitest";
const h=vi.hoisted(()=>({companies:vi.fn(),cycles:vi.fn(),report:vi.fn(),userId:"b5000000-0000-4000-8000-000000000009",role:"owner"}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
vi.mock("@/components/app/account-chrome",()=>({useOptionalAccountSession:()=>({status:"ready",identity:{userId:h.userId,platformIdentity:{role:h.role,status:"active"}}})}));
vi.mock("@/lib/billing/admin/cycle-cost-actions",()=>({readAdminCostCompaniesAction:h.companies,readAdminCostCyclesAction:h.cycles,readAdminCycleCostsAction:h.report}));
import {CycleCostReport,CycleCostsPanel} from "./cycle-costs-panel";
const id=(n:number)=>`b5000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const initial={ok:true as const,data:{actorUserId:id(9),companies:[{id:id(1),name:"Business A"}],next:null}};
beforeEach(()=>{vi.clearAllMocks();h.userId=id(9);h.role="owner";});
it("labels native tariff estimates, unsettled attempts and unknown final invoice without paid controls",()=>{
 const html=renderToStaticMarkup(<CycleCostReport ar={false} value={{companyId:id(1),cycleId:id(2),startsAt:"2026-10-01T00:00:00Z",expiresAt:"2026-10-31T00:00:00Z",basis:"native_usage_tariff_estimate",providerFinalCost:null,unsettledAttempts:1,groups:[{model:"gpt-6-luna",channel:"whatsapp",category:"compensation",attempts:1,estimated_baisa:0.125}]}}/>);
 expect(html).toContain("Compensation");expect(html).toContain("Unknown");expect(html).toContain("displayed total is incomplete");expect(html).toContain("0.000125");expect(html).not.toContain("<button");
});
it("requires explicit customer and cycle selection without automatic model calls",()=>{const html=renderToStaticMarkup(<CycleCostsPanel initialResult={initial}/>);expect(html).toContain("Business A");expect(html).toContain("Select a cycle");expect(html).toContain('disabled=""');expect(h.cycles).not.toHaveBeenCalled();expect(h.report).not.toHaveBeenCalled();});
it("hides native company data after account switch or delegation",()=>{h.userId=id(8);expect(renderToStaticMarkup(<CycleCostsPanel initialResult={initial}/>)).not.toContain("Business A");h.userId=id(9);h.role="delegated";expect(renderToStaticMarkup(<CycleCostsPanel initialResult={initial}/>)).not.toContain("Business A");});
it("keeps default-off or unavailable reads distinct from a zero-cost report",()=>{const html=renderToStaticMarkup(<CycleCostsPanel initialResult={{ok:false,code:"UNCONFIGURED"}}/>);expect(html).toContain("awaiting activation");expect(html).not.toContain("Recorded tariff estimate");});

import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,it,vi} from "vitest";
import {SetupWizard} from "./setup-wizard";
import type {CompanyRecord} from "@/lib/tenancy/types";
import type {PaidBranchSetupRead,PaidSetupStepId} from "@/lib/tenancy/paid-setup-contracts";
import {PaidAssistantChecklist,paidChecklistFromRead} from "./paid-assistant-checklist";

const session=vi.hoisted(()=>({status:"ready",identity:{userId:"account",companyId:"company"},boundaryFingerprint:"boundary",liveSnapshot:()=>({ready:true,userId:"account",boundaryFingerprint:"boundary"}),isCurrentUser:()=>true}));
vi.mock("./account-chrome",()=>({useOptionalAccountSession:()=>session,AccountMenu:()=>null}));
vi.mock("@/lib/demo-state",async original=>({...await original<typeof import("@/lib/demo-state")>(),useDemo:()=>({locale:"en"})}));
vi.mock("@/lib/tenancy/paid-setup-actions",()=>({readOwnedPaidBranchSetupEntryAction:vi.fn(),readOwnedPaidBranchSetupAction:vi.fn()}));

const scope={companyId:"company",branchId:"branch"};
const read:PaidBranchSetupRead={
 schemaVersion:1,sourceStatus:"selection_required",companyId:scope.companyId,selectedBranchId:scope.branchId,
 branches:[{id:scope.branchId,label:"Owned branch"}],entitlement:null,selectedChannels:null,steps:[],
 progress:{denominator:null,verified:0,skippedOptional:0},
 launch:{confirmationRequired:true,confirmed:false,canRequest:false,blockedReasons:["channel_selection_required"]},asOf:"2026-10-19T21:00:00Z",
};
it("preserves the real B1 unknowns without inventing progress or actionable steps",()=>{
 const model=paidChecklistFromRead(read,scope);
 expect(model).toEqual(read);
 const html=renderToStaticMarkup(createElement(PaidAssistantChecklist,{locale:"en",model}));
 expect(html).toContain("Channel selection has not yet been confirmed");
 expect(html).not.toContain("<progress");
 expect(html).not.toContain("data-step-id");
});
it.each([{companyId:"other",branchId:scope.branchId},{companyId:scope.companyId,branchId:"other"}])("rejects a mismatched server scope",expected=>{
 expect(paidChecklistFromRead(read,expected)).toBeNull();
});
it("maps every stable server step including optional team without changing status or action IDs",()=>{
 const ids:PaidSetupStepId[]=["connect_whatsapp","connect_instagram","hours","knowledge","assistant_test","launch"];
 const legacy=["connect_whatsapp","connect_instagram","hours","knowledge","assistant_test","invitations","launch"] as const;
 const snapshot={...read,steps:legacy.map(id=>({id:id as PaidSetupStepId,required:id!=="invitations",status:"blocked" as const,dependencyIds:[...legacy] as PaidSetupStepId[],reasonCodes:["server_reason"],actionId:"server_action"}))};
 const mapped=paidChecklistFromRead(snapshot,scope)!;
 const expected=["whatsapp","instagram","hours","knowledge","test","team","launch"];
 expect(mapped.steps.map(s=>s.id)).toEqual(expected);
 for(const step of mapped.steps){expect(step.dependencyIds).toEqual(expected);expect(step.status).toBe("blocked");expect(step.actionId).toBe("server_action");}
 expect(mapped.launch).toEqual(snapshot.launch);
 expect(ids).toEqual(["connect_whatsapp","connect_instagram","hours","knowledge","assistant_test","launch"]);
});
it("renders nullable unavailable readback as unavailable",()=>{
 const model=paidChecklistFromRead({...read,sourceStatus:"unavailable"},scope);
 const html=renderToStaticMarkup(createElement(PaidAssistantChecklist,{locale:"en",model}));
 expect(html).toContain("Setup could not be loaded");expect(html).not.toContain("data-step-id");
});
it("mounts the read-only paid flow from the real confirmed-company wizard",()=>{
 const html=renderToStaticMarkup(createElement(SetupWizard,{userId:"account",initialCompany:{id:"company"} as CompanyRecord}));
 expect(html).toContain("Loading branch setup");
 expect(html).not.toContain("Working Hours");
});
it("does not mount company content for another session account",()=>{
 const html=renderToStaticMarkup(createElement(SetupWizard,{userId:"other-account",initialCompany:{id:"company"} as CompanyRecord}));
 expect(html).toContain("Setup could not be loaded");
 expect(html).not.toContain("Loading branch setup");
});

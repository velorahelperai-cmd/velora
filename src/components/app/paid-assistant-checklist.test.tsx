import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it,vi } from "vitest";
vi.mock("@/lib/tenancy/paid-setup-workspace-actions",()=>({readOwnedPaidSetupWorkspaceAction:vi.fn()}));
import { PaidAssistantChecklist, type PaidChecklistModel, checklistSteps } from "./paid-assistant-checklist";
import {setupBranchFromReturn,whatsappSetupPath} from "@/lib/auth/setup-return";
it("restores only a candidate branch, keeping the existing paid branch fence",()=>{
 const branch="11111111-1111-4111-8111-111111111111";
 expect(setupBranchFromReturn(`/setup?branch=${branch}`)).toBe(branch);
 expect(whatsappSetupPath(branch)).toBe(`/setup/branches/${branch}/whatsapp`);
 expect(setupBranchFromReturn(`/setup?branch=${branch}&branch=${branch}`)).toBe("");
});
const model:PaidChecklistModel={
 schemaVersion:1,sourceStatus:"ready",companyId:"c1",selectedBranchId:"b1",branches:[{id:"b1",label:"Branch"}],
 entitlement:{slotIndex:0,persona:"level_2",package:"basic",maxChannels:1,employeesExcludingOwner:2},
 selectedChannels:["instagram"],steps:[
 {id:"instagram",required:true,dependencyIds:[],status:"pending",reasonCodes:[],actionId:"connect"},
 ...(["hours","knowledge","language","test","team","launch"] as const).map(id=>({id,required:id!=="team",dependencyIds:["instagram" as const],status:"blocked" as const,reasonCodes:[],actionId:null})),
 ],progress:{denominator:7,verified:0,skippedOptional:0},
 launch:{confirmationRequired:true,confirmed:false,canRequest:false,blockedReasons:[]},asOf:"2026-10-19T21:00:00Z",
};
const render=(m:PaidChecklistModel|null,extra={})=>renderToStaticMarkup(createElement(PaidAssistantChecklist,{locale:"en",model:m,...extra}));
it("shows only purchased channels in prescribed order",()=>{
 expect(checklistSteps(model).map(s=>s.id)).toEqual(["instagram","hours","knowledge","language","test","team","launch"]);
 const html=render(model);expect(html).toContain("Connect Instagram");expect(html).not.toContain("Connect WhatsApp");expect(html).toContain("0 / 7");expect(html).not.toContain("data-fixture-step");
});
it("fails closed for incomplete entitlement snapshots",()=>{
 expect(checklistSteps({...model,selectedChannels:["whatsapp","instagram"]})).toEqual([]);
});
it("keeps skipped invitations separate from completion",()=>{
 const updated={...model,steps:model.steps.map(s=>s.id==="team"?{...s,status:"skipped_optional" as const}:s),progress:{...model.progress,skippedOptional:1}};
 expect(render(updated)).toContain("Skipped");expect(render(updated)).toContain("0 / 7");
});
it("does not assume a channel when selection is required",()=>{
 const html=render({...model,sourceStatus:"selection_required",selectedChannels:null});
 expect(html).toContain("Channel selection has not yet been confirmed");expect(html).not.toContain("data-step-id");
});
it("does not expose fixture navigation during server rendering",()=>{
 const html=render(model,{localFixtureInspection:true});
 expect(html).not.toContain("data-fixture-step");expect(html).not.toContain(">Review launch</button>");
});
it("accepts both channels only with the matching eight-step server snapshot",()=>{
 const both:PaidChecklistModel={...model,entitlement:{...model.entitlement!,maxChannels:2},selectedChannels:["whatsapp","instagram"],steps:[{...model.steps[0],id:"whatsapp"},...model.steps],progress:{...model.progress,denominator:8}};
 expect(checklistSteps(both).map(s=>s.id).slice(0,2)).toEqual(["whatsapp","instagram"]);expect(render(both)).toContain("0 / 8");
});
it.each(["loading","unavailable","empty"] as const)("does not expose setup actions while %s",kind=>{
 const html=render(kind==="unavailable"?null:kind==="empty"?{...model,branches:[]}:model,{loading:kind==="loading",locale:"ar"});
 expect(html).not.toContain("data-step-id");expect(html).toContain('dir="rtl"');
});
it("keeps launch review unavailable when server permission is false even with verified prerequisites",()=>{
 const ready:PaidChecklistModel={...model,steps:model.steps.map(s=>({...s,status:s.id==="launch"?"pending":"verified",actionId:s.id})),progress:{denominator:7,verified:6,skippedOptional:0}};
 expect(render(ready,{onReviewLaunch:()=>{throw Error("Render must not request launch");}})).not.toContain(">Review launch</button>");
});
it("requires both server launch permission and satisfied dependencies",()=>{
 const permission={...model,launch:{...model.launch,canRequest:true}};
 expect(render(permission,{onReviewLaunch:()=>{}})).not.toContain(">Review launch</button>");
 const ready:PaidChecklistModel={...permission,steps:permission.steps.map(s=>({...s,status:s.id==="launch"?"pending":"verified",actionId:s.id})),progress:{denominator:7,verified:6,skippedOptional:0}};
 expect(render(ready,{onReviewLaunch:()=>{throw Error("Render must not request launch");}})).toContain(">Review launch</button>");
 expect(render(ready)).not.toContain(">Review launch</button>");
});
it.each([null,[]] as const)("does not fabricate a channel for an unresolved ready snapshot",selectedChannels=>{
 expect(render({...model,selectedChannels})).not.toContain("data-step-id");
});
it("does not render actionable rows for a branch absent from the server branch list",()=>{
 expect(render({...model,selectedBranchId:"foreign"},{onOpenStep:()=>{}})).not.toContain("data-step-id");
});
it("rejects duplicate rows and a required step labelled skipped",()=>{
 expect(checklistSteps({...model,steps:[model.steps[0],model.steps[0],...model.steps.slice(2)]})).toEqual([]);
 expect(checklistSteps({...model,steps:model.steps.map(s=>s.id==="knowledge"?{...s,status:"skipped_optional"}:s)})).toEqual([]);
});

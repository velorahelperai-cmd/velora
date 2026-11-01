// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {CoexistenceImportPanel,coexistenceImportRemaining,type CoexistenceImportPorts,type CoexistenceImportSetup} from "./coexistence-import-panel";

let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const NOW=Date.parse("2026-11-01T10:00:00Z");
const item=(syncType:"history"|"smb_app_state_sync",o:Partial<{state:string;requested:boolean;declined:boolean;errorCode:number|null}>={})=>({syncType,state:"not_requested",requested:false,declined:false,errorCode:null,...o});
const setup=(o:Partial<CoexistenceImportSetup>={}):CoexistenceImportSetup=>({ok:true,linkId:"11111111-1111-4111-8111-111111111111",linkGeneration:2,ready:true,deadlineAt:"2026-11-01T20:30:00Z",syncs:[item("history"),item("smb_app_state_sync")],...o});
function ports(reads:CoexistenceImportSetup[],request=vi.fn<CoexistenceImportPorts["request"]>(async()=>({ok:true as const}))){
 let i=0;const read=vi.fn(async()=>reads[Math.min(i++,reads.length-1)]);
 return {read,request,now:()=>NOW} satisfies CoexistenceImportPorts;
}
async function render(p:CoexistenceImportPorts,locale:"ar"|"en"="ar"){await act(async()=>root.render(createElement(CoexistenceImportPanel,{companyId:"co",locale,ports:p})));}
const button=()=>host.querySelector<HTMLButtonElement>("button")!;

it("never requests a sync on mount; only reads status",async()=>{
 const p=ports([setup()]);await render(p);
 expect(p.read).toHaveBeenCalledTimes(1);expect(p.request).not.toHaveBeenCalled();
 expect(button().textContent).toBe("استيراد جهات الاتصال والمحادثات");expect(button().disabled).toBe(false);
});
it("requests contacts first, then history, on one explicit click",async()=>{
 const done=setup({syncs:[item("history",{state:"pending",requested:true}),item("smb_app_state_sync",{state:"pending",requested:true})]});
 const p=ports([setup(),done]);await render(p,"en");
 await act(async()=>button().click());
 expect(p.request.mock.calls.map(c=>(c as unknown as [{syncType:string}])[0].syncType)).toEqual(["smb_app_state_sync","history"]);
 expect(p.request).toHaveBeenCalledWith(expect.objectContaining({companyId:"co",linkGeneration:2,consent:true}));
 expect(button().disabled).toBe(true);
});
it("is idempotent: skips already-requested contacts and blocks double clicks",async()=>{
 const p=ports([setup({syncs:[item("history"),item("smb_app_state_sync",{state:"syncing",requested:true})]})]);
 let release:()=>void=()=>{};p.request.mockImplementation(()=>new Promise(r=>{release=()=>r({ok:true});}));
 await render(p);
 await act(async()=>{button().click();button().click();});
 await act(async()=>release());
 expect(p.request).toHaveBeenCalledTimes(1);expect(p.request).toHaveBeenCalledWith(expect.objectContaining({syncType:"history"}));
});
it("stops before history when contacts fail",async()=>{
 const p=ports([setup()],vi.fn<CoexistenceImportPorts["request"]>(async()=>({ok:false as const,code:"UNAVAILABLE"})));await render(p,"en");
 await act(async()=>button().click());
 expect(p.request).toHaveBeenCalledTimes(1);expect(host.querySelector('[role="alert"]')!.textContent).toContain("Chat history was not requested");
});
it("shows the countdown, warns near the deadline and disables after 24h",async()=>{
 await render(ports([setup()]),"en");expect(host.textContent).toContain("Time left: 10h 30m");
 expect(host.querySelector("[data-import-deadline]")!.getAttribute("data-import-deadline")).toBe("open");
 await act(async()=>root.unmount());root=createRoot(host);
 await render(ports([setup({deadlineAt:"2026-11-01T11:00:00Z"})]),"en");
 expect(host.querySelector("[data-import-deadline]")!.getAttribute("data-import-deadline")).toBe("warning");
 expect(host.querySelector('[data-import-deadline]')!.getAttribute("role")).toBe("alert");
 await act(async()=>root.unmount());root=createRoot(host);
 const p=ports([setup({deadlineAt:"2026-11-01T09:00:00Z"})]);await render(p,"en");
 expect(button().disabled).toBe(true);expect(host.textContent).toContain("The 24-hour window has ended");
});
it("reports history declined in the app (2593109) and does not retry",async()=>{
 const p=ports([setup({syncs:[item("history",{state:"failed",requested:true,declined:true,errorCode:2593109}),item("smb_app_state_sync",{state:"syncing",requested:true})]})]);
 await render(p,"en");expect(host.querySelector('[data-sync-state="history"]')!.textContent).toContain("Declined");expect(button().disabled).toBe(true);
});
it("fails closed when status is unavailable or the server is not ready",async()=>{
 await render({read:vi.fn(async()=>({ok:false as const})),request:vi.fn()},"en");expect(host.querySelector("button")).toBeNull();expect(host.querySelector("[data-coexistence-import]")!.getAttribute("data-coexistence-import")).toBe("unavailable");
 await act(async()=>root.unmount());root=createRoot(host);
 await render(ports([setup({ready:false})]),"en");expect(button().disabled).toBe(true);
});
it("computes remaining time defensively",()=>{
 expect(coexistenceImportRemaining(null,NOW)).toBeNull();expect(coexistenceImportRemaining("bad",NOW)).toBeNull();
 expect(coexistenceImportRemaining("2026-11-01T09:00:00Z",NOW)).toBe(0);
});

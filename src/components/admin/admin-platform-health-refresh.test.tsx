// @vitest-environment jsdom
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {AdminPlatformHealth} from "./admin-platform-health";
import type {PlatformHealthOverviewData} from "@/lib/tenancy/health-types";
const load=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/tenancy/health-actions",()=>({adminGetPlatformHealthOverview:load}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
vi.mock("@/components/app/access-gate",()=>({AccessGate:({code}:{code:string})=><p role="alert">{code}</p>}));
const data:PlatformHealthOverviewData={kpis:{overallStatus:"HEALTHY",dbLatencyMs:17,authStatus:"HEALTHY",paymentGatewayMode:"TEST_MODE_GUARDED",aiRouterStatus:"UNKNOWN"},probes:[{id:"db",nameAr:"",nameEn:"Last good probe",category:"database",status:"HEALTHY",latencyMs:17,detailsAr:"",detailsEn:"Saved evidence",lastCheckedAt:"2026-10-26T10:00:00Z"}],invariants:[],evaluatedAt:"2026-10-26T10:00:00Z"};
let host:HTMLDivElement,root:Root;
beforeEach(async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});load.mockReset();host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root.render(<AdminPlatformHealth data={data}/>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it("keeps pending until the real result, prevents duplicate calls and keeps last good data on failure",async()=>{
 let resolve!:(value:unknown)=>void;load.mockReturnValue(new Promise(r=>resolve=r));
 await act(async()=>{host.querySelector("button")!.click();host.querySelector("button")!.click();});
 expect(load).toHaveBeenCalledTimes(1);expect(host.querySelector("button")!.disabled).toBe(true);
 await act(async()=>resolve({ok:false,code:"UNAVAILABLE"}));
 expect(host.querySelector("button")!.disabled).toBe(false);expect(host.textContent).toContain("Last good probe");expect(host.querySelector('[role="alert"]')?.textContent).toContain("last successful result");
 load.mockResolvedValue({ok:true,data:{...data,probes:[{...data.probes[0],nameEn:"Fresh probe"}],evaluatedAt:"2026-10-26T11:00:00Z"}});
 await act(async()=>host.querySelector("button")!.click());expect(host.textContent).toContain("Fresh probe");expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("hides the old snapshot when permissions are revoked",async()=>{load.mockResolvedValue({ok:false,code:"FORBIDDEN"});await act(async()=>host.querySelector("button")!.click());expect(host.textContent).toBe("FORBIDDEN");expect(host.textContent).not.toContain("Last good probe");});
it("does not let an old response overwrite a new server snapshot",async()=>{let resolve!:(value:unknown)=>void;load.mockReturnValue(new Promise(r=>resolve=r));await act(async()=>host.querySelector("button")!.click());const fresh={...data,probes:[{...data.probes[0],nameEn:"New account snapshot"}]};await act(async()=>root.render(<AdminPlatformHealth data={fresh}/>));await act(async()=>resolve({ok:true,data}));expect(host.textContent).toContain("New account snapshot");});
it("keeps prior evidence after a network exception",async()=>{load.mockRejectedValue(new Error("offline"));await act(async()=>host.querySelector("button")!.click());expect(host.textContent).toContain("Last good probe");expect(host.querySelector('[role="alert"]')).not.toBeNull();});

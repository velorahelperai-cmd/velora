// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {AdminAIOperations} from "./admin-ai-operations";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/answers/runtime/admin-actions",()=>({readAdminAIState:read,runAdminAITrial:vi.fn()}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
vi.mock("@/components/app/synthetic-gemini-console",()=>({SyntheticGeminiConsole:()=>null}));
it("removes the prior protected snapshot when access is no longer verified",async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(<AdminAIOperations initial={{budget:{limit_baisa:25000,spent_baisa:0,held_baisa:0,enabled:true},companies:[{id:"company",name:"Private business",status:"active"}],models:[],recent:[]}}/>));
  expect(host.textContent).toContain("Private business");
  read.mockResolvedValue({ok:false,error:"OWNER_REQUIRED"});
  const refresh=Array.from(host.querySelectorAll("button")).find(button=>button.textContent?.includes("Refresh Usage"))!;
  await act(async()=>refresh.click());
  expect(host.textContent).not.toContain("Private business");
  expect(host.textContent).toContain("Could not verify access");
 } finally {await act(async()=>root.unmount());host.remove();}
});

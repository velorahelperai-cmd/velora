import {beforeEach,describe,expect,it,vi} from "vitest";
import type {ReactNode} from "react";
import type {AdminAIState} from "@/lib/answers/runtime/admin-types";
import type {SyntheticGeminiFreeState} from "@/lib/answers/runtime/synthetic-gemini-types";
type Slot={value?:unknown;deps?:unknown[];cleanup?:()=>void};
type Driver={slots:Slot[];cursor:number;effects:Array<()=>void>;mounted:boolean;lateWrites:number};
const mocked=vi.hoisted(()=>({driver:null as Driver|null,locale:"en",paidRead:vi.fn(),freeRead:vi.fn(),paidRun:vi.fn(),freeRun:vi.fn()}));
vi.mock("react",async()=>{
 const actual=await vi.importActual<typeof import("react")>("react");
 const slot=()=>{const d=mocked.driver!;return {d,s:d.slots[d.cursor++]??(d.slots[d.cursor-1]={})};};
 const changed=(a:unknown[]|undefined,b:unknown[])=>!a||a.length!==b.length||b.some((v,i)=>!Object.is(a[i],v));
 return {...actual,
  useState(initial:unknown){const {d,s}=slot();if(!("value" in s))s.value=typeof initial==="function"?(initial as ()=>unknown)():initial;return [s.value,(value:unknown)=>{if(!d.mounted){d.lateWrites++;return;}s.value=typeof value==="function"?(value as (v:unknown)=>unknown)(s.value):value;}];},
  useRef(value:unknown){const {s}=slot();if(!s.value)s.value={current:value};return s.value;},
  useMemo(fn:()=>unknown,deps:unknown[]){const {s}=slot();if(changed(s.deps,deps)){s.value=fn();s.deps=deps;}return s.value;},
  useEffect(fn:()=>void|(()=>void),deps:unknown[]){const {d,s}=slot();if(changed(s.deps,deps)){d.effects.push(()=>{s.cleanup?.();s.cleanup=fn()||undefined;});s.deps=deps;}},
 };
});
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:mocked.locale})}));
vi.mock("@/lib/answers/runtime/admin-actions",()=>({readAdminAIState:mocked.paidRead,runAdminAITrial:mocked.paidRun}));
vi.mock("@/lib/answers/runtime/synthetic-gemini-actions",()=>({readSyntheticGeminiFreeState:mocked.freeRead,runSyntheticGeminiFreeTest:mocked.freeRun}));
vi.mock("./ui",()=>({Button:"button",Notice:"aside"}));
vi.mock("next/link",()=>({default:"a"}));
import {AdminAIConsole} from "./admin-ai-console";
import {SyntheticGeminiConsole} from "./synthetic-gemini-console";
type Node={props:Record<string,unknown>};
function nodes(value:unknown):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=="object"||!("props" in value))return [];const node=value as Node;return [node,...nodes(node.props.children)];}
function text(value:unknown):string{if(Array.isArray(value))return value.map(text).join(" ");if(value&&typeof value==="object"&&"props" in value)return text((value as Node).props.children);return typeof value==="string"||typeof value==="number"?String(value):"";}
function mount<P>(component:(props:P)=>ReactNode,initial:P){
 const driver:Driver={slots:[],cursor:0,effects:[],mounted:true,lateWrites:0};let props=initial,tree:ReactNode;
 function render(next=props){props=next;driver.cursor=0;mocked.driver=driver;tree=component(props);mocked.driver=null;driver.effects.splice(0).forEach(fn=>fn());return tree;}
 render();return {render,tree:()=>tree,unmount(){driver.slots.forEach(s=>s.cleanup?.());driver.mounted=false;},driver};
}
const flush=async()=>{for(let n=0;n<6;n++)await Promise.resolve();};
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:Error)=>void;const promise=new Promise<T>((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};}
const snapshot=(name="Tenant A",spent=123):AdminAIState=>({budget:{enabled:true,limit_baisa:1000,spent_baisa:spent,held_baisa:10},companies:[{id:"a",name,status:"active"}],models:[],recent:[]});
const ready:SyntheticGeminiFreeState={ready:true,code:"READY",projectRef:"synthetic-project",modelId:"gemini-3.8-flash",expiresAt:"2099-01-01T00:00:00Z"};
beforeEach(()=>{vi.clearAllMocks();mocked.locale="en";});
describe("owner AI refresh controls",()=>{
 for(const kind of ["paid","free"] as const){
  const setup=()=>kind==="paid"?mount(AdminAIConsole,{initial:snapshot()}):mount(SyntheticGeminiConsole,{initial:ready,ar:false});
  const read=()=>kind==="paid"?mocked.paidRead:mocked.freeRead;
  const label=kind==="paid"?"Refresh usage":"Refresh test readiness";
  const click=(h:ReturnType<typeof setup>)=>{const n=nodes(h.tree()).find(n=>text(n.props.children)===label)!;(n.props.onClick as ()=>void)();};
  const refreshButton=(h:ReturnType<typeof setup>)=>nodes(h.tree()).find(n=>text(n.props.children)===label)!;
  it(kind+": rejected refresh is caught, visible and retryable without a provider call",async()=>{
   read().mockRejectedValueOnce(new Error("SYNTHETIC_TRANSPORT_FAILURE"));const h=setup();click(h);await flush();h.render();
   expect(nodes(h.tree()).some(n=>n.props.role==="alert"&&/refresh/i.test(text(n)))).toBe(true);
   expect(refreshButton(h).props.disabled).toBe(false);
   expect(text(h.tree())).toContain(kind==="paid"?"Tenant A":"synthetic-project");
   expect(mocked.paidRun).not.toHaveBeenCalled();expect(mocked.freeRun).not.toHaveBeenCalled();
  });
  it(kind+": rapid repeated refresh has one pending read and announces loading",async()=>{
   const pending=deferred<unknown>();read().mockReturnValue(pending.promise);const h=setup();click(h);click(h);h.render();
   expect(read()).toHaveBeenCalledTimes(1);expect(refreshButton(h).props.disabled).toBe(true);expect(refreshButton(h).props.busy).toBe(true);
   expect(nodes(h.tree()).some(n=>n.props.role==="status"&&/refreshing/i.test(text(n)))).toBe(true);
   pending.resolve({ok:true,data:kind==="paid"?snapshot("fresh",0):ready});await flush();h.render();expect(refreshButton(h).props.disabled).toBe(false);
   click(h);expect(read()).toHaveBeenCalledTimes(2);
  });
  it(kind+": unmount discards a pending response and performs no late state writes",async()=>{
   const pending=deferred<unknown>();read().mockReturnValue(pending.promise);const h=setup();click(h);h.unmount();pending.resolve({ok:true,data:kind==="paid"?snapshot("old response"):ready});await flush();
   expect(h.driver.lateWrites).toBe(0);
  });
  it(kind+": changed server context ignores older success and older failure",async()=>{
   for(const failed of [false,true]){
    const pending=deferred<unknown>();read().mockReturnValueOnce(pending.promise);const h=setup();click(h);
    const next=kind==="paid"?{initial:snapshot("Tenant B")}:{initial:{...ready,projectRef:"new-project"},ar:false};
    h.render(next as never);
    if(failed)pending.reject(new Error("STALE"));else pending.resolve({ok:true,data:kind==="paid"?snapshot("STALE"):ready});
    await flush();h.render();expect(text(h.tree())).toContain(kind==="paid"?"Tenant B":"new-project");expect(text(h.tree())).not.toContain("STALE");
    expect(nodes(h.tree()).some(n=>n.props.role==="alert")).toBe(false);expect(refreshButton(h).props.disabled).toBe(false);
   }
  });
 }
 it("paid: a confirmed zero remains a numeric zero; unknown refresh does not invent one",async()=>{
  const h=mount(AdminAIConsole,{initial:snapshot("Tenant A",123)});mocked.paidRead.mockResolvedValueOnce({ok:true,data:snapshot("zero",0)});
  const click=()=>{(nodes(h.tree()).find(n=>text(n.props.children)==="Refresh usage")!.props.onClick as ()=>void)();};
  click();await flush();h.render();expect(text(h.tree())).toContain("0.000");
  mocked.paidRead.mockResolvedValueOnce({ok:true,data:{...snapshot("UNKNOWN"),budget:null}});click();await flush();h.render();
  expect(text(h.tree())).not.toContain("UNKNOWN");expect(nodes(h.tree()).some(n=>n.props.role==="alert")).toBe(true);
 });
 it("paid: revoked owner gate hides old owner data until a new authorized snapshot",async()=>{
  const h=mount(AdminAIConsole,{initial:snapshot("sensitive-name")});mocked.paidRead.mockResolvedValueOnce({ok:false,error:"OWNER_REQUIRED"});
  const click=()=>{(nodes(h.tree()).find(n=>text(n.props.children)==="Refresh usage")!.props.onClick as ()=>void)();};
  click();await flush();h.render();expect(text(h.tree())).not.toContain("sensitive-name");expect(nodes(h.tree()).some(n=>n.props.role==="alert")).toBe(true);
  mocked.paidRead.mockResolvedValueOnce({ok:true,data:snapshot("authorized-again")});click();await flush();h.render();expect(text(h.tree())).toContain("authorized-again");
 });
 it("free: structured readiness denial blocks execution without claiming readiness",async()=>{
  const h=mount(SyntheticGeminiConsole,{initial:ready,ar:false});mocked.freeRead.mockResolvedValueOnce({ok:false,error:"OWNER_REQUIRED"});
  (nodes(h.tree()).find(n=>text(n.props.children)==="Refresh test readiness")!.props.onClick as ()=>void)();await flush();h.render();
  expect(text(h.tree())).toContain("OWNER_REQUIRED");expect(text(h.tree())).not.toContain("synthetic-project");
  const form=nodes(h.tree()).find(n=>typeof n.props.onSubmit==="function")!;await (form.props.onSubmit as (e:unknown)=>Promise<void>)({preventDefault(){}});
  expect(mocked.freeRun).not.toHaveBeenCalled();
 });
 it("free: refresh never clears the one-shot latch, even after context replacement",async()=>{
  const h=mount(SyntheticGeminiConsole,{initial:ready,ar:false});
  (nodes(h.tree()).find(n=>n.props.type==="checkbox")!.props.onChange as (e:unknown)=>void)({target:{checked:true}});h.render();
  mocked.freeRun.mockResolvedValueOnce({ok:false,error:"SYNTHETIC_OUTCOME_UNVERIFIED"});
  await (nodes(h.tree()).find(n=>typeof n.props.onSubmit==="function")!.props.onSubmit as (e:unknown)=>Promise<void>)({preventDefault(){}});h.render();
  mocked.freeRead.mockResolvedValueOnce({ok:true,data:ready});(nodes(h.tree()).find(n=>text(n.props.children)==="Refresh test readiness")!.props.onClick as ()=>void)();await flush();h.render();
  h.render({initial:{...ready,projectRef:"context-replaced"},ar:false});
  await (nodes(h.tree()).find(n=>typeof n.props.onSubmit==="function")!.props.onSubmit as (e:unknown)=>Promise<void>)({preventDefault(){}});
  expect(mocked.freeRun).toHaveBeenCalledTimes(1);
 });
 it("locale change scopes refresh status and does not apply the previous locale response",async()=>{
  const pending=deferred<unknown>();mocked.paidRead.mockReturnValueOnce(pending.promise);const initial=snapshot("before");const h=mount(AdminAIConsole,{initial});
  (nodes(h.tree()).find(n=>text(n.props.children)==="Refresh usage")!.props.onClick as ()=>void)();mocked.locale="ar";h.render();pending.resolve({ok:true,data:snapshot("STALE")});await flush();h.render();
  expect(text(h.tree())).not.toContain("STALE");expect(text(h.tree())).toContain("\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0627\u0633\u062a\u0647\u0644\u0627\u0643");
 });

 for(const kind of ["paid","free"] as const){
  it(kind+": locale replacement preserves a confirmed refresh failure gate",async()=>{
   const initial=kind==="paid"?snapshot():ready;
   const h=kind==="paid"?mount(AdminAIConsole,{initial:initial as AdminAIState}):mount(SyntheticGeminiConsole,{initial:initial as SyntheticGeminiFreeState,ar:false});
   const read=kind==="paid"?mocked.paidRead:mocked.freeRead;
   read.mockRejectedValueOnce(new Error("UNKNOWN"));
   (nodes(h.tree()).find(n=>text(n.props.children)===(kind==="paid"?"Refresh usage":"Refresh test readiness"))!.props.onClick as ()=>void)();await flush();h.render();
   if(kind==="paid"){mocked.locale="ar";h.render();}
   else h.render({initial,ar:true} as never);
   expect(nodes(h.tree()).some(n=>n.props.role==="alert")).toBe(true);
   expect(nodes(h.tree()).find(n=>n.props.type==="submit")!.props.disabled).toBeTruthy();
  });
 }
 it("composed parent recovery retains the Free one-shot attempt after a child remount",async()=>{
  const initial=snapshot();const parent=mount(AdminAIConsole,{initial,freeState:ready});
  const freeNode=()=>nodes(parent.tree()).find(n=>(n as unknown as {type:unknown}).type===SyntheticGeminiConsole);
  const child=mount(SyntheticGeminiConsole,freeNode()!.props as {initial:SyntheticGeminiFreeState;ar:boolean});
  (nodes(child.tree()).find(n=>n.props.type==="checkbox")!.props.onChange as (e:unknown)=>void)({target:{checked:true}});child.render();
  mocked.freeRun.mockResolvedValue({ok:false,error:"SYNTHETIC_OUTCOME_UNVERIFIED"});
  await (nodes(child.tree()).find(n=>typeof n.props.onSubmit==="function")!.props.onSubmit as (e:unknown)=>Promise<void>)({preventDefault(){}});parent.render();
  const refresh=()=>{(nodes(parent.tree()).find(n=>text(n.props.children)==="Refresh usage")!.props.onClick as ()=>void)();};
  mocked.paidRead.mockResolvedValueOnce({ok:false,error:"OWNER_REQUIRED"});refresh();await flush();parent.render();expect(freeNode()).toBeUndefined();child.unmount();
  mocked.paidRead.mockResolvedValueOnce({ok:true,data:initial});refresh();await flush();parent.render();
  const recovered=mount(SyntheticGeminiConsole,freeNode()!.props as {initial:SyntheticGeminiFreeState;ar:boolean});
  (nodes(recovered.tree()).find(n=>n.props.type==="checkbox")!.props.onChange as (e:unknown)=>void)({target:{checked:true}});recovered.render();
  await (nodes(recovered.tree()).find(n=>typeof n.props.onSubmit==="function")!.props.onSubmit as (e:unknown)=>Promise<void>)({preventDefault(){}});
  expect(mocked.freeRun).toHaveBeenCalledTimes(1);
 });

});

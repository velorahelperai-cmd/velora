import {beforeEach,describe,expect,it,vi} from "vitest";
import type {ReactNode} from "react";
import {readFileSync} from "node:fs";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import {useServerDraftField} from "./draft-refresh";
import {useWhatsappRequestReadback} from "./whatsapp-request-readback";
import type {WhatsappCompanyLink} from "@/lib/whatsapp/connection";

type Slot={value?:unknown;deps?:unknown[];cleanup?:()=>void};
type Driver={slots:Slot[];cursor:number;effects:Array<()=>void>;mounted:boolean;lateWrites:number};
const mocked=vi.hoisted(()=>({driver:null as Driver|null,locale:"en",read:vi.fn(),save:vi.fn(),next:vi.fn()}));
vi.mock("react",async()=>{
 const actual=await vi.importActual<typeof import("react")>("react");
 const slot=()=>{const d=mocked.driver!;return {d,s:d.slots[d.cursor++]??(d.slots[d.cursor-1]={})};};
 const changed=(a:unknown[]|undefined,b:unknown[])=>!a||a.length!==b.length||b.some((v,i)=>!Object.is(a[i],v));
 return {...actual,
  useState(initial:unknown){const {d,s}=slot();if(!("value" in s))s.value=typeof initial==="function"?(initial as ()=>unknown)():initial;return [s.value,(value:unknown)=>{if(!d.mounted){d.lateWrites++;return;}s.value=typeof value==="function"?(value as (v:unknown)=>unknown)(s.value):value;}];},
  useRef(value:unknown){const {s}=slot();if(!s.value)s.value={current:value};return s.value;},
  useMemo(fn:()=>unknown,deps:unknown[]){const {s}=slot();if(changed(s.deps,deps)){s.value=fn();s.deps=deps;}return s.value;},
  useCallback(fn:unknown,deps:unknown[]){const {s}=slot();if(changed(s.deps,deps)){s.value=fn;s.deps=deps;}return s.value;},
  useEffect(fn:()=>void|(()=>void),deps:unknown[]){const {d,s}=slot();if(changed(s.deps,deps)){d.effects.push(()=>{s.cleanup?.();s.cleanup=fn()||undefined;});s.deps=deps;}},
 };
});
type Node={props:Record<string,unknown>};
function nodes(value:unknown):Node[]{if(typeof value==="function")return nodes(value({}));if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=="object"||!("props" in value))return [];const node=value as Node;return [node,...nodes(node.props.children)];}
function text(value:unknown):string{if(Array.isArray(value))return value.map(text).join(" ");if(value&&typeof value==="object"&&"props" in value)return text((value as Node).props.children);return typeof value==="string"||typeof value==="number"?String(value):"";}
function mount<P>(component:(props:P)=>ReactNode,initial:P){
 const driver:Driver={slots:[],cursor:0,effects:[],mounted:true,lateWrites:0};let props=initial,tree:ReactNode;
 function render(next=props){props=next;driver.cursor=0;mocked.driver=driver;tree=component(props);mocked.driver=null;driver.effects.splice(0).forEach(fn=>fn());return tree;}
 render();return {render,tree:()=>tree,unmount(){driver.slots.forEach(s=>s.cleanup?.());driver.mounted=false;},driver};
}
const flush=async()=>{for(let n=0;n<6;n++)await Promise.resolve();};
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:Error)=>void;const promise=new Promise<T>((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};}

vi.mock("@/lib/whatsapp/connection-actions",()=>({getWhatsappCompanyLink:mocked.read}));
const source=readFileSync(new URL("./setup-wizard.tsx",import.meta.url),"utf8");
const start=source.indexOf("function WhatsAppStep("),end=source.indexOf("\n/* ========================================================================= */",start);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const copy={setup:{numberOwnership:"Ownership",ownNumber:"Own",newNumber:"New",whatsappNumber:"Number",continue:"Continue"},errors:{phone:"Invalid phone"},knowledge:{needCompanyFirst:"Need company"},app:{waLinkSaveFailed:"Failed",waLinkKeepOnPhone:"Keep on phone"},loading:"Loading",back:"Back",unsaved:"Unsaved"};
const makeStep=(busy=false)=>new Function("exports","require","useState","useEffect","useRef","useMemo","useDemo","useAppCopy","useAction","useUnsavedWarning","useServerDraftField","saveWhatsappLinkRequest","Button","Field","Notice","isPhone","styles",code+";return WhatsAppStep;")(
 {},()=>jsxRuntime,React.useState,React.useEffect,React.useRef,React.useMemo,()=>({locale:mocked.locale}),()=>copy,()=>({busy,run:(fn:()=>Promise<void>)=>fn()}),()=>{},useServerDraftField,mocked.save,"button",({children}:{children:(props:object)=>ReactNode})=>children({}),"aside",(v:string)=>v.length>5,{}
) as (props:Record<string,unknown>)=>ReactNode;
const link=(companyId="a",number="+968 95555555",keep=true):WhatsappCompanyLink=>({id:"request-a",companyId,requestedDisplayNumber:number,keepOnPhone:keep,status:"request_saved",verifiedDisplayNumber:null,inboundTestedAt:null,outboundTestedAt:null,receptionSendTested:false,priorLinkEvidence:false,lastErrorCode:null,createdAt:null,updatedAt:"1"});
const props=(saved:WhatsappCompanyLink|null=link(),companyId="a")=>({userId:"u",companyId,link:saved,linkStatus:"ready",refreshLink:vi.fn(),onLinkSaved:vi.fn(),leaveGuardRef:{current:null},draft:{business:{contactPhone:"+968 91111111"}},onBack:vi.fn(),onNext:mocked.next});
const phone=(h:{tree:()=>ReactNode})=>nodes(h.tree()).find(n=>n.props.inputMode==="tel")!;
const checkbox=(h:{tree:()=>ReactNode})=>nodes(h.tree()).find(n=>n.props.type==="checkbox")!;
beforeEach(()=>{vi.clearAllMocks();mocked.locale="en";});
describe("WhatsApp saved request UI readback",()=>{
 it("hydrates persisted number and preference after step remount, not the business contact defaults",()=>{
  const Step=makeStep(),p=props();let h=mount(Step,p);
  expect(phone(h).props.value).toBe("+968 95555555");expect(checkbox(h).props.checked).toBe(true);
  h.unmount();h=mount(Step,p);expect(phone(h).props.value).toBe("+968 95555555");expect(checkbox(h).props.checked).toBe(true);
 });
 it("refresh replaces untouched fields with authoritative request values",()=>{
  const Step=makeStep(),p=props(link("a","+968 92222222",false)),h=mount(Step,p);
  h.render({...p,link:link("a","+968 93333333",true)});h.render();
  expect(phone(h).props.value).toBe("+968 93333333");expect(checkbox(h).props.checked).toBe(true);
 });
 it("refresh preserves a dirty phone while adopting an untouched preference",()=>{
  const Step=makeStep(),p=props(link("a","+968 92222222",false)),h=mount(Step,p);
  (phone(h).props.onChange as (e:unknown)=>void)({target:{value:"+968 94444444"}});h.render();
  h.render({...p,link:link("a","+968 93333333",true)});h.render();
  expect(phone(h).props.value).toBe("+968 94444444");expect(checkbox(h).props.checked).toBe(true);
 });
 it("failed read retains the same company's last confirmed values and blocks saving",async()=>{
  const Step=makeStep(),p={...props(),linkStatus:"failed"},h=mount(Step,p);
  expect(phone(h).props.value).toBe("+968 95555555");
  expect(nodes(h.tree()).find(n=>n.props.type==="submit")!.props.disabled).toBeTruthy();
  await (nodes(h.tree()).find(n=>typeof n.props.onSubmit==="function")!.props.onSubmit as (e:unknown)=>void)({preventDefault(){}});
  expect(mocked.save).not.toHaveBeenCalled();expect(mocked.next).not.toHaveBeenCalled();
 });
 it("a different-company snapshot cannot hydrate or permit a request save",async()=>{
  const Step=makeStep(),p=props(link("a"),"b"),h=mount(Step,p);
  expect(phone(h).props.value).not.toBe("+968 95555555");
  await (nodes(h.tree()).find(n=>typeof n.props.onSubmit==="function")!.props.onSubmit as (e:unknown)=>void)({preventDefault(){}});
  expect(mocked.save).not.toHaveBeenCalled();
 });
 it("dirty edits register the navigation warning instead of silently vanishing",()=>{
  const Step=makeStep(),p=props(),h=mount(Step,p);
  (phone(h).props.onChange as (e:unknown)=>void)({target:{value:"+968 96666666"}});h.render();
  expect(typeof p.leaveGuardRef.current).toBe("function");
 });

 it("refresh keeps a dirty preference and adopts an untouched requested number",()=>{
  const Step=makeStep(),p=props(link("a","+968 92222222",false)),h=mount(Step,p);
  (checkbox(h).props.onChange as (e:unknown)=>void)({target:{checked:true}});h.render();
  h.render({...p,link:link("a","+968 93333333",false)});h.render();
  expect(phone(h).props.value).toBe("+968 93333333");expect(checkbox(h).props.checked).toBe(true);
  expect(text(h.tree())).toContain("unsupported by the current signup path");
 });
 it("late successful save after unmount never updates a new workspace or advances",async()=>{
  const pending=deferred<unknown>();mocked.save.mockReturnValueOnce(pending.promise);
  const Step=makeStep(),p=props(),h=mount(Step,p);
  const submit=(nodes(h.tree()).find(n=>typeof n.props.onSubmit==="function")!.props.onSubmit as (e:unknown)=>void)({preventDefault(){}});
  h.unmount();pending.resolve({ok:true,data:link()});await submit;await flush();
  expect(p.onLinkSaved).not.toHaveBeenCalled();expect(mocked.next).not.toHaveBeenCalled();expect(h.driver.lateWrites).toBe(0);
 });
 it("a save response for another company cannot advance or replace the current request",async()=>{
  mocked.save.mockResolvedValueOnce({ok:true,data:link("b")});const Step=makeStep(),p=props(),h=mount(Step,p);
  await (nodes(h.tree()).find(n=>typeof n.props.onSubmit==="function")!.props.onSubmit as (e:unknown)=>void)({preventDefault(){}});await flush();
  expect(p.onLinkSaved).not.toHaveBeenCalled();expect(mocked.next).not.toHaveBeenCalled();
 });

 it("pending save disables all request edits until the authoritative result returns",()=>{
  const h=mount(makeStep(true),props());
  expect(phone(h).props.disabled).toBe(true);expect(checkbox(h).props.disabled).toBe(true);
  expect(nodes(h.tree()).filter(n=>n.props.type==="radio").every(n=>n.props.disabled===true)).toBe(true);
 });
});

const frames=new Map<number,()=>void>();let frameId=0;
beforeEach(()=>{
 frames.clear();vi.stubGlobal("window",{requestAnimationFrame:(fn:()=>void)=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:(id:number)=>frames.delete(id),confirm:vi.fn(()=>false)});
});
const paint=()=>{const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());};
type ReadProps={userId:string;companyId:string;revision?:string};
const readMount=(p:ReadProps={userId:"u",companyId:"a"})=>mount((v:ReadProps)=>useWhatsappRequestReadback(v.userId,v.companyId,v.revision) as unknown as ReactNode,p);
const view=(h:ReturnType<typeof readMount>)=>h.tree() as unknown as ReturnType<typeof useWhatsappRequestReadback>;
describe("authenticated selected-company request reads",()=>{
 it("loads the actual returned saved fields and refreshes read-only",async()=>{
  mocked.read.mockResolvedValueOnce({ok:true,data:link()});const h=readMount();expect(view(h).status).toBe("loading");paint();await flush();h.render();
  expect(view(h).link?.requestedDisplayNumber).toBe("+968 95555555");expect(view(h).link?.keepOnPhone).toBe(true);
  mocked.read.mockResolvedValueOnce({ok:true,data:link("a","+968 97777777",false)});view(h).refresh();await flush();h.render();
  expect(view(h).link?.requestedDisplayNumber).toBe("+968 97777777");expect(view(h).link?.keepOnPhone).toBe(false);expect(mocked.save).not.toHaveBeenCalled();
 });
 for(const dimension of ["company","user"] as const){
  it(dimension+" replacement immediately hides old fields and discards an older read",async()=>{
   mocked.read.mockResolvedValueOnce({ok:true,data:link()});const h=readMount();paint();await flush();h.render();
   const old=deferred<unknown>();mocked.read.mockReturnValueOnce(old.promise);view(h).refresh();
   const next={userId:dimension==="user"?"other-user":"u",companyId:dimension==="company"?"b":"a"};h.render(next);
   expect(view(h).link).toBeNull();mocked.read.mockResolvedValueOnce({ok:true,data:link(next.companyId,"new-scope",false)});paint();await flush();h.render();
   old.resolve({ok:true,data:link("a","STALE",true)});await flush();h.render();expect(view(h).link?.requestedDisplayNumber).toBe("new-scope");
  });
 }
 it("company mismatch fails closed without adopting another company's snapshot",async()=>{
  mocked.read.mockResolvedValueOnce({ok:true,data:link("b")});const h=readMount();paint();await flush();h.render();
  expect(view(h).link).toBeNull();expect(view(h).status).toBe("failed");
 });
 it("rejected refresh retains confirmed fields and exposes failure, then safe retry recovers",async()=>{
  mocked.read.mockResolvedValueOnce({ok:true,data:link()});const h=readMount();paint();await flush();h.render();
  mocked.read.mockRejectedValueOnce(new Error("OFFLINE"));view(h).refresh();await flush();h.render();
  expect(view(h).status).toBe("failed");expect(view(h).link?.keepOnPhone).toBe(true);
  mocked.read.mockResolvedValueOnce({ok:true,data:link("a","recovered",false)});view(h).refresh();await flush();h.render();expect(view(h).status).toBe("ready");expect(view(h).link?.requestedDisplayNumber).toBe("recovered");
 });
 it("revoked authentication hides prior request facts",async()=>{
  mocked.read.mockResolvedValueOnce({ok:true,data:link()});const h=readMount();paint();await flush();h.render();
  mocked.read.mockResolvedValueOnce({ok:false,code:"UNAUTHENTICATED"});view(h).refresh();await flush();h.render();expect(view(h).status).toBe("failed");expect(view(h).link).toBeNull();
 });
 it("pending refresh is single-flight and an authoritative save invalidates its old result",async()=>{
  const pending=deferred<unknown>();mocked.read.mockReturnValueOnce(pending.promise);const h=readMount();paint();view(h).refresh();view(h).refresh();expect(mocked.read).toHaveBeenCalledTimes(1);
  view(h).adopt(link("a","saved",false));h.render();pending.resolve({ok:true,data:link("a","old-read",true)});await flush();h.render();
  expect(view(h).link?.requestedDisplayNumber).toBe("saved");expect(view(h).status).toBe("ready");
 });
 it("unmount ignores pending read without late state writes",async()=>{
  const pending=deferred<unknown>();mocked.read.mockReturnValueOnce(pending.promise);const h=readMount();paint();h.unmount();pending.resolve({ok:true,data:link()});await flush();expect(h.driver.lateWrites).toBe(0);
 });
 it("revision refresh reads newer server facts without changing company scope",async()=>{
  mocked.read.mockResolvedValueOnce({ok:true,data:link()});const h=readMount({userId:"u",companyId:"a",revision:"1"});paint();await flush();h.render();
  mocked.read.mockResolvedValueOnce({ok:true,data:link("a","revision-two",false)});h.render({userId:"u",companyId:"a",revision:"2"});paint();await flush();h.render();expect(view(h).link?.requestedDisplayNumber).toBe("revision-two");
 });
});

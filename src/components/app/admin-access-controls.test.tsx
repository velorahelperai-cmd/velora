import {beforeEach,describe,expect,it,vi} from "vitest";
import type {ReactNode} from "react";
import {appCopy} from "@/lib/app-copy";
type Slot={value?:unknown;deps?:unknown[];cleanup?:()=>void};
type Driver={slots:Slot[];cursor:number;effects:Array<()=>void>;mounted:boolean;lateWrites:number};
const mocked=vi.hoisted(()=>({driver:null as Driver|null,search:vi.fn(),read:vi.fn(),grants:vi.fn(),role:vi.fn()}));
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
vi.mock("@/lib/tenancy/actions",()=>({adminSearchAccounts:mocked.search}));
vi.mock("@/lib/access/actions",()=>({accessGetUserSnapshot:mocked.read,accessSetMemberGrants:mocked.grants,accessSetPlatformRole:mocked.role}));
const copy={admin:{accessNoStaffMemberships:"No staff company memberships are available for this account within your access scope. This list shows existing staff memberships, not all platform companies.",accountSearchAction:"Search",accessGrantDelegated:"Delegate",accessSaveGrants:"Save grants",accessConfirmSave:"Confirm save",accessSearchFailed:"Search failed",accessLoadFailed:"Load failed",accessSaveFailed:"Save failed",accessSaved:"Saved",accessConfirmGrants:"Confirm {email} {n} {scope}",accessConfirmDelegated:"Delegate {email}"}};
vi.mock("./ui",()=>({Button:"button",Notice:"aside",useAppCopy:()=>copy}));
vi.mock("next/link",()=>({default:"a"}));
import {AdminAccessPage} from "./admin-access";
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

const account=(userId="a")=>({userId,email:userId+"@synthetic.invalid",platform:{role:"delegated",status:"active",revision:3},memberships:[{companyId:"company-"+userId,role:"staff",status:"active",displayName:"Company "+userId}],grants:[{companyId:"company-"+userId,capabilities:["wa.conversations.read"],conversationScope:"assigned_only",revision:7}]});
const hits={ok:true,data:{rows:["a","b"].map(user_id=>({user_id,email:user_id+"@synthetic.invalid",full_name:"Account "+user_id,support_code:"SYNTHETIC"}))}};
const setup=()=>mount(AdminAccessPage,undefined);
type Harness=ReturnType<typeof setup>;
const button=(h:Harness,label:string)=>nodes(h.tree()).find(n=>typeof n.props.onClick==="function"&&text(n.props.children).trim()===label)!;
const click=(h:Harness,label:string)=>{(button(h,label).props.onClick as ()=>void)();};
const pick=(h:Harness,id:string)=>{(nodes(h.tree()).find(n=>typeof n.props.onClick==="function"&&text(n).includes("Account "+id))!.props.onClick as ()=>void)();};
async function searched(){const h=setup();click(h,"Search");await flush();h.render();return h;}
async function loaded(){const h=await searched();pick(h,"a");await flush();h.render();return h;}
const view=(h:Harness)=>text(h.tree());
beforeEach(()=>{vi.clearAllMocks();mocked.search.mockResolvedValue(hits);mocked.read.mockImplementation(async id=>({ok:true,data:account(id)}));mocked.grants.mockResolvedValue({ok:true});mocked.role.mockResolvedValue({ok:true});});
describe("AdminAccessPage request ownership (independent cloud reproduction)",()=>{
 it("ignores an older account success after switching to a newer account",async()=>{
  const h=await searched(),a=deferred<unknown>();mocked.read.mockReturnValueOnce(a.promise);pick(h,"a");pick(h,"b");await flush();h.render();
  a.resolve({ok:true,data:account("a")});await flush();h.render();
  expect(nodes(h.tree()).some(n=>n.props.value==="company-b")).toBe(true);
  expect(nodes(h.tree()).some(n=>n.props.value==="company-a")).toBe(false);
 });
 it("hides the prior account editor immediately while switching",async()=>{
  const h=await loaded(),b=deferred<unknown>();mocked.read.mockReturnValueOnce(b.promise);pick(h,"b");h.render();
  expect(button(h,"Delegate")).toBeUndefined();b.resolve({ok:true,data:account("b")});await flush();
 });
 it("an older failure cannot clear the newer account or its busy state",async()=>{
  const h=await searched(),a=deferred<unknown>(),b=deferred<unknown>();mocked.read.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  pick(h,"a");pick(h,"b");a.resolve({ok:false,message:"STALE"});await flush();h.render();
  expect(button(h,"Search").props.busy).toBe(true);expect(view(h)).not.toContain("STALE");
  b.resolve({ok:true,data:account("b")});await flush();h.render();expect(nodes(h.tree()).some(n=>n.props.value==="company-b")).toBe(true);
 });
 it("deduplicates search before a render",async()=>{
  const pending=deferred<unknown>();mocked.search.mockReturnValue(pending.promise);const h=setup();click(h,"Search");click(h,"Search");expect(mocked.search).toHaveBeenCalledTimes(1);pending.resolve(hits);await flush();
 });
 it("deduplicates repeated pending account reads",async()=>{
  const h=await searched(),pending=deferred<unknown>();mocked.read.mockReturnValue(pending.promise);pick(h,"a");pick(h,"a");expect(mocked.read).toHaveBeenCalledTimes(1);pending.resolve({ok:true,data:account()});await flush();
 });
 for(const kind of ["grants","role"] as const){
  const label=kind==="grants"?"Save grants":"Delegate",confirmed=kind==="grants"?"Confirm save":"Delegate";
  it(kind+": preserves confirmation and submits only once while pending",async()=>{
   const h=await loaded(),pending=deferred<unknown>();mocked[kind].mockReturnValue(pending.promise);
   click(h,label);expect(mocked[kind]).not.toHaveBeenCalled();h.render();click(h,confirmed);click(h,confirmed);
   expect(mocked[kind]).toHaveBeenCalledTimes(1);expect(mocked[kind].mock.calls[0][0]).toEqual(kind==="grants"?{userId:"a",companyId:"company-a",capabilities:["wa.conversations.read"],conversationScope:"assigned_only",expectedRevision:7,reason:"admin_access_ui"}:{userId:"a",role:"delegated",status:"active",expectedRevision:3,reason:"admin_access_ui"});
   h.render();expect(nodes(h.tree()).filter(n=>typeof n.props.onChange==="function"&&"value" in n.props&&["company-a","assigned_only"].includes(String(n.props.value))).every(n=>n.props.disabled)).toBe(true);
   pick(h,"b");expect(mocked.read).toHaveBeenCalledTimes(1);
   pending.resolve({ok:true});await flush();h.render();expect(button(h,"Search").props.busy).toBe(false);expect(view(h)).toContain("Saved");
  });
  it(kind+": rejected mutation shows safe feedback and can be retried",async()=>{
   const h=await loaded();mocked[kind].mockRejectedValueOnce(new Error("PRIVATE_TRANSPORT_DETAILS"));click(h,label);h.render();click(h,confirmed);await flush();h.render();
   expect(view(h)).toContain("Save failed");expect(view(h)).not.toContain("PRIVATE_TRANSPORT_DETAILS");expect(button(h,"Search").props.busy).toBe(false);
   click(h,confirmed);await flush();expect(mocked[kind]).toHaveBeenCalledTimes(2);
  });
 }
 it("rejected search shows localized feedback and clears old hits",async()=>{
  const h=await searched();mocked.search.mockRejectedValueOnce(new Error("PRIVATE"));click(h,"Search");await flush();h.render();expect(view(h)).toContain("Search failed");expect(view(h)).not.toContain("Account a");expect(button(h,"Search").props.busy).toBe(false);
 });
 it("rejected account read clears the editor and shows localized feedback",async()=>{
  const h=await loaded();mocked.read.mockRejectedValueOnce(new Error("PRIVATE"));pick(h,"b");await flush();h.render();expect(view(h)).toContain("Load failed");expect(button(h,"Delegate")).toBeUndefined();expect(button(h,"Search").props.busy).toBe(false);
 });
 it("superseded search cannot replace account selection or post a stale error",async()=>{
  const h=await searched(),pending=deferred<unknown>();mocked.search.mockReturnValueOnce(pending.promise);click(h,"Search");pick(h,"b");await flush();h.render();pending.resolve({ok:false,message:"STALE"});await flush();h.render();expect(view(h)).not.toContain("STALE");expect(nodes(h.tree()).some(n=>n.props.value==="company-b")).toBe(true);
 });
 it("unmount ignores pending completion without late state writes",async()=>{
  const h=await searched(),pending=deferred<unknown>();mocked.read.mockReturnValueOnce(pending.promise);pick(h,"a");h.unmount();pending.resolve({ok:true,data:account()});await flush();expect(h.driver.lateWrites).toBe(0);
 });
 it("a stale rejected read cannot replace newer success with an error",async()=>{
  const h=await searched(),pending=deferred<unknown>();mocked.read.mockReturnValueOnce(pending.promise);pick(h,"a");pick(h,"b");await flush();h.render();pending.reject(new Error("STALE"));await flush();h.render();expect(view(h)).not.toContain("Load failed");expect(nodes(h.tree()).some(n=>n.props.value==="company-b")).toBe(true);
 });
 it("rejects a mismatched account snapshot instead of exposing its editor",async()=>{
  const h=await searched();mocked.read.mockResolvedValueOnce({ok:true,data:account("b")});pick(h,"a");await flush();h.render();expect(view(h)).toContain("Load failed");expect(button(h,"Delegate")).toBeUndefined();
 });
 for(const kind of ["grants","role"] as const){
  it(kind+": keeps the request locked through refresh and reports refresh rejection",async()=>{
   const h=await loaded(),refresh=deferred<unknown>();mocked.read.mockReturnValueOnce(refresh.promise);
   click(h,kind==="grants"?"Save grants":"Delegate");h.render();click(h,kind==="grants"?"Confirm save":"Delegate");await flush();h.render();
   expect(button(h,"Search").props.busy).toBe(true);pick(h,"b");expect(mocked.read).toHaveBeenCalledTimes(2);
   refresh.reject(new Error("PRIVATE"));await flush();h.render();expect(view(h)).toContain("Saved");expect(view(h)).toContain("Load failed");expect(button(h,"Search").props.busy).toBe(false);expect(button(h,"Delegate")).toBeUndefined();
  });
  it(kind+": unmount prevents a late successful write from starting another read",async()=>{
   const h=await loaded(),pending=deferred<unknown>();mocked[kind].mockReturnValueOnce(pending.promise);
   click(h,kind==="grants"?"Save grants":"Delegate");h.render();click(h,kind==="grants"?"Confirm save":"Delegate");h.unmount();pending.resolve({ok:true});await flush();expect(mocked.read).toHaveBeenCalledTimes(1);expect(h.driver.lateWrites).toBe(0);
  });
 }

});

describe("staff membership selector empty state",()=>{
 for(const locale of ["en","ar"] as const){
  it.each(["none","owner"])(locale+": explains a successful snapshot with %s staff memberships",async kind=>{
   const message=locale==="ar"?"لا توجد عضويات موظف متاحة لهذا الحساب ضمن نطاق صلاحياتك. تعرض هذه القائمة عضويات الموظف الحالية، وليس جميع شركات المنصة.":"No staff company memberships are available for this account within your access scope. This list shows existing staff memberships, not all platform companies.";
   copy.admin.accessNoStaffMemberships=message;
   const data=account();data.memberships=kind==="none"?[]:data.memberships.map(m=>({...m,role:"owner"}));
   mocked.read.mockResolvedValueOnce({ok:true,data});const h=await loaded();
   expect(view(h)).toContain(message);expect(button(h,"Save grants")).toBeUndefined();
   expect(mocked.grants).not.toHaveBeenCalled();expect(mocked.role).not.toHaveBeenCalled();
  });
 }
 it.each(["setup","active","suspended"])("retains existing staff options for a %s company",async companyStatus=>{
  const data=account();const memberships=data.memberships.map(m=>({...m,companyStatus}));mocked.read.mockResolvedValueOnce({ok:true,data:{...data,memberships}});const h=await loaded();
  expect(nodes(h.tree()).some(n=>n.props.value==="company-a")).toBe(true);expect(view(h)).not.toContain(copy.admin.accessNoStaffMemberships);
 });
 it("does not label an unavailable snapshot as empty memberships",async()=>{
  mocked.read.mockResolvedValueOnce({ok:false});const h=await loaded();expect(view(h)).toContain("Load failed");expect(view(h)).not.toContain(copy.admin.accessNoStaffMemberships);
 });
 it("ships distinct Arabic and English empty-state copy",()=>{
  const en=appCopy("en").admin as unknown as Record<string,string>,ar=appCopy("ar").admin as unknown as Record<string,string>;
  expect(en.accessNoStaffMemberships).toContain("existing staff memberships");expect(ar.accessNoStaffMemberships).toContain("عضويات الموظف الحالية");
 });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks=vi.hoisted(()=>({slots:[] as {value?:unknown}[],cursor:0,list:vi.fn()}));
vi.mock("react",async()=>{
 const actual=await vi.importActual<typeof import("react")>("react");
 const slot=()=>mocks.slots[mocks.cursor++]??(mocks.slots[mocks.cursor-1]={});
 return {...actual,useState(initial:unknown){const s=slot();if(!("value" in s))s.value=typeof initial==="function"?(initial as ()=>unknown)():initial;return [s.value,(v:unknown)=>{s.value=typeof v==="function"?(v as (old:unknown)=>unknown)(s.value):v;}];},useRef(initial:unknown){const s=slot();return s.value??(s.value={current:initial});},useMemo(fn:()=>unknown){slot();return fn();},useEffect(){}};
});
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
vi.mock("@/lib/tenancy/actions",()=>({adminListCompanies:mocks.list,adminGetOverviewStats:vi.fn(),adminSearchAccounts:vi.fn()}));
vi.mock("@/lib/answers/runtime/admin-truth",()=>({readAdminTruth:vi.fn()}));
import { AdminList } from "./admin-list";
type Node={type:unknown;props:Record<string,unknown>};
function nodes(v:unknown):Node[]{if(Array.isArray(v))return v.flatMap(nodes);if(!v||typeof v!=="object"||!("props" in v))return [];const n=v as Node;return [n,...nodes(n.props.children)];}
function text(v:unknown):string{if(Array.isArray(v))return v.map(text).join("");if(v&&typeof v==="object"&&"props" in v)return text((v as Node).props.children);return typeof v==="string"||typeof v==="number"?String(v):"";}
function render():ReactNode{mocks.cursor=0;return AdminList({overviewUnavailable:{code:"FORBIDDEN",message:"synthetic unavailable"}});}
function count(tree:ReactNode){const button=nodes(tree).find(n=>n.type==="button"&&text(n.props.children).startsWith("Companies"))!;const children=button.props.children as Node[];return text(children[children.length-1]);}
function header(tree:ReactNode){const section=nodes(tree).find(n=>n.props.id==="companies")!;return text((section.props.children as Node[])[0]);}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
async function search(tree:ReactNode){const form=nodes(tree).find(n=>n.type==="form")!;(form.props.onSubmit as (e:{preventDefault():void})=>void)({preventDefault(){}});await flush();}
beforeEach(()=>{vi.clearAllMocks();mocks.slots=[];mocks.cursor=0;});
describe("company count distinguishes unknown from verified zero",()=>{
 it("initial loading badges do not fabricate zero",()=>{const tree=render();expect(count(tree)).toBe("-");expect(header(tree)).not.toContain("(0)");});
 it("a successful empty database read displays real zero",async()=>{mocks.list.mockResolvedValue({ok:true,data:[]});await search(render());const tree=render();expect(count(tree)).toBe("0");expect(header(tree)).toContain("(0)");});
 it("a successful nonempty read displays the loaded count",async()=>{
  mocks.list.mockResolvedValue({ok:true,data:[{id:"synthetic-company",display_name:"Synthetic company",status:"active",created_at:"2026-10-11T00:00:00Z"}]});
  await search(render());expect(count(render())).toBe("1");
 });
 it("failed read keeps count unavailable",async()=>{mocks.list.mockResolvedValue({ok:false,code:"FORBIDDEN"});await search(render());expect(count(render())).toBe("-");});
 it("refresh does not display stale count while pending or rejected",async()=>{
  mocks.list.mockResolvedValueOnce({ok:true,data:[]});await search(render());expect(count(render())).toBe("0");
  let reject!:(e:Error)=>void;mocks.list.mockReturnValue(new Promise((_,no)=>{reject=no;}));await search(render());expect(count(render())).toBe("-");
  reject(new Error("Synthetic failure"));await flush();expect(count(render())).toBe("-");
 });
});

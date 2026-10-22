import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { ReactNode } from "react";
const mocks=vi.hoisted(()=>({slots:[] as {value?:unknown}[],cursor:0,list:vi.fn(),overview:vi.fn(),truth:vi.fn(),effects:[] as Array<()=>void>}));
vi.mock("react",async()=>{
 const actual=await vi.importActual<typeof import("react")>("react");
 const slot=()=>mocks.slots[mocks.cursor++]??(mocks.slots[mocks.cursor-1]={});
 return {...actual,useState(initial:unknown){const s=slot();if(!("value" in s))s.value=typeof initial==="function"?(initial as ()=>unknown)():initial;return [s.value,(v:unknown)=>{s.value=typeof v==="function"?(v as (old:unknown)=>unknown)(s.value):v;}];},useRef(initial:unknown){const s=slot();return s.value??(s.value={current:initial});},useMemo(fn:()=>unknown){slot();return fn();},useEffect(fn:()=>void){mocks.effects.push(fn);}};
});
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
vi.mock("@/lib/tenancy/actions",()=>({adminListCompaniesPage:mocks.list,adminListPendingReviewsPage:vi.fn().mockResolvedValue({ok:true,data:[]}),adminGetOverviewStats:mocks.overview,adminSearchAccounts:vi.fn()}));
vi.mock("@/lib/answers/runtime/admin-truth",()=>({readAdminTruth:mocks.truth}));
import { AdminList } from "./admin-list";
type Node={type:unknown;props:Record<string,unknown>};
function nodes(v:unknown):Node[]{if(Array.isArray(v))return v.flatMap(nodes);if(!v||typeof v!=="object"||!("props" in v))return [];const n=v as Node;return [n,...nodes(n.props.children)];}

function render(props:Record<string,unknown>={}):ReactNode{mocks.cursor=0;return AdminList({...props,overviewUnavailable:{code:"FORBIDDEN",message:"synthetic unavailable"}});}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const company={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",display_name:"Synthetic company",status:"active",created_at:"2026-10-11T00:00:00Z"};
function companyForm(tree:ReactNode){return nodes(tree).find(n=>n.type==="form")!;}
function input(tree:ReactNode){return nodes(companyForm(tree)).find(n=>n.type==="input")!;}
function select(tree:ReactNode){return nodes(companyForm(tree)).find(n=>n.type==="select")!;}
async function submit(tree:ReactNode){(companyForm(tree).props.onSubmit as (e:unknown)=>void)({preventDefault(){}});await flush();}
const links=(tree:ReactNode)=>nodes(tree).filter(n=>typeof n.props.href==="string"&&n.props.href.startsWith("/admin/companies/"));
import Page from "@/app/admin/page";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/lib/knowledge/actions",()=>({adminGetKnowledgeFileUrl:vi.fn(),adminListCompanyKnowledge:vi.fn()}));
vi.mock("@/lib/whatsapp/connection-actions",()=>({adminGetWhatsappCompanyLink:vi.fn(),adminMarkWhatsappLinkNeedsExternal:vi.fn(),adminUpdateWhatsappLinkNote:vi.fn()}));
import {AdminCompanyDetail,type AdminCompany} from "./admin-company-detail";
import {AdminBillingLedger} from "@/components/admin/billing-ledger";
beforeEach(()=>{vi.clearAllMocks();mocks.slots=[];mocks.cursor=0;mocks.effects=[];mocks.list.mockResolvedValue({ok:true,data:{rows:[company],totalCount:1,offset:0,hasMore:false}});mocks.overview.mockResolvedValue({ok:false,code:"FORBIDDEN"});mocks.truth.mockResolvedValue({ok:false});});
describe("company detail return restores list search",()=>{
 it("company links encode applied search and selected status",async()=>{
  let tree=render();(input(tree).props.onChange as (e:unknown)=>void)({target:{value:"شركة & café"}});(select(tree).props.onChange as (e:unknown)=>void)({target:{value:"active"}});tree=render();await submit(tree);tree=render();
  const href=String(links(tree)[0]?.props.href);const back=new URL(href,"https://synthetic.invalid").searchParams.get("returnTo");
  expect(back).toBe("/admin?companySearch=%D8%B4%D8%B1%D9%83%D8%A9+%26+caf%C3%A9&companyStatus=active#companies");
  (input(tree).props.onChange as (e:unknown)=>void)({target:{value:"unsent draft"}});tree=render();expect(String(links(tree)[0]?.props.href)).toBe(href);
 });
 it("return props restore the search input and status used for reloading",async()=>{
  const props={initialCompanyFilters:{search:"Synthetic",status:"active"}};const tree=render(props);
  expect(input(tree).props.value).toBe("Synthetic");expect(select(tree).props.value).toBe("active");await submit(tree);expect(mocks.list).toHaveBeenCalledWith({search:"Synthetic",status:"active",limit:25,offset:0});
 });
 it("server page carries return filters and keys the list by them",async()=>{
  const call=Page as (props:unknown)=>ReturnType<typeof Page>;
  const first=await call({searchParams:Promise.resolve({companySearch:"Synthetic",companyStatus:"active"})});
  const second=await call({searchParams:Promise.resolve({})});
  expect(first.props.initialCompanyFilters).toEqual({search:"Synthetic",status:"active"});expect(first.key).not.toBe(second.key);
 });
});

it("actual detail return link uses the validated list query",()=>{
 const returnTo="/admin?companySearch=Synthetic&companyStatus=active#companies";
 const tree=AdminCompanyDetail({initialCompany:{...company,business_type:"test",reply_language:"en",country:"",city:"",hours:"",contact_phone:"",contact_email:""} as AdminCompany,initialMembers:[],initialAudits:[],initialKnowledge:[],returnTo});
 expect(nodes(tree).some(n=>n.props.href===returnTo)).toBe(true);
});
it("actual billing company link carries the current filter and browse cursor",()=>{
 const query={environment:"test",companyId:company.id,cursor:"synthetic"};
 const tree=AdminBillingLedger({query,result:{status:"ready",rows:[{id:"synthetic-order",companyId:company.id,companyName:company.display_name,createdAt:company.created_at,environment:"test",amountBaisa:null,currency:null,financial:{state:"unknown"} as never,checkoutDeadline:null,checkoutExpired:null}],total:1,hasMore:false,nextCursor:null,snapshot:"synthetic"}});
 const href=String(links(tree)[0]?.props.href);
 expect(new URL(href,"https://internal.invalid").searchParams.get("returnTo")).toBe("/admin/billing?"+new URLSearchParams(query));
});

it("return mount automatically reloads the restored query without another Apply",async()=>{
 vi.stubGlobal("window",{requestAnimationFrame:(fn:()=>void)=>{fn();return 1;},cancelAnimationFrame:vi.fn()});
 try{render({initialCompanyFilters:{search:"restored search",status:"active"}});mocks.effects[0]();await flush();expect(mocks.list).toHaveBeenCalledWith({search:"restored search",status:"active",limit:25,offset:0});}finally{vi.unstubAllGlobals();}
});

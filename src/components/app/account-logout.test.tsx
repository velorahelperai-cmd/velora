import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {appCopy} from "@/lib/app-copy";
type Slot={value?:unknown;deps?:unknown[];cleanup?:()=>void};
const f=vi.hoisted(()=>({slots:[] as Slot[],cursor:0,effects:[] as Array<()=>void>,liveUser:"user-a" as string|null,logout:vi.fn(),publishLogout:vi.fn(),clear:vi.fn(),update:vi.fn(),drafts:vi.fn(),replace:vi.fn(),refresh:vi.fn(),getUser:vi.fn(),assign:vi.fn()}));
vi.mock("react",async()=>{const actual=await vi.importActual<typeof import("react")>("react");const slot=()=>f.slots[f.cursor++]??(f.slots[f.cursor-1]={});return {...actual,useId:()=>"menu",useContext:()=>({status:"ready",identity:{userId:"user-a",fullName:"Synthetic",email:"synthetic@example.invalid"},clear:f.clear,isCurrentUser:(id:string)=>f.liveUser===id}),useState(initial:unknown){const s=slot();if(!("value"in s))s.value=initial;return[s.value,(v:unknown)=>{s.value=typeof v==="function"?(v as(p:unknown)=>unknown)(s.value):v;}];},useRef(initial:unknown){const s=slot();return s.value??(s.value={current:initial});},useEffect(fn:()=>void|(()=>void),deps:unknown[]){const s=slot();if(!s.deps||deps.some((v,i)=>!Object.is(v,s.deps![i]))){f.effects.push(()=>{s.cleanup?.();s.cleanup=fn()||undefined;});s.deps=deps;}}};});
const router={replace:f.replace,refresh:f.refresh};
vi.mock("next/navigation",()=>({useRouter:()=>router}));
vi.mock("@/lib/tenancy/actions",()=>({signOut:f.logout,getAccountProfile:vi.fn()}));
vi.mock("@/lib/company-draft",()=>({clearCompanyDrafts:f.drafts}));
vi.mock("@/lib/auth/session-context",()=>({publishSessionLogout:f.publishLogout,publishSessionContext:vi.fn(),subscribeSessionContext:vi.fn()}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{getUser:f.getUser}}),tryCreateClient:()=>null}));
vi.mock("@/lib/demo-state",()=>({emptyBusiness:{},useDemo:()=>({locale:"en",update:f.update})}));
vi.mock("./ui",()=>({useAppCopy:()=>appCopy("en"),LangSwitch:()=>null}));
import {AccountMenu} from "./account-chrome";
type Node={type:unknown;props:Record<string,unknown>};
function nodes(v:unknown):Node[]{if(Array.isArray(v))return v.flatMap(nodes);if(!v||typeof v!=="object"||!("props"in v))return[];const n=v as Node;return[n,...nodes(n.props.children)];}
function render(){f.cursor=0;const tree=AccountMenu({});f.effects.splice(0).forEach(fn=>fn());return tree;}
function logout(){const closed=render();(nodes(closed).find(n=>n.props["aria-haspopup"]==="menu")!.props.onClick as()=>void)();const tree=render();(nodes(tree).find(n=>n.type==="button"&&n.props.role==="menuitem")!.props.onClick as()=>void)();}
async function settle(){for(let n=0;n<15;n++)await Promise.resolve();}
beforeEach(()=>{vi.clearAllMocks();f.slots=[];f.effects=[];f.liveUser="user-a";f.getUser.mockResolvedValue({data:{user:{id:"user-a"}}});f.logout.mockResolvedValue({ok:true});vi.stubGlobal("document",{addEventListener:vi.fn(),removeEventListener:vi.fn()});vi.stubGlobal("window",{location:{assign:f.assign}});});
afterEach(()=>{for(const s of f.slots)s.cleanup?.();});
it("logout is bound to the current displayed user without a delayed browser lookup",async()=>{
 logout();await settle();expect(f.logout).toHaveBeenCalledWith("user-a");expect(f.getUser).not.toHaveBeenCalled();expect(f.drafts).toHaveBeenCalledWith("user-a");expect(f.clear).toHaveBeenCalledOnce();expect(f.publishLogout).toHaveBeenCalledWith("user-a");expect(f.publishLogout.mock.invocationCallOrder[0]).toBeLessThan(f.assign.mock.invocationCallOrder[0]!);
});
it("logout completion cannot erase or navigate a new account",async()=>{
 let resolve!:(v:unknown)=>void;f.logout.mockReturnValue(new Promise(ok=>{resolve=ok;}));logout();await settle();f.liveUser="user-b";resolve({ok:true});await settle();
 expect(f.clear).not.toHaveBeenCalled();expect(f.update).not.toHaveBeenCalled();expect(f.drafts).not.toHaveBeenCalled();expect(f.publishLogout).not.toHaveBeenCalled();expect(f.replace).not.toHaveBeenCalled();expect(f.assign).not.toHaveBeenCalled();
});
it("failed native logout keeps the current identity and drafts recoverable",async()=>{
 f.logout.mockResolvedValue({ok:false,code:"AUTH_ERROR",message:"Synthetic logout failure"});logout();await settle();
 expect(f.logout).toHaveBeenCalledWith("user-a");expect(f.clear).not.toHaveBeenCalled();expect(f.update).not.toHaveBeenCalled();expect(f.drafts).not.toHaveBeenCalled();expect(f.publishLogout).not.toHaveBeenCalled();expect(f.assign).not.toHaveBeenCalled();
 const closed=render();(nodes(closed).find(n=>n.props["aria-haspopup"]==="menu")!.props.onClick as()=>void)();
 expect(nodes(render()).some(n=>n.props.children==="Synthetic logout failure")).toBe(true);
});

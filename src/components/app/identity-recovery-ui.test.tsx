import {beforeEach,expect,it,vi} from "vitest";
import type {IdentityRecoveryCase} from "@/lib/tenancy/identity-recovery";
type Slot={value?:unknown};
const f=vi.hoisted(()=>({slots:[] as Slot[],cursor:0,user:"account-a",open:vi.fn(),read:vi.fn()}));
vi.mock("react",async()=>{const actual=await vi.importActual<typeof import("react")>("react");const slot=()=>f.slots[f.cursor++]??(f.slots[f.cursor-1]={});return {...actual,useState(initial:unknown){const s=slot();if(!("value"in s))s.value=initial;return [s.value,(v:unknown)=>{s.value=v;}];},useRef(initial:unknown){const s=slot();return s.value??(s.value={current:initial});},useLayoutEffect(fn:()=>void){fn();}};});
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
vi.mock("./account-chrome",()=>({useOptionalAccountSession:()=>({status:"ready",identity:{userId:f.user,platformIdentity:{role:"owner",status:"active"}}})}));
vi.mock("./auth-pages",()=>({AuthShell:()=>null}));
vi.mock("@/lib/tenancy/identity-recovery-actions",()=>({openIdentityRecoveryReviewAction:f.open,readIdentityRecoveryReviewsAction:f.read,adminOpenIdentityRecoveryReviewAction:vi.fn(),adminDecideIdentityRecoveryAction:vi.fn()}));
import {IdentityRecoveryPage} from "./identity-recovery-page";
import {IdentityRecoveryAdminPanel} from "../admin/identity-recovery-panel";
import CustomerRoute from "@/app/account/recovery/page";
import AdminRoute from "@/app/admin/identity-recovery/page";
const c=(id:string,userId:string):IdentityRecoveryCase=>({id,userId,reason:"lost_phone",state:"review",createdAt:"2026-10-14T00:00:00Z",verifiedEvidence:0});
const view=(actorUserId:string,id:string)=>({ok:true as const,data:{actorUserId,configuration:"UNCONFIGURED" as const,cases:[c(id,actorUserId)]}});
type Node={props:Record<string,unknown>};
function nodes(v:unknown):Node[]{if(Array.isArray(v))return v.flatMap(nodes);if(!v||typeof v!=="object"||!("props"in v))return [];const n=v as Node;return [n,...nodes(n.props.children)];}
function text(v:unknown):string{if(Array.isArray(v))return v.map(text).join(" ");if(typeof v==="string")return v;if(v&&typeof v==="object"&&"props"in v)return text((v as Node).props.children);return "";}
function render(actor="account-a",id="private-case-a",admin=false){f.cursor=0;return admin?IdentityRecoveryAdminPanel({initialResult:view(actor,id)}):IdentityRecoveryPage({initialResult:view(actor,id)});}
beforeEach(()=>{vi.clearAllMocks();f.slots=[];f.cursor=0;f.user="account-a";});
it("a customer rerender under another native account never displays the prior account's saved cases",()=>{expect(text(render())).toContain("private-case-a");f.user="account-b";expect(text(render("account-b","case-b"))).not.toContain("private-case-a");});
it("admin cases bound to the previous actor are hidden until the new actor's view is loaded",()=>{expect(text(render("account-a","private-case-a",true))).toContain("private-case-a");f.user="account-b";expect(text(render("account-b","case-b",true))).not.toContain("private-case-a");});
it("a delayed customer read after account switch cannot install foreign cases",async()=>{
 let finish!:(value:unknown)=>void;f.open.mockResolvedValue({ok:true,data:{}});f.read.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const tree=render();const button=nodes(tree).find(n=>text(n.props.children)==="Open recovery review");(button!.props.onClick as()=>void)();await Promise.resolve();await Promise.resolve();
 f.user="account-b";render("account-b","case-b");finish(view("account-a","late-private-case-a"));await Promise.resolve();await Promise.resolve();
 const after=text(render("account-b","case-b"));expect(after).not.toContain("late-private-case-a");expect(after).not.toContain("private-case-a");
});
it("both recovery routes remount their state for a changed native actor",async()=>{f.read.mockResolvedValue(view("account-b","case-b"));expect((await CustomerRoute()).key).toBe("account-b");expect((await AdminRoute()).key).toBe("account-b");});

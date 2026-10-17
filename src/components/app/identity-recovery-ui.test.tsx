import {beforeEach,expect,it,vi} from "vitest";
import type {IdentityRecoveryCase,IdentityRecoveryView} from "@/lib/tenancy/identity-recovery";

type Slot={value?:unknown};
const f=vi.hoisted(()=>({
 slots:[] as Slot[],
 cursor:0,
 user:"account-a",
 status:"ready" as "ready"|"locked"|"expired"|"loading"|"guest"|"error",
 boundary:"aaaaaaaaaaaaaaaa",
 open:vi.fn(),
 read:vi.fn(),
}));

vi.mock("react",async()=>{
 const actual=await vi.importActual<typeof import("react")>("react");
 const slot=()=>f.slots[f.cursor++]??(f.slots[f.cursor-1]={});
 return {
  ...actual,
  useState(initial:unknown){
   const s=slot();
   if(!("value" in s))s.value=initial;
   return [s.value,(v:unknown)=>{s.value=v;}];
  },
  useRef(initial:unknown){
   const s=slot();
   return s.value??(s.value={current:initial});
  },
  useLayoutEffect(fn:()=>void){fn();},
 };
});
const localeState=vi.hoisted(()=>({locale:"en" as "en"|"ar"}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:localeState.locale})}));
vi.mock("./account-chrome",()=>({
 useOptionalAccountSession:()=>({
  status:f.status,
  identity:{userId:f.user,platformIdentity:{role:"owner",status:"active"}},
  boundaryFingerprint:f.boundary,
  cleanupCapture:()=>({userId:f.user,boundaryFingerprint:f.boundary}),
  liveSnapshot:()=>({
   status:f.status,
   userId:f.status==="ready"?f.user:null,
   boundaryFingerprint:f.boundary,
   ready:f.status==="ready",
  }),
  isCapturedBoundary:(fp:string|null|undefined)=>Boolean(fp)&&fp===f.boundary&&f.status==="locked",
 }),
}));
vi.mock("./auth-pages",()=>({AuthShell:({children}:{children?:unknown})=>children??null}));
vi.mock("@/lib/tenancy/identity-recovery-actions",()=>({
 openIdentityRecoveryReviewAction:f.open,
 readIdentityRecoveryReviewsAction:f.read,
 adminOpenIdentityRecoveryReviewAction:vi.fn(),
 adminDecideIdentityRecoveryAction:vi.fn(),
}));

import {IdentityRecoveryPage} from "./identity-recovery-page";
import {IdentityRecoveryAdminPanel} from "../admin/identity-recovery-panel";
import CustomerRoute from "@/app/account/recovery/page";
import AdminRoute from "@/app/admin/identity-recovery/page";

const c=(id:string,userId:string,state:IdentityRecoveryCase["state"]="review"):IdentityRecoveryCase=>({
 id,
 userId,
 reason:"lost_phone",
 state,
 createdAt:"2026-10-14T00:00:00Z",
 verifiedEvidence:0,
});
const view=(actorUserId:string,id:string,boundary="aaaaaaaaaaaaaaaa",state:IdentityRecoveryCase["state"]="review"):{ok:true;data:IdentityRecoveryView}=>({
 ok:true,
 data:{
  actorUserId,
  configuration:"UNCONFIGURED",
  cases:[c(id,actorUserId,state)],
  boundaryFingerprint:boundary,
 },
});

type Node={type?:unknown;props:Record<string,unknown>};
function nodes(v:unknown):Node[]{
 if(Array.isArray(v))return v.flatMap(nodes);
 if(!v||typeof v!=="object"||!("props" in v))return [];
 const n=v as Node;
 return [n,...nodes(n.props.children)];
}
function text(v:unknown):string{
 if(Array.isArray(v))return v.map(text).join(" ");
 if(typeof v==="string")return v;
 if(v&&typeof v==="object"&&"props" in v)return text((v as Node).props.children);
 return "";
}
function render(actor="account-a",id="private-case-a",admin=false,boundary="aaaaaaaaaaaaaaaa"){
 f.cursor=0;
 return admin
  ?IdentityRecoveryAdminPanel({initialResult:view(actor,id,"")})
  :IdentityRecoveryPage({initialResult:view(actor,id,boundary)});
}

beforeEach(()=>{
 vi.clearAllMocks();
 f.slots=[];
 f.cursor=0;
 f.user="account-a";
 f.status="ready";
 f.boundary="aaaaaaaaaaaaaaaa";
 localeState.locale="en";
 f.open.mockResolvedValue({
  ok:true,
  data:{...c("opened-case","account-a"),boundaryFingerprint:"aaaaaaaaaaaaaaaa"},
 });
 f.read.mockResolvedValue(view("account-a","opened-case"));
});

it("a customer rerender under another native account never displays the prior account's saved cases",()=>{
 expect(text(render())).toContain("private-case-a");
 f.user="account-b";
 f.boundary="bbbbbbbbbbbbbbbb";
 expect(text(render("account-b","case-b",false,"bbbbbbbbbbbbbbbb"))).not.toContain("private-case-a");
});

it("admin cases bound to the previous actor are hidden until the new actor's view is loaded",()=>{
 expect(text(render("account-a","private-case-a",true))).toContain("private-case-a");
 f.user="account-b";
 expect(text(render("account-b","case-b",true))).not.toContain("private-case-a");
});

it("a delayed customer read after account switch cannot install foreign cases",async()=>{
 let finish!:(value:unknown)=>void;
 f.open.mockResolvedValue({
  ok:true,
  data:{...c("late-private-case-a","account-a"),boundaryFingerprint:"aaaaaaaaaaaaaaaa"},
 });
 f.read.mockReturnValue(new Promise((resolve)=>{finish=resolve;}));
 const tree=render();
 const button=nodes(tree).find((n)=>text(n.props.children)==="Open recovery review");
 (button!.props.onClick as()=>void)();
 await Promise.resolve();
 await Promise.resolve();
 f.user="account-b";
 f.boundary="bbbbbbbbbbbbbbbb";
 render("account-b","case-b",false,"bbbbbbbbbbbbbbbb");
 finish(view("account-a","late-private-case-a"));
 await Promise.resolve();
 await Promise.resolve();
 const after=text(render("account-b","case-b",false,"bbbbbbbbbbbbbbbb"));
 expect(after).not.toContain("late-private-case-a");
 expect(after).not.toContain("private-case-a");
});

it("same-user newer boundary capture rejects applying a late open result",async()=>{
 let finish!:(value:unknown)=>void;
 f.open.mockReturnValue(new Promise((resolve)=>{finish=resolve;}));
 const tree=render();
 const button=nodes(tree).find((n)=>text(n.props.children)==="Open recovery review");
 (button!.props.onClick as()=>void)();
 await Promise.resolve();
 f.boundary="bbbbbbbbbbbbbbbb";
 finish({
  ok:true,
  data:{...c("stale-open","account-a"),boundaryFingerprint:"aaaaaaaaaaaaaaaa"},
 });
 await Promise.resolve();
 await Promise.resolve();
 expect(f.read).not.toHaveBeenCalled();
 const after=text(render("account-a","private-case-a",false,"bbbbbbbbbbbbbbbb"));
 expect(after).not.toContain("stale-open");
});

it("locked or expired session shows re-auth state and does not open",async()=>{
 f.status="locked";
 const locked=text(render());
 expect(locked).toContain("session ended or is locked");
 expect(locked).not.toContain("Open recovery review");
 f.status="expired";
 f.cursor=0;
 f.slots=[];
 expect(text(render())).toContain("session ended or is locked");
 const readyTree=(()=>{f.status="ready";f.cursor=0;f.slots=[];return render();})();
 const button=nodes(readyTree).find((n)=>text(n.props.children)==="Open recovery review");
 f.status="expired";
 (button!.props.onClick as()=>void)();
 await Promise.resolve();
 expect(f.open).not.toHaveBeenCalled();
});

it("unconfirmed open keeps honest messaging and does not claim saved success",async()=>{
 f.open.mockResolvedValue({ok:false,code:"UNCONFIRMED"});
 const initial=view("account-a","unused-case");
 initial.data.cases=[]; // No previously saved case: assert only the uncertain new attempt.
 f.cursor=0;
 const tree=IdentityRecoveryPage({initialResult:initial});
 const button=nodes(tree).find((n)=>text(n.props.children)==="Open recovery review");
 (button!.props.onClick as()=>void)();
 await Promise.resolve();
 await Promise.resolve();
 f.cursor=0;
 const after=text(render());
 expect(after).toContain("could not be confirmed");
 expect(after).not.toContain("Review requested");
 expect(f.read).not.toHaveBeenCalled();
});

it("double click is ignored while busy",async()=>{
 let finish!:(value:unknown)=>void;
 f.open.mockReturnValue(new Promise((resolve)=>{finish=resolve;}));
 const tree=render();
 const button=nodes(tree).find((n)=>text(n.props.children)==="Open recovery review");
 (button!.props.onClick as()=>void)();
 (button!.props.onClick as()=>void)();
 await Promise.resolve();
 expect(f.open).toHaveBeenCalledTimes(1);
 finish({
  ok:true,
  data:{...c("opened-case","account-a"),boundaryFingerprint:"aaaaaaaaaaaaaaaa"},
 });
 await Promise.resolve();
 await Promise.resolve();
});

it("stale open completion after same-user tip rebind does not leave the new tip busy",async()=>{
 let finishOpen!:(value:unknown)=>void;
 f.open.mockReturnValue(new Promise((resolve)=>{finishOpen=resolve;}));
 f.read.mockResolvedValue(view("account-a","rebound-case","bbbbbbbbbbbbbbbb"));
 f.cursor=0;
 f.slots=[];
 const tree=IdentityRecoveryPage({initialResult:view("account-a","private-case-a","aaaaaaaaaaaaaaaa")});
 const button=nodes(tree).find((n)=>text(n.props.children)==="Open recovery review");
 (button!.props.onClick as()=>void)();
 await Promise.resolve();
 // Tip B while open A is pending — preserve state slots so busy generation is visible.
 f.boundary="bbbbbbbbbbbbbbbb";
 f.cursor=0;
 const rebound=IdentityRecoveryPage({initialResult:view("account-a","private-case-a","aaaaaaaaaaaaaaaa")});
 await Promise.resolve();
 await Promise.resolve();
 finishOpen({
  ok:true,
  data:{...c("stale-open","account-a"),boundaryFingerprint:"aaaaaaaaaaaaaaaa"},
 });
 await Promise.resolve();
 await Promise.resolve();
 f.cursor=0;
 const after=IdentityRecoveryPage({initialResult:view("account-a","rebound-case","bbbbbbbbbbbbbbbb")});
 const afterButton=nodes(after).find((n)=>text(n.props.children)==="Open recovery review");
 expect(afterButton?.props.disabled).not.toBe(true);
 expect(afterButton?.props.busy).not.toBe(true);
 expect(text(after)).not.toContain("stale-open");
 expect(text(rebound)).not.toContain("stale-open");
});

it("review state labels stay distinct from restored access (EN + AR)",()=>{
 expect(text(render("account-a","case-review",false,"aaaaaaaaaaaaaaaa"))).toContain("Review requested");
 expect(text(render("account-a","case-review",false,"aaaaaaaaaaaaaaaa"))).toContain("not restored access");
 f.cursor=0;f.slots=[];
 expect(text(IdentityRecoveryPage({
  initialResult:view("account-a","case-approved","aaaaaaaaaaaaaaaa","approved_for_manual_recovery"),
 }))).toContain("supervised processing");
 expect(text(IdentityRecoveryPage({
  initialResult:view("account-a","case-approved","aaaaaaaaaaaaaaaa","approved_for_manual_recovery"),
 }))).toContain("identity not changed");
 expect(text(IdentityRecoveryPage({
  initialResult:view("account-a","case-approved","aaaaaaaaaaaaaaaa","approved_for_manual_recovery"),
 }))).not.toMatch(/account recovered|access restored|identity applied/i);
 localeState.locale="ar";
 f.cursor=0;f.slots=[];
 const ar=text(IdentityRecoveryPage({
  initialResult:view("account-a","case-approved","aaaaaaaaaaaaaaaa","approved_for_manual_recovery"),
 }));
 expect(ar).toContain("أُجيزت المراجعة للمعالجة بإشراف");
 expect(ar).toContain("الهوية لم تُغيَّر");
 expect(ar).not.toMatch(/استعادة الوصول|تم استرداد الحساب/);
 localeState.locale="en";
});

it("unconfirmed open binds error alert id for the action control",async()=>{
 f.open.mockResolvedValue({ok:false,code:"UNCONFIRMED"});
 const initial=view("account-a","unused-case");
 initial.data.cases=[];
 f.cursor=0;f.slots=[];
 const tree=IdentityRecoveryPage({initialResult:initial});
 const button=nodes(tree).find((n)=>text(n.props.children)==="Open recovery review");
 (button!.props.onClick as()=>void)();
 await Promise.resolve();
 await Promise.resolve();
 f.cursor=0;
 const after=IdentityRecoveryPage({initialResult:initial});
 expect(text(after)).toContain("could not be confirmed");
 const alert=nodes(after).find((n)=>n.props.id==="identity-recovery-error");
 expect(alert).toBeTruthy();
 expect(alert?.props.role??"alert").toBe("alert");
 const bound=nodes(after).find((n)=>text(n.props.children)==="Open recovery review");
 expect(bound?.props["aria-describedby"]).toBe("identity-recovery-error");
});

it("reason select exposes htmlFor association for keyboard users",()=>{
 const tree=render();
 const label=nodes(tree).find((n)=>n.type==="label"&&text(n.props.children).includes("Access lost"));
 expect(label?.props.htmlFor).toBe("identity-recovery-reason");
 const select=nodes(tree).find((n)=>n.props.id==="identity-recovery-reason");
 expect(select).toBeTruthy();
});

it("both recovery routes remount their state for a changed native actor",async()=>{
 f.read.mockResolvedValue(view("account-b","case-b","bbbbbbbbbbbbbbbb"));
 expect((await CustomerRoute()).key).toBe("account-b:bbbbbbbbbbbbbbbb");
 f.read.mockResolvedValue(view("account-b","case-b",""));
 expect((await AdminRoute()).key).toBe("account-b");
});

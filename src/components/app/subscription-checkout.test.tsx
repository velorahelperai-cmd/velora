import { beforeEach, describe, expect, it, vi } from "vitest";
type Node={type:unknown;props:Record<string,unknown>};
const state=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,cleanup:[] as (()=>void)[],live:vi.fn(),test:vi.fn(),assign:vi.fn(),resume:vi.fn(),current:true,selectedCompany:"company-a"}));
vi.mock("react",async()=>({...await vi.importActual("react"),
 useState:(initial:unknown)=>{const i=state.cursor++;if(!(i in state.slots))state.slots[i]=initial;return [state.slots[i],(v:unknown)=>{state.slots[i]=v;}];},
 useRef:(value:unknown)=>{const i=state.cursor++;return state.slots[i]??(state.slots[i]={current:value});},
 useEffect:(fn:()=>void|(()=>void))=>{const i=state.cursor++;if(!(i in state.slots)){state.slots[i]=true;const cleanup=fn();if(cleanup)state.cleanup.push(cleanup);}}
}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams("term=monthly&persona=level_1&package=premium&version=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&amount=90000&currency=OMR")}));
vi.mock("./account-chrome",()=>({useOptionalAccountSession:()=>({identity:{userId:"owner",companyId:state.selectedCompany},isCurrentUser:()=>state.current})}));
vi.mock("@/lib/billing/wiring/live-checkout-actions",()=>({startLiveCheckoutAction:state.live,resumeLiveCheckoutAction:state.resume}));
vi.mock("@/lib/billing/wiring/test-checkout-actions",()=>({startTestCheckoutAction:state.test}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
vi.mock("./workspace-shell",()=>({WorkspaceShell:"main"}));
import {SubscriptionPaymentStatus} from "./subscription-payment-status";
import { SubscriptionPanel } from "./subscription-panel";
const offer={versionId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",planId:"22222222-2222-4222-8222-222222222222",persona:"level_1" as const,package:"premium" as const,term:"monthly" as const,amountBaisa:90000,currency:"OMR" as const,automatedOutboundPerMonth:1500,quotaEnforcement:"not_verified" as const,liveCheckoutReady:true,catalogRevision:7,features:[]};
const props={locale:"en" as const,companyId:"company-a",view:{state:"empty" as const,currentTier:null,cycle:null,paidThrough:null},offersView:{status:"ready" as const,offers:[offer]}};
const nodes=(value:unknown):Node[]=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==="object"&&"props" in value?[value as Node,...nodes((value as Node).props.children)]:[];
const render=(companyId="company-a")=>{state.cursor=0;return SubscriptionPanel({...props,companyId});};
const pay=(tree:unknown)=>nodes(tree).find(n=>n.type==="button"&&n.props["aria-describedby"]==="subscription-payment-note")!;
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
beforeEach(()=>{vi.clearAllMocks();state.slots=[];state.cleanup=[];state.current=true;state.selectedCompany="company-a";vi.stubGlobal("window",{location:{assign:state.assign}});});
describe("checkout response ownership",()=>{
 it("ignores a delayed checkout after the same user's session selects another company before remount",async()=>{
  let resolve!:(v:unknown)=>void;state.live.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  (pay(render()).props.onClick as ()=>void)();(pay(render()).props.onClick as ()=>void)();
  state.selectedCompany="company-b";render();resolve({ok:true,url:"https://om.checkout.paymob.com/synthetic",orderId:"old-order"});await flush();
  expect(state.assign).not.toHaveBeenCalled();expect(nodes(render()).some(n=>n.props.href==="/app/subscription/orders/old-order")).toBe(false);
 });
 it("ignores a delayed resume after the same user's session selects another company before remount",async()=>{
  let resolve!:(v:unknown)=>void;state.resume.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const status=()=>{state.cursor=0;return SubscriptionPaymentStatus({companyId:"company-a",orderId:"old-order",providerEnvironment:"live",display:{kind:"unresolved",messageKey:"payment_unresolved"}});};
  (nodes(status()).find(n=>n.type==="button"&&n.props.disabled===false)!.props.onClick as ()=>void)();
  expect(state.resume).toHaveBeenCalledOnce();state.selectedCompany="company-b";status();resolve({ok:true,url:"https://om.checkout.paymob.com/synthetic"});await flush();
  expect(state.assign).not.toHaveBeenCalled();
 });
 it.each(["unmount","account","company"])("ignores a delayed Live result after %s changes",async change=>{
  let resolve!:(v:unknown)=>void;state.live.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  (pay(render()).props.onClick as ()=>void)();const button=pay(render());(button.props.onClick as ()=>void)();(button.props.onClick as ()=>void)();
  expect(state.live).toHaveBeenCalledTimes(1);expect(state.live).toHaveBeenCalledWith(expect.objectContaining({expectedCompanyId:"company-a",expectedCatalogRevision:7}));expect(state.test).not.toHaveBeenCalled();
  if(change==="unmount")state.cleanup.forEach(fn=>fn());else if(change==="account")state.current=false;else render("company-b");
  resolve({ok:true,url:"https://om.checkout.paymob.com/synthetic",orderId:"old-order"});await flush();
  expect(state.assign).not.toHaveBeenCalled();expect(nodes(render("company-b")).some(n=>n.props.href==="/app/subscription/orders/old-order")).toBe(false);
 });
 it("keeps retry operation stable and redirects only a current result",async()=>{
  state.live.mockResolvedValueOnce({ok:false,code:"live_disabled"}).mockResolvedValueOnce({ok:true,url:"https://om.checkout.paymob.com/synthetic"});
  (pay(render()).props.onClick as ()=>void)();(pay(render()).props.onClick as ()=>void)();await flush();
  (pay(render()).props.onClick as ()=>void)();await flush();
  expect(state.live.mock.calls[0][0].clientOpId).toBe(state.live.mock.calls[1][0].clientOpId);expect(state.assign).toHaveBeenCalledExactlyOnceWith("https://om.checkout.paymob.com/synthetic");
 });
});

// @vitest-environment jsdom
import {act, createElement, StrictMode, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";

const state=vi.hoisted(()=>({
  verify:vi.fn(),profile:vi.fn(),broker:vi.fn(),replace:vi.fn(),routerRefresh:vi.fn(),publish:vi.fn(),
}));
const router={replace:state.replace,refresh:state.routerRefresh,push:vi.fn()};
vi.mock("next/navigation",()=>({useRouter:()=>router,usePathname:()=>"/verify-email",useSearchParams:()=>new URLSearchParams("email=new%40example.test")}));
vi.mock("next/link",()=>({default:({children,href}:{children:ReactNode;href:string})=>createElement("a",{href},children)}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en",state:{}}),emptyBusiness:{}}));
vi.mock("./auth-motion-canvas",()=>({AuthMotionCanvas:()=>null}));
vi.mock("@/lib/auth/session-context",()=>({
  readLocalQuarantine:()=>({type:"quarantine",userId:"old-user",boundaryFingerprint:"aaaaaaaaaaaaaaaa"}),
  publishSessionContext:state.publish,publishSessionLogout:vi.fn(),publishSessionQuarantine:vi.fn(),subscribeSessionContext:()=>()=>{},
}));
vi.mock("@/lib/auth/broker-actions",()=>({readBrokerSessionStatus:state.broker,quarantineCurrentBrokerSession:vi.fn()}));
vi.mock("@/lib/tenancy/actions",()=>({
  verifyEmailCode:state.verify,getAccountProfile:state.profile,signOut:vi.fn(),resendVerificationEmail:vi.fn(),
  completeProfileName:vi.fn(),requestPasswordReset:vi.fn(),resolvePostAuthPath:vi.fn(),signUpWithEmail:vi.fn(),updatePassword:vi.fn(),
}));
vi.mock("@/lib/auth/browser-continuity",()=>({ensureBrowserContinuity:vi.fn(async()=>({ok:true,requestNonce:"00000000-0000-4000-8000-000000000001"})),clearAuthGestureNonce:vi.fn()}));
import {AccountSessionProvider,useOptionalAccountSession} from "./account-chrome";
import {VerifyEmailPage} from "./auth-pages";
let root:Root,container:HTMLDivElement;
function Probe(){return createElement("output",{"data-session-state":true},useOptionalAccountSession()?.status);}
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers();localStorage.clear();sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("matchMedia",()=>({matches:true,addEventListener(){},removeEventListener(){}}));
  vi.stubGlobal("requestAnimationFrame",(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
  vi.stubGlobal("cancelAnimationFrame",(id:number)=>clearTimeout(id));
  state.broker.mockResolvedValue({ok:false,code:"UNAUTHENTICATED"});
  state.profile.mockResolvedValue({ok:true,data:{userId:"new-user",email:"new@example.test",fullName:"New user",companyId:null,isPlatformAdmin:false}});
  state.verify.mockImplementation(async()=>{
    state.broker.mockResolvedValue({ok:true,userId:"new-user",boundaryFingerprint:"bbbbbbbbbbbbbbbb",nativeSessionId:"native-b",contextGeneration:1,generation:"new-generation"});
    return {ok:true,data:{next:"/setup",userId:"new-user",boundaryFingerprint:"bbbbbbbbbbbbbbbb"}};
  });
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});

it("verifies a new mailbox through real mounted provider and OTP page despite old quarantine",async()=>{
  await act(async()=>root.render(createElement(StrictMode,null,createElement(AccountSessionProvider,null,createElement(Probe),createElement(VerifyEmailPage)))));
  await act(async()=>{await vi.advanceTimersByTimeAsync(50);});
  expect(container.querySelector("[data-session-state]")?.textContent).toBe("guest");
  expect(state.profile).not.toHaveBeenCalled();
  const form=container.querySelector('[data-auth-otp-modal="true"] form')!;
  expect(form).toBeTruthy();
  const paste=new Event("paste",{bubbles:true,cancelable:true});Object.defineProperty(paste,"clipboardData",{value:{getData:()=>"012345"}});
  await act(async()=>{form.dispatchEvent(paste);});
  await act(async()=>{await vi.advanceTimersByTimeAsync(500);});
  expect(state.verify).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[data-session-state]")?.textContent).toBe("ready");
  expect(state.replace).toHaveBeenCalledExactlyOnceWith("/setup");
});

// Preserve existing UI race fixtures; transport/native authority have separate tests.
vi.mock("@/lib/auth/account-profile-client",()=>({fetchAttestedAccountProfile:async()=>{
 const {getAccountProfile}=await import("@/lib/tenancy/actions");
 const result=await getAccountProfile();if(!result.ok)return result;
 const {readBrokerSessionStatus}=await import("@/lib/auth/broker-actions");
 const attestation=await readBrokerSessionStatus();
 return attestation.ok?{...result,attestation}:{ok:false,code:attestation.code};
}}));

vi.mock("@/lib/auth/account-session-client",()=>({fetchAccountSession:async(correlation?:unknown)=>{
 const {readBrokerSessionStatus}=await import("@/lib/auth/broker-actions");return readBrokerSessionStatus(correlation);
}}));

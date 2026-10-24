// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({
 query:"email=fixture%40example.test",verify:vi.fn(),resend:vi.fn(),continuity:vi.fn(),clearNonce:vi.fn(),refresh:vi.fn(),clear:vi.fn(),replace:vi.fn(),routerRefresh:vi.fn(),
 snapshot:{status:"guest",userId:null as string|null,boundaryFingerprint:null as string|null,ready:false},
}));
vi.mock("next/navigation",()=>({useRouter:()=>({replace:state.replace,refresh:state.routerRefresh,push:vi.fn()}),useSearchParams:()=>new URLSearchParams(state.query)}));
vi.mock("next/link",()=>({default:({children,href}:{children:ReactNode;href:string})=>createElement("a",{href},children)}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en",state:{}})}));
vi.mock("./auth-motion-canvas",()=>({AuthMotionCanvas:()=>null}));
vi.mock("./account-chrome",()=>({AccountMenu:()=>null,useOptionalAccountSession:()=>({
 status:state.snapshot.status,identity:null,refresh:state.refresh,boundaryFingerprint:state.snapshot.boundaryFingerprint,liveSnapshot:()=>state.snapshot,
})}));
vi.mock("@/lib/tenancy/actions",()=>({
 verifyEmailCode:state.verify,getAccountProfile:vi.fn(),resendVerificationEmail:state.resend,completeProfileName:vi.fn(),
 requestPasswordReset:vi.fn(),resolvePostAuthPath:vi.fn(),signUpWithEmail:vi.fn(),updatePassword:vi.fn(),
}));
vi.mock("@/lib/auth/browser-continuity",()=>({
 ensureBrowserContinuity:state.continuity,clearAuthGestureNonce:state.clearNonce,
}));
vi.mock("@/lib/auth/auth-journey",async()=>({
 ...await vi.importActual<typeof import("@/lib/auth/auth-journey")>("@/lib/auth/auth-journey"),
 clearPendingSignup:state.clear,readPendingSignup:()=>null,
}));
import {VerifyEmailPage} from "./auth-pages";
const accepted={ok:true as const,data:{next:"/setup",userId:"user-a",boundaryFingerprint:"aaaaaaaaaaaaaaaa"}};
let resolveVerify:(result:typeof accepted)=>void,root:Root,container:HTMLDivElement,mounted=false;
beforeEach(()=>{
 vi.resetAllMocks();vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 vi.stubGlobal("matchMedia",()=>({matches:true,addEventListener(){},removeEventListener(){}}));
 state.query="email=fixture%40example.test";state.snapshot={status:"guest",userId:null,boundaryFingerprint:null,ready:false};
 state.verify.mockImplementation(()=>new Promise(resolve=>{resolveVerify=resolve;}));
 state.continuity.mockResolvedValue({ok:true,requestNonce:"00000000-0000-4000-8000-000000000001"});
 state.refresh.mockImplementation(async()=>{state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"aaaaaaaaaaaaaaaa",ready:true};});
 container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);mounted=true;
});
afterEach(async()=>{if(mounted)await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
async function render(){await act(async()=>{root.render(createElement(VerifyEmailPage));});await act(async()=>{vi.advanceTimersByTime(20);});}
async function submit(expectSent=true){
 await render();const form=container.querySelector('[data-auth-otp-modal="true"] form')!;
 const paste=new Event("paste",{bubbles:true,cancelable:true});Object.defineProperty(paste,"clipboardData",{value:{getData:()=>"012345"}});
 await act(async()=>{form.dispatchEvent(paste);});await act(async()=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
 if(expectSent)expect(state.verify).toHaveBeenCalledTimes(1);
}
async function accept(){await act(async()=>{resolveVerify(accepted);});}
async function resend(){
 await render();const button=[...container.querySelectorAll("button")].find(button=>button.textContent==="Send a new confirmation code")!;
 expect(button).toBeTruthy();await act(async()=>{button.dispatchEvent(new MouseEvent("click",{bubbles:true}));});
}
describe("mounted verification result ownership",()=>{
 it.each(["resolved error", "throw"])("recovers by session read only after refresh %s",async mode=>{
  state.refresh.mockImplementationOnce(async()=>{
   state.snapshot={status:"error",userId:null,boundaryFingerprint:null,ready:false};
   if(mode==="throw")throw new Error("synthetic transport failure");
  });
  await submit();await accept();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Your email is confirmed, but the session check is unavailable");
  const retry=[...container.querySelectorAll("button")].find(button=>button.textContent==="Retry session check")!;
  expect(retry).toBeTruthy();expect(state.clear).not.toHaveBeenCalled();
  expect([...container.querySelectorAll<HTMLInputElement>('[data-auth-otp-cell]')].every(input=>input.disabled)).toBe(true);
  await act(async()=>{retry.click();});await act(async()=>{vi.advanceTimersByTime(120);});
  expect(state.verify).toHaveBeenCalledTimes(1);expect(state.refresh).toHaveBeenCalledTimes(2);
  expect(state.replace).toHaveBeenCalledExactlyOnceWith("/setup");
 });
 it("requires READY even when refresh retains the admitted identity",async()=>{
  state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"aaaaaaaaaaaaaaaa",ready:true};
  state.refresh.mockImplementationOnce(async()=>{state.snapshot={...state.snapshot,status:"error",ready:false};});
  await submit();await accept();expect(container.querySelector('[role="alert"]')?.textContent).toContain("session check is unavailable");
  await act(async()=>{vi.advanceTimersByTime(5000);});expect(state.replace).not.toHaveBeenCalled();
 });
 it("discards a session-read recovery if the account changes during that read",async()=>{
  state.refresh.mockImplementationOnce(async()=>{state.snapshot={status:"error",userId:null,boundaryFingerprint:null,ready:false};});
  await submit();await accept();
  let finish!:()=>void;state.refresh.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const retry=[...container.querySelectorAll("button")].find(button=>button.textContent==="Retry session check")!;
  expect(retry).toBeTruthy();await act(async()=>{retry.click();});
  state.snapshot={status:"ready",userId:"user-b",boundaryFingerprint:"bbbbbbbbbbbbbbbb",ready:true};await render();
  await act(async()=>{finish();vi.advanceTimersByTime(5000);});expect(state.verify).toHaveBeenCalledTimes(1);
  expect(state.clear).not.toHaveBeenCalled();expect(state.replace).not.toHaveBeenCalled();
 });
 it("does not send verification after the account changes while continuity is pending",async()=>{
  let resume!:(value:{ok:true;requestNonce:string})=>void;
  state.continuity.mockImplementation(()=>new Promise(resolve=>{resume=resolve;}));
  await submit(false);state.snapshot={status:"ready",userId:"user-b",boundaryFingerprint:"bbbbbbbbbbbbbbbb",ready:true};
  await render();await act(async()=>{resume({ok:true,requestNonce:"00000000-0000-4000-8000-000000000001"});});
  expect(state.verify).not.toHaveBeenCalled();expect(state.clear).not.toHaveBeenCalled();
 });
 it("admits the matching result and navigates once",async()=>{
  await submit();await accept();await act(async()=>{vi.advanceTimersByTime(120);});expect(state.replace).toHaveBeenCalledExactlyOnceWith("/setup");
 });
 it.each(["new account","same user new session","logout"])("ignores the old result after %s",async scenario=>{
  if(scenario!=="new account")state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"aaaaaaaaaaaaaaaa",ready:true};
  await submit();
  state.snapshot=scenario==="logout"?{status:"guest",userId:null,boundaryFingerprint:null,ready:false}:
   {status:"ready",userId:scenario==="new account"?"user-b":"user-a",boundaryFingerprint:"bbbbbbbbbbbbbbbb",ready:true};
  state.refresh.mockImplementation(async()=>{});await render();await accept();
  expect(state.clear).not.toHaveBeenCalled();expect(state.refresh).not.toHaveBeenCalled();
  await act(async()=>{vi.advanceTimersByTime(5000);});expect(state.replace).not.toHaveBeenCalled();
 });
 it("ignores completion after the email journey changes",async()=>{
  await submit();state.query="email=other%40example.test";await render();await accept();
  expect(state.clear).not.toHaveBeenCalled();expect(state.refresh).not.toHaveBeenCalled();
 });
 it("does not clear browser state after unmount",async()=>{
  await submit();await act(async()=>root.unmount());mounted=false;await accept();
  expect(state.clear).not.toHaveBeenCalled();expect(state.refresh).not.toHaveBeenCalled();
 });
 it("does not navigate if the session changes during success motion",async()=>{
  await submit();await accept();state.snapshot={status:"ready",userId:"user-b",boundaryFingerprint:"bbbbbbbbbbbbbbbb",ready:true};
  await render();await act(async()=>{vi.advanceTimersByTime(120);});expect(state.replace).not.toHaveBeenCalled();
 });
 it("binds native resend to continuity and preserves UNKNOWN nonce",async()=>{
  state.resend.mockResolvedValue({ok:false,code:"UNAVAILABLE",message:"verification_unavailable"});
  await resend();expect(state.resend).toHaveBeenCalledExactlyOnceWith("fixture@example.test","","00000000-0000-4000-8000-000000000001");
  expect(state.continuity).toHaveBeenCalledWith("verification_resend");expect(state.clearNonce).not.toHaveBeenCalled();
  state.resend.mockResolvedValue({ok:true});await resend();
  expect(state.clearNonce).toHaveBeenCalledExactlyOnceWith("00000000-0000-4000-8000-000000000001");
 });
 it("ignores a stale resend reply after a session switch",async()=>{
  let complete!:(value:{ok:true})=>void;state.resend.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  await resend();state.snapshot={status:"ready",userId:"user-b",boundaryFingerprint:"bbbbbbbbbbbbbbbb",ready:true};
  await render();await act(async()=>{complete({ok:true});});expect(state.clearNonce).not.toHaveBeenCalled();
  expect([...container.querySelectorAll("button")].find(button=>button.textContent==="Send a new confirmation code")?.disabled).toBe(false);
 });
});

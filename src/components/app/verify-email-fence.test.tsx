// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { setTimeout as hostTurn } from "node:timers/promises";
import { createRoot, type Root } from "react-dom/client";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({
 query:"email=fixture%40example.test",verify:vi.fn(),resend:vi.fn(),continuity:vi.fn(),clearNonce:vi.fn(),refresh:vi.fn(),clear:vi.fn(),replace:vi.fn(),routerRefresh:vi.fn(),
 snapshot:{status:"guest",userId:null as string|null,boundaryFingerprint:null as string|null,ready:false},
 identity:null as null|{userId:string;email:string},
}));
vi.mock("next/navigation",()=>({useRouter:()=>({replace:state.replace,refresh:state.routerRefresh,push:vi.fn()}),useSearchParams:()=>new URLSearchParams(state.query)}));
vi.mock("next/link",()=>({default:({children,href}:{children:ReactNode;href:string})=>createElement("a",{href},children)}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en",state:{}})}));
vi.mock("./auth-motion-canvas",()=>({AuthMotionCanvas:()=>null}));
vi.mock("./account-chrome",()=>({AccountMenu:()=>null,useOptionalAccountSession:()=>({
 status:state.snapshot.status,identity:state.identity,refresh:state.refresh,boundaryFingerprint:state.snapshot.boundaryFingerprint,liveSnapshot:()=>state.snapshot,
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
let testClock=0;
let initialResendReady=false;
let resolveVerify:(result:typeof accepted)=>void,root:Root,container:HTMLDivElement,mounted=false;
beforeEach(()=>{
 initialResendReady=false;vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(Date.UTC(2026,9,24,19,++testClock*5));localStorage.clear();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 vi.stubGlobal("matchMedia",()=>({matches:true,addEventListener(){},removeEventListener(){}}));
 state.query="email=fixture%40example.test";state.snapshot={status:"guest",userId:null,boundaryFingerprint:null,ready:false};state.identity=null;
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
 await render();const button=container.querySelector<HTMLButtonElement>("[data-auth-otp-resend]")!;
 expect(button).toBeTruthy();
 // Native digest completion is independent of the fake clock. Wait for the
 // initial enabled control, but preserve later deliberate cooldown-blocked clicks.
 if(!initialResendReady){
  for(let attempt=0;button.disabled&&attempt<100;attempt++){
   await act(async()=>{await hostTurn(10);});
  }
  expect(button.disabled).toBe(false);initialResendReady=true;
 }
 await act(async()=>{button.dispatchEvent(new MouseEvent("click",{bubbles:true}));});
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
  expect(container.querySelector("[data-auth-verify-fence]")?.getAttribute("data-auth-verify-fence")).toBe("foreign_session");
 });
 it("still contacts the provider when the same user rotates fingerprint during continuity",async()=>{
  state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"aaaaaaaaaaaaaaaa",ready:true};
  let resume!:(value:{ok:true;requestNonce:string})=>void;
  state.continuity.mockImplementation(()=>new Promise(resolve=>{resume=resolve;}));
  await submit(false);
  state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"bbbbbbbbbbbbbbbb",ready:true};
  await render();
  await act(async()=>{resume({ok:true,requestNonce:"00000000-0000-4000-8000-000000000001"});});
  expect(state.verify).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[data-auth-verify-fence]")).toBeNull();
  await accept();
  await act(async()=>{vi.advanceTimersByTime(120);});
  expect(state.replace).toHaveBeenCalledExactlyOnceWith("/setup");
 });
 it("admits the matching result and navigates once",async()=>{
  await submit();expect(container.querySelector("[data-auth-otp-pending]")).not.toBeNull();expect(container.querySelector("[data-auth-otp-success]")).toBeNull();await accept();await act(async()=>{vi.advanceTimersByTime(120);});expect(state.replace).toHaveBeenCalledExactlyOnceWith("/setup");
 });
 it("ignores the old result after a real account switch and records account_switched",async()=>{
  state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"aaaaaaaaaaaaaaaa",ready:true};
  await submit();
  state.snapshot={status:"ready",userId:"user-b",boundaryFingerprint:"bbbbbbbbbbbbbbbb",ready:true};
  state.refresh.mockImplementation(async()=>{});await render();await accept();
  expect(state.verify).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("browser session changed or expired");
  expect(container.querySelector("[data-auth-verify-fence]")?.getAttribute("data-auth-verify-fence")).toBe("account_switched");
  expect(state.clear).not.toHaveBeenCalled();expect(state.refresh).not.toHaveBeenCalled();
  await act(async()=>{vi.advanceTimersByTime(5000);});expect(state.replace).not.toHaveBeenCalled();
 });
 it("ignores the old result after logout and records signed_out",async()=>{
  state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"aaaaaaaaaaaaaaaa",ready:true};
  await submit();
  state.snapshot={status:"guest",userId:null,boundaryFingerprint:null,ready:false};
  state.refresh.mockImplementation(async()=>{});await render();await accept();
  expect(state.verify).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("browser session changed or expired");
  expect(container.querySelector("[data-auth-verify-fence]")?.getAttribute("data-auth-verify-fence")).toBe("signed_out");
  expect(state.refresh).not.toHaveBeenCalled();
  await act(async()=>{vi.advanceTimersByTime(5000);});expect(state.replace).not.toHaveBeenCalled();
 });
 it("keeps the same-user fingerprint renewal as the same journey and completes after provider OK",async()=>{
  state.identity={userId:"user-a",email:"fixture@example.test"};
  state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"aaaaaaaaaaaaaaaa",ready:true};
  await submit();
  // Exact prior false-positive: same userId, new boundaryFingerprint mid-flight.
  state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"bbbbbbbbbbbbbbbb",ready:true};
  await render();await accept();
  expect(state.verify).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[data-auth-verify-fence]")).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent ?? "").not.toContain("browser session changed or expired");
  expect(state.refresh).toHaveBeenCalled();
  await act(async()=>{vi.advanceTimersByTime(120);});
  expect(state.replace).toHaveBeenCalledExactlyOnceWith("/setup");
 });
 it("rejects same userId when the live mailbox is not the verification journey email",async()=>{
  state.identity={userId:"user-a",email:"fixture@example.test"};
  state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"aaaaaaaaaaaaaaaa",ready:true};
  await submit();
  state.identity={userId:"user-a",email:"other@example.test"};
  state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"bbbbbbbbbbbbbbbb",ready:true};
  state.refresh.mockImplementation(async()=>{});await render();await accept();
  expect(state.verify).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("browser session changed or expired");
  expect(container.querySelector("[data-auth-verify-fence]")?.getAttribute("data-auth-verify-fence")).toBe("foreign_session");
  expect(state.replace).not.toHaveBeenCalled();
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
  await resend();expect(state.resend).toHaveBeenCalledExactlyOnceWith("fixture@example.test","","00000000-0000-4000-8000-000000000001",expect.objectContaining({request_id:expect.stringMatching(/^VEL-[A-F0-9]{16}$/)}));
  expect(state.continuity).toHaveBeenCalledWith("verification_resend",expect.objectContaining({request_id:expect.stringMatching(/^VEL-[A-F0-9]{16}$/)}),{freshGesture:true});expect(state.clearNonce).not.toHaveBeenCalled();
  // Failed acceptance must not start the advisory wait — immediate retry stays available.
  await resend();expect(state.resend).toHaveBeenCalledTimes(2);
  state.resend.mockResolvedValue({ok:true});await resend();
  expect(state.clearNonce).toHaveBeenCalledExactlyOnceWith("00000000-0000-4000-8000-000000000001");
  expect(state.resend).toHaveBeenCalledTimes(3);
  expect(container.textContent).toContain("A new code was requested");
  await resend();expect(state.resend).toHaveBeenCalledTimes(3);
  await act(async()=>{vi.advanceTimersByTime(61000);});
  await resend();expect(state.resend).toHaveBeenCalledTimes(4);
 });
 it("waits for delayed cooldown initialization before resending",async()=>{
  const digest=vi.spyOn(crypto.subtle,"digest").mockImplementation(async()=>{
   await hostTurn(250);return new ArrayBuffer(32);
  });
  state.resend.mockResolvedValue({ok:false,code:"AUTH_ERROR",message:"verification_rate_limited",data:{retryAfterSeconds:12}});
  try{
   await resend();
   expect(digest).toHaveBeenCalled();
   expect(state.resend).toHaveBeenCalledTimes(1);
   expect(container.querySelector<HTMLButtonElement>("[data-auth-otp-resend]")?.disabled).toBe(true);
   expect(container.textContent).not.toContain("A new code was requested");
  }finally{digest.mockRestore();}
 });
 it("rate-limits without claiming send success and honors provider wait seconds",async()=>{
  state.resend.mockResolvedValue({ok:false,code:"AUTH_ERROR",message:"verification_rate_limited",data:{retryAfterSeconds:12}});
  await resend();
  expect(state.resend).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("A new code was requested");
  expect(container.querySelector('[role="alert"]')?.textContent?.length).toBeGreaterThan(0);
  expect(container.querySelector<HTMLButtonElement>("[data-auth-otp-resend]")?.disabled).toBe(true);
  await act(async()=>{vi.advanceTimersByTime(11000);});
  expect(container.querySelector<HTMLButtonElement>("[data-auth-otp-resend]")?.disabled).toBe(true);
  await act(async()=>{vi.advanceTimersByTime(2000);});
  expect(container.querySelector<HTMLButtonElement>("[data-auth-otp-resend]")?.disabled).toBe(false);
 });
 it("serializes one in-flight resend so a double gesture cannot open two Auth calls",async()=>{
  let release!:(value:{ok:true})=>void;
  state.resend.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  await resend();
  const button=container.querySelector<HTMLButtonElement>("[data-auth-otp-resend]")!;
  await act(async()=>{button.click();button.click();});
  expect(state.resend).toHaveBeenCalledTimes(1);
  await act(async()=>{release({ok:true});});
  expect(state.resend).toHaveBeenCalledTimes(1);
 });
 it("ignores a stale resend reply after a session switch",async()=>{
  let complete!:(value:{ok:true})=>void;state.resend.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  await resend();state.snapshot={status:"ready",userId:"user-b",boundaryFingerprint:"bbbbbbbbbbbbbbbb",ready:true};
  await render();await act(async()=>{complete({ok:true});});expect(state.clearNonce).not.toHaveBeenCalled();
  // Provider accepted before the fence — advisory wait commits; UI must not claim delivery success.
  expect(container.querySelector<HTMLButtonElement>("[data-auth-otp-resend]")?.disabled).toBe(true);
  expect(container.textContent).not.toContain("A new code was requested");
  await act(async()=>{vi.advanceTimersByTime(61000);});
  expect(container.querySelector<HTMLButtonElement>("[data-auth-otp-resend]")?.disabled).toBe(false);
 });
});

it("restores session-only recovery when readiness is lost at success animation completion",async()=>{
 await submit();await accept();state.snapshot={status:"error",userId:"user-a",boundaryFingerprint:"aaaaaaaaaaaaaaaa",ready:false};await render();
 await act(async()=>{vi.advanceTimersByTime(120);});await act(async()=>{vi.advanceTimersByTime(20);});expect(state.replace).not.toHaveBeenCalled();
 expect(container.querySelector('[role="alert"]')?.textContent).toContain("session check is unavailable");
 const retry=[...container.querySelectorAll("button")].find(button=>button.textContent==="Retry session check");expect(retry).toBeTruthy();
 state.snapshot={status:"ready",userId:"user-a",boundaryFingerprint:"aaaaaaaaaaaaaaaa",ready:true};await render();await act(async()=>{retry!.click();});await act(async()=>{vi.advanceTimersByTime(120);});
 expect(state.verify).toHaveBeenCalledTimes(1);expect(state.refresh).toHaveBeenCalledTimes(2);expect(state.replace).toHaveBeenCalledExactlyOnceWith("/setup");
});

it.each([{status:'expired',reason:'status_expired'},{status:'locked',reason:'status_locked'}] as const)('explains blocked verification for an initially $status session without contacting provider',async({status,reason})=>{
 state.snapshot={status,userId:'user-a',boundaryFingerprint:'aaaaaaaaaaaaaaaa',ready:false};await submit(false);
 expect(state.verify).not.toHaveBeenCalled();
 expect(state.continuity).not.toHaveBeenCalled();
 expect(container.querySelector('[role="alert"]')?.textContent).toContain('browser session changed or expired');
 expect(container.querySelector('[data-auth-verify-fence]')?.getAttribute('data-auth-verify-fence')).toBe(reason);
 expect(state.replace).not.toHaveBeenCalled();
});
it('explains blocked resend instead of silently claiming delivery',async()=>{
 state.snapshot={status:'expired',userId:'user-a',boundaryFingerprint:'aaaaaaaaaaaaaaaa',ready:false};await resend();
 expect(state.resend).not.toHaveBeenCalled();
 expect(state.continuity).not.toHaveBeenCalled();
 expect(container.querySelector('[role="alert"]')?.textContent).toContain('browser session changed or expired');
 expect(container.querySelector('[data-auth-verify-fence]')?.getAttribute('data-auth-verify-fence')).toBe('status_expired');
 expect(container.textContent).not.toContain('new code has been requested');
});
it('blocks resend before the provider when continuity sees a foreign account',async()=>{
 let resume!:(value:{ok:true;requestNonce:string})=>void;
 state.continuity.mockImplementation(()=>new Promise(resolve=>{resume=resolve;}));
 await resend();
 expect(state.continuity).toHaveBeenCalledTimes(1);
 expect(state.resend).not.toHaveBeenCalled();
 state.snapshot={status:'ready',userId:'user-b',boundaryFingerprint:'bbbbbbbbbbbbbbbb',ready:true};
 await render();
 await act(async()=>{resume({ok:true,requestNonce:'00000000-0000-4000-8000-000000000001'});});
 expect(state.resend).not.toHaveBeenCalled();
 expect(container.querySelector('[data-auth-verify-fence]')?.getAttribute('data-auth-verify-fence')).toBe('foreign_session');
});
it('still reaches the resend provider when the same user only rotates fingerprint',async()=>{
 state.snapshot={status:'ready',userId:'user-a',boundaryFingerprint:'aaaaaaaaaaaaaaaa',ready:true};
 state.resend.mockResolvedValue({ok:true});
 let resume!:(value:{ok:true;requestNonce:string})=>void;
 state.continuity.mockImplementation(()=>new Promise(resolve=>{resume=resolve;}));
 await resend();
 state.snapshot={status:'ready',userId:'user-a',boundaryFingerprint:'bbbbbbbbbbbbbbbb',ready:true};
 await render();
 await act(async()=>{resume({ok:true,requestNonce:'00000000-0000-4000-8000-000000000001'});});
 expect(state.resend).toHaveBeenCalledTimes(1);
 expect(container.querySelector('[data-auth-verify-fence]')).toBeNull();
 expect(container.querySelector('[role="alert"]')).toBeNull();
});
it('does not place an interrupted old request error into a new email journey',async()=>{
 let finish!:(value:{ok:true;requestNonce:string})=>void;state.continuity.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await submit(false);state.query='email=other%40example.test';await render();await act(async()=>{finish({ok:true,requestNonce:'00000000-0000-4000-8000-000000000001'});});
 expect(state.verify).not.toHaveBeenCalled();expect(container.textContent).not.toContain('browser session changed or expired');
});

it('reports a boundary change even when the admitted-session refresh throws',async()=>{
 state.refresh.mockImplementationOnce(async()=>{state.snapshot={status:'ready',userId:'user-b',boundaryFingerprint:'bbbbbbbbbbbbbbbb',ready:true};throw new Error('synthetic session-read failure');});await submit();await accept();
 expect(container.querySelector('[role="alert"]')?.textContent).toContain('browser session changed or expired');expect(state.verify).toHaveBeenCalledTimes(1);expect(state.clear).not.toHaveBeenCalled();expect(state.replace).not.toHaveBeenCalled();
});

it.each(['/complete-profile?next=%2Fsetup','/setup','/app'])('follows the server-authorized next route %s instead of forcing setup',async next=>{
 state.query='email=fixture%40example.test&next=%2Fsetup';await submit();await act(async()=>resolveVerify({...accepted,data:{...accepted.data,next}}));await act(async()=>{vi.advanceTimersByTime(120);});
 expect(state.replace).toHaveBeenCalledExactlyOnceWith(next);expect(state.verify).toHaveBeenCalledTimes(1);expect(state.refresh).toHaveBeenCalledTimes(1);
});
it('runs sixth-digit autosubmit through provider, READY session and full success animation before navigation',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));await render();const cells=container.querySelectorAll<HTMLInputElement>('[data-auth-otp-cell]');
 for(let i=0;i<5;i++){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(cells[i],String(i));cells[i].dispatchEvent(new Event('input',{bubbles:true}));});}
 expect(state.verify).not.toHaveBeenCalled();expect(state.continuity).not.toHaveBeenCalled();
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(cells[5],'5');cells[5].dispatchEvent(new Event('input',{bubbles:true}));});
 expect(state.verify).toHaveBeenCalledTimes(1);expect(state.continuity).toHaveBeenCalledWith('verify_email',expect.objectContaining({request_id:expect.stringMatching(/^VEL-[A-F0-9]{16}$/)}));expect(state.refresh).not.toHaveBeenCalled();expect(state.replace).not.toHaveBeenCalled();
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));vi.advanceTimersByTime(1100);});expect(state.verify).toHaveBeenCalledTimes(1);expect(container.querySelector('[data-auth-otp-success]')).toBeNull();
 await act(async()=>resolveVerify({...accepted,data:{...accepted.data,next:'/complete-profile?next=%2Fsetup'}}));await act(async()=>{vi.advanceTimersByTime(0);});expect(state.refresh).toHaveBeenCalledTimes(1);expect(state.replace).not.toHaveBeenCalled();
 expect(state.snapshot.status).toBe('ready');await act(async()=>{vi.advanceTimersByTime(1199);});expect(state.replace).not.toHaveBeenCalled();await act(async()=>{vi.advanceTimersByTime(1);});
 expect(state.replace).toHaveBeenCalledExactlyOnceWith('/complete-profile?next=%2Fsetup');expect(state.verify.mock.invocationCallOrder[0]).toBeLessThan(state.refresh.mock.invocationCallOrder[0]);expect(state.refresh.mock.invocationCallOrder[0]).toBeLessThan(state.replace.mock.invocationCallOrder[0]);
});

it('keeps verify and session-only recovery under the same correlation without replaying the code',async()=>{
 state.refresh.mockImplementationOnce(async()=>{state.snapshot={status:'error',userId:null,boundaryFingerprint:null,ready:false};});await submit();const packet=state.verify.mock.calls[0][0].correlation;expect(packet?.request_id).toMatch(/^VEL-[A-F0-9]{16}$/);await accept();expect(state.refresh).toHaveBeenLastCalledWith(packet);
 await act(async()=>{container.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click();});expect(state.verify).toHaveBeenCalledTimes(1);expect(state.refresh).toHaveBeenLastCalledWith(packet);
});
it('sends bounded correlation on resend without exposing it in customer copy',async()=>{
 state.resend.mockResolvedValue({ok:true,data:undefined});await resend();const packet=state.resend.mock.calls[0][3];expect(packet?.trace_id).toMatch(/^[a-f0-9]{32}$/);expect(container.textContent).not.toContain(packet.request_id);
});

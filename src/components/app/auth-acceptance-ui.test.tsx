// @vitest-environment jsdom
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appCopy } from "@/lib/app-copy";
const state=vi.hoisted(()=>({locale:"en",push:vi.fn(),resend:vi.fn()}));
vi.mock("next/navigation",()=>{const router={push:state.push,replace:vi.fn(),refresh:vi.fn()};return {useRouter:()=>router,useSearchParams:()=>new URLSearchParams("email=fixture%40example.test")};});
vi.mock("next/link",()=>({default:({children,href,onClick}:{children:ReactNode;href:string;onClick?:()=>void})=>createElement("a",{href,onClick},children)}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:state.locale,state:{},update:vi.fn()})}));
vi.mock("./auth-motion-canvas",()=>({AuthMotionCanvas:()=>null}));
vi.mock("./account-chrome",()=>({AccountMenu:()=>null,useOptionalAccountSession:()=>null}));
vi.mock("@/lib/tenancy/actions",()=>({completeProfileName:vi.fn(),requestPasswordReset:vi.fn(),resendVerificationEmail:state.resend,resolvePostAuthPath:vi.fn(),signUpWithEmail:vi.fn(),updatePassword:vi.fn(),verifyEmailCode:vi.fn()}));
vi.mock("./ui",async()=>({...await vi.importActual<typeof import("./ui")>("./ui"),useAppCopy:()=>appCopy(state.locale as "en"|"ar")}));
import { AuthShell, VerifyEmailPage } from "./auth-pages";
import { AuthOtpModal } from "./auth-otp-modal";
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("matchMedia",()=>({matches:true,addEventListener(){},removeEventListener(){}}));container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
it("closing verification leaves exactly one interactive reopen action and an opaque card",async()=>{
 await act(async()=>root.render(createElement(VerifyEmailPage)));
 await act(async()=>{container.querySelector<HTMLButtonElement>('[data-auth-otp-close]')!.click();});
 const reopen=[...container.querySelectorAll('button')].filter(e=>e.textContent==="Confirm code and continue");
 expect(reopen).toHaveLength(1);expect(reopen[0].closest('[inert]')).toBeNull();
 expect(container.querySelector('.auth-entry-card')?.className).not.toContain('opacity-55');
 await act(async()=>{reopen[0].click();});expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});
it("presents resend as one inline prompt and keeps email correction collapsed",async()=>{
 await act(async()=>root.render(createElement(VerifyEmailPage)));
 const dialog=container.querySelector('[role="dialog"]')!;
 expect(dialog.textContent).toContain("Didn't receive the code?");
 expect(dialog.querySelectorAll('[data-auth-otp-resend]')).toHaveLength(1);
 expect(dialog.querySelector('a[href="/login"]')).toBeNull();
 const correction=dialog.querySelector('details');expect(correction).not.toBeNull();expect(correction?.open).toBe(false);
 expect(correction?.querySelector('input[type="email"]')).not.toBeNull();
});
it("resend cooldown disables the same real action and cannot call it",async()=>{
 const props={open:true,email:"fixture@example.test",title:"Confirm",body:"Code",realBody:"Read it",codeLabel:"Code",codeHint:"Private",codeFormat:"6 digits",verifyLabel:"Verify",resendPrompt:"Didn't receive the code?",resendLabel:"Resend",resendInLabel:"Resend in 42s",resentNotice:"Sent",correctEmailLabel:"Correct email",correctEmailHint:"Signup",loginLabel:"Sign in",loginHref:"/login",closeLabel:"Close",cooldown:42,onClose:vi.fn(),onSubmitCode:vi.fn(),onResend:state.resend,onCorrectEmail:vi.fn(),onSuccessAnimDone:vi.fn()};
 await act(async()=>root.render(createElement(AuthOtpModal,props)));
 const button=container.querySelector<HTMLButtonElement>('[data-auth-otp-resend]');expect(button).not.toBeNull();expect(button?.disabled).toBe(true);expect(button?.textContent).toBe("Resend in 42s");
 await act(async()=>{button?.click();});expect(state.resend).not.toHaveBeenCalled();
});

it("initializes a requested morph before the first paint rather than flashing an expanded destination",async()=>{
 vi.useFakeTimers();vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
 sessionStorage.setItem("velora.auth.entry.morph","1");
 try {
  await act(async()=>root.render(<AuthShell entry title="Sign in"><p>form</p></AuthShell>));
  expect(container.querySelector('[data-auth-entry-card]')?.getAttribute('data-auth-entry-collapsed')).toBe('true');
  expect(container.querySelector('.auth-entry-card-body')?.hasAttribute('inert')).toBe(true);
 } finally {vi.useRealTimers();sessionStorage.clear();}
});

it("rearms the incoming reveal after StrictMode reconnects its layout effect",async()=>{
 vi.useFakeTimers();vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
 sessionStorage.setItem("velora.auth.entry.morph","1");
 try {
  await act(async()=>root.render(createElement(StrictMode,null,<AuthShell entry title="Sign in"><p>form</p></AuthShell>)));
  await act(async()=>{vi.advanceTimersByTime(800);});
  expect(container.querySelector('[data-auth-entry-card]')?.getAttribute('data-auth-entry-collapsed')).toBe('false');
  expect(container.querySelector('.auth-entry-card-body')?.hasAttribute('inert')).toBe(false);
 } finally {vi.useRealTimers();sessionStorage.clear();}
});

it("cancels a pending mode switch when browser history interrupts it",async()=>{
 vi.useFakeTimers();state.push.mockClear();vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
 try {
  await act(async()=>root.render(<AuthShell entry title="Sign in"><p>form</p></AuthShell>));
  await act(async()=>{window.dispatchEvent(new CustomEvent("velora-auth-morph-out",{detail:{href:"/signup"}}));});
  await act(async()=>{window.dispatchEvent(new PopStateEvent("popstate"));vi.advanceTimersByTime(1000);});
  expect(state.push).not.toHaveBeenCalled();
  expect(container.querySelector('[data-auth-entry-card]')?.getAttribute('data-auth-entry-collapsed')).toBe('false');
 } finally {vi.useRealTimers();sessionStorage.clear();}
});

const animationProps={open:true,email:"fixture@example.test",title:"Confirm email",body:"Enter six digits",realBody:"Check mailbox",codeLabel:"Code",codeHint:"Keep it private",codeFormat:"6 digits",verifyLabel:"Verify",resendLabel:"Resend",resendInLabel:"Wait",resentNotice:"Requested",correctEmailLabel:"Correct email",correctEmailHint:"Signup",loginLabel:"Login",loginHref:"/login",closeLabel:"Close",verifyingLabel:"Verifying…",verifiedLabel:"Verified & Secured",onClose:vi.fn(),onSubmitCode:vi.fn(),onResend:vi.fn(),onCorrectEmail:vi.fn()};
async function enterAnimationCode(){
 const paste=new Event("paste",{bubbles:true,cancelable:true});Object.defineProperty(paste,"clipboardData",{value:{getData:()=>"012345"}});
 await act(async()=>{container.querySelector('form')!.dispatchEvent(paste);});
}
async function advanceAnimation(ms:number){await act(async()=>{vi.advanceTimersByTime(ms);});}
it("animates all six entered digits during a slow real verification without inventing success",async()=>{
 vi.useFakeTimers();vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));const done=vi.fn();
 try {
  await act(async()=>root.render(createElement(AuthOtpModal,{...animationProps,onSuccessAnimDone:done})));
  await enterAnimationCode();
  await act(async()=>root.render(createElement(AuthOtpModal,{...animationProps,verifying:true,busy:true,onSuccessAnimDone:done})));
  await advanceAnimation(280);expect(container.querySelector('[data-auth-otp-modal]')?.getAttribute('data-auth-otp-phase')).toBe('diamond');
  await advanceAnimation(770);expect(container.querySelector('[data-auth-otp-modal]')?.getAttribute('data-auth-otp-phase')).toBe('orbit');
  await advanceAnimation(60000);expect(container.querySelector('[data-auth-otp-modal]')?.getAttribute('data-auth-otp-phase')).toBe('orbit');
  expect(container.querySelector('[data-auth-otp-pending]')?.textContent).toBe('Verifying…');
  expect([...container.querySelectorAll<HTMLInputElement>('[data-auth-otp-cell]')].map(e=>e.value).join('')).toBe('012345');
  expect(container.querySelector('[data-auth-otp-success]')).toBeNull();expect(container.querySelector('[data-auth-otp-confirmed]')).toBeNull();expect(done).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it("returns from the pending orbit to the same entered code with the real error",async()=>{
 vi.useFakeTimers();vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));const done=vi.fn();
 try{
  await act(async()=>root.render(createElement(AuthOtpModal,{...animationProps,onSuccessAnimDone:done})));await enterAnimationCode();
  await act(async()=>root.render(createElement(AuthOtpModal,{...animationProps,verifying:true,busy:true,onSuccessAnimDone:done})));await advanceAnimation(1050);
  expect(container.querySelector('[data-auth-otp-modal]')?.getAttribute('data-auth-otp-phase')).toBe('orbit');
  await act(async()=>root.render(createElement(AuthOtpModal,{...animationProps,error:"The code has expired",onSuccessAnimDone:done})));await advanceAnimation(1);
  expect(container.querySelector('[data-auth-otp-modal]')?.getAttribute('data-auth-otp-phase')).toBe('input');expect(container.querySelector('[role="alert"]')?.textContent).toBe('The code has expired');
  expect([...container.querySelectorAll<HTMLInputElement>('[data-auth-otp-cell]')].map(e=>e.value).join('')).toBe('012345');expect(done).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it("never completes hidden pending verification and cleans up on unmount",async()=>{
 vi.useFakeTimers();vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));const done=vi.fn();
 try{
  await act(async()=>root.render(createElement(AuthOtpModal,{...animationProps,verifying:true,busy:true,onSuccessAnimDone:done})));await advanceAnimation(1050);
  await act(async()=>root.render(createElement(AuthOtpModal,{...animationProps,open:false,verified:true,onSuccessAnimDone:done})));await advanceAnimation(10000);expect(done).not.toHaveBeenCalled();
  await act(async()=>root.render(null));await advanceAnimation(10000);expect(done).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it("keeps reduced-motion verification static until a real confirmed result",async()=>{
 vi.useFakeTimers();const done=vi.fn();
 try{
  await act(async()=>root.render(createElement(StrictMode,null,createElement(AuthOtpModal,{...animationProps,verifying:true,busy:true,onSuccessAnimDone:done}))));await advanceAnimation(60000);
  expect(container.querySelector('[data-auth-otp-modal]')?.getAttribute('data-auth-otp-phase')).toBe('input');expect(container.querySelector('[data-auth-otp-pending]')).not.toBeNull();expect(done).not.toHaveBeenCalled();
  await act(async()=>root.render(createElement(StrictMode,null,createElement(AuthOtpModal,{...animationProps,verified:true,onSuccessAnimDone:done}))));await advanceAnimation(120);expect(done).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});


it("automatically sends a complete normalized six-digit code exactly once while its request is pending",async()=>{
 let finish!:()=>void;const send=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 await act(async()=>root.render(createElement(AuthOtpModal,{...animationProps,onSubmitCode:send,onSuccessAnimDone:vi.fn()})));
 const paste=async(value:string)=>{const e=new Event("paste",{bubbles:true,cancelable:true});Object.defineProperty(e,"clipboardData",{value:{getData:()=>value}});await act(async()=>{container.querySelector('form')!.dispatchEvent(e);});};
 await paste('01234');expect(send).not.toHaveBeenCalled();
 await paste('٠١٢٣٤٥');expect(send).toHaveBeenCalledExactlyOnceWith('012345');
 await act(async()=>{const f=container.querySelector('form')!;f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 expect(send).toHaveBeenCalledTimes(1);await act(async()=>finish());
});
it("does not auto-loop after a rejected code, but permits explicit retry or deliberate corrected input",async()=>{
 const send=vi.fn().mockResolvedValue(undefined),done=vi.fn();
 const render=async(error?:string)=>{await act(async()=>root.render(createElement(AuthOtpModal,{...animationProps,error,onSubmitCode:send,onSuccessAnimDone:done})));};
 const paste=async(value:string)=>{const e=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(e,'clipboardData',{value:{getData:()=>value}});await act(async()=>{container.querySelector('form')!.dispatchEvent(e);});};
 await render();await paste('012345');expect(send).toHaveBeenCalledTimes(1);
 await render('This code expired');expect(send).toHaveBeenCalledTimes(1);expect(done).not.toHaveBeenCalled();
 await paste('012345');expect(send).toHaveBeenCalledTimes(1);
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});expect(send).toHaveBeenCalledTimes(2);
 await paste('01234');await paste('012345');expect(send).toHaveBeenCalledTimes(3);
});


it("rejects an overlength provider code instead of truncating and auto-sending its first six digits",async()=>{
 const send=vi.fn().mockResolvedValue(undefined);await act(async()=>root.render(createElement(AuthOtpModal,{...animationProps,onSubmitCode:send,onSuccessAnimDone:vi.fn()})));
 const paste=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{getData:()=> '01234567'}});await act(async()=>{container.querySelector('form')!.dispatchEvent(paste);});
 expect(send).not.toHaveBeenCalled();expect([...container.querySelectorAll<HTMLInputElement>('[data-auth-otp-cell]')].map(e=>e.value).join('')).toBe('');expect(container.querySelector<HTMLInputElement>('[data-auth-otp-cell]')!.maxLength).toBeGreaterThanOrEqual(8);
});

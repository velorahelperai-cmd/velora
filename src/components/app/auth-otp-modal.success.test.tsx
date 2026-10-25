// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthOtpModal } from "./auth-otp-modal";
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en",state:{}})}));

const props = {
 open:true,email:"fixture@example.test",title:"Confirm email",body:"Enter code",realBody:"Check mailbox",
 codeLabel:"Code",codeHint:"Six digits",codeFormat:"Invalid",verifyLabel:"Verify",resendLabel:"Resend",resendInLabel:"Wait",
 resentNotice:"Requested",correctEmailLabel:"Correct email",correctEmailHint:"Email",loginLabel:"Login",loginHref:"/login",
 closeLabel:"Close",onClose:vi.fn(),onSubmitCode:vi.fn(),onResend:vi.fn(),onCorrectEmail:vi.fn(),
};
let root:Root, container:HTMLDivElement, reduced=false;
beforeEach(()=>{
 vi.useFakeTimers();reduced=false;vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 vi.stubGlobal("matchMedia",()=>({matches:reduced,addEventListener(){},removeEventListener(){}}));
 container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
async function render(done:()=>void,cooldown=0){
 await act(async()=>root.render(createElement(StrictMode,null,createElement(AuthOtpModal,{...props,verified:true,cooldown,onSuccessAnimDone:done}))));
}
async function advance(ms:number){await act(async()=>{vi.advanceTimersByTime(ms);});}
describe("real OTP success lifecycle",()=>{
 it("keeps the same six cells and scene through server success",async()=>{
  const done=vi.fn();
  await act(async()=>root.render(createElement(AuthOtpModal,{...props,onSuccessAnimDone:done})));
  const cells=Array.from(container.querySelectorAll('[data-auth-otp-cell]'));
  const scene=container.querySelector('[data-auth-otp-cells]');
  await act(async()=>root.render(createElement(AuthOtpModal,{...props,verifying:true,onSuccessAnimDone:done})));
  await advance(1100);
  expect(Array.from(container.querySelectorAll('[data-auth-otp-cell]'))).toEqual(cells);
  expect(container.querySelector('[data-auth-otp-success]')).toBeNull();
  await act(async()=>root.render(createElement(AuthOtpModal,{...props,verified:true,onSuccessAnimDone:done})));
  await advance(901);
  expect(container.querySelector('[data-auth-otp-cells]')).toBe(scene);
  expect(Array.from(container.querySelectorAll('[data-auth-otp-cell]'))).toEqual(cells);
  expect(cells.every(cell=>(cell as HTMLInputElement).disabled)).toBe(true);
 });
 it("restores the same editable cells after failure and cancels old phases on close",async()=>{
  const done=vi.fn();
  const show=async(extra:Partial<React.ComponentProps<typeof AuthOtpModal>>)=>act(async()=>root.render(createElement(AuthOtpModal,{...props,onSuccessAnimDone:done,...extra})));
  await show({});const cells=Array.from(container.querySelectorAll('[data-auth-otp-cell]'));
  await show({verifying:true});await advance(1100);
  await show({verifying:false,error:'Incorrect code'});await advance(1);
  expect(container.querySelector('[role=alert]')?.textContent).toBe('Incorrect code');
  expect(Array.from(container.querySelectorAll('[data-auth-otp-cell]'))).toEqual(cells);
  expect(cells.every(cell=>!(cell as HTMLInputElement).disabled)).toBe(true);
  await show({verified:true});await advance(200);await show({open:false});await advance(5000);
  expect(done).not.toHaveBeenCalled();expect(container.querySelector('[role=dialog]')).toBeNull();
 });
 it("survives StrictMode effect replay and completes once",async()=>{
  const done=vi.fn();await render(done);await advance(2400);expect(done).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-auth-otp-success="true"]')).not.toBeNull();
  await advance(10000);expect(done).toHaveBeenCalledTimes(1);
 });
 it("keeps the deadline through cooldown renders and calls the latest callback",async()=>{
  const initial=vi.fn(),latest=vi.fn();await render(initial,60);await advance(1000);await render(latest,59);
  await advance(1000);await render(latest,58);await advance(400);
  expect(initial).not.toHaveBeenCalled();expect(latest).toHaveBeenCalledTimes(1);
 });
 it("completes reduced motion under StrictMode",async()=>{
  reduced=true;const done=vi.fn();await render(done);await advance(120);expect(done).toHaveBeenCalledTimes(1);
 });
 it("cancels navigation on unmount",async()=>{
  const done=vi.fn();await render(done);await act(async()=>root.unmount());root=createRoot(container);
  await advance(10000);expect(done).not.toHaveBeenCalled();
 });
});

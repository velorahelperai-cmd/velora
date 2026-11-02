// @vitest-environment jsdom
import {act,createElement,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ApprovedAccountLoader,useApprovedLoaderGate} from './approved-account-loader';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
it.each(['جارٍ تأكيد الحساب…','Confirming your account…'])('keeps only an accessible pending status: %s',async label=>{
 const frame=vi.spyOn(window,'requestAnimationFrame');const complete=vi.fn();
 await act(async()=>root.render(createElement(StrictMode,null,createElement(ApprovedAccountLoader,{label,ready:true,onComplete:complete}))));
 const status=host.querySelector('[role="status"]');
 expect(status?.className).toBe('sr-only');expect(status?.getAttribute('aria-busy')).toBe('true');expect(status?.getAttribute('aria-label')).toBe(label);
 expect(host.querySelector('canvas,main,[data-approved-loader],[data-account-loading]')).toBeNull();
 expect(frame).not.toHaveBeenCalled();expect(complete).not.toHaveBeenCalled();
});
function Fixture({status,scope='/setup'}:{status:'loading'|'ready'|'error'|'locked';scope?:string}){
 const gate=useApprovedLoaderGate(status==='loading');
 return gate.holding?createElement(ApprovedAccountLoader,{key:scope,label:'Checking account',onComplete:gate.finish}):createElement('section',{'data-result':status},status==='ready'?'Protected destination':'Recovery');
}
const renderStatus=async(status:'loading'|'ready'|'error'|'locked',scope='/setup')=>act(async()=>root.render(createElement(Fixture,{status,scope})));
it('reveals verified content immediately without a visual completion callback',async()=>{
 await renderStatus('loading');expect(host.textContent).not.toContain('Protected destination');
 await renderStatus('ready');expect(host.querySelector('[data-result="ready"]')).not.toBeNull();
});
it('keeps pending authority fenced without any animation or timer',async()=>{
 const timer=vi.spyOn(window,'setTimeout');await renderStatus('loading');
 expect(host.querySelector('[data-result]')).toBeNull();expect(host.textContent).not.toContain('Protected destination');expect(timer).not.toHaveBeenCalled();
});
it.each(['error','locked'] as const)('exposes recovery instead of content after %s',async status=>{
 await renderStatus('loading');await renderStatus(status);expect(host.textContent).toBe('Recovery');expect(host.querySelector('[role="status"]')).toBeNull();
});
it('hides previously ready content when a new account check is pending',async()=>{
 await renderStatus('ready');await renderStatus('loading','/account');expect(host.textContent).not.toContain('Protected destination');
 await renderStatus('ready','/account');expect(host.textContent).toBe('Protected destination');
});

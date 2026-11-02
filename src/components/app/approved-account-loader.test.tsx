// @vitest-environment jsdom
import {act,createElement,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({usePathname:()=>'/app/conversations'}));
const links=vi.hoisted(()=>({prefetch:[] as unknown[]}));
vi.mock('next/link',()=>({default:({prefetch,...props}:{prefetch?:boolean;href:string;children?:React.ReactNode})=>{links.prefetch.push(prefetch);return createElement('a',props);}}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en',setLocale:vi.fn()})}));
import {ApprovedAccountLoader,useApprovedLoaderGate} from './approved-account-loader';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 links.prefetch=[];
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
it.each(['جارٍ تأكيد الحساب…','Confirming your account…'])('shows the page UI with no loading announcement: %s',async label=>{
 const frame=vi.spyOn(window,'requestAnimationFrame');const complete=vi.fn();
 await act(async()=>root.render(createElement(StrictMode,null,createElement(ApprovedAccountLoader,{label,ready:true,onComplete:complete}))));
 expect(host.querySelector('[role="status"],[aria-busy],canvas,[data-approved-loader],[data-account-loading]')).toBeNull();
 expect(host.textContent).not.toContain(label);
 expect(host.querySelector('h1')?.textContent).toBe('Conversations');
 expect(host.querySelector('a[href="/app/settings"]')).not.toBeNull();
 expect(host.querySelector('input,select')).toBeNull();
 expect(links.prefetch.length).toBeGreaterThan(0);expect(links.prefetch.every(value=>value===false)).toBe(true);
 expect(frame).not.toHaveBeenCalled();expect(complete).not.toHaveBeenCalled();
});
it('lets the initial page menu open before account data arrives',async()=>{
 await act(async()=>root.render(createElement(ApprovedAccountLoader,{label:'Checking account'})));
 const button=host.querySelector('[aria-controls="workspace-navigation"]') as HTMLButtonElement;
 expect(button.getAttribute('aria-expanded')).toBe('false');
 await act(async()=>button.click());expect(button.getAttribute('aria-expanded')).toBe('true');
 expect(host.textContent).not.toContain('Checking account');
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

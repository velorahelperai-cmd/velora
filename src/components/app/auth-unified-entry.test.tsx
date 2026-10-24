// @vitest-environment jsdom
import {act,createElement,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({locale:'en',google:vi.fn(),path:'/login',query:'next=%2Fsetup',listeners:new Set<()=>void>(),push:vi.fn(),replace:vi.fn(),signup:vi.fn(),signIn:vi.fn(),clear:vi.fn(),continuity:vi.fn()}));
vi.mock('next/navigation',async()=>{const react=await vi.importActual<typeof import('react')>('react');return{usePathname:()=>react.useSyncExternalStore(fn=>{state.listeners.add(fn);return()=>state.listeners.delete(fn);},()=>state.path,()=>state.path),useSearchParams:()=>new URLSearchParams(state.query),useRouter:()=>({push:state.push,replace:state.replace,refresh:vi.fn()})};});
vi.mock('next/link',()=>({default:({children,href,onClick}:{children:ReactNode;href:string;onClick?:()=>void})=>createElement('a',{href,onClick},children)}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:state.locale,state:{},update:vi.fn()})}));
vi.mock('./auth-motion-canvas',()=>({AuthMotionCanvas:()=>createElement('canvas',{'data-test-background':'true'})}));
vi.mock('./account-chrome',()=>({AccountMenu:()=>null,useOptionalAccountSession:()=>({status:'guest',identity:null})}));
vi.mock('@/lib/tenancy/actions',()=>({signInWithEmail:state.signIn,signUpWithEmail:state.signup,resolvePostAuthPath:vi.fn(),completeProfileName:vi.fn(),requestPasswordReset:vi.fn(),resendVerificationEmail:vi.fn(),updatePassword:vi.fn(),verifyEmailCode:vi.fn()}));
vi.mock('@/lib/auth/browser-continuity',()=>({ensureBrowserContinuity:state.continuity,clearAuthGestureNonce:vi.fn()}));
vi.mock('@/lib/auth/auth-journey',async()=>({...await vi.importActual<typeof import('@/lib/auth/auth-journey')>('@/lib/auth/auth-journey'),clearPendingSignup:state.clear}));
vi.mock('@/lib/auth/browser',()=>({startOAuth:state.google}));
import {AuthEntryExperience} from './auth-pages';
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.resetAllMocks();state.locale='en';state.path='/login';state.query='next=%2Fsetup';state.listeners.clear();window.history.replaceState(null,'','/login?next=%2Fsetup');const push=window.history.pushState.bind(window.history);vi.spyOn(window.history,'pushState').mockImplementation((a,b,c)=>{push(a,b,c);const url=new URL(String(c),window.location.href);state.path=url.pathname;state.query=url.searchParams.toString();for(const fn of state.listeners)fn();});vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));state.continuity.mockResolvedValue({ok:true,requestNonce:'synthetic-nonce'});container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function render(){await act(async()=>root.render(createElement(AuthEntryExperience)));}
async function route(path:string,query=state.query){await act(async()=>{window.history.pushState(null,'',path+(query?'?'+query:''));});}
async function fill(selector:string,value:string){await act(async()=>{const el=container.querySelector<HTMLInputElement>(selector)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
it('keeps one card and background while swapping modes and clearing password history',async()=>{
 await render();const card=container.querySelector('[data-auth-entry-card]'),canvas=container.querySelector('canvas');
 await fill('input[type="password"]','synthetic-fixture-only');
 await route('/signup');expect(container.querySelector('[data-auth-entry-form="signup"]')).not.toBeNull();expect(container.querySelector('[data-auth-entry-card]')).toBe(card);expect(container.querySelector('canvas')).toBe(canvas);
 await route('/login');expect(container.querySelector('[data-auth-entry-card]')).toBe(card);expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('');
});
it('switches immediately through URL history with next intact and no route-flip request',async()=>{
 await render();const card=container.querySelector('[data-auth-entry-card]');await act(async()=>{container.querySelector<HTMLAnchorElement>('a[href^="/signup"]')!.click();});
 expect(window.location.pathname).toBe('/signup');expect(new URLSearchParams(window.location.search).get('next')).toBe('/setup');expect(container.querySelector('[data-auth-entry-card]')).toBe(card);expect(state.push).not.toHaveBeenCalled();expect(container.querySelector('[data-auth-entry-form="signup"]')).not.toBeNull();
});
it('holds one pending submission across a mode change and discards its late navigation side effects',async()=>{
 let finish!:(result:unknown)=>void;state.signIn.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await render();
 await fill('input[type="email"]','fixture@example.test');await fill('input[type="password"]','synthetic-fixture-only');await act(async()=>{container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});expect(state.signIn).toHaveBeenCalledTimes(1);
 await route('/signup');await act(async()=>{container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});expect(state.signup).not.toHaveBeenCalled();
 await act(async()=>{finish({ok:true,data:{next:'/setup'}});});expect(state.clear).not.toHaveBeenCalled();expect(state.replace).not.toHaveBeenCalled();
});


it.each(['en','ar'])('keeps %s login service errors friendly and technical references internal',async(locale)=>{
 state.locale=locale;state.signIn.mockResolvedValue({ok:false,code:'UNAVAILABLE',diagnostic:{reference:'VEL-0000000000000000',operation:'auth_login',stage:'provider',code:'UNAVAILABLE'}});await render();
 await fill('input[type="email"]','fixture@example.test');await fill('input[type="password"]','synthetic-fixture-only');await act(async()=>{container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 expect(container.textContent).toContain(locale==='en'?'temporarily unavailable':'غير متاحة مؤقتًا');expect(container.textContent).not.toContain('VEL-0000000000000000');expect(container.textContent).not.toContain('Support reference:');expect(container.textContent).not.toContain('Step:');expect(container.textContent).not.toContain('مرجع الدعم');
});
it('does not render raw Google provider errors',async()=>{
 state.google.mockRejectedValue(new Error('SYNTHETIC_RAW_PROVIDER_MESSAGE'));await render();await act(async()=>{[...container.querySelectorAll('button')].find(b=>b.textContent?.includes('Google'))!.click();});
 expect(container.textContent).not.toContain('SYNTHETIC_RAW_PROVIDER_MESSAGE');expect(container.textContent).toContain('could not start');
});

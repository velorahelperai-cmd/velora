// @vitest-environment jsdom
import {act,createElement,StrictMode,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({locale:'en',google:vi.fn(),path:'/login',query:'next=%2Fsetup',listeners:new Set<()=>void>(),push:vi.fn(),replace:vi.fn(),signup:vi.fn(),signIn:vi.fn(),clear:vi.fn(),clearNonce:vi.fn(),remember:vi.fn(),continuity:vi.fn()}));
vi.mock('next/navigation',async()=>{const react=await vi.importActual<typeof import('react')>('react');const router={push:state.push,replace:state.replace,refresh:vi.fn()};return{usePathname:()=>react.useSyncExternalStore(fn=>{state.listeners.add(fn);return()=>state.listeners.delete(fn);},()=>state.path,()=>state.path),useSearchParams:()=>new URLSearchParams(react.useSyncExternalStore(fn=>{state.listeners.add(fn);return()=>state.listeners.delete(fn);},()=>state.query,()=>state.query)),useRouter:()=>router};});
vi.mock('next/link',()=>({default:({children,href,onClick}:{children:ReactNode;href:string;onClick?:()=>void})=>createElement('a',{href,onClick},children)}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:state.locale,state:{},update:vi.fn()})}));
vi.mock('./auth-motion-canvas',()=>({AuthMotionCanvas:()=>createElement('canvas',{'data-test-background':'true'})}));
vi.mock('./account-chrome',()=>({AccountMenu:()=>null,useOptionalAccountSession:()=>({status:'guest',identity:null})}));
vi.mock('@/lib/tenancy/actions',()=>({signInWithEmail:state.signIn,signUpWithEmail:state.signup,resolvePostAuthPath:vi.fn(),completeProfileName:vi.fn(),requestPasswordReset:vi.fn(),resendVerificationEmail:vi.fn(),updatePassword:vi.fn(),verifyEmailCode:vi.fn()}));
vi.mock('@/lib/auth/browser-continuity',()=>({ensureBrowserContinuity:state.continuity,clearAuthGestureNonce:state.clearNonce}));
vi.mock('@/lib/auth/auth-journey',async()=>({...await vi.importActual<typeof import('@/lib/auth/auth-journey')>('@/lib/auth/auth-journey'),clearPendingSignup:state.clear}));
vi.mock('@/lib/auth/browser',()=>({startOAuth:state.google}));
vi.mock('./use-verification-cooldown',async()=>({...await vi.importActual<typeof import('./use-verification-cooldown')>('./use-verification-cooldown'),rememberVerificationResend:state.remember}));
import {AuthEntryExperience} from './auth-pages';
let root:Root,container:HTMLDivElement;
beforeEach(()=>{sessionStorage.clear();vi.resetAllMocks();state.locale='en';state.path='/login';state.query='next=%2Fsetup';state.listeners.clear();window.history.replaceState(null,'','/login?next=%2Fsetup');const push=window.history.pushState.bind(window.history);vi.spyOn(window.history,'pushState').mockImplementation((a,b,c)=>{push(a,b,c);const url=new URL(String(c),window.location.href);state.path=url.pathname;state.query=url.searchParams.toString();for(const fn of state.listeners)fn();});vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));state.continuity.mockResolvedValue({ok:true,requestNonce:'synthetic-nonce'});container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function render(){await act(async()=>root.render(createElement(AuthEntryExperience)));}
async function route(path:string,query=state.query){await act(async()=>{window.history.pushState(null,'',path+(query?'?'+query:''));});}
async function fill(selector:string,value:string,index=0){await act(async()=>{const el=container.querySelectorAll<HTMLInputElement>(selector)[index]!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
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

async function advanceMorph(ms:number){await act(async()=>{vi.advanceTimersByTime(ms);});}
function fullMotion(){vi.useFakeTimers();vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));}
it('runs the complete reference morph in one mounted shell in both directions',async()=>{
 fullMotion();await act(async()=>root.render(createElement(StrictMode,null,createElement(AuthEntryExperience))));
 const card=container.querySelector<HTMLElement>('[data-auth-entry-card]')!,canvas=container.querySelector('canvas');
 await fill('input[type="password"]','synthetic-fixture-only');
 for(const target of ['signup','login']){
  const before=window.location.pathname;await act(async()=>{container.querySelector<HTMLAnchorElement>('a[href^="/'+target+'"]')!.click();});
  expect(window.location.pathname).toBe(before);expect(card.dataset.authEntryCollapsed).toBe('true');expect(card.style.width).toBe('170px');expect(card.style.transform).toBe('rotate(-45deg)');expect(container.querySelector('.auth-entry-card-body')?.hasAttribute('inert')).toBe(true);
  await advanceMorph(599);expect(window.location.pathname).toBe(before);await advanceMorph(1);expect(window.location.pathname).toBe('/'+target);expect(card.dataset.authEntryCollapsed).toBe('true');await advanceMorph(79);expect(card.dataset.authEntryCollapsed).toBe('true');await advanceMorph(1);expect(card.dataset.authEntryCollapsed).toBe('false');await advanceMorph(600);
  expect(container.querySelector('[data-auth-entry-card]')).toBe(card);expect(container.querySelector('canvas')).toBe(canvas);expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('');expect(document.activeElement?.hasAttribute('data-auth-entry-heading')).toBe(true);
 }
 expect(new URLSearchParams(window.location.search).get('next')).toBe('/setup');expect(state.push).not.toHaveBeenCalled();
});
it('ignores repeated switch gestures and cancels a pending mode commit on browser history interruption',async()=>{
 fullMotion();await render();const card=container.querySelector<HTMLElement>('[data-auth-entry-card]')!;const link=container.querySelector<HTMLAnchorElement>('a[href^="/signup"]')!;
 await act(async()=>{link.click();link.click();});expect(card.dataset.authEntryCollapsed).toBe('true');await advanceMorph(300);
 await act(async()=>{window.history.replaceState(null,'','/login?next=%2Faccount');state.path='/login';state.query='next=%2Faccount';window.dispatchEvent(new PopStateEvent('popstate'));for(const fn of state.listeners)fn();});await advanceMorph(2000);
 expect(window.location.pathname).toBe('/login');expect(new URLSearchParams(window.location.search).get('next')).toBe('/account');expect(card.dataset.authEntryCollapsed).toBe('false');expect(container.querySelector('[data-auth-entry-form="login"]')).not.toBeNull();
});
it('rejects the old login result from the moment a mode-change gesture starts, before URL commit',async()=>{
 fullMotion();let finish!:(value:unknown)=>void;state.signIn.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await render();await fill('input[type="email"]','fixture@example.test');await fill('input[type="password"]','synthetic-fixture-only');await act(async()=>{container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});expect(state.signIn).toHaveBeenCalledTimes(1);
 await act(async()=>{container.querySelector<HTMLAnchorElement>('a[href^="/signup"]')!.click();});expect(window.location.pathname).toBe('/login');await act(async()=>finish({ok:true,data:{next:'/setup'}}));expect(state.clear).not.toHaveBeenCalled();expect(state.replace).not.toHaveBeenCalled();await advanceMorph(680);expect(window.location.pathname).toBe('/signup');
});


async function submitSignup(){
 await fill('input[autocomplete="name"]','Synthetic owner');await fill('input[type="email"]','fixture@example.test');await fill('input[type="password"]','synthetic-fixture-only');await fill('input[type="password"]','synthetic-fixture-only',1);
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
}
it('shows neutral next steps without promising account creation or code delivery for the normalized signup response',async()=>{
 state.signup.mockResolvedValue({ok:true,data:{needsVerification:true,email:'fixture@example.test'}});await route('/signup');await render();await submitSignup();
 expect(state.signup).toHaveBeenCalledTimes(1);expect(state.replace).not.toHaveBeenCalled();expect(container.querySelector('[data-auth-signup-continuation]')).not.toBeNull();expect(container.textContent).toContain('if one arrives');expect(container.textContent).not.toMatch(/code (?:was |has been )?sent|account (?:was )?created/i);expect(container.querySelector('form')).toBeNull();expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
 expect(container.querySelector('a[href^="/login"]')).not.toBeNull();expect(container.querySelector('a[href="/forgot-password"]')).not.toBeNull();expect(state.remember).toHaveBeenCalledTimes(1);
 await act(async()=>{container.querySelector<HTMLButtonElement>('[data-auth-continue-verification]')!.click();});expect(state.replace).toHaveBeenCalledWith('/verify-email?next=%2Fsetup&email=fixture%40example.test');
});
it('resumes the same local pending journey without another signup or email request',async()=>{
 const {savePendingSignup}=await import('@/lib/auth/auth-journey');savePendingSignup('fixture@example.test','/setup');await route('/signup');await render();await submitSignup();
 expect(state.signup).not.toHaveBeenCalled();expect(state.continuity).not.toHaveBeenCalled();expect(state.remember).not.toHaveBeenCalled();expect(container.querySelector('[data-auth-signup-continuation]')).not.toBeNull();expect(state.replace).not.toHaveBeenCalled();
});
it('offers recovery for an uncertain signup result without claiming delivery or clearing its nonce',async()=>{
 state.signup.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await route('/signup');await render();await submitSignup();
 expect(container.querySelector('[data-auth-signup-continuation="uncertain"]')).not.toBeNull();expect(container.textContent).toContain('could not confirm the signup result');expect(container.textContent).not.toMatch(/code (?:was |has been )?sent|account (?:was )?created/i);expect(container.querySelector('[data-auth-use-another-email]')).toBeNull();expect(state.clearNonce).not.toHaveBeenCalled();expect(state.remember).not.toHaveBeenCalled();expect((await import('@/lib/auth/auth-journey')).readPendingSignup()).toBeNull();expect(state.replace).not.toHaveBeenCalled();
});
it('lets the owner choose another email after continuation with passwords cleared',async()=>{
 state.signup.mockResolvedValue({ok:true,data:{needsVerification:true,email:'fixture@example.test'}});await route('/signup');await render();await submitSignup();await act(async()=>{container.querySelector<HTMLButtonElement>('[data-auth-use-another-email]')!.click();});
 expect(container.querySelector('form')).not.toBeNull();expect([...container.querySelectorAll<HTMLInputElement>('input[type="password"]')].every(input=>input.value==='')).toBe(true);expect(state.signup).toHaveBeenCalledTimes(1);
});

it('sends bounded correlation with signup and logs its neutral terminal outcome without entered credentials',async()=>{
 state.signup.mockResolvedValue({ok:true,data:{needsVerification:true,email:'fixture@example.test'}});await route('/signup');await render();const info=vi.spyOn(console,'info').mockImplementation(()=>{});await submitSignup();
 const packet=state.signup.mock.calls[0][0].correlation;expect(packet).toEqual({request_id:expect.stringMatching(/^VEL-[A-F0-9]{16}$/),trace_id:expect.stringMatching(/^[a-f0-9]{32}$/),parent_span_id:expect.stringMatching(/^[a-f0-9]{16}$/)});
 const rows=info.mock.calls.map(([row])=>JSON.parse(String(row)));expect(rows.some(row=>row.request_id===packet.request_id&&row.code==='OK')).toBe(true);expect(JSON.stringify(rows)).not.toContain('fixture@example.test');
});

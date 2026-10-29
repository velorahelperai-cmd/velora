// @vitest-environment jsdom
import {act,createElement,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {SetupOrderReviewProps} from './setup-order-review';
const mocks=vi.hoisted(()=>({verify:vi.fn(),finish:vi.fn(),confirm:vi.fn(),navigate:vi.fn(),review:null as SetupOrderReviewProps|null}));
const qa=vi.hoisted(()=>({access:vi.fn(async()=>false),grant:vi.fn()}));
vi.mock('@/lib/tenancy/qa-business-grant-actions',()=>({grantQaBusiness:qa.grant}));
vi.mock('@/lib/tenancy/qa-setup-simulation-actions',()=>({readQaSetupSimulationAccess:qa.access}));
vi.mock('@/app/account/payment/[orderId]/actions',()=>({verifyThawaniPayment:mocks.verify,finishTestCheckout:mocks.finish}));
vi.mock('./setup-order-review',async original=>({...await original<typeof import('./setup-order-review')>(),SetupOrderReview:(p:SetupOrderReviewProps)=>{mocks.review=p;return createElement('div',{'data-review':true},createElement('button',{onClick:()=>{if(p.beforeConfirm?.()===false)return;void p.confirmReview(true).then(r=>{if(r.ok)p.onConfirmed?.(r);});}},'Pay'),p.paymentStatus,p.qaSimulationAction);}}));
import {SetupPaymentDialog} from './setup-payment-dialog';
import {resolveEs02Offer} from '@/lib/billing/es02/commercial-offer';
const orderId='11111111-2222-4333-8444-555555555555',accountId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const selection={term:'monthly' as const,slots:[{persona:'level_1' as const,package:'basic' as const}]};
const resolved=resolveEs02Offer(selection);if(!resolved.ok)throw Error('fixture');
const order={orderId,accountId,status:'open' as const,offer:resolved.offer,specialReference:'REF-ONE',paymentAttemptId:orderId,environment:'test' as const,settledAt:null,provisionedCompanyId:null,originalOrderGroupId:orderId};
const url='https://uatcheckout.thawani.om/pay/checkout_abcdefgh12345678?key=publicfixture123';
const success={ok:true as const,order,checkoutUrl:url,settlement:'UNPAID' as const,serviceReady:false as const,clientOpId:orderId,action:'insert' as const};
const props={qaPreparation:{name:'VELORA QA',type:'technology',country:'OM',city:'Nizwa',phone:'+96890000000',branches:[{name:'QA Main',city:'Nizwa'}]},ar:false,slots:[{label:{name:'TAG CITY',city:'Nizwa'},persona:'level_1' as const,package:'basic' as const}],term:'monthly' as const,write:{kind:'idle' as const},actor:{accountId,captureToken:'capture'},consentAccepted:true,confirmReview:mocks.confirm,onEditBranch:vi.fn(),onBackToPlans:vi.fn(),isCurrent:()=>true,navigate:mocks.navigate};
let root:Root,host:HTMLDivElement,popup:{closed:boolean;opener:unknown;document:{title:string;body:{textContent:string}};location:{replace:ReturnType<typeof vi.fn>};close:ReturnType<typeof vi.fn>;focus:ReturnType<typeof vi.fn>},open:ReturnType<typeof vi.fn>;
let channels:Array<{onmessage:((event:{data:unknown})=>void)|null;close:ReturnType<typeof vi.fn>}>;
beforeEach(()=>{
 qa.access.mockResolvedValue(false);
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});vi.clearAllMocks();channels=[];
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 popup={closed:false,opener:window,document:{title:'',body:{textContent:''}},location:{replace:vi.fn()},close:vi.fn(()=>{popup.closed=true;}),focus:vi.fn()};
 open=vi.fn(()=>popup);vi.stubGlobal('open',open);vi.stubGlobal('BroadcastChannel',class{onmessage:null=null;close=vi.fn();constructor(){channels.push(this);}});
 mocks.confirm.mockResolvedValue(success);mocks.verify.mockResolvedValue({ok:true,paid:false});mocks.finish.mockResolvedValue({ok:true,next:'/setup'});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
async function render(extra={}){await act(async()=>root.render(createElement(SetupPaymentDialog,{...props,...extra})));}
async function pay(){await act(async()=>host.querySelector<HTMLButtonElement>('[data-review] button')!.click());}
it('opens the popup synchronously and does not create an order if blocked',async()=>{open.mockReturnValue(null);await render();await pay();expect(open).toHaveBeenCalledOnce();expect(mocks.confirm).not.toHaveBeenCalled();expect(host.textContent).toContain('Allow popups');});
it('keeps the parent dialog and sends only the validated UAT checkout to a popup without opener',async()=>{await render();await pay();expect(open.mock.invocationCallOrder[0]).toBeLessThan(mocks.confirm.mock.invocationCallOrder[0]!);expect(popup.opener).toBeNull();expect(popup.location.replace).toHaveBeenCalledWith(url);expect(host.querySelector('dialog[open]')).not.toBeNull();expect(mocks.navigate).not.toHaveBeenCalled();expect(mocks.verify).toHaveBeenCalledWith(orderId);expect(mocks.finish).not.toHaveBeenCalled();});
it('does not treat closing the popup or a return hint as payment proof',async()=>{await render();await pay();popup.closed=true;await act(async()=>{channels[0]!.onmessage?.({data:{type:'velora-payment-return',orderId}});});expect(mocks.verify.mock.calls.length).toBeGreaterThanOrEqual(2);expect(mocks.finish).not.toHaveBeenCalled();expect(mocks.navigate).not.toHaveBeenCalled();});
it('offers a separate simulation action only after server authorization without creating checkout',async()=>{
 await render();expect(mocks.review?.qaSimulationAction).toBeUndefined();
 qa.access.mockResolvedValue(true);await act(async()=>root.render(null));await render();
 expect(mocks.review?.qaSimulationAction).toBeTruthy();expect(mocks.confirm).not.toHaveBeenCalled();expect(mocks.finish).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
});
it('provisions only after server payment proof, then navigates directly to setup',async()=>{mocks.verify.mockResolvedValue({ok:true,paid:true});await render();await pay();expect(mocks.finish).toHaveBeenCalledWith(orderId);expect(mocks.navigate).toHaveBeenCalledWith('/setup');expect(popup.close).toHaveBeenCalled();});
it('reopens the same unpaid checkout without creating another order',async()=>{await render();await pay();popup.closed=true;await act(async()=>host.querySelector<HTMLButtonElement>('[data-resume-payment]')!.click());expect(mocks.confirm).toHaveBeenCalledOnce();expect(popup.location.replace).toHaveBeenLastCalledWith(url);});
it('rejects unsafe provider and post-payment destinations',async()=>{mocks.confirm.mockResolvedValue({...success,checkoutUrl:'https://evil.example/pay'});await render();await pay();expect(popup.location.replace).not.toHaveBeenCalled();expect(mocks.navigate).not.toHaveBeenCalled();});
it('discards a paid response for a stale account and cleans up its popup',async()=>{let finish!:(value:unknown)=>void;let current=true;mocks.verify.mockReturnValue(new Promise(resolve=>{finish=resolve;}));await render({isCurrent:()=>current});await pay();current=false;await act(async()=>finish({ok:true,paid:true}));expect(mocks.finish).not.toHaveBeenCalled();expect(mocks.navigate).not.toHaveBeenCalled();await act(async()=>root.render(null));expect(popup.close).toHaveBeenCalled();expect(channels[0]!.close).toHaveBeenCalled();});
it('retains the paid order when provisioning is unavailable and retries it without a new payment',async()=>{mocks.verify.mockResolvedValue({ok:true,paid:true});mocks.finish.mockResolvedValueOnce({ok:false});await render();await pay();expect(host.textContent).toContain('Payment confirmed');expect(mocks.navigate).not.toHaveBeenCalled();await act(async()=>host.querySelector<HTMLButtonElement>('[data-check-payment]')!.click());expect(mocks.finish).toHaveBeenCalledTimes(2);expect(mocks.confirm).toHaveBeenCalledOnce();expect(mocks.navigate).toHaveBeenCalledWith('/setup');});
it('bounds automatic checking and lets the customer resume the same order explicitly',async()=>{await render();await pay();for(let i=0;i<32;i++)await act(async()=>vi.advanceTimersByTimeAsync(10000));const calls=mocks.verify.mock.calls.length;await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(mocks.verify.mock.calls.length).toBe(calls);expect(host.textContent).toContain('Automatic checking paused');expect(host.querySelector('[data-check-payment]')).not.toBeNull();expect(mocks.confirm).toHaveBeenCalledOnce();});
it('uses server polling if the browser blocks BroadcastChannel',async()=>{vi.stubGlobal('BroadcastChannel',class{constructor(){throw Error('Storage denied');}});mocks.verify.mockResolvedValue({ok:true,paid:true});await render();await pay();expect(mocks.finish).toHaveBeenCalledWith(orderId);expect(mocks.navigate).toHaveBeenCalledWith('/setup');});
it('recovers an existing order through StrictMode without finishing a stale effect',async()=>{const write={kind:'unpaid' as const,order,checkoutUrl:url,clientOpId:orderId,selection,settlement:'UNPAID' as const,serviceReady:false as const,action:'reuse' as const};mocks.verify.mockResolvedValue({ok:true,paid:true});await act(async()=>root.render(createElement(StrictMode,null,createElement(SetupPaymentDialog,{...props,write}))));await act(async()=>vi.advanceTimersByTimeAsync(300));expect(mocks.confirm).not.toHaveBeenCalled();expect(mocks.finish).toHaveBeenCalledOnce();expect(mocks.navigate).toHaveBeenCalledWith('/setup');});
it('never navigates to an unsafe finish result',async()=>{mocks.verify.mockResolvedValue({ok:true,paid:true});mocks.finish.mockResolvedValue({ok:true,next:'https://evil.example'});await render();await pay();expect(mocks.navigate).not.toHaveBeenCalled();expect(host.textContent).toContain('Payment confirmed');});
it('minimizes and restores the same dialog without losing the order',async()=>{await render();await pay();await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Hide payment dialog"]')!.click());expect(host.querySelector('dialog')).toBeNull();await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Continue order and payment')!.click());expect(host.querySelector('dialog[open]')).not.toBeNull();expect(mocks.confirm).toHaveBeenCalledOnce();expect(host.querySelector('[data-resume-payment]')).not.toBeNull();});
it('keeps one verification request and one polling timer after several return hints',async()=>{let resolve!:(value:unknown)=>void;mocks.verify.mockReturnValueOnce(new Promise(done=>{resolve=done;}));await render();await pay();await act(async()=>{for(let i=0;i<5;i++)channels[0]!.onmessage?.({data:{type:'velora-payment-return',orderId}});await vi.advanceTimersByTimeAsync(500);});expect(mocks.verify).toHaveBeenCalledOnce();await act(async()=>resolve({ok:true,paid:false}));await act(async()=>vi.advanceTimersByTimeAsync(10001));expect(mocks.verify).toHaveBeenCalledTimes(2);expect(mocks.finish).not.toHaveBeenCalled();});
it('recovers a saved order with an uncertain checkout URL only after an explicit user gesture',async()=>{
 const retry=vi.fn().mockResolvedValue({...success,action:'reuse'});
 const write={kind:'unpaid' as const,order,clientOpId:orderId,selection,settlement:'UNPAID' as const,serviceReady:false as const,action:'reuse' as const};
 await render({write,retrySameOperation:retry});expect(retry).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-resume-payment]')!.click());
 expect(retry).toHaveBeenCalledOnce();expect(open).toHaveBeenCalledOnce();expect(popup.location.replace).toHaveBeenCalledWith(url);expect(mocks.confirm).not.toHaveBeenCalled();
});

it('creates the selected QA grant only after explicit confirmation, with no gateway calls',async()=>{qa.access.mockResolvedValue(true);qa.grant.mockResolvedValue({ok:true,companyId:orderId});await render();await act(async()=>host.querySelector<HTMLButtonElement>('[data-qa-simulation]')!.click());expect(qa.grant).not.toHaveBeenCalled();await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Confirm QA business creation')!.click());expect(qa.grant).toHaveBeenCalledWith(expect.objectContaining({preparation:props.qaPreparation,selection}));expect(mocks.navigate).toHaveBeenCalledWith('/setup');expect(mocks.confirm).not.toHaveBeenCalled();expect(mocks.verify).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();});

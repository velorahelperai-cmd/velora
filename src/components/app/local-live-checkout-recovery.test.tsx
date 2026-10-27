import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
import type {SetupOrderReviewProps} from './setup-order-review';
const m=vi.hoisted(()=>({actor:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',current:true,begin:vi.fn(),props:null as SetupOrderReviewProps|null}));
vi.mock('./account-chrome',()=>({AccountMenu:()=>null,useOptionalAccountSession:()=>({status:'ready',identity:{userId:m.actor},boundaryFingerprint:'capture',isCurrentUser:()=>m.current})}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en'})}));
vi.mock('@/lib/billing/es02/account-order-actions',()=>({beginAccountPaymentAction:m.begin}));
vi.mock('./setup-payment-dialog',()=>({SetupPaymentDialog:(p:SetupOrderReviewProps)=>{m.props=p;return createElement('div',null,'Same order recovery');}}));
import {LocalLiveCheckoutRecovery} from './local-live-checkout-recovery';
import {resolveEs02Offer} from '@/lib/billing/es02/commercial-offer';
import type {LocalLiveOperation} from '@/lib/billing/es02/local-live-operation';
const operation:LocalLiveOperation={version:1,accountId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',grantId:'11111111-2222-4333-8444-555555555555',clientOpId:'11111111-2222-4333-8444-555555555555',selection:{term:'monthly',slots:[{persona:'level_1',package:'basic'}]},preparation:{name:'Fixture',type:'retail',country:'OM',city:'Muscat',phone:'+96890000000',branches:[{name:'Main',city:'Muscat'}]}};
const props={operation,order:null,checkoutNotice:{ar:'100بيسة',en:'OMR0.100'}};
beforeEach(()=>{m.actor=operation.accountId;m.current=true;m.props=null;m.begin.mockReset();});
it('never renders a previous account recovery record after an identity switch',()=>{m.actor='other';expect(renderToStaticMarkup(createElement(LocalLiveCheckoutRecovery,props))).toBe('');expect(m.props).toBeNull();expect(m.begin).not.toHaveBeenCalled();});
it('keeps a missing native acknowledgment UNKNOWN and retries only the original operation',async()=>{
 renderToStaticMarkup(createElement(LocalLiveCheckoutRecovery,props));expect(m.props?.write.kind).toBe('unknown');expect(m.begin).not.toHaveBeenCalled();m.begin.mockResolvedValue({ok:false,code:'UNKNOWN'});
 expect(await m.props!.retrySameOperation!()).toMatchObject({ok:false,code:'UNKNOWN'});expect(m.begin).toHaveBeenCalledWith(expect.objectContaining({clientOpId:operation.clientOpId,selection:operation.selection,preparation:operation.preparation,expectedAccountId:operation.accountId}));
});
it('does not derive paid status from a saved local record',()=>{
 const offer=resolveEs02Offer(operation.selection);if(!offer.ok)throw Error('fixture');
 const order={orderId:operation.clientOpId,accountId:operation.accountId,status:'provisioned' as const,offer:offer.offer,specialReference:'ES02-fixture',paymentAttemptId:operation.clientOpId,environment:'live' as const,settledAt:'2026-10-26T00:00:00Z',provisionedCompanyId:operation.clientOpId,originalOrderGroupId:operation.clientOpId};
 renderToStaticMarkup(createElement(LocalLiveCheckoutRecovery,{...props,order}));expect(m.props?.write).toMatchObject({kind:'unpaid',settlement:'UNPAID',serviceReady:false});expect(m.begin).not.toHaveBeenCalled();
});
it('rejects a stale capture before retrying a native operation',async()=>{renderToStaticMarkup(createElement(LocalLiveCheckoutRecovery,props));m.current=false;expect(await m.props!.retrySameOperation!()).toMatchObject({ok:false,code:'STALE_CAPTURE'});expect(m.begin).not.toHaveBeenCalled();});

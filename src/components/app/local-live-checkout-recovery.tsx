'use client';
import Link from 'next/link';
import {AccountMenu,useOptionalAccountSession} from './account-chrome';
import {useDemo} from '@/lib/demo-state';
import {SetupPaymentDialog} from './setup-payment-dialog';
import {beginAccountPaymentAction} from '@/lib/billing/es02/account-order-actions';
import type {LocalLiveOperation} from '@/lib/billing/es02/local-live-operation';
import type {Es02AccountOrderView} from '@/lib/billing/es02/contracts';
import type {SetupPlanConfirmResult,SetupPlanWrite} from './setup-plan-journey';
export function LocalLiveCheckoutRecovery({operation,order,checkoutUrl,checkoutNotice}:{operation:LocalLiveOperation;order:Es02AccountOrderView|null;checkoutUrl?:string;checkoutNotice:{ar:string;en:string}}){
 const session=useOptionalAccountSession(),{locale}=useDemo();
 if(session?.status!=='ready'||session.identity?.userId!==operation.accountId)return null;
 const identity=session.identity,isCurrent=()=>session.isCurrentUser(operation.accountId,identity);
 const selection=order?{term:order.offer.term,slots:order.offer.slots.map(s=>({persona:s.persona,package:s.package}))}:operation.selection;
 const slots=selection.slots.map((s,i)=>({label:{name:operation.preparation.branches[i]?.name??'',city:operation.preparation.branches[i]?.city??''},persona:s.persona,package:s.package}));
 const write:SetupPlanWrite=order?{kind:'unpaid',order,checkoutUrl,clientOpId:operation.clientOpId,selection,action:'reuse',settlement:'UNPAID',serviceReady:false}:{kind:'unknown',clientOpId:operation.clientOpId,selection,code:'UNKNOWN'};
 async function recover():Promise<SetupPlanConfirmResult>{
  if(!isCurrent())return {ok:false,code:'STALE_CAPTURE'};
  const result=await beginAccountPaymentAction({expectedAccountId:operation.accountId,selection:operation.selection,consentAccepted:true,clientOpId:operation.clientOpId,preparation:operation.preparation});
  if(!result.ok)return {ok:false,code:result.code,clientOpId:operation.clientOpId};
  return {ok:true,...result.data,clientOpId:operation.clientOpId,settlement:'UNPAID',serviceReady:false};
 }
 return <main data-service-theme="" dir={locale==='ar'?'rtl':'ltr'}><header><Link href="/">Velora</Link><AccountMenu compact/></header><p role="status">{locale==='ar'?'استعادة نفس الطلب المحفوظ. نتحقق من حالته خادميًا دون إنشاء دفعة أخرى.':'Recovering the same saved order. Payment status comes from the server.'}</p><SetupPaymentDialog ar={locale==='ar'} actor={{accountId:operation.accountId,captureToken:session.boundaryFingerprint??''}} slots={slots} term={selection.term} write={write} editingLocked consentAccepted checkoutNotice={checkoutNotice} isCurrent={isCurrent} confirmReview={recover} retrySameOperation={recover} onEditBranch={()=>{}} onBackToPlans={()=>{}}/></main>;
}

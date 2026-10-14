'use client';
import {useEffect,useRef,useState} from 'react';
import {readRenewalWalletAction,requestExcessRefundAction,setAutoRenewAction} from '@/lib/billing/autorenew-wallet-actions';
import {useOptionalAccountSession} from './account-chrome';
import {formatOmrBaisa} from './subscription-offers-view';
import {Button} from './ui';
type RightsSnapshot={companyId:string;wallet:{balanceBaisa:number;currency:'OMR';frozen:boolean};excessCollections:Array<{id:string;amountBaisa:number;currency:'OMR';state:'conversion_or_refund_choice'|'converted'|'REFUND_REVIEW_REQUIRED'}>;autoRenew:{requested:boolean;enabled:boolean}};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const money=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function financialRightsSnapshot(v:unknown,companyId:string):RightsSnapshot|null{
 if(!object(v)||v.companyId!==companyId||!object(v.wallet)||!money(v.wallet.balanceBaisa)||v.wallet.currency!=='OMR'||typeof v.wallet.frozen!=='boolean'||!object(v.autoRenew)||typeof v.autoRenew.requested!=='boolean'||typeof v.autoRenew.enabled!=='boolean'||!Array.isArray(v.excessCollections))return null;
 if(!v.excessCollections.every(x=>object(x)&&uuid(x.id)&&money(x.amountBaisa)&&x.currency==='OMR'&&['conversion_or_refund_choice','converted','REFUND_REVIEW_REQUIRED'].includes(String(x.state))))return null;
 return v as unknown as RightsSnapshot;
}
export function BusinessFinancialRightsPanel(props:{companyId:string;expectedUserId:string;ar:boolean}){return <RightsPanel key={`${props.expectedUserId}:${props.companyId}`} {...props}/>;}
function RightsPanel({companyId,expectedUserId,ar}:{companyId:string;expectedUserId:string;ar:boolean}){
 const [data,setData]=useState<RightsSnapshot|null>(null),[pending,setPending]=useState(false),[message,setMessage]=useState('');
 const alive=useRef(true),running=useRef(false),keys=useRef(new Map<string,string>()),session=useOptionalAccountSession(),sessionRef=useRef(session);
 // eslint-disable-next-line react-hooks/refs
 sessionRef.current=session;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 // Historical money rights remain bound to the account, independently of its selected workspace.
 const current=()=>alive.current&&(!sessionRef.current||sessionRef.current.isCurrentUser(expectedUserId));
 const scope={expectedCompanyId:companyId,expectedUserId,ownerHistory:true as const};
 const refresh=async()=>{const r=await readRenewalWalletAction(scope);if(!current())return;const next=r.ok?financialRightsSnapshot(r.data,companyId):null;setData(next);if(!next)setMessage(ar?'تعذر تحميل الحقوق المالية الموثوقة. أعد المحاولة.':'Verified financial rights are unavailable. Please retry.');};
 const run=async(action:()=>Promise<void>)=>{if(running.current||!current())return;running.current=true;setPending(true);setMessage('');try{await action();}catch{if(current())setMessage(ar?'تعذر تأكيد النتيجة. حدّث البيانات قبل إعادة الطلب.':'The result could not be confirmed. Reload before retrying.');}finally{running.current=false;if(current())setPending(false);}};
 const refund=(obligationId:string)=>void run(async()=>{let clientOpId=keys.current.get(obligationId);if(!clientOpId){clientOpId=crypto.randomUUID();keys.current.set(obligationId,clientOpId);}const r=await requestExcessRefundAction({...scope,obligationId,clientOpId});if(!current())return;if(!r.ok){setMessage(ar?'تعذر تسجيل مراجعة الاسترداد. حدّث البيانات وأعد المحاولة.':'Refund review could not be recorded. Reload and retry.');return;}setMessage(ar?'سُجل طلب مراجعة الاسترداد؛ لم يُنفذ استرداد مالي.':'Refund review request recorded; no provider refund has been executed.');await refresh();});
 const stop=()=>void run(async()=>{const r=await setAutoRenewAction({...scope,enabled:false});if(!current())return;if(!r.ok){setMessage(ar?'تعذر تأكيد إيقاف التجديد. حدّث البيانات وأعد المحاولة.':'Stopping renewal could not be confirmed. Reload and retry.');return;}setMessage(ar?'سُجل إيقاف التجديد التلقائي. التحصيل الجاري، إن وجد، يبقى قيد المراجعة.':'Automatic renewal stopped. An already committed collection, if any, remains subject to review.');await refresh();});
 return <section className="grid gap-3 rounded-xl border border-[var(--color-border-soft)] p-3" aria-label={ar?'الحقوق المالية للشركة':'Business financial rights'}>
  <h3 className="font-semibold">{ar?'المحفظة وحقوق الاسترداد':'Wallet and refund rights'}</h3>
  <Button type="button" variant="ghost" disabled={pending} onClick={()=>void run(refresh)}>{ar?'عرض الحقوق المالية':'Review financial rights'}</Button>
  {data&&<BusinessFinancialRightsView data={data} ar={ar} pending={pending} onRefund={refund} onStop={stop}/>}
  {message&&<p role="status" className="text-sm">{message}</p>}
 </section>;
}
export function BusinessFinancialRightsView({data,ar,pending,onRefund,onStop}:{data:RightsSnapshot;ar:boolean;pending:boolean;onRefund:(id:string)=>void;onStop:()=>void}){
 const state=(value:RightsSnapshot['excessCollections'][number]['state'])=>value==='converted'?(ar?'حُوّل إلى المحفظة':'Converted to wallet'):value==='REFUND_REVIEW_REQUIRED'?(ar?'طُلبت مراجعة الاسترداد':'Refund review requested'):(ar?'تحصيل زائد مثبت':'Proven excess collection');
 return <div className="grid gap-3 text-sm">
  <p>{ar?'رصيد المحفظة':'Wallet balance'}: <bdi>{formatOmrBaisa(data.wallet.balanceBaisa,ar?'ar':'en')}</bdi>{data.wallet.frozen&&(ar?' — مجمّد للمراجعة':' — frozen for review')}</p>
  <p>{ar?'طلب الاسترداد يسجل طلب مراجعة، ولا ينفذ تحصيلاً أو استرداداً من المزود. يبقى متاحاً بعد الأرشفة أو التحويل إلى المحفظة.':'This records a review request without executing a provider collection or refund. Refund review remains available after archive or conversion to wallet credit.'}</p>
  {data.excessCollections.map(x=><div key={x.id} className="grid gap-2 border-t border-[var(--color-border-soft)] pt-2"><p><bdi>{formatOmrBaisa(x.amountBaisa,ar?'ar':'en')}</bdi> · {state(x.state)}</p>{x.state!=='REFUND_REVIEW_REQUIRED'&&<Button type="button" variant="secondary" disabled={pending} onClick={()=>onRefund(x.id)}>{ar?'طلب مراجعة الاسترداد':'Request refund review'}</Button>}</div>)}
  {(data.autoRenew.requested||data.autoRenew.enabled)&&<Button type="button" variant="secondary" disabled={pending} onClick={onStop}>{ar?'إيقاف التجديد التلقائي':'Stop automatic renewal'}</Button>}
 </div>;
}

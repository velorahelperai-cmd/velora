import type {ActivationState} from '@/lib/billing/activation';
/** Parent supplies server-scoped state; no browser readiness checkbox. */
export function SubscriptionActivationState({value,ar}:{value:ActivationState|null;ar:boolean}){
 if(!value)return null;
 const fmt=(v:string)=>new Intl.DateTimeFormat(ar?'ar-OM':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Muscat'}).format(new Date(v));
 return <section aria-label={ar?'تفعيل الاشتراك':'Subscription activation'}>
  <p role='status'>{value.state==='waiting'?(ar?'تأكد الدفع. تبدأ مدة الاشتراك عند جاهزية أول قناة مختارة ومستحقة أو انتهاء مهلة التجهيز.':'Payment is confirmed. Your subscription starts when the first selected entitled channel is ready or the setup deadline is reached.'):
   value.state==='legacy'?(ar?'مواعيد الاشتراك الحالي محفوظة. تُتحقق جاهزية القنوات بصورة مستقلة.':'Your existing subscription dates are preserved. Channel readiness is checked separately.'):
   value.operationalReady?(ar?'بدأ الاشتراك وجاهزية التشغيل مؤكدة.':'Your subscription has started and operation is ready.'):
   value.state==='ended'?(ar?'انتهت مدة الاشتراك.':'Your subscription has ended.'):(ar?'بدأت مدة الاشتراك. الرد الآلي ينتظر جاهزية التشغيل.':'Your subscription has started. Automated replies await operational readiness.')}</p>
  <dl><div><dt>{ar?'تأكيد الدفع':'Payment confirmed'}</dt><dd><bdi>{fmt(value.paymentConfirmedAt)}</bdi></dd></div>
   {value.state==='waiting'&&<div><dt>{ar?'نهاية مهلة التجهيز':'Setup deadline'}</dt><dd><bdi>{fmt(value.activationDeadline)}</bdi></dd></div>}
   {value.subscriptionStartedAt&&<div><dt>{ar?'بداية الاشتراك':'Subscription started'}</dt><dd><bdi>{fmt(value.subscriptionStartedAt)}</bdi></dd></div>}
   {value.expiresAt&&<div><dt>{ar?'نهاية الاشتراك':'Subscription expiry'}</dt><dd><bdi>{fmt(value.expiresAt)}</bdi></dd></div>}</dl>
  {value.paused&&<p>{ar?'مهلة التجهيز معلقة بسبب عطل موثق من مزود الخدمة.':'The setup deadline is paused for a verified service-provider outage.'}</p>}
  {value.bonusDays===7&&<p>{ar?'يشمل الاشتراك الأول المؤهل ٧ أيام إضافية مرة واحدة.':'This eligible first subscription includes a one-time seven-day bonus.'}</p>}
 </section>;
}

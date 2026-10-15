import Link from 'next/link';
/** Explain unchanged review gates without restoring removed setup sections. */
export function SetupReviewPrerequisites({ar,knowledgeReady,hoursRequired,hoursReady,channelsSelected,subscriptionActive}:{ar:boolean;knowledgeReady:boolean;hoursRequired:boolean;hoursReady:boolean;channelsSelected:boolean;subscriptionActive:boolean}){
 return <aside aria-label={ar?'متطلبات مراجعة التشغيل':'Operational review requirements'} className="grid gap-3 rounded-xl border border-[var(--color-border-soft)] p-4 text-base leading-7">
  <p>{ar?'اكتمال بيانات هذه الصفحة مستقل عن جاهزية التشغيل. مراجعة التشغيل تظل خاضعة للمعرفة المعتمدة ومتطلبات الأمان والقنوات؛ اكتمال البيانات لا يفعّل الخدمة.':'Completing this page’s data is separate from operational readiness. Operational review still requires approved knowledge, security and channel requirements; data completion does not activate service.'}</p>
  {!knowledgeReady?<Link className="inline-flex min-h-11 items-center underline" href="/app/knowledge">{ar?'استكمال المعرفة المطلوبة من صفحة المعرفة':'Complete required knowledge on the Knowledge page'}</Link>:null}
  {hoursRequired&&!hoursReady?<Link className="inline-flex min-h-11 items-center underline" href="/app/settings?tab=business">{ar?'استكمال أوقات العمل من إعدادات النشاط':'Complete business hours in Business settings'}</Link>:null}
  {!channelsSelected?(subscriptionActive?<Link className="inline-flex min-h-11 items-center underline" href="/app/settings?tab=whatsapp">{ar?'إدارة قنوات الاشتراك من الإعدادات':'Manage subscription channels in Settings'}</Link>:<p>{ar?'ربط القنوات يأتي بعد الدفع، ولا يدخل في نسبة اكتمال بيانات هذه الصفحة.':'Channel connection follows payment and is not counted in this page’s data progress.'}</p>):null}
 </aside>;
}

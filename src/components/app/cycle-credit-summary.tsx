import type {CycleCreditSnapshot} from '@/lib/billing/cycle-credits';
export function CycleCreditSummary({value,ar}:{value:CycleCreditSnapshot|null;ar:boolean}){
 if(!value)return null;
 const labels=ar?{base:'رصيد الباقة',topup:'الرصيد الإضافي',compensation:'التعويض'}:{base:'Plan credits',topup:'Top-up credits',compensation:'Compensation'};
 return <section className="grid gap-3 rounded-2xl border p-4" aria-label={ar?'رصيد الردود':'Response credits'}>
  <h2 className="font-semibold">{ar?'رصيد الردود في الدورة الحالية':'Response credits for this cycle'}</h2>
  <p>{ar?'المتبقي':'Remaining'}: {value.totalRemaining.toLocaleString(ar?'ar':'en')} · {ar?'المستهلك':'Consumed'}: {value.totalConsumed.toLocaleString(ar?'ar':'en')}</p>
  <dl className="grid gap-2 sm:grid-cols-3">{(['base','topup','compensation'] as const).map(kind=><div key={kind}><dt>{labels[kind]}</dt><dd>{value.credits[kind].remaining} {ar?'متبقٍ؛ مستهلك':'remaining; consumed'} {value.credits[kind].consumed} · {ar?'محجوز':'held'} {value.credits[kind].held}</dd></div>)}</dl>
  <p className="text-sm">{ar?'تنتهي الأرصدة مع هذه الدورة:':'Credits expire with this cycle:'} <bdi>{new Intl.DateTimeFormat(ar?'ar-OM':'en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value.expiresAt))}</bdi></p>
  {value.usageNotices?.map(n=><p key={n.threshold} role="status">{ar?`سُجّل تنبيه استهلاك ${n.threshold}% لهذه الدورة.`:`A ${n.threshold}% usage notice was recorded for this cycle.`}</p>)}
  {value.topupConfiguration==='UNCONFIGURED'&&<p className="text-sm">{ar?'شراء الرصيد الإضافي غير متاح حتى اعتماد الأسعار والشروط.':'Top-up purchases await approved prices and terms.'}</p>}
 </section>;
}

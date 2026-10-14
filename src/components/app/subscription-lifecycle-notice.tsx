import {subscriptionPolicyCopy,subscriptionLifecycle} from '@/lib/billing/lifecycle';
export function SubscriptionLifecycleNotice({paidThrough,ar}:{paidThrough:string|null;ar:boolean}){
 const deadlines=subscriptionLifecycle(paidThrough);
 const fmt=(value:string)=>new Intl.DateTimeFormat(ar?'ar-OM':'en-GB',{dateStyle:'medium',timeStyle:'long',timeZone:'Asia/Muscat'}).format(new Date(value));
 return <section aria-label={ar?'سياسة انتهاء الاشتراك':'Subscription expiry policy'}><p>{subscriptionPolicyCopy[ar?'ar':'en']}</p>
 {deadlines.disconnectAt&&deadlines.deleteAt&&<dl><div><dt>{ar?'موعد إزالة الربط إذا لم تجدّد':'Local disconnection if not renewed'}</dt><dd><bdi>{fmt(deadlines.disconnectAt)}</bdi></dd></div><div><dt>{ar?'موعد حذف سجل المحادثات إذا لم تجدّد':'Conversation deletion if not renewed'}</dt><dd><bdi>{fmt(deadlines.deleteAt)}</bdi></dd></div></dl>}
 <a href='/app/subscription'>{ar?'حالة الاشتراك والتجديد':'Subscription and renewal'}</a> · <a href='mailto:velorahelperai@gmail.com'>{ar?'الدعم':'Support'}</a></section>;
}

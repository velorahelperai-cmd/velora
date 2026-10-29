import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {loginPathForReturn} from "@/lib/tenancy/access";
import {readSessionIdentity} from "@/lib/auth/server-identity";
import {listMyBranchAccess,readBranchInbox} from "@/lib/tenancy/branch-inbox";
import {LOCALE_COOKIE,resolveLocale} from "@/lib/i18n";
import {BranchInboxRealtime} from '@/components/app/branch-inbox-realtime';
export default async function BranchPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const identity=await readSessionIdentity();
 if(!identity.ok)redirect(loginPathForReturn('/branch'));
 const locale=resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value),ar=locale==='ar',t=(a:string,e:string)=>ar?a:e;
 const query=await searchParams,one=(key:string)=>typeof query[key]==='string'?query[key] as string:undefined;
 const branches=await listMyBranchAccess();
 const selected=branches?.find(b=>b.companyId===one('company')&&b.branchId===one('branch'));
 const channels=selected?[...(selected.capabilities.includes('wa.conversations.read')?['whatsapp']:[]),...(selected.capabilities.includes('ig.conversations.read')?['instagram']:[])]:[];
 const channel=one('channel')??channels[0],conversationId=one('conversation'),before=one('before');
 const href=(params:Record<string,string|undefined>)=>'/branch?'+new URLSearchParams(Object.entries(params).filter((v):v is [string,string]=>v[1]!==undefined)).toString();
 const base={company:selected?.companyId,branch:selected?.branchId,channel};
 const inbox=selected&&channels.includes(channel)?await readBranchInbox({companyId:selected.companyId,branchId:selected.branchId,channel,conversationId,before}):null;
 const card='rounded-xl border border-[color:var(--color-border-soft)] p-4';
 return <main dir={ar?'rtl':'ltr'} className="mx-auto grid max-w-5xl gap-6 p-6 text-[var(--color-on-dark)]">
  <header><h1 className="text-2xl font-semibold">{t('مساحة فريق الفرع','Branch team workspace')}</h1><p>{t('عرض المحادثات حسب صلاحياتك في الفرع.','View conversations permitted for your branch.')}</p></header>
  {branches===null?<p role="alert">{t('تعذّر التحقق من صلاحيات الفروع.','Branch access could not be verified.')}</p>:branches.length===0?<p>{t('لا توجد فروع متاحة لهذا الحساب حاليًا.','No branches are currently available for this account.')}</p>:<nav aria-label={t('الفروع','Branches')} className="flex flex-wrap gap-4">{branches.map(b=><Link key={b.branchId} className={card} href={href({company:b.companyId,branch:b.branchId})} aria-current={selected===b?'page':undefined}>{b.branchLabel}</Link>)}</nav>}
  {selected&&<section className="grid gap-4"><h2 className="text-xl">{selected.branchLabel}</h2><nav className="flex gap-4">{channels.map(c=><Link key={c} href={href({...base,channel:c})} aria-current={channel===c?'page':undefined}>{c==='whatsapp'?'WhatsApp':'Instagram'}</Link>)}</nav>
   {!inbox?<p role="alert">{t('المحادثات غير متاحة. حدّث الصفحة للتحقق من الصلاحيات والربط.','Conversations are unavailable. Refresh to verify access and channel connection.')}</p>:<>
    <BranchInboxRealtime key={`${selected.companyId}:${selected.branchId}:${channel}`} companyId={selected.companyId} branchId={selected.branchId} channel={channel} ar={ar}/>
    {inbox.conversation?<><Link href={href(base)}>{t('العودة للمحادثات','Back to conversations')}</Link><h3>{inbox.conversation.label}</h3><ol className="grid gap-3">{[...inbox.messages].reverse().map(m=><li key={m.id} className={card}><p className="text-sm">{m.direction==='inbound'?t('واردة','Incoming'):t('صادرة','Outgoing')} · <time dateTime={m.receivedAt}>{new Date(m.receivedAt).toLocaleString(ar?'ar-OM':'en-OM')}</time></p><p dir="auto" className="whitespace-pre-wrap break-words">{m.text||t('رسالة غير نصية','Non-text message')}</p></li>)}</ol>{!inbox.messages.length&&<p>{t('لا توجد رسائل.','No messages.')}</p>}</>:<ul className="grid gap-3">{inbox.conversations.map(c=><li key={c.id} className={card}><Link href={href({...base,conversation:c.id})}><strong dir="auto">{c.label}</strong><p dir="auto" className="line-clamp-2">{c.latest?.text||t('عرض المحادثة','View conversation')}</p></Link></li>)}{!inbox.conversations.length&&<li>{t('لا توجد محادثات.','No conversations.')}</li>}</ul>}
    {inbox.nextCursor&&<Link href={href({...base,conversation:conversationId,before:inbox.nextCursor})}>{t('الأقدم','Older')}</Link>}
   </>}
  </section>}
 </main>;
}

'use client';
import {useDemo} from '@/lib/demo-state';
import {WorkspaceShell} from './workspace-shell';
import {InstagramOwnerConnection} from './instagram-owner-connection';
import {LinkButton,Notice} from './ui';
import {ChannelBadge} from './channel-badge';
export function InstagramConnectionPage({companyId,owner,callbackResult,callbackDiagnostic}:{companyId:string|null;owner:boolean;callbackResult?:string;callbackDiagnostic?:unknown}) {
 const {locale}=useDemo(),ar=locale==='ar';
 return <WorkspaceShell title={ar?'ربط إنستجرام':'Instagram connection'} actions={<LinkButton href="/app/conversations?channel=instagram" variant="secondary">{ar?'فتح المحادثات':'Open conversations'}</LinkButton>}>
  <section className="app-panel max-w-3xl rounded-xl p-6"><ChannelBadge channel="instagram" ar={ar}/><h2 className="my-3 text-xl font-medium">{ar?'حساب النشاط':'Business account'}</h2>
   <p className="app-muted mb-4 text-sm">{ar?'حالة الربط محفوظة على الخادم. تجديد التفويض متاح لصاحب النشاط عند الحاجة؛ الاشتراك له حالة مستقلة.':'Connection state is stored on the server. The business owner can renew authorization when needed; subscription status is separate.'}</p>
   {companyId&&owner?<InstagramOwnerConnection companyId={companyId} ar={ar} callbackResult={callbackResult} callbackDiagnostic={callbackDiagnostic}/>:<Notice>{ar?'إدارة الربط متاحة لصاحب النشاط بعد اختيار مساحة العمل.':'Connection management requires the business owner and a selected workspace.'}</Notice>}
  </section>
 </WorkspaceShell>;
}

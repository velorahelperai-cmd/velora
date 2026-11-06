'use client';

import {useDemo} from '@/lib/demo-state';
import {InboxDesktop,type InboxDesktopView} from './inbox-desktop';
import {WorkspaceShell} from './workspace-shell';

/** Shown while the authorized inbox read is still running.
 * The three columns stay in the document instead of an empty page. */
export function InboxLoadingFrame(){
 const {locale}=useDemo(),ar=locale==='ar';
 const view:InboxDesktopView={
  state:'ready',scopeKey:'inbox-loading',messages:[],query:'',onQueryChange:()=>{},
  tabs:[{id:'all',label:ar?'الكل':'All'},{id:'unassigned',label:ar?'غير مسند':'Unassigned'},{id:'mine',label:ar?'مسند لي':'Assigned to me'}],
  activeTab:'all',onTabChange:()=>{},conversations:[],onSelect:()=>{},
  emptyListLabel:ar?'جارٍ تحميل المحادثات…':'Loading conversations…',
  notice:ar?'صندوق الوارد مفتوح. البحث والتصفية والإرسال تُستخدم بعد قراءة المحادثات المصرّح بها.':'The inbox is open. Search, filters and sending are used after the authorized conversations load.',
 };
 return <WorkspaceShell title={ar?'المحادثات':'Conversations'}><div data-inbox-loading="true"><InboxDesktop locale={locale} view={view}/></div></WorkspaceShell>;
}

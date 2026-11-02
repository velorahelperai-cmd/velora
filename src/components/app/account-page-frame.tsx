"use client";
import {usePathname} from 'next/navigation';
import {useDemo} from '@/lib/demo-state';
import {useAppCopy} from './ui';
import {WorkspaceFrame,workspaceNavigation} from './workspace-frame';

/** The actual shared UI frame can render before private records are admitted.
 * Navigation is public; it never grants a capability or starts a data mutation.
 * No cached account, tenant, role, counters or form values are projected. */
export function AccountPageFrame(){
 const pathname=usePathname();const copy=useAppCopy();const {locale}=useDemo();const ar=locale==='ar';
 const workspaceNav=workspaceNavigation(copy,ar);
 const inWorkspace=pathname==='/app'||pathname.startsWith('/app/');
 const nav=inWorkspace?workspaceNav:[
  {href:'/',label:ar?'الرئيسية':'Home',icon:'M3 11 12 3l9 8 M5 10v11h14V10'},
  {href:'/account',label:ar?'حسابي':'My account',icon:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21v-2a8 8 0 0 1 16 0v2'},
 ];
 const matched=workspaceNav.find(item=>item.href==='/app'?pathname==='/app':pathname===item.href||pathname.startsWith(item.href+'/'));
 const title=inWorkspace?(matched?.label??copy.app.nav.dashboard)
  :pathname.startsWith('/admin')?(ar?'الإدارة':'Administration')
  :pathname.startsWith('/reset-password')?(ar?'كلمة المرور':'Password')
  :pathname.startsWith('/complete-profile')?(ar?'بيانات الحساب':'Account details')
  :pathname.startsWith('/setup')?(ar?'جهّز مساعدك':'Set up your assistant')
  :(ar?'حسابي':'My account');
 return <WorkspaceFrame title={title} nav={nav} prefetch={false}/>;
}

"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {useDemo} from '@/lib/demo-state';
import {LangSwitch,useAppCopy} from './ui';
import styles from './internal-ui.module.css';
export type WorkspaceNavItem={href:string;label:string;icon:string};
export function workspaceNavigation(copy:ReturnType<typeof useAppCopy>,ar:boolean):WorkspaceNavItem[]{return [
    { href: "/app", label: copy.app.nav.dashboard, icon: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" },
    { href: "/app/conversations", label: copy.app.nav.conversations, icon: "M4 4h16v12H9l-5 4V4z M8 8h8 M8 12h5" },
    { href: "/app/instagram", label: ar?"ربط إنستجرام":"Instagram connection", icon: "M4 4h16v16H4z M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0" },
    { href: "/app/knowledge", label: copy.app.nav.knowledge, icon: "M4 3h12l4 4v14H4V3z M15 3v5h5 M8 12h8 M8 16h6" },
    { href: "/app/test", label: copy.app.nav.test, icon: "M9 3h6 M10 3v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3 M8 14h8" },
    { href: "/app/subscription", label: ar ? "اشتراكي" : "My subscription", icon: "M3 5h18v14H3z M3 9h18 M7 14h4" },
    { href: "/app/settings", label: copy.app.nav.settings, icon: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6" },
  ];}
/** Shared presentation for both initial UI and the authorized workspace.
 * No identity, records, permission checks, fetches or mutation handlers here. */
export function WorkspaceFrame({title,children,actions,account,presence,nav,immersive=false,prefetch=null}:{title:string;children?:ReactNode;actions?:ReactNode;account?:ReactNode;presence?:ReactNode;nav:WorkspaceNavItem[];immersive?:boolean;prefetch?:boolean|null}){
 const copy=useAppCopy();const {locale}=useDemo();const ar=locale==='ar';const pathname=usePathname();
 const [menuOpen,setMenuOpen]=useState(false);const menuButtonRef=useRef<HTMLButtonElement>(null);
 const closeButtonRef=useRef<HTMLButtonElement>(null);const wasOpen=useRef(false);
 useEffect(()=>{if(menuOpen)closeButtonRef.current?.focus();else if(wasOpen.current)menuButtonRef.current?.focus();wasOpen.current=menuOpen;},[menuOpen]);
 useEffect(()=>{const media=typeof window==='undefined'?undefined:window.matchMedia?.('(min-width: 1024px)');if(!media)return;const close=(event:MediaQueryListEvent)=>{if(event.matches)setMenuOpen(false);};media.addEventListener('change',close);return()=>media.removeEventListener('change',close);},[]);
  return (
    <div className={`app-shell ${styles.theme} ${styles.workspace}`} data-internal-ui="true" data-conversations-workspace={pathname==='/app/conversations'} data-immersive={immersive} dir={ar ? "rtl" : "ltr"}>
      <a href="#workspace-content" inert={menuOpen} className="service-skip-link">{ar?"انتقل للمحتوى":"Skip to content"}</a>
      <aside data-workspace-navigation="true" className={styles.sidebar}>
        <div className={styles.sidebarHeader} inert={menuOpen}>
          <div className={styles.sidebarBrand}>
            <Link href="/" prefetch={prefetch} className={styles.brand} title={copy.brand}><span className={styles.brandMark} aria-hidden="true">V</span><span className={styles.brandLabel}>{copy.brand}</span></Link>
          </div>
          <div className={styles.sidebarUtilities}>
            <button ref={menuButtonRef} type="button" className={styles.menuButton}
              aria-label={ar ? "قائمة مساحة العمل" : "Workspace menu"} aria-expanded={menuOpen}
              aria-controls="workspace-navigation" onClick={() => setMenuOpen(v => !v)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={menuOpen ? "m6 6 12 12 M6 18 18 6" : "M4 6h16 M4 12h16 M4 18h16"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
        {menuOpen && <div className={styles.workspaceOverlay} aria-hidden="true" onClick={()=>setMenuOpen(false)} />}
        <div id="workspace-navigation" className={styles.workspaceMenu} data-open={menuOpen}
          role={menuOpen?'dialog':undefined} aria-modal={menuOpen?true:undefined} aria-label={menuOpen?(ar?'قائمة مساحة العمل':'Workspace navigation'):undefined}
          onKeyDown={event => {
            if (!menuOpen) return;
            if(event.key==='Escape'){event.preventDefault();setMenuOpen(false);}
            else if(event.key==='Tab'){
              const focusable=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')).filter(element=>element.getClientRects().length>0);
              const first=focusable[0],last=focusable[focusable.length-1];
              if(first && last && ((event.shiftKey && document.activeElement===first)||(!event.shiftKey && document.activeElement===last))){event.preventDefault();(event.shiftKey?last:first).focus();}
            }
          }}>
          <button ref={closeButtonRef} type="button" className={styles.drawerClose} aria-label={ar?'إغلاق القائمة':'Close navigation'} onClick={()=>setMenuOpen(false)}>×</button>
          <nav aria-label={copy.app.nav.dashboard} className={styles.workspaceNav}>
            {nav.map(item => {
              const active = item.href === "/app" ? pathname === "/app" : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return <Link key={item.href} href={item.href} prefetch={prefetch} aria-current={active ? "page" : undefined} title={item.label}
                className={styles.navLink} onClick={() => setMenuOpen(false)}>
                <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={item.icon} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span className={styles.navLabel}>{item.label}</span>
              </Link>;
            })}
          </nav>
          <details className={styles.accountMenu} onKeyDown={event=>{if(event.key==='Escape'&&event.currentTarget.open){event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}>
            <summary aria-label={ar?'الحساب واللغة':'Account and language'} title={ar?'الحساب واللغة':'Account and language'}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6"/><path d="M4 21a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg><span className={styles.navLabel}>{ar?'الحساب واللغة':'Account and language'}</span></summary>
            <div className={styles.workspaceAccount}><LangSwitch />{account}</div>
          </details>
        </div>
      </aside>
      <main id="workspace-content" inert={menuOpen} className={styles.workspaceMain}>
        {presence}
        <div data-workspace-page-header="true" className={styles.workspacePageHeader}>
          <h1 className="app-title min-w-0 break-words text-2xl lg:text-[2rem]">{title}</h1>
          <div className={styles.workspacePageActions}>{actions}</div>
        </div>
        <div className="min-w-0">{children}</div>
      </main>
    </div>
  );
}

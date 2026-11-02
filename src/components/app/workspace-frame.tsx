"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useRef,useState,type ReactNode} from 'react';
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
  return (
    <div className={`app-shell ${styles.theme} ${styles.workspace}`} data-internal-ui="true" data-immersive={immersive} dir={ar ? "rtl" : "ltr"}>
      <a href="#workspace-content" className="service-skip-link">{ar?"انتقل للمحتوى":"Skip to content"}</a>
      <aside data-workspace-navigation="true" className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.sidebarBrand}>
            <Link href="/" prefetch={prefetch} className={styles.brand}><span className={styles.brandMark}>V</span>{copy.brand}</Link>
          </div>
          <div className={styles.sidebarUtilities}>
            <LangSwitch />
            <button ref={menuButtonRef} type="button" className={styles.menuButton}
              aria-label={ar ? "قائمة مساحة العمل" : "Workspace menu"} aria-expanded={menuOpen}
              aria-controls="workspace-navigation" onClick={() => setMenuOpen(v => !v)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={menuOpen ? "m6 6 12 12 M6 18 18 6" : "M4 6h16 M4 12h16 M4 18h16"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
        <div id="workspace-navigation" className={styles.workspaceMenu} data-open={menuOpen}
          onKeyDown={e => { if (e.key === "Escape" && menuOpen && window.matchMedia("(max-width: 1023px)").matches) { setMenuOpen(false); menuButtonRef.current?.focus(); } }}>
          <nav aria-label={copy.app.nav.dashboard} className={styles.workspaceNav}>
            {nav.map(item => {
              const active = item.href === "/app" ? pathname === "/app" : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return <Link key={item.href} href={item.href} prefetch={prefetch} aria-current={active ? "page" : undefined}
                className={styles.navLink} onClick={() => setMenuOpen(false)}>
                <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={item.icon} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>{item.label}</span>
              </Link>;
            })}
          </nav>
          {account&&<div className={styles.workspaceAccount}>{account}</div>}
        </div>
      </aside>
      <main id="workspace-content" className={styles.workspaceMain}>
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

import { useId } from 'react';
import Link from 'next/link';
import styles from './setup-loading-view.module.css';

/** Neutral setup frame before account and branch authority are available. */
export function SetupLoadingView({ ar }: { ar: boolean }) {
  const id = useId();
  return <main className={`app-shell ${styles.shell}`} dir={ar ? 'rtl' : 'ltr'} aria-labelledby={`${id}-title`}>
    <div className={styles.content}>
      <header className={styles.brand}><span aria-hidden="true">V</span>Velora<h1 id={`${id}-title`}>{ar ? 'جهّز مساعدك' : 'Set up your assistant'}</h1></header>
      <nav className="flex gap-4 px-3 py-4 text-sm" aria-label={ar?'التنقل':'Navigation'}>
        <Link href="/" prefetch={false}>{ar?'الرئيسية':'Home'}</Link>
        <Link href="/account" prefetch={false}>{ar?'حسابي':'My account'}</Link>
      </nav>
    </div>
  </main>;
}

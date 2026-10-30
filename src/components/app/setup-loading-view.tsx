import { useId } from 'react';
import styles from './setup-loading-view.module.css';

/** Neutral setup frame before account and branch authority are available. */
export function SetupLoadingView({ ar }: { ar: boolean }) {
  const id = useId();
  return <main className={`app-shell ${styles.shell}`} dir={ar ? 'rtl' : 'ltr'} aria-busy="true" aria-labelledby={`${id}-title`}>
    <div className={styles.content}>
      <header className={styles.brand}><span aria-hidden="true">V</span>Velora<h1 id={`${id}-title`}>{ar ? 'جهّز مساعدك' : 'Set up your assistant'}</h1></header>
      <span className={styles.srOnly} role="status">{ar ? 'جارٍ تحميل بيانات التجهيز…' : 'Loading your setup…'}</span>
      <div className={styles.frame} aria-hidden="true">
        <aside className={styles.rail}><div/><div/><div/><div/><div/></aside>
        <section className={styles.stage}><div className={styles.line}/><div className={styles.description}/><div className={styles.cards}><div/><div/></div></section>
      </div>
    </div>
  </main>;
}

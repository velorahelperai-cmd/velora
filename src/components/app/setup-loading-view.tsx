import { useId } from 'react';
import styles from './setup-loading-view.module.css';

/** Setup presentation only. It stays pending until the caller has real ready/error facts. */
export function SetupLoadingView({ ar }: { ar: boolean }) {
  const id = useId();
  return <main className={`app-shell ${styles.shell}`} dir={ar ? 'rtl' : 'ltr'} aria-busy="true" aria-labelledby={`${id}-title`}>
    <div className={styles.content}>
      <div className={styles.brand}><span aria-hidden="true">V</span>Velora</div>
      <h1 id={`${id}-title`}>{ar ? 'تجهيز نشاطك' : 'Prepare your business'}</h1>
      <div className={styles.status} role="status" aria-live="polite">
        <span className={styles.spinner} aria-hidden="true" />
        <p>{ar ? 'جارٍ تحميل بيانات التجهيز…' : 'Loading your setup…'}</p>
      </div>
      <p className={styles.hint}>{ar ? 'سيظهر النموذج عندما تصبح بيانات حسابك جاهزة.' : 'The form will appear when your account details are ready.'}</p>
      <div className={styles.skeleton} aria-hidden="true">
        <div className={styles.form}>
          <span className={styles.line} /><span className={styles.description} />
          <div className={styles.field}><span /><div /></div>
          <div className={styles.row}><div className={styles.field}><span /><div /></div><div className={styles.field}><span /><div /></div></div>
          <div className={styles.action} /><span className={styles.description} />
        </div>
        <div className={styles.guide} />
      </div>
    </div>
  </main>;
}

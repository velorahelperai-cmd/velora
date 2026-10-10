"use client";

import { useAppCopy } from "@/components/app/ui";
import styles from "./setup-wizard.module.css";

/** Setup-only loading feedback; no records, completion or readiness are inferred. */
export function SetupLoading() {
  const copy = useAppCopy();
  return (
    <main className={`app-shell ${styles.setup}`} aria-busy="true">
      <div className={styles.loadingContent}>
        <div className={styles.loadingBrand}><span aria-hidden="true">V</span>{copy.brand}</div>
        <h1 className={styles.loadingTitle}>{copy.setup.title}</h1>
        <div className={styles.loadingStatus} role="status" aria-live="polite">
          <span className={styles.loadingSpinner} aria-hidden="true" />
          <span>{copy.loading}</span>
        </div>
        <div className={styles.loadingSteps} aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <span key={i} />)}
        </div>
        <div className={styles.panel} aria-hidden="true">
          <div className={styles.loadingFields}>
            {Array.from({ length: 6 }, (_, i) => <span key={i} />)}
          </div>
        </div>
      </div>
    </main>
  );
}

"use client";

import { useState } from "react";
import { SubscriptionCharacter } from "./subscription-character";
import { subscriptionCopy, subscriptionTiers } from "./subscription-copy";
import type { SubscriptionPersona } from "./subscription-offers-view";
import styles from "./subscription-panel.module.css";

const team = [
  { name: "noor", task: "files", ar: "ملفات ومعرفة", en: "Files and knowledge" },
  { name: "lina", task: "screen", ar: "تنظيم العمل", en: "Work coordination" },
  { name: "dana", task: "messages", ar: "تواصل العملاء", en: "Customer communication" },
] as const;

function Workstation({ task }: { task: (typeof team)[number]["task"] }) {
  return (
    <div className={styles.workstation} data-task={task}>
      <span className={styles.desk} />
      {task === "files" ? (
        <div className={styles.paperStack}>
          {[0, 1, 2].map(sheet => <span key={sheet} className={styles.paper}><i /><i /><i /></span>)}
        </div>
      ) : task === "screen" ? (
        <div className={styles.monitor}><span className={styles.screen}><i /><i /><i /></span><span className={styles.monitorStand} /></div>
      ) : (
        <div className={styles.communications}>
          <svg className={styles.headset} viewBox="0 0 48 48" fill="none"><path d="M10 27V23a14 14 0 0 1 28 0v4M10 25H7v10h6V25h-3Zm28 0h3v10h-6V25h3ZM38 35v3c0 3-4 4-10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <span className={styles.messageSheet}><i /><i /></span>
        </div>
      )}
    </div>
  );
}

export function SubscriptionBrandGuide({ locale, selectedPersona }: {
  locale: "ar" | "en";
  selectedPersona?: SubscriptionPersona | null;
}) {
  const c = subscriptionCopy[locale];
  const selected = subscriptionTiers.find(item => item.id === selectedPersona);
  const [motionPaused, setMotionPaused] = useState(false);
  return (
    <section className={styles.brandGuide} data-persona={selectedPersona ?? "none"} aria-label={c.hostStage}>
      <div className={styles.brandCopy}>
        <span className={styles.brandSignature} aria-hidden="true">Velora</span>
        <h2>{c.guideWelcome}</h2>
        <p className={styles.brandIntro}>{c.guideIntro}</p>
        <div className={styles.brandHint} role="status" aria-live="polite" aria-atomic="true">
          <span className={styles.hintLight} aria-hidden="true" />
          <p>{selected ? c.guideSelected.replace("{name}", selected[locale]) : c.guideChoose}</p>
        </div>
      </div>
      <figure className={styles.brandTableau}>
        <div className={styles.teamScene} data-motion-paused={motionPaused} aria-hidden="true">
          <span className={styles.sceneOrbit} />
          <div className={styles.sceneWorkers}>
            {team.map(worker => <div key={worker.name} className={styles.sceneWorker} data-worker={worker.name}>
              <div className={styles.workerPortrait}><SubscriptionCharacter name={worker.name} label={worker.name} locale={locale} /></div>
              <Workstation task={worker.task} />
              <span className={styles.workerTask}>{worker[locale]}</span>
            </div>)}
          </div>
          <div className={styles.sceneManager}>
            <SubscriptionCharacter name="velora" label={c.guide} locale={locale} selected={Boolean(selectedPersona)} size="host" />
            <span className={styles.managerName}>{locale === "ar" ? "فيلورا · المديرة" : "Velora · Team manager"}</span>
          </div>
        </div>
        <figcaption className={styles.sceneCaption}>
          <span>{locale === "ar" ? "مشهد توضيحي لفيلورا وفريقها" : "An illustrated scene of Velora and her team"}</span>
          <button type="button" className={styles.motionToggle} aria-pressed={motionPaused} onClick={() => setMotionPaused(paused => !paused)}>
            {locale === "ar" ? motionPaused ? "تشغيل الحركة" : "إيقاف الحركة" : motionPaused ? "Play motion" : "Pause motion"}
          </button>
        </figcaption>
      </figure>
    </section>
  );
}

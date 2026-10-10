"use client";
import { useId } from "react";
import styles from "./internal-ui.module.css";
export function SetupNavigation({ labels, shortLabels, done, step, locale, onSelect }: {
 labels: readonly string[];shortLabels: readonly string[];done:boolean[];step:number;locale:"ar"|"en";onSelect:(step:number)=>void;
}) {
 const id=useId(),ar=locale==="ar";
 return <nav className={styles.navigation} aria-label={ar?"مراحل إعداد الشركة":"Company setup milestones"}>
  <ol className={styles.desktopMilestones}>{shortLabels.map((label,i)=><li key={label}>
   <button type="button" className={styles.milestone} onClick={()=>onSelect(i)} aria-current={i===step?"step":undefined} aria-label={`${i+1}. ${labels[i]} — ${done[i]?(ar?"مؤكد من السجلات":"Confirmed from records"):(ar?"غير مؤكد":"Not confirmed")}`}>
    <span className={styles.number} data-complete={done[i]} aria-hidden="true">{done[i]?<svg width="15" height="15" viewBox="0 0 20 20" fill="none"><path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="2"/></svg>:i+1}</span>
    <span className={styles.milestoneLabel}>{label}</span>
   </button>
  </li>)}</ol>
  <div className={styles.mobileMilestone}>
   <div className={styles.mobileCurrent}><strong>{labels[step]}</strong><span className={styles.mobileCounter}>{step+1} / 8</span></div>
   <label className={styles.mobilePicker} htmlFor={id}>{ar?"انتقل إلى مرحلة":"Go to milestone"}
    <select id={id} value={step} onChange={e=>onSelect(Number(e.target.value))}>{labels.map((label,i)=><option key={label} value={i}>{i+1}. {label}</option>)}</select>
   </label>
  </div>
 </nav>;
}

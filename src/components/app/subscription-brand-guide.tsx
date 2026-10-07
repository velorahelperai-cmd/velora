import Image from "next/image";
import {SubscriptionCharacter} from "./subscription-character";
import {subscriptionCopy,subscriptionTiers} from "./subscription-copy";
import type {SubscriptionPersona} from "./subscription-offers-view";
import styles from "./subscription-panel.module.css";

export function SubscriptionBrandGuide({locale,selectedPersona}:{locale:"ar"|"en";selectedPersona?:SubscriptionPersona|null}){
 const c=subscriptionCopy[locale],selected=subscriptionTiers.find(item=>item.id===selectedPersona);
 return <section className={styles.brandGuide} data-persona={selectedPersona??"none"} aria-label={c.hostStage}>
  <div className={styles.brandPortrait}>
   <SubscriptionCharacter name="velora" label={c.guide} locale={locale} selected={Boolean(selectedPersona)} size="host"/>
   <span className={styles.brandName}>{c.guide}</span>
  </div>
  <div className={styles.brandCopy}>
   <h2>{c.guideWelcome}</h2>
   <p>{c.guideIntro}</p>
   <p>{c.oneProduct}</p>
   <div className={styles.brandHint} role="status">{selected?c.guideSelected.replace("{name}",selected[locale]):c.guideChoose}</div>
   <details className={styles.approvedArt}>
    <summary>{locale === "ar" ? "التصميم المرجعي للشخصيات" : "Character design reference"}</summary>
    <Image src="/velora-characters.png" alt={locale === "ar" ? "لوحة نور ولينا ودانة وفيلورا المعتمدة" : "Approved Noor, Lina, Dana, and Velora character board"} width={1672} height={941} sizes="(max-width:760px) 100vw, 700px"/>
   </details>
  </div>
  <p className={styles.brandDisclosure}>{c.guideNote}</p>
 </section>;
}

"use client";
import { useState } from "react";
import { SubscriptionCharacter } from "./subscription-character";
import { subscriptionCopy, subscriptionTiers } from "./subscription-copy";
import type { SubscriptionChoice, SubscriptionOfferView, SubscriptionOffersView, SubscriptionTerm } from "./subscription-offers-view";
import { choiceFromOffer, findOffer } from "./subscription-offers-view";
import styles from "./subscription-panel.module.css";
function price(locale:"ar"|"en",offer?:SubscriptionOfferView){return offer?new Intl.NumberFormat(locale,{style:"currency",currency:offer.currency}).format(offer.amountBaisa/1000):subscriptionCopy[locale].price;}
export function SubscriptionOfferCards({locale,term,offers,catalogStatus,selectedPersona,selectedPackage,currentPersona,disabled=false,onSelectionInvalidated,onSelect}:{locale:"ar"|"en";term:SubscriptionTerm;offers:readonly SubscriptionOfferView[];catalogStatus?:SubscriptionOffersView["status"];selectedPackage?:SubscriptionChoice["package"];selectedPersona:SubscriptionChoice["persona"]|null;currentPersona?:SubscriptionChoice["persona"]|null;disabled?:boolean;onSelectionInvalidated?:()=>void;onSelect:(choice:SubscriptionChoice)=>void}){
 const c=subscriptionCopy[locale],ar=locale==="ar";
 const [packages,setPackages]=useState<Record<SubscriptionChoice["persona"],SubscriptionChoice["package"]>>({level_1:"basic",level_2:"basic",level_3:"basic"});
 const roles=ar?["خدمة العملاء","المبيعات والحضور الرقمي","الطلبات والعمليات"]:["Customer service","Sales & digital presence","Orders & operations"];
 return <div className={styles.cards}>{subscriptionTiers.map((persona,index)=>{
 const pack=packages[persona.id],offer=findOffer(offers,persona.id,pack,term),selected=selectedPersona===persona.id&&selectedPackage===pack;
 return <article
   key={persona.id}
   className={styles.card}
   data-persona={persona.id}
   data-selected={selected}
   aria-label={persona[locale]}
   onMouseMove={(e) => {
     const el = e.currentTarget;
     const rect = el.getBoundingClientRect();
     const x = (e.clientX - rect.left) / rect.width;
     const y = (e.clientY - rect.top) / rect.height;
     const dx = (x - 0.5) * 2;
     const dy = (y - 0.5) * 2;
     el.style.setProperty("--card-tilt-x", `${-dy * 4}deg`);
     el.style.setProperty("--card-tilt-y", `${dx * 4}deg`);
   }}
   onMouseLeave={(e) => {
     const el = e.currentTarget;
     el.style.setProperty("--card-tilt-x", "0deg");
     el.style.setProperty("--card-tilt-y", "0deg");
   }}
 >
  <div className={styles.cardIdentity}><div><p className={styles.cardRole}>{roles[index]}</p><h3>{persona[locale]}</h3><p className={styles.cardSubtitle}>{ar?persona.en:persona.ar}</p></div><div className={styles.portrait}><SubscriptionCharacter name={index===0?"noor":index===1?"lina":"dana"} label={persona[locale]} locale={locale} selected={selected} size="staff"/></div></div>
  {currentPersona===persona.id?<span className={styles.currentBadge}>{c.currentBadge}</span>:null}
  <p className={styles.cardDescription}>{c.personas[persona.id].fits}</p>
  <div className={styles.packageOptions} role="group" aria-label={c.packageLevel+" "+persona[locale]}>{(["basic","premium"] as const).map(value=><button key={value} type="button" aria-pressed={pack===value} disabled={disabled||catalogStatus!=="ready"||!findOffer(offers,persona.id,value,term)} onClick={()=>{if(value!==pack&&selectedPersona===persona.id)onSelectionInvalidated?.();setPackages(prev=>({...prev,[persona.id]:value}));}}>{c[value]}</button>)}</div>
  <div className={styles.priceBlock}><p className={styles.price} data-unavailable={!offer}><bdi>{price(locale,offer)}</bdi></p><span className={styles.cycleLabel}>{c[term]}</span></div>
  {offer?.automatedOutboundPerMonth!=null?<p className={styles.messageAllowance}><strong><bdi>{new Intl.NumberFormat(locale).format(offer.automatedOutboundPerMonth)}</bdi></strong>{ar?" رسالة آلية / شهر":" automated messages / month"}</p>:null}
  {offer?.features.length?<ul className={styles.features}>{offer.features.map(feature=><li key={feature.id}><span className={styles.featureCheck} aria-hidden="true">✓</span><span>{feature.label[locale]}</span><span className={styles.featureState} data-availability={feature.availability}>{c.featureAvailability[feature.availability]}</span></li>)}</ul>:<p className={styles.featureEmpty}>{catalogStatus==="error"?c.catalogError:c.featuresUnavailable}</p>}
  {index>0?<p className={styles.setupNote}>{ar?"قد تُضاف رسوم تأسيس للربط؛ تُراجع وتُعتمد منفصلة قبل التنفيذ.":"Integration may need a setup fee, quoted and approved separately."}</p>:null}
  <button type="button" className={styles.select} aria-label={(selected?c.selected:c.select)+" "+persona[locale]+" / "+c[pack]} aria-pressed={selected} disabled={disabled||catalogStatus!=="ready"||!offer} onClick={()=>{if(offer)onSelect(choiceFromOffer(offer));}}>{selected?(ar?"تم اختيار ":"Selected: ")+persona[locale]:(ar?"اختر ":"Choose ")+persona[locale]}<span aria-hidden="true">{selected?"✓":"↗"}</span></button>
 </article>;})}</div>;
}
export function SubscriptionCompareTable({locale,term,offers,catalogStatus}:{locale:"ar"|"en";term:SubscriptionTerm;offers:readonly SubscriptionOfferView[];catalogStatus?:SubscriptionOffersView["status"];selectedPersona:SubscriptionChoice["persona"]|null}){
 const c=subscriptionCopy[locale];return <details className={styles.comparison}><summary>{c.compare}<span aria-hidden="true">＋</span></summary><p>{catalogStatus==="ready"?c.comparePublishedNote:c.compareNote}</p><div className={styles.comparisonScroll}><table className={styles.comparisonTable}><thead><tr><th scope="col">{c.personaLabel}</th><th scope="col">Basic</th><th scope="col">Premium</th></tr></thead><tbody>{subscriptionTiers.map(persona=><tr key={persona.id}><th scope="row">{persona[locale]}</th>{(["basic","premium"] as const).map(pack=><td key={pack}><bdi>{price(locale,findOffer(offers,persona.id,pack,term))}</bdi></td>)}</tr>)}</tbody></table></div></details>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import type { SubscriptionPersona } from "./subscription-offers-view";
import styles from "./subscription-panel.module.css";
export function SubscriptionBrandGuide({ locale }: { locale:"ar"|"en"; selectedPersona?:SubscriptionPersona|null }) {
 const ar=locale==="ar", video=useRef<HTMLVideoElement>(null), [playing,setPlaying]=useState(false), [failed,setFailed]=useState(false);
 useEffect(()=>{ const media=window.matchMedia("(prefers-reduced-motion: reduce)"); if(!media.matches)void video.current?.play().catch(()=>{}); const stop=()=>{if(media.matches)video.current?.pause();};media.addEventListener("change",stop);return()=>media.removeEventListener("change",stop);},[]);
 return <section className={styles.filmHero} aria-label={ar?"تعرّف على فيلورا":"Meet Velora"}>
   <div className={styles.filmFrame}>
    <video ref={video} className={styles.heroVideo} src="/assets/subscription/velora-intro.mp4" poster="/assets/subscription/velora-intro-poster.jpg" muted loop playsInline preload="metadata" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>setFailed(true)} aria-label={ar?"فيلم تعريفي لشخصيات فيلورا في المكتب":"Velora characters at work in their office"}/>
    <div className={styles.filmShade}/>
    <div className={styles.filmCopy}><span className={styles.filmMark}>Velora</span><h2>{ar?"موظفتك القادمة،\nبطريقتك.":"Your next hire.\nYour way."}</h2><p>{ar?"نور لخدمة العملاء. لينا للمبيعات. دانة للعمليات. اختر المستوى المناسب لشركتك، واترك لفيلورا تفاصيل اليوم.":"Noor for customers. Lina for sales. Dana for operations. Choose the right level for your business and let Velora handle the everyday."}</p><a href="#subscription-plans" className={styles.heroLink}>{ar?"اكتشف الباقات":"Explore the plans"}<span aria-hidden="true">↓</span></a></div>
    {!failed?<button type="button" className={styles.filmControl} onClick={()=>{if(playing)video.current?.pause();else void video.current?.play().catch(()=>{});}} aria-label={playing?(ar?"إيقاف الفيديو مؤقتًا":"Pause video"):(ar?"تشغيل الفيديو":"Play video")}>{playing?"Ⅱ":"▷"}<span>{playing?(ar?"إيقاف":"Pause"):(ar?"تشغيل":"Play")}</span></button>:<span className={styles.filmControl}>{ar?"تعذّر تشغيل الفيديو":"Video unavailable"}</span>}
   </div>
   <div className={styles.filmFooter}><p>{ar?"شخصيات مختلفة. اشتراك واحد يناسب عملك.":"Different personalities. One subscription for your business."}</p><span>{ar?"اختر شخصيتك · حدد مستواك · ابدأ":"Choose your persona · Pick your level · Get started"}</span></div>
 </section>;
}

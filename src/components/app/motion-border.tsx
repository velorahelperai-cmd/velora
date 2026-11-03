"use client";
import {useEffect,useRef,useState,type ReactNode} from 'react';
import styles from './motion-border.module.css';

/** Decorative border: the underlying content remains available without animation. */
export function MotionBorder({children,enabled=true}:{children:ReactNode;enabled?:boolean}) {
 const ref=useRef<HTMLDivElement>(null);
 const [animate,setAnimate]=useState(false);
 useEffect(()=>{
  const element=ref.current;
  if(!enabled || !element || typeof IntersectionObserver==='undefined') return;
  let visible=false;
  const update=()=>setAnimate(visible && document.visibilityState==='visible');
  const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);update();});
  observer.observe(element);
  document.addEventListener('visibilitychange',update);
  return ()=>{observer.disconnect();document.removeEventListener('visibilitychange',update);};
 },[enabled]);
 return <div ref={ref} className={styles.border} data-animate={enabled && animate} data-enabled={enabled}>{children}</div>;
}

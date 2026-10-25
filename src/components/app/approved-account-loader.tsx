"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createApprovedLoaderScene,APPROVED_LOADER_TIMELINE} from './approved-loader-scene';
import styles from './approved-account-loader.module.css';

/** Lifetime belongs to AccountSessionProvider; the reference animation never admits identity. */
export function ApprovedAccountLoader({label,ready=false,onComplete}:{label:string;ready?:boolean;onComplete?:()=>void}){
  const readyRef=useRef(ready),completeRef=useRef(onComplete),resumeRef=useRef(()=>{});
  useLayoutEffect(()=>{readyRef.current=ready;completeRef.current=onComplete;resumeRef.current();},[ready,onComplete]);
  const canvas=useRef<HTMLCanvasElement>(null);
  const [painted,setPainted]=useState(false);
  useEffect(()=>{
    let alive=true,frame=0,resizeFrame=0,pageHidden=false,completed=false,assetUnavailable=false;
    let elapsed=0,lastPaint:number|null=null,dissolveStart:number|null=null;
    let scene:ReturnType<typeof createApprovedLoaderScene>=null;
    const pointer={x:-9999,y:-9999,active:false};
    const resetPointer=()=>{pointer.active=false;scene?.clearPointer();};
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    const cancel=()=>{if(frame)cancelAnimationFrame(frame);frame=0;};
    const finish=()=>{if(!alive||completed||!readyRef.current||document.hidden||pageHidden)return;completed=true;cancel();completeRef.current?.();};
    const draw=(now:number)=>{
      frame=0;if(!alive||completed||document.hidden||pageHidden||!scene)return;
      if(motion.matches){lastPaint=null;}else{if(lastPaint!==null)elapsed+=Math.max(0,now-lastPaint);lastPaint=now;}
      if(!readyRef.current)dissolveStart=null;
      if(!motion.matches&&readyRef.current&&elapsed>APPROVED_LOADER_TIMELINE.holdUntil&&dissolveStart===null)dissolveStart=elapsed;
      const progress=dissolveStart===null?undefined:Math.min(1,(elapsed-dissolveStart)/APPROVED_LOADER_TIMELINE.dissolveDuration);
      try{if(scene.draw(elapsed,now,motion.matches,progress))setPainted(true);else{assetUnavailable=true;setPainted(false);finish();return;}}catch{assetUnavailable=true;setPainted(false);finish();return;}
      if(motion.matches||progress===1){finish();if(completed)return;}
      if(!motion.matches)frame=requestAnimationFrame(draw);
    };
    const resume=()=>{cancel();if(motion.matches)resetPointer();if(!alive||document.hidden||pageHidden)return;if(assetUnavailable){finish();return;}if(scene)draw(performance.now());};
    resumeRef.current=resume;
    const resize=()=>{if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;if(!alive||!scene)return;try{if(!scene.resize()){assetUnavailable=true;setPainted(false);cancel();finish();return;}resume();}catch{assetUnavailable=true;setPainted(false);cancel();finish();}});};
    const visibility=()=>{if(document.hidden){resetPointer();lastPaint=null;cancel();}else resume();};
    const hide=()=>{pageHidden=true;lastPaint=null;resetPointer();cancel();};
    const show=()=>{pageHidden=false;resume();};
    const point=(x:number,y:number)=>{if(motion.matches||document.hidden||pageHidden){resetPointer();return;}pointer.x=x;pointer.y=y;pointer.active=true;scene?.setPointer(x,y);};
    const mouse=(event:MouseEvent)=>point(event.clientX,event.clientY);
    const leave=()=>resetPointer();
    const touch=(event:TouchEvent)=>{const first=event.touches[0];if(first)point(first.clientX,first.clientY);else leave();};
    window.addEventListener('mousemove',mouse);window.addEventListener('mouseleave',leave);
    window.addEventListener('touchmove',touch,{passive:true});window.addEventListener('touchend',leave);window.addEventListener('touchcancel',leave);window.addEventListener('blur',leave);
    const fonts=document.fonts?.load('800 100px "Velora Loader Outfit"');
    if(fonts)void fonts.then(()=>{
      if(!alive||assetUnavailable||!canvas.current)return;
      try{scene=createApprovedLoaderScene(canvas.current);if(scene?.resize()){if(pointer.active)scene.setPointer(pointer.x,pointer.y);resume();}else{assetUnavailable=true;finish();}}catch{assetUnavailable=true;setPainted(false);finish();}
    }).catch(()=>{assetUnavailable=true;finish();});
    else assetUnavailable=true;
    // Font/canvas failure may use the accessible alternative; never hold a READY page indefinitely.
    const assetDeadline=setTimeout(()=>{if(!scene){assetUnavailable=true;resume();}},APPROVED_LOADER_TIMELINE.holdUntil+APPROVED_LOADER_TIMELINE.dissolveDuration);
    if(assetUnavailable)finish();
    motion.addEventListener('change',resume);document.addEventListener('visibilitychange',visibility);
    window.addEventListener('resize',resize);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
    return()=>{alive=false;resumeRef.current=()=>{};clearTimeout(assetDeadline);leave();window.removeEventListener('mousemove',mouse);window.removeEventListener('mouseleave',leave);window.removeEventListener('touchmove',touch);window.removeEventListener('touchend',leave);window.removeEventListener('touchcancel',leave);window.removeEventListener('blur',leave);cancel();if(resizeFrame)cancelAnimationFrame(resizeFrame);motion.removeEventListener('change',resume);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',resize);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);};
  },[]);
  return <main className={styles.root} data-account-loading="true" data-approved-loader="particles" role="status" aria-busy="true" aria-label={label}>
    <canvas ref={canvas} className={styles.canvas} aria-hidden="true" style={{opacity:painted?1:0}}/>
    <span className="sr-only">{label}</span>
    <span className={styles.vignette} aria-hidden="true"/>
  </main>;
}

/** Presentation gate only. The provider keeps sole authority over READY/error/locked states. */
export function useApprovedLoaderGate(pending:boolean,ready:boolean,scope:string){
  const [cycle,setCycle]=useState({scope,active:pending,wasPending:pending,complete:false,token:0});
  // Adjust only when source props change; no effect-driven cascading presentation render.
  let current=cycle;
  const scopeChanged=cycle.scope!==scope;
  const cancelled=!pending&&!ready&&cycle.active;
  if(scopeChanged||cycle.wasPending!==pending||cancelled){
    const restart=scopeChanged||(pending&&!cycle.wasPending)||cancelled;
    current={scope,active:pending||(ready&&!scopeChanged&&cycle.active),wasPending:pending,complete:restart?false:cycle.complete,token:cycle.token+(restart?1:0)};
    setCycle(current);
  }
  const token=current.token;
  const finish=useCallback(()=>{if(!ready)return;setCycle(current=>current.scope===scope&&current.token===token&&current.active&&!current.complete?{...current,complete:true}:current);},[ready,scope,token]);
  return {holding:pending||(ready&&current.scope===scope&&current.active&&!current.complete),finish};
}

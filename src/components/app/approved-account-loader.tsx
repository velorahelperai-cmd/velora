"use client";
import {useEffect,useRef,useState} from 'react';
import {createApprovedLoaderScene} from './approved-loader-scene';
import styles from './approved-account-loader.module.css';

/** Lifetime belongs to AccountSessionProvider; the reference animation never admits identity. */
export function ApprovedAccountLoader({label}:{label:string}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const [painted,setPainted]=useState(false);
  useEffect(()=>{
    let alive=true,frame=0,resizeFrame=0,pageHidden=false;
    let scene:ReturnType<typeof createApprovedLoaderScene>=null;
    const started=performance.now(),motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    const cancel=()=>{if(frame)cancelAnimationFrame(frame);frame=0;};
    const draw=(now:number)=>{
      frame=0;if(!alive||document.hidden||pageHidden||!scene)return;
      try{if(scene.draw(now-started,now,motion.matches))setPainted(true);}catch{setPainted(false);return;}
      if(!motion.matches)frame=requestAnimationFrame(draw);
    };
    const resume=()=>{cancel();if(alive&&!document.hidden&&!pageHidden&&scene)draw(performance.now());};
    const resize=()=>{if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;if(!alive||!scene)return;try{if(!scene.resize()){setPainted(false);cancel();return;}resume();}catch{setPainted(false);cancel();}});};
    const visibility=()=>{if(document.hidden)cancel();else resume();};
    const hide=()=>{pageHidden=true;cancel();};
    const show=()=>{pageHidden=false;resume();};
    const fonts=document.fonts?.load('800 100px "Velora Loader Outfit"');
    if(fonts)void fonts.then(()=>{
      if(!alive||!canvas.current)return;
      try{scene=createApprovedLoaderScene(canvas.current);if(scene?.resize())resume();}catch{setPainted(false);}
    }).catch(()=>{});
    motion.addEventListener('change',resume);document.addEventListener('visibilitychange',visibility);
    window.addEventListener('resize',resize);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
    return()=>{alive=false;cancel();if(resizeFrame)cancelAnimationFrame(resizeFrame);motion.removeEventListener('change',resume);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',resize);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);};
  },[]);
  return <main className={styles.root} data-account-loading="true" data-approved-loader="particles" role="status" aria-busy="true" aria-label={label}>
    <canvas ref={canvas} className={styles.canvas} aria-hidden="true" style={{opacity:painted?1:0}}/>
    {!painted&&<span className={styles.fallback} aria-hidden="true">Velora</span>}
    <span className={styles.vignette} aria-hidden="true"/>
  </main>;
}

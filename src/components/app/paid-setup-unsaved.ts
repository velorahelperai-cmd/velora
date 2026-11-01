"use client";
import {useEffect} from 'react';
const message=(locale:'ar'|'en')=>locale==='ar'?'لديك تعديلات لم يؤكد الخادم حفظها. هل تريد المغادرة وفقدها؟':'You have changes the server has not confirmed as saved. Leave and discard them?';
type FlushHost=HTMLElement&{__veloraFlush?:()=>Promise<void>};
function isFlushableUnsaved(el:Element):boolean{
 const host=el as FlushHost;
 return typeof host.__veloraFlush==='function'||el.hasAttribute('data-setup-flush');
}
/** Ask mounted setup editors to persist drafts. Callers may fire-and-forget so navigation stays instant. */
export async function flushSetupDrafts(root:Element|null):Promise<void>{
 const nodes=Array.from(root?.querySelectorAll<FlushHost>('[data-setup-flush]')??[]);
 await Promise.all(nodes.map(node=>node.__veloraFlush?node.__veloraFlush():Promise.resolve()));
}
/** Blocks only non-flushable drafts. Flushable editors save in the background on leave. */
export function confirmSetupLeave(root:Element|null,locale:'ar'|'en'):boolean{
 const unsaved=Array.from(root?.querySelectorAll('[data-setup-unsaved="true"]')??[]);
 const blocking=unsaved.filter(el=>!isFlushableUnsaved(el));
 return blocking.length===0||window.confirm(message(locale));
}
/** Local draft protection only; never derives persistence or completion. */
export function useSetupUnsavedChanges(dirty:boolean,isCurrent:()=>boolean,locale:'ar'|'en'='en'){
 useEffect(()=>{
  if(!dirty)return;
  let approvedUnload=false,timer:ReturnType<typeof setTimeout>|undefined;
  const unload=(event:BeforeUnloadEvent)=>{if(isCurrent()&&!approvedUnload){event.preventDefault();event.returnValue='';}};
  const traverse=(event:Event)=>{const navigation=event as Event&{navigationType?:string};if(navigation.navigationType==='traverse'&&event.cancelable&&isCurrent()&&!window.confirm(message(locale)))event.preventDefault();};
  const navigation=(window as Window&{navigation?:EventTarget}).navigation;
  const navigate=(event:MouseEvent)=>{
   if(!isCurrent()||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
   const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
   if(!anchor||anchor.hasAttribute('download')||(anchor.target&&anchor.target!=='_self'))return;
   const url=new URL(anchor.href,window.location.href);
   if(url.pathname===location.pathname&&url.search===location.search&&url.origin===location.origin)return;
   if(!window.confirm(message(locale))){event.preventDefault();event.stopImmediatePropagation();return;}
   approvedUnload=true;timer=setTimeout(()=>{approvedUnload=false;},0);
  };
  window.addEventListener('beforeunload',unload);document.addEventListener('click',navigate,true);navigation?.addEventListener('navigate',traverse);
  return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',navigate,true);navigation?.removeEventListener('navigate',traverse);if(timer)clearTimeout(timer);};
 },[dirty,isCurrent,locale]);
}

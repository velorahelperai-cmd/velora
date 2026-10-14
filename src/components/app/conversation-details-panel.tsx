'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {Button} from './ui';
/** Desktop companion / independent mobile details panel. Facts come from native readers. */
export function ConversationDetailsPanel({id,title,open,onClose,children}:{id:string;title:string;open:boolean;onClose():void;children:ReactNode}){
 const ref=useRef<HTMLElement>(null);
 const close=useRef(onClose);
 useEffect(()=>{close.current=onClose;},[onClose]);
 useEffect(()=>{
  if(!open)return;
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';ref.current?.querySelector<HTMLElement>('button')?.focus();
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){close.current();return;}if(e.key!=='Tab')return;
   const nodes=[...ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')??[]].filter(n=>n.getClientRects().length);
   const first=nodes[0],last=nodes.at(-1);if(!first||!last)return;
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  };
  const resized=()=>{if(window.innerWidth>=1536)close.current();};document.addEventListener('keydown',key);window.addEventListener('resize',resized);
  return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);window.removeEventListener('resize',resized);previous?.focus();};
 },[open]);
 return <aside id={id} ref={ref} className="conversation-details-panel" data-details-open={open} role={open?'dialog':undefined} aria-modal={open?true:undefined} aria-label={title}>
  <header><h2>{title}</h2><Button variant="ghost" onClick={onClose} aria-label="Close">×</Button></header>{children}
 </aside>;
}

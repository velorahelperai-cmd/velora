"use client";
import {useEffect,useId,useRef,useState} from 'react';
import styles from './paid-assistant-checklist.module.css';
type Props={locale:'ar'|'en';branches:readonly {id:string;label:string}[];selectedId:string|null|undefined;status:string;ready:boolean;isCurrent:()=>boolean;onSelect:(id:string,root:Element)=>boolean};
export function SetupBranchPicker(p:Props){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLUListElement>(null),id=useId();
 const ar=p.locale==='ar',selected=p.branches.find(branch=>branch.id===p.selectedId);
 useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();if(!selected)menu.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>document.removeEventListener('pointerdown',outside);},[open,selected]);
 const close=()=>{setOpen(false);trigger.current?.focus();};
 return <div ref={root} className={styles.branchPicker} onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();close();}if(event.key==='Tab')setOpen(false);}}>
  <button ref={trigger} type="button" className={styles.selector} aria-label={ar?'اختيار الفرع':'Choose branch'} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} disabled={!p.branches.length} onClick={()=>{if(p.isCurrent())setOpen(value=>!value);}} onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)&&p.isCurrent()){event.preventDefault();setOpen(true);}}}>
   <span className={styles.branchIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 21V5h10v16M14 10h6v11M2 21h20M8 9h2M8 13h2M8 17h2M17 14h1M17 17h1"/></svg></span>
   <span className={styles.branchControl}><span className={styles.branchLabel}>{ar?'الفرع الذي تجهّزه':'Branch you’re setting up'}</span><span className={styles.branchValue} dir="auto">{selected?.label??(ar?'اختر الفرع':'Choose branch')}</span></span>
   <span className={styles.branchStatus} data-ready={p.ready}>{p.status}</span><svg className={styles.pickerChevron} data-open={open} aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m5 8 5 5 5-5"/></svg>
  </button>
  {open&&<ul ref={menu} id={id} role="listbox" aria-label={ar?'فروع النشاط':'Business branches'} className={styles.branchMenu} onKeyDown={event=>{const options=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')??[]),index=options.indexOf(document.activeElement as HTMLButtonElement);let next:number|undefined;if(event.key==='ArrowDown')next=(index+1)%options.length;if(event.key==='ArrowUp')next=(index-1+options.length)%options.length;if(event.key==='Home')next=0;if(event.key==='End')next=options.length-1;if(next!==undefined){event.preventDefault();options[next]?.focus();}}}>
   {p.branches.map(branch=><li key={branch.id} role="presentation"><button type="button" role="option" aria-selected={branch.id===p.selectedId} onClick={()=>{if(p.isCurrent()&&root.current&&p.onSelect(branch.id,root.current))close();}}><span className={styles.optionIcon} aria-hidden="true">▥</span><span className={styles.optionText}><strong dir="auto">{branch.label}</strong>{branch.id===p.selectedId&&<small>{p.status}</small>}</span><span className={styles.optionCheck} aria-hidden="true">{branch.id===p.selectedId?'✓':''}</span></button></li>)}
  </ul>}
 </div>;
}

'use client';
import type {ReactNode} from 'react';
import './conversation-workspace.css';

export type ComposerMode = 'message' | 'note' | 'ai';
export function ComposerTabs({mode,onChange,ar,notes=true,ai=true,id}:{mode:ComposerMode;onChange(mode:ComposerMode):void;ar:boolean;notes?:boolean;ai?:boolean;id:string}) {
 const tabs: {value:ComposerMode;label:string;icon:string}[] = [
  {value:'message',label:ar?'رسالة':'Message',icon:'M4 4h16v12H9l-5 4z'},
  ...(ai?[{value:'ai' as const,label:ar?'مساعدة AI':'AI assistance',icon:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'}]:[]),
  ...(notes?[{value:'note' as const,label:ar?'ملاحظة داخلية':'Internal note',icon:'M6 3h12v18H6z M9 8h6 M9 12h6 M9 16h4'}]:[]),
 ];
 return <div className="conversation-composer-tabs" role="tablist" aria-label={ar?'نوع الكتابة':'Composer mode'}>{tabs.map((tab,index)=><button key={tab.value} type="button" role="tab" id={`${id}-tab-${tab.value}`} aria-controls={`${id}-panel-${tab.value}`} aria-selected={mode===tab.value} tabIndex={mode===tab.value?0:-1} onClick={()=>onChange(tab.value)} onKeyDown={event=>{
  let next:number|undefined;
  if(event.key==='Home')next=0;
  if(event.key==='End')next=tabs.length-1;
  if(event.key==='ArrowRight')next=(index+(ar?-1:1)+tabs.length)%tabs.length;
  if(event.key==='ArrowLeft')next=(index+(ar?1:-1)+tabs.length)%tabs.length;
  if(next!==undefined){event.preventDefault();onChange(tabs[next].value);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();}
 }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={tab.icon} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"/></svg>{tab.label}</button>)}</div>;
}
export function DetailSection({title,children,action}:{title:string;children:ReactNode;action?:ReactNode}) {
 return <section className="conversation-detail-section"><div className="conversation-detail-heading"><h3>{title}</h3>{action}</div>{children}</section>;
}
export function DetailRow({label,children}:{label:string;children:ReactNode}) {
 return <div className="conversation-detail-row"><dt>{label}</dt><dd dir="auto">{children}</dd></div>;
}

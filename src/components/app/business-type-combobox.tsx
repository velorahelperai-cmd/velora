'use client';
import {useEffect,useRef,useState,type KeyboardEvent} from 'react';
import {businessTypeGroups,businessTypeLabel,customBusinessType,findBusinessTypes} from '@/lib/business-types';
import styles from './business-type-combobox.module.css';
type Props={id:string;value:string;ar:boolean;disabled?:boolean;onChange:(value:string)=>void};
export function BusinessTypeCombobox({id,value,ar,disabled=false,onChange}:Props){
 const [query,setQuery]=useState<string|null>(null),[active,setActive]=useState(-1),input=useRef<HTMLInputElement>(null),activeOption=useRef<HTMLButtonElement>(null);
 const open=query!==null&&!disabled,results=findBusinessTypes(query??''),custom=query?customBusinessType(query):null,listId=`${id}-options`;
 const choices=[...results.map(option=>({value:option.id,label:option[ar?'ar':'en'],secondary:option[ar?'en':'ar'],group:option.group})),...(custom?[{value:custom,label:ar?`استخدام «${custom}» كنشاط آخر`:`Use “${custom}” as another business type`,secondary:'',group:'custom'}]:[])];
 useEffect(()=>{if(open)activeOption.current?.scrollIntoView({block:'nearest'});},[open,active,query]);
 function close(){setQuery(null);setActive(-1);}
 function choose(next:string){if(disabled)return;onChange(next);close();input.current?.focus();}
 function show(){if(disabled)return;setQuery('');setActive(-1);}
 function keyDown(event:KeyboardEvent<HTMLInputElement>){
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   if((event.key==='Home'||event.key==='End')&&!open)return;
   event.preventDefault();if(!open){show();setActive(event.key==='ArrowUp'?choices.length-1:0);return;}
   setActive(index=>event.key==='Home'?0:event.key==='End'?choices.length-1:Math.max(0,Math.min(choices.length-1,index+(event.key==='ArrowDown'?1:-1))));
  }else if(event.key==='Enter'&&open){event.preventDefault();if(choices[active])choose(choices[active].value);}
  else if(event.key==='Escape'&&open){event.preventDefault();close();}else if(event.key==='Tab')close();
 }
 const selected=value==='store'?'retail':value;
 return <div className={styles.root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))close();}}>
  <input type="hidden" name="businessType" value={value}/>
  <div className={styles.control}><input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open?listId:undefined} aria-activedescendant={open&&choices[active]?`${id}-option-${active}`:undefined} aria-required="true" autoComplete="off" spellCheck={false} maxLength={80} disabled={disabled} data-setup-entry-control="" value={open?query??'':businessTypeLabel(value,ar)} placeholder={ar?'ابحث عن نوع نشاطك أو اكتب نوعًا آخر':'Search business types or enter another type'} onFocus={show} onChange={event=>{setQuery(event.target.value);setActive(0);}} onKeyDown={keyDown}/>
   <button type="button" tabIndex={-1} disabled={disabled} aria-label={ar?'فتح قائمة الأنشطة':'Open business types'} onPointerDown={event=>event.preventDefault()} onClick={()=>{if(open)close();else{show();input.current?.focus();}}}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg></button></div>
  {open?<div className={styles.popup}><div id={listId} role="listbox" aria-label={ar?'أنواع الأنشطة':'Business types'} className={styles.options}>
   {choices.map((option,index)=>{const group=businessTypeGroups.find(item=>item.id===option.group);return <div key={`${option.group}:${option.value}`}>
    {index===0||choices[index-1].group!==option.group?<p className={styles.group} role="presentation">{group?.[ar?'ar':'en']??(ar?'نوع مخصص':'Custom type')}</p>:null}
    <button type="button" role="option" id={`${id}-option-${index}`} tabIndex={-1} aria-selected={option.value===selected} data-active={index===active||undefined} ref={index===active?activeOption:undefined} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(option.value)}><span>{option.label}</span>{option.secondary?<span className={styles.secondary} lang={ar?'en':'ar'} dir={ar?'ltr':'rtl'}>{option.secondary}</span>:null}</button>
   </div>;})}</div>{!choices.length?<p role="status" className={styles.empty}>{ar?'لا توجد نتائج. جرّب اسمًا آخر بالعربية أو الإنجليزية.':'No matches. Try another Arabic or English name.'}</p>:null}</div>:null}
 </div>;
}

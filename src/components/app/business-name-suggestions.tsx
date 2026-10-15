'use client';
import {useId,useState,type KeyboardEvent} from 'react';
import {businessNameSuggestions} from '@/lib/field-suggestions';
import styles from './business-name-suggestions.module.css';
type Props={id:string;value:string;onChange:(value:string)=>void;disabled?:boolean;placeholder?:string;userId?:string|null;isCurrent?:()=>boolean;ar:boolean};
export function BusinessNameSuggestions({id,value,onChange,disabled,placeholder,userId,isCurrent,ar}:Props){
 const listId=useId(),[entries,setEntries]=useState<string[]>([]),[owner,setOwner]=useState<string|null>(null),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 const allowed=!!userId&&!!isCurrent?.(),items=allowed&&owner===userId?entries.filter(item=>item.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase())):[];
 const expanded=open&&items.length>0&&!disabled;
 function choose(item:string){if(!userId||!isCurrent?.()||owner!==userId)return;onChange(item);setOpen(false);setActive(-1);}
 function key(event:KeyboardEvent<HTMLInputElement>){if(event.key==='Escape'){setOpen(false);setActive(-1);return;}if(!items.length)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActive(i=>event.key==='ArrowDown'?(i+1)%items.length:(i<=0?items.length:i)-1);}
  if(event.key==='Enter'&&expanded&&active>=0){event.preventDefault();choose(items[active]);}
 }
 return <div className={styles.wrap}>
  <input data-setup-entry-control="" id={id} name="businessName" maxLength={120} aria-required="true" disabled={disabled} value={value} placeholder={placeholder}
   role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded?listId:undefined} aria-activedescendant={expanded&&active>=0?`${listId}-${active}`:undefined} autoComplete="off"
   onFocus={()=>{setOwner(userId??null);try{setEntries(userId&&isCurrent?.()?businessNameSuggestions(window.localStorage,userId):[]);}catch{setEntries([]);}setOpen(true);setActive(-1);}}
   onBlur={()=>{setOpen(false);setActive(-1);}} onKeyDown={key} onChange={e=>{onChange(e.target.value);setOpen(true);setActive(-1);}}/>
  {expanded?<ul id={listId} role="listbox" aria-label={ar?'أسماء استخدمتها في هذا الحساب':'Names used in this account'} className={styles.list}>{items.map((item,index)=><li id={`${listId}-${index}`} key={item} role="option" aria-selected={index===active} onPointerDown={e=>e.preventDefault()} onClick={()=>choose(item)}>{item}</li>)}</ul>:null}
 </div>;
}

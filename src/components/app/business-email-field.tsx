'use client';
import {useState} from 'react';
import {normalizeBusinessEmail} from '@/lib/tenancy/business-contacts';
import styles from './business-contact-fields.module.css';
type Props={id:string;label:string;value:string;suggestedEmail:string;ar:boolean;onChange:(value:string)=>void;isCurrent:()=>boolean};
export function BusinessEmailField({id,label,value,suggestedEmail,ar,onChange,isCurrent}:Props){
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState<string|null>(null),[error,setError]=useState(false),current=isCurrent(),chip=current&&!editing&&Boolean(value)&&value===suggestedEmail;
 function commit(){if(!isCurrent()||draft===null)return;const email=normalizeBusinessEmail(draft);if(email===null){setError(true);return;}setError(false);setDraft(null);if(email!==value)onChange(email);}
 return <div className={styles.email} data-setup-contact="email" role="group" aria-labelledby={`${id}-label`}><label id={`${id}-label`} htmlFor={chip?undefined:id}>{label}</label>
  {chip?<div className={styles.chip}><span dir="ltr">{value}</span><button type="button" className={styles.remove} aria-label={ar?'إزالة بريد النشاط المقترح':'Remove suggested business email'} onClick={()=>{if(!isCurrent())return;setEditing(true);setDraft('');setError(false);onChange('');}}>×</button></div>:<input id={id} type="email" inputMode="email" autoComplete="email" dir="ltr" maxLength={254} disabled={!current} autoFocus={editing&&current} value={current?(draft??value):''} placeholder="business@example.com" aria-describedby={`${id}-hint${error?` ${id}-error`:''}`} aria-invalid={error} onChange={event=>{if(isCurrent()){setDraft(event.target.value);setError(false);}}} onBlur={commit}/>}
  <p id={`${id}-hint`} className={styles.hint}>{ar?'بريد تواصل النشاط فقط؛ لا يغيّر بريد تسجيل الدخول.':'Business contact only; this does not change your sign-in email.'}</p>{error?<p id={`${id}-error`} role="alert" className={styles.error}>{ar?'اكتب بريدًا صحيحًا مثل business@example.com.':'Enter a valid email, such as business@example.com.'}</p>:null}
 </div>;
}

'use client';
import {useRef,useState} from 'react';
import {maskedPhoneExample,parseBusinessPhoneInput,phoneCallingCode,phoneCountryFromValue,storedPhoneDisplay,supportedPhoneCountry} from '@/lib/business-phone-input';
import {CountryCombobox} from './country-combobox';
import styles from './business-contact-fields.module.css';
type Props={id:string;label:string;value:string;businessCountry:string;ar:boolean;onChange:(value:string)=>void;isCurrent?:()=>boolean;groupLabel?:boolean};
export function BusinessPhoneField({id,label,value,businessCountry,ar,onChange,isCurrent=()=>true,groupLabel=false}:Props){
 const [pickedCountry,setCountry]=useState<ReturnType<typeof phoneCountryFromValue>|null>(null),[draft,setDraft]=useState<string|null>(null),[error,setError]=useState<string|null>(null),dirty=useRef(false),input=useRef<HTMLInputElement>(null);
 // Derive the default from current props until an explicit selection/paste.
 const country=pickedCountry??phoneCountryFromValue(value,businessCountry);
 const current=isCurrent(),display=current?(draft??storedPhoneDisplay(value,country)):'',example=maskedPhoneExample(country);
 function message(code:string){return code==='COUNTRY_REQUIRED'?(ar?'اختر دولة الرقم أو ألصقه بصيغته الدولية.':'Choose the phone country or paste an international number.'):code==='COUNTRY_MISMATCH'?(ar?'الرقم لا يطابق الدولة المختارة. راجع الدولة أو أدخل الرقم كاملًا مع مفتاحه.':'This number does not match the selected country. Check it or paste the full international number.'):(ar?'راجع رقم الهاتف ومفتاح الدولة.':'Check the phone number and country calling code.');}
 function edit(raw:string){if(!isCurrent())return;dirty.current=true;const parsed=parseBusinessPhoneInput(raw,country);if(raw.trim().startsWith('+')&&parsed.ok&&parsed.value){setCountry(parsed.country);setDraft(parsed.display);}else setDraft(raw);setError(null);input.current?.setCustomValidity(parsed.ok?'':message(parsed.code));}
 function commit(){if(!isCurrent()||!dirty.current)return;const parsed=parseBusinessPhoneInput(draft??display,country);if(!parsed.ok){setError(message(parsed.code));input.current?.setCustomValidity(message(parsed.code));return;}dirty.current=false;setError(null);setDraft(null);setCountry(parsed.country);input.current?.setCustomValidity('');if(parsed.value!==value)onChange(parsed.value);}
 return <div className={styles.phone} dir={ar?'rtl':'ltr'} data-setup-contact="phone">{groupLabel?<label id={`${id}-label`} htmlFor={id}>{label}</label>:null}<div className={styles.row}>
  <div className={styles.countryPicker}><label htmlFor={`${id}-country`}>{ar?'دولة الرقم ومفتاحه':'Phone country and code'}</label><CountryCombobox compactOptions={groupLabel} id={`${id}-country`} value={country??''} ar={ar} disabled={!current} required={Boolean(display.trim())} inputLabel={ar?'دولة رقم الهاتف':'Phone country'} allowCountry={supportedPhoneCountry} labelSuffix={phoneCallingCode} onChange={code=>{if(!isCurrent()||!supportedPhoneCountry(code))return;dirty.current=true;setDraft(draft??storedPhoneDisplay(value,country));setCountry(code);setError(null);queueMicrotask(()=>{if(isCurrent())input.current?.focus();});}}/></div>
  <div className={styles.numberField}>{!groupLabel?<label htmlFor={id}>{label}</label>:null}<input ref={input} id={id} type="tel" inputMode="tel" dir="ltr" autoComplete="tel-national" maxLength={40} disabled={!current} value={display} placeholder={example.national} aria-describedby={error?`${id}-error`:undefined} aria-invalid={Boolean(error)} onChange={event=>edit(event.target.value)} onBlur={commit}/></div>
 </div>{error?<p id={`${id}-error`} role="alert" className={styles.error}>{error}</p>:null}</div>;
}

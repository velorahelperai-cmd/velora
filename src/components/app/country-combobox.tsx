'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { countries, countryLabel, findCountries, type CountryOption } from './country-options';
import styles from './country-combobox.module.css';

export function CountryCombobox({ id, value, ar, disabled, onChange, labelSuffix, allowCountry, inputLabel, required=true, compactOptions=false }: {
  id: string; value: string; ar: boolean; disabled: boolean; onChange: (code: string) => void;
  labelSuffix?: (code:string)=>string; allowCountry?: (code:string)=>boolean; inputLabel?:string; required?:boolean; compactOptions?:boolean;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLButtonElement | null>(null);
  const open = query !== null && !disabled;
  const find=(text:string)=>{const dial=text.trim().replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));const dialMatches=labelSuffix&&/^\+?\d+$/.test(dial)?countries.filter(country=>labelSuffix(country.code).replace('+','').startsWith(dial.replace('+',''))):[];return [...new Map([...findCountries(text,ar),...dialMatches].map(country=>[country.code,country])).values()].filter(country=>!allowCountry||allowCountry(country.code));};
  const results = find(query ?? '');
  const listId = `${id}-options`;
  useEffect(() => { if (open) activeOption.current?.scrollIntoView({ block: 'nearest' }); }, [open, active, query]);
  function close() { setQuery(null); setActive(-1); }
  function show() {
    if (disabled) return;
    setQuery('');
    setActive(find('').findIndex(country => country.code === value.trim().toUpperCase()));
  }
  function choose(country: CountryOption) {
    if (disabled) return;
    onChange(country.code);
    close();
    input.current?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setQuery(''); setActive(0); return; }
      setActive(index => Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (results[active]) choose(results[active]);
    } else if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
    else if (event.key === 'Tab') close();
  }
  return <div className={styles.country} data-compact-options={compactOptions ? "true" : undefined} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <input type="hidden" name="country" value={value} />
    <div className={styles.control}>
      <input ref={input} id={id} data-setup-entry-control="" role="combobox" aria-autocomplete="list" aria-expanded={open}
        aria-controls={open ? listId : undefined} aria-activedescendant={open && results[active] ? `${id}-option-${results[active].code}` : undefined}
        aria-required={required||undefined} aria-label={inputLabel} autoComplete="off" spellCheck={false} disabled={disabled}
        value={open ? query ?? '' : countryLabel(value, ar)+(labelSuffix&&labelSuffix(value)?` \u2066${labelSuffix(value)}\u2069`:'')} placeholder={ar ? 'اختر الدولة أو ابحث عنها' : 'Choose or search for a country'}
        onFocus={show} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={keyDown} />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label={ar ? 'فتح قائمة الدول' : 'Open country list'}
        onPointerDown={event => event.preventDefault()} onClick={() => { if (open) close(); else { show(); input.current?.focus(); } }}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
    {open ? <div className={styles.popup}>
      <div id={listId} role="listbox" aria-label={ar ? 'الدول' : 'Countries'} className={styles.options}>
        {results.map((country, index) => <button key={country.code} type="button" role="option" tabIndex={-1}
          id={`${id}-option-${country.code}`} aria-selected={country.code === value.trim().toUpperCase()} data-active={index === active || undefined}
          ref={index === active ? activeOption : undefined} onPointerDown={event => event.preventDefault()} onClick={() => choose(country)}>
          <span className={styles.primary}><span className={styles.optionName} title={country[ar ? 'ar' : 'en']}>{country[ar ? 'ar' : 'en']}</span>{labelSuffix?<bdi dir="ltr"> {labelSuffix(country.code)}</bdi>:null}</span><span className={styles.secondary} lang={ar ? 'en' : 'ar'} dir={ar ? 'ltr' : 'rtl'}>{country[ar ? 'en' : 'ar']}</span>
        </button>)}
      </div>
      {!results.length ? <p role="status" className={styles.empty}>{ar ? 'لا توجد دولة بهذا الاسم. جرّب البحث بالعربية أو الإنجليزية.' : 'No matching country. Try an Arabic or English name.'}</p> : null}
    </div> : null}
  </div>;
}

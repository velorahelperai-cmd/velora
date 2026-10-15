'use client';

import { useId, type FormEvent } from 'react';
import styles from './setup-entry.module.css';
import { CountryCombobox } from './country-combobox';
import { SetupEmployee } from './setup-employee';
import {BusinessNameSuggestions} from './business-name-suggestions';

type Fields = { name: string; type: string; country: string };
export type SetupEntryProps = {
  ar: boolean;
  fields: Fields;
  ready: boolean;
  busy: boolean;
  pending: boolean;
  error: string | null;
  suggestionUserId?: string|null;
  suggestionIsCurrent?: () => boolean;
  onChange: (key: keyof Fields, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

const businessTypes = [
  ['other', 'أخرى', 'Other'], ['retail', 'متجر', 'Store'],
  ['restaurant', 'مطعم', 'Restaurant'], ['clinic', 'عيادة', 'Clinic'],
  ['services', 'خدمات', 'Services'],
] as const;

/** Presentation only. Creation authority, persistence and receipt recovery stay with the caller. */
export function SetupEntry({ ar, fields, ready, busy, pending, error, onChange, onSubmit, suggestionUserId, suggestionIsCurrent }: SetupEntryProps) {
  const id = useId();
  const locked = pending || !ready;
  const canCreate = ready && Boolean(fields.name.trim()) && !busy;


  return (
    <section className={styles.entry} dir={ar ? 'rtl' : 'ltr'} aria-labelledby={`${id}-heading`}>
      <ol className={styles.nextSteps} aria-label={ar ? "خطوات التجهيز" : "Setup steps"}>
            <li aria-current="step"><span aria-hidden="true">1</span><div><strong>{ar ? 'عرّف نشاطك' : 'Introduce your business'}</strong><p>{ar ? 'الاسم والنوع والدولة' : 'Name, type and country'}</p></div></li>
            <li><span aria-hidden="true">2</span><div><strong>{ar ? 'أضف تفاصيلك' : 'Add your details'}</strong><p>{ar ? 'الخدمات والمعلومات التي تعتمد عليها الردود' : 'Services and information for approved replies'}</p></div></li>
            <li><span aria-hidden="true">3</span><div><strong>{ar ? 'راجع قبل التفعيل' : 'Review before activation'}</strong><p>{ar ? 'أكمل متطلبات التجهيز وربط القنوات' : 'Complete setup and channel requirements'}</p></div></li>
          </ol>
      <div className={styles.formColumn}>
        <div className={styles.intro}>
          <h2 id={`${id}-heading`}>{ar ? 'عرّفنا بنشاطك' : 'Tell us about your business'}</h2>
          <p id={`${id}-intro`}>{ar ? 'ثلاث معلومات نبدأ بها. أكمل التفاصيل بعد إنشاء النشاط.' : 'Start with three details. Add the rest after creating your business.'}</p>
        </div>

        <form onSubmit={onSubmit} className={styles.form} noValidate aria-describedby={`${id}-intro`}>
          <div className={styles.field}>
            <label htmlFor={`${id}-name`}>
              <span>{ar ? 'اسم النشاط' : 'Business name'}</span>
              <span className={styles.required} aria-hidden="true">{ar ? 'مطلوب' : 'Required'}</span>
            </label>
            <BusinessNameSuggestions ar={ar} userId={suggestionUserId} isCurrent={suggestionIsCurrent} id={`${id}-name`} value={fields.name}
              disabled={locked}
              placeholder={ar ? 'مثال: متجر الندى' : 'For example, Al Nada Store'}
              onChange={value => onChange('name', value)} />
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label htmlFor={`${id}-type`}><span>{ar ? 'نوع النشاط' : 'Business type'}</span><span className={styles.required} aria-hidden="true">{ar ? 'مطلوب' : 'Required'}</span></label>
              <div className={styles.selectWrap}>
                <select data-setup-entry-control="" id={`${id}-type`} name="businessType" value={fields.type} aria-required="true"
                  disabled={locked} onChange={event => onChange('type', event.target.value)}>
                  {businessTypes.map(([value, arabic, english]) => <option key={value} value={value}>{ar ? arabic : english}</option>)}
                </select>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
            </div>
            <div className={styles.field}>
              <label htmlFor={`${id}-country`}><span>{ar ? 'الدولة' : 'Country'}</span><span className={styles.required} aria-hidden="true">{ar ? 'مطلوب' : 'Required'}</span></label>
              <CountryCombobox id={`${id}-country`} value={fields.country} ar={ar} disabled={locked} onChange={code => onChange('country', code)} />
            </div>
          </div>

          {error ? <div className={styles.error} role="alert"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" /><path d="M12 7v6m0 3v.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><p>{error}</p></div> : null}

          <div className={styles.actions}>
            <button type="submit" className={styles.submit} disabled={!canCreate} aria-busy={busy || undefined}
              aria-describedby={!fields.name.trim() || !ready ? `${id}-create-hint` : undefined}>
              {busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
              <span>{busy ? (ar ? 'جارٍ إنشاء نشاطك…' : 'Creating your business…') : pending ? (ar ? 'استعادة نتيجة الإنشاء' : 'Recover creation result') : (ar ? 'إنشاء ومتابعة التجهيز' : 'Create and continue setup')}</span>
              {!busy ? <svg className={styles.forward} aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
            </button>
            {!fields.name.trim() || !ready ? <p id={`${id}-create-hint`} className={styles.hint}>{!ready ? (ar ? 'انتظر تأكيد حسابك قبل المتابعة.' : 'Wait for your account to be confirmed before continuing.') : (ar ? 'اكتب اسم النشاط للمتابعة.' : 'Enter a business name to continue.')}</p> : null}
            <p className={styles.reassurance}>{ar ? 'إنشاء النشاط لا يفعّل الردود أو يربط أي قناة تلقائيًا.' : 'Creating a business does not activate replies or connect a channel automatically.'}</p>
          </div>
        </form>
      </div>

      <aside className={styles.guide} aria-labelledby={`${id}-guide-heading`}>
        <div className={styles.guideIntro}>
          <span className={styles.guideMark} aria-hidden="true">V</span>
          <p>{ar ? 'موظفتك الرقمية في Velora' : 'Your digital employee at Velora'}</p>
        </div>
        <div className={styles.employee}>
          <SetupEmployee ar={ar} />
        </div>
        <div className={styles.guideBody}>
          <h3 id={`${id}-guide-heading`}>{ar ? 'أكمل التجهيز خطوة بخطوة' : 'Complete setup step by step'}</h3>
          <p id={`${id}-video-description`}>{ar ? 'أضف خدماتك ومعلومات نشاطك في الخطوات التالية لتجهيز الردود.' : 'Add your services and business information in the next steps to prepare replies.'}</p>

        </div>
      </aside>
    </section>
  );
}

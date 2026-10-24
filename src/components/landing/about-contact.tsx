"use client";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { LandingCopy, PlanId, SectorId } from "@/lib/landing-copy";
import { approvedLowerCopy } from "./approved-lower-copy";
import styles from "./approved-sections.module.css";

export function AboutContact({ copy, locale, sector, plan, question, onSector, onQuestion }: {
  copy: LandingCopy; locale: "ar" | "en"; sector: SectorId; plan: PlanId | null; question: string;
  onSector: (sector: SectorId) => void; onQuestion: (value: string) => void;
}) {
  const t = approvedLowerCopy[locale], id = useId();
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<{ locale: string; text: string; manual?: string } | null>(null);
  const [invalidLocale, setInvalidLocale] = useState<string | null>(null);
  const [pendingLocale, setPendingLocale] = useState<string | null>(null);
  const [stateLocale, setStateLocale] = useState(locale);
  if (stateLocale !== locale) { setStateLocale(locale); setPendingLocale(null); setNotice(null); setInvalidLocale(null); }
  const epoch = useRef(0), busy = useRef(false), lastMail = useRef(0), message = useRef<HTMLTextAreaElement>(null), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => () => { epoch.current++; busy.current = false; }, [locale]);
  const planName = copy.plans.find(item => item.id === plan)?.name ?? copy.nonePlan;
  const sectorName = copy.sectors.find(item => item.id === sector)?.label ?? "";
  const shown = notice?.locale === locale ? notice : null, invalid = invalidLocale === locale;
  function invalidate() { epoch.current++; busy.current = false; setNotice(null); setPendingLocale(null); setInvalidLocale(null); }
  function draft() {
    const value = question.trim();
    if (value.length < 10 || value.length > 1500) { setInvalidLocale(locale); message.current?.focus(); return null; }
    setInvalidLocale(null);
    return [copy.mailSubject, copy.businessName + ": " + (name.trim() || "-"), copy.sectorField + ": " + sectorName, copy.planField + ": " + planName, copy.questionField + ": " + value].join("\n");
  }
  async function copyDraft() {
    if (busy.current) return;
    const value = draft(); if (value === null) return;
    const token = ++epoch.current; busy.current = true; setPendingLocale(locale); setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      if (token === epoch.current) setNotice({ locale, text: t.copied });
    } catch {
      if (token === epoch.current) setNotice({ locale, text: t.failed, manual: value });
    } finally {
      if (token === epoch.current) { busy.current = false; setPendingLocale(null); }
    }
  }
  function openEmail() {
    const value = draft(); if (value === null || Date.now() - lastMail.current < 1500) return;
    lastMail.current = Date.now(); setNotice({ locale, text: t.opened, manual: value });
    window.location.href = "mailto:" + copy.contactEmail + "?subject=" + encodeURIComponent(copy.mailSubject) + "&body=" + encodeURIComponent(value);
  }
  return <div className={styles.lower} dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
    <section className="contact-shell" id="contact"><div className="wrap"><div className="contact-grid">
      <div className="contact-intro"><p className="eyebrow">{t.contactEyebrow}</p>
        <h2>{t.contactTitle.split("<br>").map((line, index) => <Fragment key={line}>{index ? <br /> : null}{line}</Fragment>)}</h2><p>{t.contactIntro}</p>
        <a className="email" href={"mailto:" + copy.contactEmail}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" /><path d="m3 7 9 6 9-6" /></svg><span>{copy.contactEmail}</span></a>
        <div className="about" id="about" data-seq="about-block"><h3>{t.aboutTitle}</h3><p>{copy.about}</p></div>
      </div>
      <form className="form-card" data-seq="contact-block" onSubmit={event => { event.preventDefault(); void copyDraft(); }} noValidate>
        <div className="form-head"><h3>{t.formTitle}</h3><span className="badge">{copy.planField}: {planName}</span></div>
        <div className="fields"><div className="field"><label htmlFor={id + "-business"}>{t.business} <small>{t.optional}</small></label><input id={id + "-business"} autoComplete="organization" maxLength={100} value={name} onChange={event => { invalidate(); setName(event.target.value); }} /></div>
          <div className="field"><label htmlFor={id + "-sector"}>{t.sector}</label><select id={id + "-sector"} value={sector} onChange={event => { invalidate(); onSector(event.target.value as SectorId); }}>{copy.sectors.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div></div>
        <div className="field"><label htmlFor={id + "-message"}>{t.message}</label><textarea ref={message} id={id + "-message"} required minLength={10} maxLength={1500} value={question} placeholder={t.placeholder} dir="auto" aria-invalid={invalid || undefined} aria-describedby={id + "-counter " + id + "-error"} onChange={event => { invalidate(); onQuestion(event.target.value); }} /><div id={id + "-counter"} className="counter" dir="ltr">{question.length} / 1500</div></div>
        <div id={id + "-error"} className="error" role="alert">{invalid ? t.validation : ""}</div>
        <div className="actions"><button className="btn primary" type="submit" disabled={pendingLocale === locale}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="3" /><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>{t.copy}</button>
          <button className="btn" type="button" onClick={openEmail}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" /><path d="m3 7 9 6 9-6" /></svg>{t.openMail}</button></div>
        <p className="help">{t.mailHelp}</p><p className="status" role="status" aria-live="polite">{shown?.text}</p>
        {shown?.manual ? <div className="manual"><label htmlFor={id + "-manual"}>{t.manualHelp}</label><textarea id={id + "-manual"} value={shown.manual} readOnly dir="auto" /><a href={"mailto:" + copy.contactEmail + "?subject=" + encodeURIComponent(copy.mailSubject) + "&body=" + encodeURIComponent(shown.manual)}>{copy.emailUs}</a></div> : null}
      </form>
    </div><section className="privacy-strip" id="privacy"><div className="privacy-copy"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 3 11 5v8c0 6-5 10-11 13C10 26 5 22 5 16V8Z" /><path d="m11 16 3 3 7-7" /></svg><div><h3>{t.privacyTitle}</h3><p>{t.privacyShort}</p></div></div><button className="link-button" type="button" onClick={() => dialog.current?.showModal()}>{t.privacyRead}</button></section></div></section>
    <dialog ref={dialog} aria-labelledby={id + "-privacy-heading"} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
    }}><div className="dialog-top"><h2 id={id + "-privacy-heading"}>{t.privacyTitle}</h2><button className="close" type="button" aria-label={t.close} onClick={() => dialog.current?.close()}>×</button></div><p>{copy.privacy}</p><a className="text-link" href="/privacy">{t.fullPrivacy}</a><br /><a className="text-link" href="/data-deletion">{copy.deletionLink}</a></dialog>
  </div>;
}

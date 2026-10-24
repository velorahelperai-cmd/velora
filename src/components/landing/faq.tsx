import { Fragment } from "react";
import type { LandingCopy } from "@/lib/landing-copy";
import { approvedLowerCopy } from "./approved-lower-copy";
import styles from "./approved-sections.module.css";

export function Faq({ copy, locale }: { copy: LandingCopy; locale: "ar" | "en" }) {
  const t = approvedLowerCopy[locale];
  return <div className={styles.lower} dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
    <section id="faq" className="faq"><div className="wrap faq-layout">
      <div className="intro"><p className="eyebrow">{t.faqEyebrow}</p>
        <h2 className="faq-title">{t.faqTitle.split("<br>").map((line, index) => <Fragment key={line}>{index ? <br /> : null}{line}</Fragment>)}</h2>
        <p>{t.faqIntro}</p><a className="text-link" href="#contact">{t.moreQuestion}<span aria-hidden="true">←</span></a>
        <svg className="art" viewBox="0 0 160 140" aria-hidden="true"><path d="M84 132C78 91 85 54 113 14M84 115C49 114 27 94 23 70c30-2 50 12 60 33M85 87c31 2 48-17 49-39-25 0-41 14-49 32M90 58C64 52 53 31 59 12c24 8 32 24 31 46M83 130h32M23 70l40 27M134 48l-32 23M59 12l20 33" /></svg>
      </div><div className="accordion">{copy.faq.map(item => <details key={item.q} data-seq="faq-item"><summary><span>{item.q}</span><span className="plus" aria-hidden="true">+</span></summary><p>{item.a}</p></details>)}</div>
    </div></section>
  </div>;
}

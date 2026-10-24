import type { LandingCopy } from "@/lib/landing-copy";
import { approvedLowerCopy } from "./approved-lower-copy";
import styles from "./approved-sections.module.css";

export function SiteFooter({ copy, locale }: { copy: LandingCopy; locale: "ar" | "en" }) {
  const t = approvedLowerCopy[locale];
  const links = [[copy.footer.about, "#about"], [copy.footer.how, "#how"], [t.faqNav, "#faq"], [t.packages, "#packages"], [t.contactNav, "#contact"], [copy.footer.privacy, "/privacy"], [copy.footer.terms, "/terms"], [copy.footer.deletion, "/data-deletion"]] as const;
  return <div className={styles.lower} dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}><div className="footer-shell"><div className="wrap">
    <footer data-seq="footer"><div className="footer-main">
      <div className="footer-brand"><span className="brand" dir="ltr">VELORA</span><p className="company">{copy.companyLine}</p></div>
      <nav className="footer-links" aria-label={locale === "ar" ? "روابط التذييل" : "Footer"}>{links.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav>
    </div><div className="footer-bottom"><span>{copy.copyright}</span></div></footer>
  </div></div></div>;
}

"use client";

import { useDemo } from "@/lib/demo-state";
import { serviceTermsDraft } from "@/lib/service-terms-draft";

/** Local review content only. No acceptance action or effective version. */
export function ServiceTermsDraft() {
  const { locale } = useDemo();
  const ar = locale === "ar";
  const document = ar ? serviceTermsDraft.ar : serviceTermsDraft.en;
  return (
    <div dir={ar ? "rtl" : "ltr"} data-terms-local-draft="true" data-terms-effective="false">
      <h2 className="mt-6 text-xl font-bold sm:text-2xl">{document.title}</h2>
      <p className="mt-2 text-sm leading-7 text-[var(--color-muted-on-dark)]">{document.subtitle}</p>
      <p className="mt-4 text-base leading-8">{document.notice}</p>
      <p className="mt-4 whitespace-pre-wrap break-words rounded-2xl border border-[color:var(--color-border-soft)] bg-[#0d1a14] p-4 text-base leading-8 sm:p-5" data-terms-proposed-operator="true">{document.operator}</p>
      <section aria-labelledby="draft-pending-heading" className="mt-6 rounded-2xl border border-amber-300/40 p-4 sm:p-5">
        <h2 id="draft-pending-heading" className="text-lg font-bold">{ar ? "قرارات مفتوحة قبل النفاذ والنشر" : "Open decisions before effectiveness and publication"}</h2>
        <ul className="mt-3 grid gap-3 text-sm leading-7 sm:text-base">
          {serviceTermsDraft.pending.map(item => <li key={item.id} data-terms-pending={item.id}>
            <p>{ar ? item.ar : item.en}</p>
            <span>{ar ? "البنود: " : "Clauses: "}</span>
            {item.sections.map((number, index) => <span key={number}>{index ? "، " : ""}<a className="inline-flex min-h-11 min-w-11 items-center justify-center text-[#38dc89] underline underline-offset-4" href={`#draft-section-${number}`}>{number}</a></span>)}
          </li>)}
        </ul>
      </section>
      <ol className="mt-6 grid gap-4 text-base leading-8 sm:text-lg" data-terms-clauses="true">
        {document.sections.map(section => <li id={`draft-section-${section.number}`} key={section.number} data-terms-section={section.number} className="scroll-mt-4 rounded-2xl border border-[color:var(--color-border-soft)] bg-[#0d1a14] p-4 sm:p-5">
          <h2 className="text-lg font-bold sm:text-xl">{section.number}. {section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => <p key={index} className="mt-3 whitespace-pre-wrap break-words">{paragraph}</p>)}
        </li>)}
      </ol>
    </div>
  );
}

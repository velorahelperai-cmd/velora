import type { LandingCopy } from "@/lib/landing-copy";

export function Faq({ copy }: { copy: LandingCopy }) {
  return (
    <section id="faq" className="bg-[#f5f8f5] px-6 py-16 text-[#101b16] lg:px-12">
      <div className="mx-auto max-w-[860px]">
        <h2 className="text-3xl font-bold">{copy.faqTitle}</h2>
        <div className="mt-6 divide-y divide-[#cbddd2] border-y border-[#cbddd2]">
          {copy.faq.map((item) => (
            <details key={item.q} className="group py-2">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-2 text-lg font-medium">
                {item.q}
              </summary>
              <p className="pb-4 text-base leading-7 text-[#4f6258]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

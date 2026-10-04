import type { LandingCopy, PlanId } from "@/lib/landing-copy";

export function Packages({
  copy,
  selectedPlan,
  onSelect,
}: {
  copy: LandingCopy;
  selectedPlan: PlanId | null;
  onSelect: (plan: PlanId) => void;
}) {
  return (
    <section id="packages" data-scene="8" className="scene scene-dark px-6 py-20 lg:px-12 lg:py-24">
      <div data-seq="veil" aria-hidden="true" className="scene-veil" style={{ background: "#07110d" }} />
      <div data-seq="stage" className="relative z-10 mx-auto max-w-[1380px]">
        <h2 data-seq="packages-title" className="mx-auto max-w-[22ch] text-center text-[clamp(2rem,4vw,3.25rem)] font-bold leading-snug text-[#f7fbf8] sm:max-w-none">
          {copy.packagesTitle}
        </h2>
        <p data-seq="packages-lead" className="mx-auto mt-4 max-w-[46ch] text-center text-lg leading-8 text-[#d5e4da]">
          {copy.packagesBody}
        </p>
        <div
          className="mx-auto mt-8 h-0.5 w-44 origin-center rounded-full bg-[#38dc89]"
          data-seq="trace"
          aria-hidden="true"
        />
        <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-3 lg:gap-6">
          {copy.plans.map((plan) => {
            const selected = selectedPlan === plan.id;
            const featured = plan.id === "expanded";
            return (
              <article
                key={plan.id}
                data-seq="plan"
                className={`flex h-full flex-col rounded-[1.75rem] p-6 text-[#101b16] ${
                  featured ? "bg-[#f5f8f5] shadow-[0_24px_60px_rgba(0,0,0,0.28)]" : "bg-[#eef5f0]"
                } ${
                  selected
                    ? "ring-2 ring-[#38dc89] ring-offset-4 ring-offset-[#0d1b14]"
                    : featured
                      ? "border-t-[5px] border-[#087443]"
                      : "border border-[#c5d6cb]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-2xl font-bold tracking-tight">{plan.name}</h3>
                  {featured ? (
                    <span className="rounded-full bg-[#def5e7] px-3 py-1 text-sm font-medium text-[#087443]">{copy.suggested}</span>
                  ) : null}
                </div>
                <p className="mt-2 min-h-[3.5rem] text-base leading-7 text-[#4f6258]">{plan.purpose}</p>
                <p className="mt-4 text-base font-bold text-[#101b16]">{copy.price}</p>
                <ul className="mt-5 flex flex-1 flex-col gap-2.5 text-base leading-7">
                  {plan.features.map((feature) => (
                    <li key={feature.text} className="flex gap-2">
                      <span className="mt-0.5 text-[#087443]" aria-hidden="true">✓</span>
                      <span>{feature.text}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(plan.id)}
                  className={`mt-6 inline-flex min-h-12 items-center justify-center rounded-full px-5 text-sm font-medium transition ${
                    selected
                      ? "bg-[#07110d] text-[#f7fbf8]"
                      : featured
                        ? "bg-[#38dc89] text-[#072317] hover:bg-[#4fe79a]"
                        : "bg-[#087443] text-white hover:bg-[#0a8550]"
                  }`}
                >
                  {selected ? copy.selected : copy.choose}
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

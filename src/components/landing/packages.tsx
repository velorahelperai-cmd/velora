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
        <h2 className="scene-title mx-auto max-w-none text-center text-[#f7fbf8] lg:whitespace-nowrap">
          {copy.packagesTitle}
        </h2>
        <p className="scene-body mx-auto mt-4 max-w-[46ch] text-center text-[#b7c6b9]">
          {copy.packagesBody}
        </p>
        <div
          className="mx-auto mt-8 h-0.5 w-44 origin-center rounded-full bg-[#38dc89]"
          data-seq="trace"
          aria-hidden="true"
        />
        <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-3 lg:gap-6 lg:items-end">
          {copy.plans.map((plan) => {
            const selected = selectedPlan === plan.id;
            const featured = plan.id === "expanded";
            return (
              <article
                key={plan.id}
                data-seq="plan"
                className={`flex flex-col rounded-[1.75rem] p-6 text-[#101b16] transition duration-200 ${
                  featured
                    ? "bg-[#f5f8f5] shadow-[0_24px_60px_rgba(0,0,0,0.35)] lg:-translate-y-3 lg:p-7"
                    : "bg-[#eef5f0]"
                } ${
                  selected
                    ? "ring-2 ring-[#38dc89] ring-offset-4 ring-offset-[#07110d]"
                    : featured
                      ? "border-t-[5px] border-[#087443]"
                      : "border border-[#c5d6cb]"
                }`}
              >
                <h3 className="text-2xl font-bold tracking-tight">{plan.name}</h3>
                <p className="mt-2 text-sm leading-6 text-[#4f6258]">{plan.purpose}</p>
                <p className="mt-5 text-lg font-bold text-[#101b16]">{copy.price}</p>
                <p className="mt-1 text-sm text-[#4f6258]">{copy.allowance}</p>
                <ul className="mt-5 flex flex-1 flex-col gap-2.5 text-sm leading-6">
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

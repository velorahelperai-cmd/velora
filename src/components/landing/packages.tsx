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
    <section id="packages" data-scene="8" className="scene scene-dark px-6 py-20 lg:px-12 lg:py-12">
      <div data-seq="veil" aria-hidden="true" className="scene-veil" style={{ background: "#07110d" }} />
      <div data-seq="stage" className="relative z-10 mx-auto max-w-[1380px]">
        <h2 className="scene-title mx-auto max-w-none text-center text-[#f7fbf8] lg:whitespace-nowrap">
          {copy.packagesTitle}
        </h2>
        <p className="scene-body mx-auto mt-3 max-w-[46ch] text-center text-[#adbeaf]">
          {copy.packagesBody}
        </p>
        <div className="mx-auto mt-6 h-0.5 w-40 origin-center bg-[#38dc89]" data-seq="trace" aria-hidden="true" />
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          {copy.plans.map((plan) => {
            const selected = selectedPlan === plan.id;
            return (
              <article
                key={plan.id}
                data-seq="plan"
                className={`flex flex-col rounded-3xl bg-[#f5f8f5] p-5 text-[#101b16] transition ${
                  selected
                    ? "ring-2 ring-[#087443] ring-offset-2 ring-offset-[#07110d]"
                    : plan.id === "expanded"
                      ? "border-t-4 border-[#087443]"
                      : "border border-white/10"
                }`}
              >
                <h3 className="text-2xl font-bold">{plan.name}</h3>
                <p className="mt-2 text-sm leading-6 text-[#4f6258]">{plan.purpose}</p>
                <p className="mt-4 text-lg font-bold">{copy.price}</p>
                <p className="mt-1 text-sm text-[#4f6258]">{copy.allowance}</p>
                <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm leading-6">
                  {plan.features.map((feature) => (
                    <li key={feature.text}>
                      <span aria-hidden="true">✓ </span>
                      {feature.text}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(plan.id)}
                  className={`mt-5 inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-medium transition ${
                    selected ? "bg-[#0d1a14] text-[#f7fbf8]" : "bg-[#087443] text-white"
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

import type { LandingCopy, SectorId } from "@/lib/landing-copy";
import { PhoneFrame, PhoneSlot, PhoneScreenBody } from "@/components/landing/conversation-stage";

export function DemoScene({
  copy,
  sector,
  onSector,
}: {
  copy: LandingCopy;
  sector: SectorId;
  onSector: (sector: SectorId) => void;
}) {
  const scene = copy.scenes.find((item) => item.id === 9)!;
  const sample = copy.sampleFor(sector);

  return (
    <section id="demo" data-scene="9" className="scene scene-dark relative overflow-hidden px-6 py-20 lg:px-12 lg:py-24">
      <div data-seq="stage" data-phone="end" className="story-stage relative z-10 mx-auto max-w-[1380px]">
        <div className="story-visual">
          <div className="demo-stage stage-row" data-seq="sample">
            <PhoneSlot />
            <div className="demo-phone phone-shell mx-auto" data-seq="demo-phone">
              <div className="phone-screen bg-[#f7fbf8]">
                <PhoneScreenBody question={sample.q} answer={sample.a} note={copy.illustrative} />
              </div>
              <PhoneFrame />
            </div>
          </div>
        </div>

        <div className="story-copy min-w-0" data-seq="invite">
          <h2 className="scene-title text-[#f7fbf8]">{scene.title}</h2>
          <p className="scene-body mt-5 text-[#adbeaf]">{scene.body}</p>
          <p className="mt-3 text-sm text-[#adbeaf]">{copy.exampleNote}</p>
          <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label={copy.sectorField}>
            {copy.sectors.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={sector === item.id}
                onClick={() => onSector(item.id)}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ${
                  sector === item.id
                    ? "bg-[#38dc89] text-[#072317]"
                    : "border border-white/20 text-[#f7fbf8]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="mt-4 text-sm leading-6 text-[#adbeaf]">
            {copy.sectors.find((item) => item.id === sector)?.note}
          </p>
        </div>
      </div>
    </section>
  );
}

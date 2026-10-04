import Link from "next/link";
import type { LandingCopy, SectorId } from "@/lib/landing-copy";
import { PhoneMock, SourceCard } from "@/components/landing/conversation-stage";

export function DemoScene({
  copy,
  sector,
  onSector,
  onPrepare,
  onReplay,
  startHref,
  startLabel,
}: {
  copy: LandingCopy;
  sector: SectorId;
  onSector: (sector: SectorId) => void;
  onPrepare: () => void;
  onReplay: () => void;
  startHref: string;
  startLabel: string;
}) {
  const scene = copy.scenes.find((item) => item.id === 9)!;
  const sample = copy.sampleFor(sector);

  return (
    <section id="demo" data-scene="9" className="scene scene-dark px-6 py-20 lg:px-12">
      <div data-seq="stage" data-phone="start" className="story-stage relative z-10 mx-auto max-w-[1380px]">
        <div className="story-visual stage-row" data-seq="sample">
          <SourceCard title={scene.example.cardTitle} body={scene.example.card} />
          <PhoneMock
            question={sample.q}
            answer={sample.a}
            rotation={-4}
            scale={0.93}
          />
        </div>
        <div className="story-copy" data-seq="invite">
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
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={startHref}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#38dc89] px-6 text-base font-medium text-[#072317]"
            >
              {startLabel}
            </Link>
            <button
              type="button"
              onClick={onPrepare}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/25 px-5 text-sm text-[#f7fbf8]"
            >
              {copy.prepare}
            </button>
            <button
              type="button"
              onClick={onReplay}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/25 px-5 text-sm text-[#f7fbf8]"
            >
              {copy.replay}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

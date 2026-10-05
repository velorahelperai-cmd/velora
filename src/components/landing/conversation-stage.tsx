import Image from "next/image";
import { Fragment } from "react";

type PhoneScreenBodyProps = {
  question: string;
  answer: string;
  menuLabel?: string;
  onMenu?: () => void;
  note?: string;
};

export function PhoneScreenBody({ question, answer, menuLabel, onMenu, note }: PhoneScreenBodyProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-[#d7e4db] bg-[#f5f8f5] px-2.5 py-2">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#38dc89] text-[10px] font-bold text-[#072317]">
          V
        </span>
        <span className="min-w-0 truncate text-sm font-semibold text-[#101b16]">Velora</span>
        {note ? (
          <span className="shrink-0 rounded-full bg-[#def5e7] px-1.5 py-0.5 text-[10px] font-medium text-[#087443]">{note}</span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-hidden px-2.5 py-2">
        <p data-seq="question" className="chat-bubble ms-auto max-w-[96%] rounded-2xl rounded-es-md bg-[#def5e7] px-2.5 py-1.5 text-[#101b16]">
          {question}
        </p>
        <div className="chat-turn">
          <span data-seq="typing" aria-hidden="true" className="typing">
            <i /><i /><i />
          </span>
          <p data-seq="answer" className="chat-bubble me-auto max-w-[98%] rounded-2xl rounded-ss-md border border-[#d7e4db] bg-white px-2.5 py-1.5 text-[#101b16]">
            {answer}
          </p>
        </div>
        {menuLabel && onMenu ? (
          <button
            type="button"
            data-seq="menu"
            onClick={onMenu}
            className="me-auto min-h-11 rounded-full px-2 text-sm font-medium text-[#087443] underline"
          >
            {menuLabel}
          </button>
        ) : null}
      </div>
    </>
  );
}

export function PhoneFrame() {
  return (
    <Image
      src="/assets/velora/phone-frame-v1.png"
      alt=""
      width={1024}
      height={1536}
      className="phone-frame"
    />
  );
}

type PhoneMockProps = PhoneScreenBodyProps & {
  rotation?: number;
  scale?: number;
  className?: string;
};

export function PhoneMock({
  question,
  answer,
  rotation = 0,
  scale = 1,
  menuLabel,
  onMenu,
  orbit,
  className = "",
}: PhoneMockProps & { orbit?: readonly string[] }) {
  return (
    <div
      className={`phone-shell ${className}`.trim()}
      data-motion
      style={{ transform: `rotateX(2deg) rotateY(-3deg) rotate(${rotation}deg) scale(${scale})` }}
    >
      <PhoneOrbit notes={orbit ?? []} />
      <div className="phone-screen">
        <PhoneScreenBody question={question} answer={answer} menuLabel={menuLabel} onMenu={onMenu} />
      </div>
      <PhoneFrame />
    </div>
  );
}

export function PhoneOrbit({ notes }: { notes: readonly string[] }) {
  if (!notes.length) return null;
  return (
    <ul className="phone-orbit" data-seq="orbit">
      {notes.map((note, index) => (
        <li key={`orbit-${index}`}>{note}</li>
      ))}
    </ul>
  );
}

/** Shared desktop theater phone: one frame, layered screens per story scene. */
export function StoryTheaterPhone({
  screens,
  orbit,
}: {
  screens: Array<{
    id: string;
    question: string;
    answer: string;
    menuLabel?: string;
    onMenu?: () => void;
    note?: string;
  }>;
  orbit?: readonly string[];
}) {
  return (
    <div data-story-phone className="phone-shell story-theater-phone">
      <PhoneOrbit notes={orbit ?? []} />
      <div className="phone-screen story-theater-screen">
        {screens.map((screen, index) => (
          <div
            key={screen.id}
            data-phone-screen={screen.id}
            className="phone-screen-layer"
            style={index === 0 ? undefined : { opacity: 0 }}
          >
            <PhoneScreenBody
              question={screen.question}
              answer={screen.answer}
              menuLabel={screen.menuLabel}
              onMenu={screen.onMenu}
              note={screen.note}
            />
          </div>
        ))}
      </div>
      <PhoneFrame />
    </div>
  );
}

export function PhoneSlot() {
  return <div data-phone-slot className="phone-slot" aria-hidden="true" />;
}

export function SourceCard({
  title,
  body,
  tone = "dark",
  seq = "source",
  avatar,
}: {
  title: string;
  body: string;
  tone?: "dark" | "light";
  seq?: string;
  avatar?: string;
}) {
  const dark = tone === "dark";
  return (
    <aside
      data-seq={seq}
      className={`source-card w-full max-w-[300px] rounded-2xl border bg-white p-5 text-[#101b16] shadow-[0_16px_36px_rgba(0,0,0,0.18)] ${
        dark ? "border-[#38dc89]/70" : "border-[#cbddd2]"
      }`}
    >
      {avatar ? (
        <span
          aria-hidden="true"
          className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#087443] text-sm font-bold text-white"
        >
          {avatar}
        </span>
      ) : null}
      <p className="text-base font-bold text-[#087443]">{title}</p>
      {/* Explicit <br /> avoids SSR/client text-node newline normalization mismatches. */}
      <p className="mt-2 text-base leading-7 text-[#24382e]">
        {body.split("\n").map((line, index) => (
          <Fragment key={`line-${index}`}>
            {index > 0 ? <br /> : null}
            {line}
          </Fragment>
        ))}
      </p>
    </aside>
  );
}

import Image from "next/image";

type PhoneMockProps = {
  question: string;
  answer: string;
  rotation?: number;
  scale?: number;
  menuLabel?: string;
  onMenu?: () => void;
};

export function PhoneMock({
  question,
  answer,
  rotation = 0,
  scale = 1,
  menuLabel,
  onMenu,
}: PhoneMockProps) {
  return (
    <div
      className="phone-shell"
      data-motion
      style={{ transform: `rotate(${rotation}deg) scale(${scale})` }}
    >
      <div className="phone-screen">
        <div className="flex items-center justify-between border-b border-[#d7e4db] bg-[#f5f8f5] px-3 py-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#38dc89] text-xs font-bold text-[#072317]">
            V
          </span>
          <span className="text-xs font-medium text-[#101b16]">Velora</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 overflow-y-auto px-2 py-2">
          <p data-seq="question" className="chat-bubble ms-auto max-w-[96%] rounded-2xl rounded-es-md bg-[#def5e7] px-2.5 py-1.5 text-[#101b16]">
            {question}
          </p>
          <div className="relative">
            <span data-seq="typing" aria-hidden="true" className="typing me-auto">
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
      </div>
      <Image
        src="/assets/velora/phone-frame-v1.png"
        alt=""
        width={1024}
        height={1536}
        className="phone-frame"
      />
    </div>
  );
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
      className={`source-card w-full max-w-[210px] rounded-2xl border bg-white p-4 text-[#101b16] shadow-[0_16px_36px_rgba(0,0,0,0.18)] ${
        dark ? "border-[#38dc89]/70" : "border-[#cbddd2]"
      }`}
    >
      {avatar ? (
        <span
          aria-hidden="true"
          className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#087443] text-sm font-bold text-white"
        >
          {avatar}
        </span>
      ) : null}
      <p className="text-sm font-bold text-[#087443]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#4f6258]">{body}</p>
    </aside>
  );
}

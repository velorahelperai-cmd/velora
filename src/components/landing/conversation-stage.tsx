import Image from "next/image";
import { Fragment } from "react";
import styles from "./phone-messages.module.css";

type PhoneScreenBodyProps = {
  question: string;
  answer: string;
  menuLabel?: string;
  onMenu?: () => void;
  note?: string;
};

export function PhoneStatusBar() {
  return <div className={styles.statusBar} dir="ltr" aria-hidden="true"><span>9:41</span><span className={styles.statusIcons}><svg width="12" height="10" viewBox="0 0 14 10" fill="currentColor"><rect x="1" y="7" width="2" height="3" rx="0.5" /><rect x="4" y="5" width="2" height="5" rx="0.5" /><rect x="7" y="3" width="2" height="7" rx="0.5" /><rect x="10" y="1" width="2" height="9" rx="0.5" /></svg><svg width="12" height="10" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M2 3a9 9 0 0 1 12 0M4.5 6a5.5 5.5 0 0 1 7 0M7 9a2 2 0 0 1 2 0" /></svg><svg width="17" height="10" viewBox="0 0 20 12" fill="none" stroke="currentColor"><rect x="1" y="1" width="15" height="10" rx="2" /><rect x="3" y="3" width="11" height="6" rx="1" fill="currentColor" stroke="none" /><path d="M18 4v4" strokeWidth="2" /></svg></span></div>;
}

export function PhoneScreenBody({ question, answer, menuLabel, onMenu, note }: PhoneScreenBodyProps) {
  const questions = question.split("\n\n" );
  const answers = answer.split("\n\n" );
  const arabic = /[\u0600-\u06ff]/.test(question);
  return (
    <div className={styles.surface}>
      <PhoneStatusBar />
      <div className={styles.header}>
        <span aria-hidden="true" className={styles.back}>‹</span>
        <span className={styles.avatar} aria-hidden="true">V</span>
        <span className={styles.contact}>Velora{note ? <small>{note}</small> : null}</span>
        <span className={styles.headerIcons} aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 3h4l2 5-3 2c2 4 3 5 7 7l2-3 5 2v4c-9 3-20-8-17-17Z" /></svg><span>⋮</span></span>
      </div>
      <div className={`${styles.messages} ${questions.length > 1 ? styles.dense : ""} flex min-h-0 flex-1 flex-col justify-center overflow-hidden px-2 py-2`}>
        {questions.map((message, index) => (
          <Fragment key={index}>
            <p data-seq={index === questions.length - 1 ? "question" : undefined} className={`chat-bubble ${styles.bubble} ${styles.outgoing}`}>
              {message}<span className={styles.meta} aria-hidden="true">09:4{index + 1} <span className={styles.checks}>✓✓</span></span>
            </p>
            <div className="chat-turn">
              {index === questions.length - 1 ? <span data-seq="typing" aria-hidden="true" className="typing"><i /><i /><i /></span> : null}
              <p data-seq={index === questions.length - 1 ? "answer" : undefined} className={`chat-bubble ${styles.bubble} ${styles.incoming}`}>
                {answers[index] ?? ""}<span className={styles.meta} aria-hidden="true">09:4{index + 1}</span>
              </p>
            </div>
          </Fragment>
        ))}
        {menuLabel && onMenu ? <button type="button" data-seq="menu" onClick={onMenu} className="me-auto min-h-11 rounded-full px-2 text-xs font-medium text-[#087443] underline">{menuLabel}</button> : null}
      </div>
      <div className={styles.composer} aria-hidden="true"><span>☺</span><span className={styles.composerField}>{arabic ? "اكتب رسالة" : "Message"}</span><span>＋</span><span className={styles.mic}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="6" y="2" width="4" height="7" rx="2" /><path d="M4 7v1a4 4 0 0 0 8 0V7M8 12v2M5 14h6" /></svg></span></div>
    </div>
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
    <ul className={`phone-orbit ${styles.orbit}`} data-seq="orbit">
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

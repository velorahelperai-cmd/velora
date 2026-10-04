import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let registered = false;

export function registerLandingMotion() {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(ScrollTrigger);
  registered = true;
}

const HEADER = 68;

/**
 * Pinned, scrubbed chapter: the scene holds while its story plays, pauses for reading,
 * then hands off — content lifts away while a veil fades to the next scene's theme.
 */
function chapter(
  scene: Element,
  build: (tl: gsap.core.Timeline) => void,
  length = 1.45,
  handoff: "full" | "soft" = "full",
) {
  const tl = gsap.timeline({
    defaults: { ease: "power2.out" },
    scrollTrigger: {
      trigger: scene,
      start: `top ${HEADER}px`,
      end: `+=${Math.round(window.innerHeight * length)}`,
      pin: true,
      pinSpacing: true,
      anticipatePin: 1,
      scrub: 0.8,
      invalidateOnRefresh: true,
    },
  });
  build(tl);
  const hold = tl.duration() + 0.2;
  const wrapper = scene.querySelector(":scope > [data-seq='stage']");
  const veil = scene.querySelector("[data-seq='veil']");
  if (wrapper) {
    tl.to(
      wrapper,
      handoff === "full"
        ? { y: -70, opacity: 0, duration: 0.55, ease: "power2.in" }
        : { y: -24, duration: 0.45, ease: "power1.inOut" },
      hold,
    );
  }
  if (veil && handoff === "full") tl.to(veil, { opacity: 1, duration: 0.55, ease: "power1.inOut" }, hold);
  return tl;
}

export function playLandingMotion(root: HTMLElement) {
  const mm = gsap.matchMedia();
  const scene = (id: string) => root.querySelector<HTMLElement>(`[data-scene="${id}"]`);
  const q = <T extends Element = HTMLElement>(parent: Element | null, sel: string) =>
    parent ? parent.querySelector<T>(sel) : null;
  const all = (parent: Element | null, sel: string) => (parent ? parent.querySelectorAll(sel) : []);

  mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
    root.classList.add("motion-desktop");
    const rtl = getComputedStyle(document.documentElement).direction === "rtl";
    const side = rtl ? 1 : -1; // direction from phone toward card
    const origin = rtl ? "right center" : "left center";

    // ---------- 1. Pressure: timed intro, then parallax while leaving ----------
    const s1 = scene("1");
    if (s1) {
      const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
      intro
        .from(q(s1, ".phone-shell"), { y: 90, opacity: 0, rotate: -14, duration: 1 }, 0)
        .from(q(s1, "h1"), { y: 30, opacity: 0, duration: 0.9 }, 0.1)
        .from(q(s1, ".scene-body"), { y: 24, opacity: 0, duration: 0.8 }, 0.3)
        .from(all(s1, "[data-seq='chip']"), { y: 60, opacity: 0, scale: 0.7, stagger: 0.28, duration: 0.8 }, 0.5)
        .from(q(s1, "[data-seq='question']"), { scale: 0.85, opacity: 0, duration: 0.5 }, 1.1)
        .from(q(s1, "[data-seq='source']"), { x: 120 * side, opacity: 0, duration: 0.9 }, 1.3)
        .from(q(s1, "[data-seq='tagline']"), { y: 10, opacity: 0, duration: 0.5 }, 0)
        .from(all(s1, "[data-seq='hero-actions'] > *"), { y: 16, opacity: 0, stagger: 0.1, duration: 0.6 }, 1.5);

      gsap.timeline({
        scrollTrigger: { trigger: s1, start: "top top", end: "bottom top", scrub: 0.6 },
      })
        .to(q(s1, "[data-seq='environment']"), { yPercent: -12, scale: 1.12, ease: "none" }, 0)
        .to(all(s1, "[data-seq='chip']"), { y: -120, opacity: 0, stagger: 0.08, ease: "none" }, 0)
        .to(q(s1, ".phone-shell"), { y: -60, rotate: -2, ease: "none" }, 0)
        .to(q(s1, "[data-seq='source']"), { y: -40, opacity: 0, ease: "none" }, 0.2)
        .to(q(s1, "[data-seq='scroll-hint']"), { opacity: 0, ease: "none", duration: 0.15 }, 0)
        .to(q(s1, "[data-seq='veil']"), { opacity: 1, ease: "none", duration: 0.5 }, 0.5);
    }

    /** Typing dots show while the reply is pending, then hand over to the answer bubble. */
    const typingThenAnswer = (tl: gsap.core.Timeline, s: Element, at: number, answerVars: gsap.TweenVars) => {
      const typing = q(s, "[data-seq='typing']");
      const answer = q(s, "[data-seq='answer']");
      if (typing) tl.fromTo(typing, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.15 }, at - 0.35);
      if (typing) tl.to(typing, { opacity: 0, duration: 0.12 }, at);
      if (answer) tl.from(answer, { ...answerVars }, at);
    };

    // ---------- 2. Knowledge: source card arrives from outside the chat ----------
    const s2 = scene("2");
    if (s2) {
      chapter(s2, (tl) => {
        tl.from(q(s2, ".phone-shell"), { y: 140, rotate: 8, opacity: 0, duration: 0.5 }, 0)
          .from(q(s2, "h2"), { x: -40 * side, opacity: 0, duration: 0.45 }, 0.05)
          .from(q(s2, ".scene-body"), { y: 20, opacity: 0, duration: 0.4 }, 0.2);
        typingThenAnswer(tl, s2, 0.6, { opacity: 0, y: 14, duration: 0.3 });
        tl.from(q(s2, "[data-seq='source']"), { x: 220 * side, y: 40, opacity: 0, scale: 0.85, duration: 0.6 }, 0.45)
          .fromTo(q(s2, "[data-seq='highlight']"), { scaleX: 0, transformOrigin: origin }, { scaleX: 1, duration: 0.3 }, 0.95)
          .to({}, { duration: 0.3 });
      });
    }

    // ---------- 3. Reply: green trace from source to the reply bubble, then menu ----------
    const s3 = scene("3");
    if (s3) {
      const trace = q<SVGPathElement>(s3, "[data-trace]");
      const length = trace?.getTotalLength() ?? 0;
      if (trace && length > 0) gsap.set(trace, { strokeDasharray: length, strokeDashoffset: length });
      chapter(s3, (tl) => {
        tl.from(q(s3, ".phone-shell"), { scale: 0.86, y: 60, opacity: 0, duration: 0.45 }, 0)
          .from(q(s3, "h2"), { x: -40 * side, opacity: 0, duration: 0.45 }, 0.05)
          .from(q(s3, "[data-seq='source']"), { x: 160 * side, opacity: 0, scale: 0.9, duration: 0.5 }, 0.2)
          .from(q(s3, ".scene-body"), { y: 20, opacity: 0, duration: 0.4 }, 0.3);
        if (trace && length > 0) tl.to(trace, { strokeDashoffset: 0, duration: 0.5, ease: "none" }, 0.5);
        typingThenAnswer(tl, s3, 0.95, { opacity: 0, y: 26, scale: 0.9, duration: 0.4 });
        tl.from(q(s3, "[data-seq='menu']"), { opacity: 0, y: 14, scale: 0.9, duration: 0.3 }, 1.3)
          .to({}, { duration: 0.3 });
      });
    }

    // ---------- 4. Enquiry: details confirmed, summary travels into the follow-up record ----------
    const s4 = scene("4");
    if (s4) {
      chapter(s4, (tl) => {
        tl.from(q(s4, ".phone-shell"), { x: -120 * side, opacity: 0, duration: 0.5 }, 0)
          .from(q(s4, "h2"), { x: -40 * side, opacity: 0, duration: 0.45 }, 0.05)
          .from(q(s4, ".scene-body"), { y: 20, opacity: 0, duration: 0.4 }, 0.2);
        typingThenAnswer(tl, s4, 0.5, { opacity: 0, y: 20, duration: 0.35 });
        tl.from(q(s4, "[data-seq='record']"), { x: -260 * side, y: -40, scale: 0.55, opacity: 0, duration: 0.65 }, 0.6)
          .from(q(s4, "[data-seq='confirmed']"), { opacity: 0, y: 12, duration: 0.3 }, 1.2)
          .to({}, { duration: 0.3 });
      });
    }

    // ---------- 5. Handover: record becomes the staff card, auto replies pause ----------
    const s5 = scene("5");
    if (s5) {
      chapter(s5, (tl) => {
        tl.from(q(s5, ".phone-shell"), { y: 80, opacity: 0, duration: 0.45 }, 0)
          .from(q(s5, "h2"), { x: -40 * side, opacity: 0, duration: 0.45 }, 0.05)
          .from(q(s5, ".scene-body"), { y: 20, opacity: 0, duration: 0.4 }, 0.2)
          .from(q(s5, "[data-seq='staff']"), { x: -240 * side, y: 60, scale: 0.6, opacity: 0, duration: 0.65 }, 0.4);
        typingThenAnswer(tl, s5, 0.85, { opacity: 0, y: 20, duration: 0.35 });
        tl.fromTo(
            q(s5, "[data-seq='paused']"),
            { scale: 0.4, opacity: 0, backgroundColor: "rgba(56,220,137,0)" },
            { scale: 1, opacity: 1, backgroundColor: "rgba(56,220,137,0.18)", duration: 0.4, ease: "back.out(2)" },
            1.05,
          )
          .from(q(s5, "[data-seq='no-repeat']"), { opacity: 0, y: 10, duration: 0.3 }, 1.3)
          .to({}, { duration: 0.3 });
      });
    }

    // ---------- 6. Owner: the frame widens from a phone to the panel ----------
    const s6 = scene("6");
    if (s6) {
      chapter(s6, (tl) => {
        tl.from(q(s6, "[data-seq='panel']"), { scale: 0.42, y: 160, opacity: 0, borderRadius: 48, duration: 0.8 }, 0)
          .from(q(s6, "h2"), { x: -40 * side, opacity: 0, duration: 0.45 }, 0.15)
          .from(q(s6, ".scene-body"), { y: 20, opacity: 0, duration: 0.4 }, 0.3)
          .from(all(s6, "[data-seq='tab']"), { y: 14, opacity: 0, stagger: 0.08, duration: 0.3 }, 0.6)
          .from(all(s6, "[data-seq='row']"), { x: 30 * side, opacity: 0, stagger: 0.14, duration: 0.35 }, 0.75)
          .fromTo(q(s6, "[data-seq='row-active']"), { backgroundColor: "rgba(222,245,231,0)" }, { backgroundColor: "rgba(222,245,231,1)", duration: 0.35 }, 1.15)
          .to({}, { duration: 0.3 });
      });
    }

    // ---------- 7. Setup: rows arrive in order 0 / .3 / .6 / .9 ----------
    const s7 = scene("7");
    if (s7) {
      chapter(s7, (tl) => {
        tl.from(q(s7, "h2"), { x: -40 * side, opacity: 0, duration: 0.45 }, 0)
          .from(q(s7, ".scene-body"), { y: 20, opacity: 0, duration: 0.4 }, 0.15);
        all(s7, "[data-seq='step']").forEach((step, i) => {
          tl.from(step, { x: 120 * side, opacity: 0, duration: 0.45 }, 0.3 + i * 0.3);
        });
        tl.from(q(s7, "[data-seq='notes']"), { opacity: 0, y: 14, duration: 0.35 }, 1.6).to({}, { duration: 0.3 });
      });
    }

    // ---------- 8. Packages: the trace reaches the three tiers ----------
    const s8 = scene("8");
    if (s8) {
      chapter(s8, (tl) => {
        tl.from(q(s8, "h2"), { y: 40, opacity: 0, duration: 0.45 }, 0)
          .from(q(s8, ".scene-body"), { y: 20, opacity: 0, duration: 0.4 }, 0.15)
          .fromTo(q(s8, "[data-seq='trace']"), { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: "none" }, 0.35)
          .from(all(s8, "[data-seq='plan']"), { y: 160, opacity: 0, rotateX: 18, transformOrigin: "top center", stagger: 0.22, duration: 0.6 }, 0.6)
          .to({}, { duration: 0.35 });
      }, 1.55);
    }

    // ---------- 9. Invitation: motion settles, footer hands off quietly ----------
    const s9 = scene("9");
    if (s9) {
      chapter(s9, (tl) => {
        tl.from(q(s9, ".phone-shell"), { y: 120, opacity: 0, rotate: -10, duration: 0.6 }, 0)
          .from(q(s9, "[data-seq='source']"), { x: 140 * side, opacity: 0, duration: 0.5 }, 0.25)
          .from(q(s9, "h2"), { x: -40 * side, opacity: 0, duration: 0.45 }, 0.1)
          .from(q(s9, ".scene-body"), { y: 20, opacity: 0, duration: 0.4 }, 0.25)
          .from(all(s9, "[data-seq='invite'] button, [data-seq='invite'] p:not(.scene-body)"), { y: 16, opacity: 0, stagger: 0.05, duration: 0.35 }, 0.5)
          .to({}, { duration: 0.3 });
      }, 1.1, "soft");
    }

    const footer = root.querySelector("[data-seq='footer']");
    if (footer) {
      gsap.from(footer, {
        y: 40,
        opacity: 0,
        ease: "none",
        scrollTrigger: { trigger: footer, start: "top 95%", end: "top 60%", scrub: 0.6 },
      });
    }

    return () => {
      root.classList.remove("motion-desktop");
      const trace = root.querySelector("[data-trace]");
      if (trace) gsap.set(trace, { clearProps: "strokeDasharray,strokeDashoffset" });
      gsap.set(root.querySelectorAll("[data-seq='veil'], [data-seq='stage']"), { clearProps: "all" });
    };
  });

  // Mobile: same order, lighter motion, no pin.
  mm.add("(max-width: 1023px) and (prefers-reduced-motion: no-preference)", () => {
    root.querySelectorAll("[data-scene]").forEach((section) => {
      const parts = section.querySelectorAll(
        ".phone-shell, .source-card, [data-seq='step'], [data-seq='plan'], [data-seq='panel'], [data-seq='chip']",
      );
      if (!parts.length) return;
      gsap.from(parts, {
        y: 36,
        opacity: 0.45,
        stagger: 0.08,
        ease: "none",
        scrollTrigger: { trigger: section, start: "top 85%", end: "top 35%", scrub: 0.4 },
      });
    });
    const trace = root.querySelector("[data-trace]");
    if (trace) gsap.set(trace, { clearProps: "strokeDasharray,strokeDashoffset" });
  });

  return () => mm.revert();
}

/** Replays only the chosen sample conversation in the final scene. */
export function replaySample(root: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const sample = root.querySelector("[data-scene='9'] [data-seq='sample']");
  if (!sample) return;
  const question = sample.querySelector("[data-seq='question']");
  const answer = sample.querySelector("[data-seq='answer']");
  const card = sample.querySelector("[data-seq='source']");
  gsap
    .timeline({ defaults: { ease: "power2.out", overwrite: "auto" } })
    .fromTo(question, { opacity: 0, y: 18, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.45 }, 0)
    .fromTo(answer, { opacity: 0, y: 18, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.45 }, 0.55)
    .fromTo(card, { opacity: 0, x: 24 }, { opacity: 1, x: 0, duration: 0.45 }, 0.9);
}

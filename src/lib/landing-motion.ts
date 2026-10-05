import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

let registered = false;

export function registerLandingMotion() {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(ScrollTrigger);
  registered = true;
}

type StoryId = "1" | "2" | "3" | "4" | "5" | "9";
const STORY_IDS: StoryId[] = ["1", "2", "3", "4", "5", "9"];

type TheaterBridge = {
  scrollToScene: (sceneId: StoryId) => boolean;
};

function theaterBridgeOf(root: HTMLElement): TheaterBridge | null {
  const value = (root as HTMLElement & { __veloraTheater?: TheaterBridge }).__veloraTheater;
  return value ?? null;
}

function setTheaterBridge(root: HTMLElement, bridge: TheaterBridge | null) {
  const host = root as HTMLElement & { __veloraTheater?: TheaterBridge };
  if (bridge) host.__veloraTheater = bridge;
  else delete host.__veloraTheater;
}

function bindTheater(root: HTMLElement, compact: boolean) {
  const header = compact ? 56 : 68;
  const yawMax = compact ? 6 : 12;
  const travelYaw = compact ? 8 : 18;
  const grow = compact ? 1.1 : 1.18;
  const sideAmount = compact ? 18 : 96;
  const pinScreens = compact ? 6.4 : 5.7;
  const scrub = compact ? 0.55 : true;

  root.classList.add("motion-theater");
  root.classList.add(compact ? "motion-compact" : "motion-desktop");

  const scene = (id: string) => root.querySelector<HTMLElement>(`[data-scene="${id}"]`);
  const q = <T extends Element = HTMLElement>(parent: Element | null, sel: string) =>
    parent ? parent.querySelector<T>(sel) : null;
  const all = (parent: Element | null, sel: string) => (parent ? parent.querySelectorAll(sel) : []);

  const phone = root.querySelector<HTMLElement>("[data-story-phone]");
  const range = root.querySelector<HTMLElement>("[data-story-phone-range]");
  const phoneScreen = (id: string) => q(phone, `[data-phone-screen="${id}"]`);
  const slotOf = (s: Element | null) => (s ? s.querySelector<HTMLElement>("[data-phone-slot]") : null);

  type Rest = { x: number; y: number; w: number; h: number; shift: number; yaw: number };
  let rests: Rest[] = STORY_IDS.map(() => ({
    x: 0,
    y: compact ? 220 : 72,
    w: compact ? 200 : 354,
    h: compact ? 300 : 531,
    shift: -56,
    yaw: yawMax,
  }));

  const setScreenMix = (fromId: string, toId: string, t: number) => {
    if (!phone) return;
    const showTo = fromId !== toId && t >= 0.5;
    const active = showTo ? toId : fromId;
    all(phone, "[data-phone-screen]").forEach((layer) => {
      const id = layer.getAttribute("data-phone-screen");
      const on = id === active;
      gsap.set(layer, {
        opacity: on ? 1 : 0,
        zIndex: on ? 2 : 0,
        visibility: on ? "visible" : "hidden",
        pointerEvents: on ? "auto" : "none",
      });
    });
  };

  const measureRests = () => {
    if (!range) return;
    void range.offsetHeight;
    const rangeBox = range.getBoundingClientRect();
    const raw = STORY_IDS.map((id) => {
      const slot = slotOf(scene(id));
      const copy = q(scene(id), ".story-copy");
      const slotBox = slot?.getBoundingClientRect();
      const x = slotBox ? slotBox.left - rangeBox.left : rangeBox.width / 2 - 100;
      const copyX = copy ? copy.getBoundingClientRect().left - rangeBox.left : x;
      return {
        x,
        y: slotBox ? slotBox.top - rangeBox.top : compact ? rangeBox.height * 0.42 : 72,
        w: slotBox?.width || (compact ? 190 : 300),
        h: slotBox?.height || (compact ? 285 : 450),
        shift: copyX + 24 < x ? -56 : 56,
      };
    });
    const slotW = raw[0]?.w ?? (compact ? 190 : 300);
    const slotH = raw[0]?.h ?? (compact ? 285 : 450);
    const w = Math.round(slotW * grow);
    const h = Math.round(slotH * grow);
    const yawFor = (x: number) => (x + w / 2 < rangeBox.width / 2 ? 1 : -1) * yawMax;
    rests = raw.map((item, index) => {
      const copy = q(scene(STORY_IDS[index]), ".story-copy");
      const copyBox = copy?.getBoundingClientRect();
      const copyLeft = copyBox ? copyBox.left - rangeBox.left : null;
      const copyRight = copyBox ? copyLeft! + copyBox.width : null;
      const copyBottom = copyBox ? copyBox.bottom - rangeBox.top : null;
      const card = compact ? null : q(scene(STORY_IDS[index]), ".source-card");
      const cardBox = card?.getBoundingClientRect();
      const cardLeft = cardBox ? cardBox.left - rangeBox.left : null;
      const cardRight = cardBox ? cardLeft! + cardBox.width : null;
      const project = compact ? 8 : 28;
      const minX = Math.max(8, 16 + project - rangeBox.left);
      const maxX = window.innerWidth - 16 - project - rangeBox.left - w;
      let x = item.x - (w - item.w) / 2;
      let y = item.y - (h - item.h) / 2;
      const minY = compact && copyBottom != null ? copyBottom + 8 : 8;
      y = gsap.utils.clamp(minY, Math.max(minY, rangeBox.height - h - 8), y);
      x = gsap.utils.clamp(minX, Math.max(minX, maxX), x);

      if (!compact) {
        const bleed = Math.round((h / 2) * Math.sin((yawMax * Math.PI) / 180)) + 20;
        if (copyLeft != null && copyRight != null) {
          const overlaps = x - bleed < copyRight && x + w + bleed > copyLeft;
          if (overlaps) {
            const phoneMid = x + w / 2;
            const copyMid = (copyLeft + copyRight) / 2;
            x = phoneMid <= copyMid ? copyLeft - bleed - w : copyRight + bleed;
            x = gsap.utils.clamp(minX, Math.max(minX, maxX), x);
          }
        }
        if (cardLeft != null && cardRight != null && x < cardRight && x + w > cardLeft) {
          const phoneMid = x + w / 2;
          const cardMid = (cardLeft + cardRight) / 2;
          const away = phoneMid <= cardMid ? cardLeft - 18 - w : cardRight + 18;
          const next = gsap.utils.clamp(minX, Math.max(minX, maxX), away);
          const still = next < cardRight && next + w > cardLeft;
          if (!still) x = next;
        }
      } else {
        // Aim the phone at ~52% of the stage so it reads as mid-screen, not bottom-heavy.
        x = gsap.utils.clamp(minX, Math.max(minX, maxX), (rangeBox.width - w) / 2);
        const targetMid = rangeBox.height * 0.52;
        const idealY = targetMid - h / 2;
        const minClear = copyBottom != null ? Math.max(8, copyBottom - Math.round(h * 0.12)) : 8;
        y = gsap.utils.clamp(minClear, Math.max(minClear, rangeBox.height - h - 8), idealY);
      }
      return { x, y, w, h, shift: item.shift, yaw: yawFor(x) };
    });
  };

  // Native touch scrolling is more reliable on phones; Lenis stays on desktop.
  let lenis: Lenis | null = null;
  let lenisTick: ((time: number) => void) | null = null;
  const onLenisScroll = () => {
    ScrollTrigger.update();
  };
  if (!compact) {
    lenis = new Lenis({
      autoRaf: false,
      lerp: 0.3,
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1,
      syncTouch: false,
    });
    lenis.on("scroll", onLenisScroll);
    lenisTick = (time: number) => {
      lenis?.raf(time * 1000);
    };
    gsap.ticker.add(lenisTick);
    gsap.ticker.lagSmoothing(0);
  }

  const typingThenAnswer = (tl: gsap.core.Timeline, screenId: string, at: number) => {
    const screen = phoneScreen(screenId);
    const typing = q(screen, "[data-seq='typing']");
    const answer = q(screen, "[data-seq='answer']");
    if (typing) {
      tl.fromTo(
        typing,
        { autoAlpha: 0, height: 0, paddingTop: 0, paddingBottom: 0, borderColor: "transparent" },
        {
          autoAlpha: 1,
          height: compact ? 24 : 28,
          paddingTop: 6,
          paddingBottom: 6,
          borderColor: "#d7e4db",
          duration: 0.12,
          immediateRender: false,
        },
        at,
      );
      tl.to(typing, { autoAlpha: 0, height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.08 }, at + 0.22);
    }
    if (answer) tl.fromTo(answer, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, immediateRender: false }, at + 0.34);
  };

  measureRests();
  if (phone && range) {
    const first = rests[0] ?? { x: 0, y: 72, w: 300, h: 450, yaw: yawMax };
    gsap.set(phone, {
      x: rests[0]?.x ?? first.x,
      y: rests[0]?.y ?? first.y,
      scale: 1,
      width: rests[0]?.w ?? first.w,
      height: rests[0]?.h ?? first.h,
      rotate: 0,
      rotationX: compact ? 2 : 4,
      rotationY: rests[0]?.yaw ?? yawMax,
      opacity: 1,
    });
    root.classList.add("motion-theater-ready");
    setScreenMix("1", "1", 0);
    STORY_IDS.slice(1).forEach((id) => {
      const panel = scene(id);
      const answer = q(phoneScreen(id), "[data-seq='answer']");
      const menu = q(phoneScreen(id), "[data-seq='menu']");
      if (panel) gsap.set(panel, { autoAlpha: 0 });
      if (answer) gsap.set(answer, { autoAlpha: 0 });
      if (menu) gsap.set(menu, { autoAlpha: 0 });
    });

    const tl = gsap.timeline({
      scrollTrigger: {
        id: "velora-story-theater",
        trigger: range,
        start: `top ${header}px`,
        end: () => `+=${Math.round(window.innerHeight * pinScreens)}`,
        pin: true,
        pinSpacing: true,
        anticipatePin: 1,
        scrub,
        invalidateOnRefresh: true,
        onRefreshInit: measureRests,
        onRefresh: (self) => {
          if (self.progress < 0.02) setScreenMix("1", "1", 0);
        },
      },
    });

    const storySt = () => ScrollTrigger.getById("velora-story-theater");
    setTheaterBridge(root, {
      scrollToScene: (sceneId) => {
        const st = storySt();
        if (!st || tl.duration() <= 0) return false;
        const label = `scene-${sceneId}`;
        let labelTime = tl.labels[label];
        if (typeof labelTime !== "number") {
          const idx = STORY_IDS.indexOf(sceneId);
          if (idx < 0) return false;
          // Approximate arrival if labels were not registered yet.
          labelTime = (idx / Math.max(1, STORY_IDS.length - 1)) * tl.duration() * 0.9;
        }
        const progress = Math.min(1, Math.max(0, labelTime / tl.duration()));
        const y = st.start + (st.end - st.start) * progress;
        if (lenis) {
          lenis.scrollTo(y, { immediate: false });
        } else if (typeof st.scroll === "function") {
          st.scroll(y);
        } else {
          window.scrollTo({ top: y, behavior: "smooth" });
        }
        ScrollTrigger.update();
        return true;
      },
    });

    const copyOf = (id: StoryId) => q(scene(id), ".story-copy");
    const visualOf = (id: StoryId) => q(scene(id), ".story-visual");
    const sideX = (index: number, amount = sideAmount) => ((rests[index]?.shift ?? 56) < 0 ? -amount : amount);

    tl.set(
      phone,
      {
        x: () => rests[0]?.x ?? 0,
        y: () => rests[0]?.y ?? 0,
        width: () => rests[0]?.w ?? 354,
        height: () => rests[0]?.h ?? 531,
        rotationX: compact ? 2 : 4,
        rotationY: () => rests[0]?.yaw ?? yawMax,
        scale: 1,
      },
      0,
    );
    const environment = q(scene("1"), "[data-seq='environment']");
    if (environment) {
      tl.to(environment, { yPercent: compact ? -3 : -6, ease: "none", duration: 0.35 }, 0);
    }
    tl.to({}, { duration: 0.85 });

    const handoff = (from: StoryId, to: StoryId) => {
      const fromIndex = STORY_IDS.indexOf(from);
      const toIndex = STORY_IDS.indexOf(to);
      const fromScene = scene(from);
      const toScene = scene(to);
      const fromCopy = copyOf(from);
      const toCopy = copyOf(to);
      const fromVisual = visualOf(from);
      const toVisual = visualOf(to);
      const at = tl.duration();

      if (compact) {
        if (toCopy) tl.set(toCopy, { y: 16, autoAlpha: 0, immediateRender: false }, at);
        if (toVisual) tl.set(toVisual, { y: 12, autoAlpha: 0, immediateRender: false }, at);
      } else {
        if (toCopy) tl.set(toCopy, { x: () => sideX(toIndex), autoAlpha: 0, immediateRender: false }, at);
        if (toVisual) tl.set(toVisual, { x: () => -sideX(toIndex, 48), autoAlpha: 0, immediateRender: false }, at);
      }

      const orbit = from === "1" ? q(phone, "[data-seq='orbit']") : null;
      if (orbit) tl.to(orbit, { autoAlpha: 0, duration: 0.28, immediateRender: false }, at);

      if (fromCopy) {
        tl.to(
          fromCopy,
          compact
            ? { y: -14, autoAlpha: 0, duration: 0.3, ease: "power2.in", immediateRender: false }
            : { x: () => sideX(fromIndex), autoAlpha: 0, duration: 0.34, ease: "power2.in", immediateRender: false },
          at,
        );
      }
      if (fromVisual) {
        tl.to(
          fromVisual,
          compact
            ? { y: 10, autoAlpha: 0, duration: 0.26, ease: "power2.in", immediateRender: false }
            : { x: () => -sideX(fromIndex, 40), autoAlpha: 0, duration: 0.28, ease: "power2.in", immediateRender: false },
          at,
        );
      }

      const travelAt = at + 0.22;
      const travelDur = compact ? 0.95 : 1.05;
      const travelSign = () => {
        const deltaX = (rests[toIndex]?.x ?? 0) - (rests[fromIndex]?.x ?? 0);
        const deltaY = (rests[toIndex]?.y ?? 0) - (rests[fromIndex]?.y ?? 0);
        if (Math.abs(deltaX) < 2) return Math.sign(deltaY) || (rests[toIndex]?.yaw ?? yawMax) / yawMax;
        return Math.sign(deltaX);
      };
      tl.to(
        phone,
        {
          x: () => rests[toIndex]?.x ?? 0,
          y: () => rests[toIndex]?.y ?? 0,
          width: () => rests[toIndex]?.w ?? 354,
          height: () => rests[toIndex]?.h ?? 531,
          scale: 1,
          duration: travelDur,
          ease: "sine.inOut",
          immediateRender: false,
        },
        travelAt,
      );
      tl.to(
        phone,
        {
          rotationY: () => travelSign() * travelYaw,
          rotationX: compact ? 3 : 5,
          duration: travelDur * 0.48,
          ease: "sine.inOut",
          immediateRender: false,
        },
        travelAt,
      );
      tl.to(
        phone,
        {
          rotationY: () => rests[toIndex]?.yaw ?? yawMax,
          rotationX: compact ? 2 : 4,
          duration: travelDur * 0.52,
          ease: "sine.out",
          immediateRender: false,
        },
        travelAt + travelDur * 0.48,
      );
      const mix = { t: 0 };
      tl.fromTo(
        mix,
        { t: 0, immediateRender: false },
        {
          t: 1,
          duration: travelDur,
          ease: "none",
          onUpdate: () => setScreenMix(from, to, mix.t),
        },
        travelAt,
      );
      if (toScene) {
        tl.fromTo(
          toScene,
          { autoAlpha: 0, immediateRender: false },
          { autoAlpha: 1, duration: 0.36, ease: "none" },
          travelAt,
        );
      }
      if (fromScene) tl.to(fromScene, { autoAlpha: 0, duration: 0.3, ease: "none", immediateRender: false }, travelAt + 0.1);

      const arrive = travelAt + travelDur;
      if (toCopy) {
        tl.to(toCopy, { x: 0, y: 0, autoAlpha: 1, duration: 0.55, ease: "power2.out", immediateRender: false }, arrive);
      }
      if (toVisual) {
        tl.to(toVisual, { x: 0, y: 0, autoAlpha: 1, duration: 0.45, ease: "power2.out", immediateRender: false }, arrive);
      }
      const readAt = arrive + 0.3;
      tl.addLabel(`scene-${to}`, arrive);
      if (to === "2" || to === "4" || to === "5" || to === "9") typingThenAnswer(tl, to, readAt);
      if (to === "3") {
        const trace = q<SVGPathElement>(toScene, "[data-trace]");
        const length = trace?.getTotalLength() ?? 0;
        if (trace && length > 0) {
          gsap.set(trace, { strokeDasharray: length, strokeDashoffset: length });
          tl.to(trace, { strokeDashoffset: 0, duration: 0.35, ease: "none" }, readAt);
        }
        typingThenAnswer(tl, "3", readAt + 0.12);
        tl.fromTo(
          q(phoneScreen("3"), "[data-seq='menu']"),
          { autoAlpha: 0, y: 8 },
          { autoAlpha: 1, y: 0, duration: 0.22 },
          readAt + 0.42,
        );
      }
      if (to === "5") {
        tl.fromTo(q(toScene, "[data-seq='paused']"), { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.25 }, readAt + 0.32);
      }
      tl.to({}, { duration: to === "9" ? 1.15 : to === "5" ? 1 : 0.85 });
    };

    handoff("1", "2");
    handoff("2", "3");
    handoff("3", "4");
    handoff("4", "5");
    handoff("5", "9");
    tl.addLabel("scene-1", 0);
    setScreenMix("1", "1", 0);
    gsap.set(scene("1"), { autoAlpha: 1 });
    gsap.set(phone, {
      x: rests[0]?.x ?? 0,
      y: rests[0]?.y ?? 72,
      scale: 1,
      rotationX: compact ? 2 : 4,
      rotationY: rests[0]?.yaw ?? yawMax,
      width: rests[0]?.w ?? 300,
      height: rests[0]?.h ?? 450,
    });
  }

  const enter = (trigger: Element, items: Element[], from: gsap.TweenVars, start: string, end: string) => {
    if (!items.length) return;
    gsap.fromTo(items, from, {
      x: 0,
      y: 0,
      scale: 1,
      autoAlpha: 1,
      stagger: compact ? 0.08 : 0.12,
      ease: "power2.out",
      scrollTrigger: { trigger, start, end, scrub: compact ? 0.45 : true },
    });
  };

  const s6 = scene("6");
  if (s6) {
    const lead = s6.querySelector(".order-1");
    const panel = s6.querySelector("[data-seq='panel']");
    if (lead) enter(s6, [lead], compact ? { y: 28, autoAlpha: 0 } : { x: -72, autoAlpha: 0 }, "top 80%", "top 48%");
    if (panel) enter(s6, [panel], compact ? { y: 32, autoAlpha: 0 } : { x: 84, autoAlpha: 0 }, "top 78%", "top 46%");
    enter(
      s6,
      [...s6.querySelectorAll("[data-seq='tab'], [data-seq='row-active'], [data-seq='row']")],
      compact ? { y: 20, autoAlpha: 0 } : { x: 40, autoAlpha: 0 },
      "top 70%",
      "top 34%",
    );
  }

  const s7 = scene("7");
  if (s7) {
    const lead = s7.querySelector(".order-1");
    if (lead) enter(s7, [lead], compact ? { y: 24, autoAlpha: 0 } : { x: -64, autoAlpha: 0 }, "top 82%", "top 52%");
    enter(
      s7,
      [...s7.querySelectorAll("[data-seq='step']")],
      compact ? { y: 22, autoAlpha: 0 } : { x: 72, autoAlpha: 0 },
      "top 76%",
      "top 30%",
    );
  }

  const s8 = scene("8");
  if (s8) {
    const heading = s8.querySelector("[data-seq='packages-title']");
    const lead = s8.querySelector("[data-seq='packages-lead']");
    enter(s8, [heading, lead].filter((item): item is Element => Boolean(item)), { y: 36, autoAlpha: 0 }, "top 84%", "top 60%");
    enter(s8, [...s8.querySelectorAll("[data-seq='plan']")], { y: 56, scale: 0.94, autoAlpha: 0 }, "top 72%", "top 28%");
  }

  const faq = root.querySelector("#faq");
  if (faq) {
    enter(
      faq,
      [...faq.querySelectorAll("[data-seq='faq-item']")],
      compact ? { y: 24, autoAlpha: 0 } : { x: (i: number) => (i % 2 ? 48 : -48), autoAlpha: 0 },
      "top 84%",
      "top 42%",
    );
  }

  const about = root.querySelector("[data-seq='about-block']");
  const contact = root.querySelector("[data-seq='contact-block']");
  if (about) enter(about, [about], compact ? { y: 28, autoAlpha: 0 } : { x: -70, autoAlpha: 0 }, "top 86%", "top 58%");
  if (contact) enter(contact, [contact], compact ? { y: 28, autoAlpha: 0 } : { x: 70, autoAlpha: 0 }, "top 84%", "top 56%");

  const footer = root.querySelector("[data-seq='footer']");
  if (footer) enter(footer, [footer], { y: 48, autoAlpha: 0 }, "top 96%", "top 68%");

  let refreshTimer = 0;
  const scheduleRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      measureRests();
      ScrollTrigger.refresh();
    }, 120);
  };
  const onOrientation = () => scheduleRefresh();
  window.addEventListener("orientationchange", onOrientation);
  window.visualViewport?.addEventListener("resize", scheduleRefresh);
  void document.fonts?.ready.then(scheduleRefresh);

  return () => {
    window.clearTimeout(refreshTimer);
    window.removeEventListener("orientationchange", onOrientation);
    window.visualViewport?.removeEventListener("resize", scheduleRefresh);
    if (lenisTick) gsap.ticker.remove(lenisTick);
    gsap.ticker.lagSmoothing(500, 33);
    if (lenis) {
      lenis.off("scroll", onLenisScroll);
      lenis.destroy();
    }
    root.classList.remove("motion-desktop", "motion-compact", "motion-theater", "motion-theater-ready");
    setTheaterBridge(root, null);
    ScrollTrigger.getAll().forEach((trigger) => {
      const el = trigger.trigger;
      if (!(el instanceof Node) || !root.contains(el)) return;
      trigger.kill();
    });
    const trace = root.querySelector("[data-trace]");
    if (trace) gsap.set(trace, { clearProps: "strokeDasharray,strokeDashoffset" });
    gsap.set(root.querySelectorAll("[data-seq='veil'], [data-seq='stage'], [data-story-phone]"), { clearProps: "all" });
    gsap.set(root.querySelectorAll("[data-phone-screen]"), {
      clearProps: "opacity,pointerEvents,visibility,zIndex",
    });
  };
}

export function playLandingMotion(root: HTMLElement) {
  const mm = gsap.matchMedia();

  mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => bindTheater(root, false));

  // Compact theater: same story + phone travel, adapted to the live viewport.
  mm.add("(max-width: 1023px) and (prefers-reduced-motion: no-preference)", () => bindTheater(root, true));

  return () => mm.revert();
}

/** Map nav/footer hashes to story scene ids used by the pinned theater. */
const HASH_TO_SCENE: Record<string, StoryId> = {
  story: "1",
  how: "2",
  reply: "3",
  enquiry: "4",
  handoff: "5",
  demo: "9",
  // Legacy nav target pointed at activation; business-type picker lives in demo.
  activities: "9",
};

/**
 * Scroll to a landing hash so pinned story chapters actually reveal their copy.
 * Native #hash alone leaves the theater on the intro while only updating the URL.
 */
export function scrollLandingHash(
  root: HTMLElement,
  rawHash: string,
  options?: { history?: "push" | "replace" | "none" },
) {
  const hash = rawHash.replace(/^#/, "");
  if (!hash) return;

  // Business types / sectors live in #demo; keep #activities as an alias.
  const resolvedHash = hash === "activities" ? "demo" : hash;
  const target = root.querySelector<HTMLElement>(`#${CSS.escape(resolvedHash)}`);
  const sceneId = HASH_TO_SCENE[hash] ?? HASH_TO_SCENE[resolvedHash];
  const historyMode = options?.history ?? "push";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollBehavior: ScrollBehavior = reduceMotion ? "instant" : "smooth";

  function writeHash() {
    if (historyMode === "none") return;
    const next = `#${resolvedHash}`;
    if (window.location.hash === next) return;
    try {
      if (historyMode === "push") history.pushState(null, "", next);
      else history.replaceState(null, "", next);
    } catch {
      /* ignore */
    }
  }

  if (sceneId && root.classList.contains("motion-theater")) {
    const bridge = theaterBridgeOf(root);
    if (bridge?.scrollToScene(sceneId)) {
      writeHash();
      // Compact rebuilds can miss the first scrub tick — nudge once more.
      window.requestAnimationFrame(() => {
        bridge.scrollToScene(sceneId);
      });
      return;
    }
  }

  if (target) {
    target.scrollIntoView({ behavior: scrollBehavior, block: "start" });
    writeHash();
    return;
  }

  // Non-story anchors (packages, faq, contact, setup, …)
  const fallback = root.querySelector<HTMLElement>(`#${CSS.escape(hash)}`);
  if (fallback) {
    fallback.scrollIntoView({ behavior: scrollBehavior, block: "start" });
    if (historyMode !== "none") {
      const next = `#${hash}`;
      if (window.location.hash !== next) {
        try {
          if (historyMode === "push") history.pushState(null, "", next);
          else history.replaceState(null, "", next);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/** Replays the sample inside the theater phone when motion is active. */
export function replaySample(root: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const theater = root.classList.contains("motion-theater");
  const scope = theater
    ? root.querySelector("[data-phone-screen='9']")
    : root.querySelector("[data-scene='9'] [data-seq='sample']");
  if (!scope) return;
  const question = scope.querySelector("[data-seq='question']");
  const answer = scope.querySelector("[data-seq='answer']");
  const phone = theater ? null : scope.querySelector("[data-seq='demo-phone']");
  const tl = gsap.timeline({ defaults: { ease: "power2.out", overwrite: "auto" } });
  if (phone) tl.fromTo(phone, { opacity: 0.7, y: 16 }, { opacity: 1, y: 0, duration: 0.35 }, 0);
  tl.fromTo(question, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28 }, 0.08).fromTo(
    answer,
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0, duration: 0.28 },
    0.32,
  );
}

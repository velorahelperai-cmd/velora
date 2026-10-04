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

const HEADER = 68;

export function playLandingMotion(root: HTMLElement) {
  const mm = gsap.matchMedia();
  const scene = (id: string) => root.querySelector<HTMLElement>(`[data-scene="${id}"]`);
  const q = <T extends Element = HTMLElement>(parent: Element | null, sel: string) =>
    parent ? parent.querySelector<T>(sel) : null;
  const all = (parent: Element | null, sel: string) => (parent ? parent.querySelectorAll(sel) : []);

  mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
    root.classList.add("motion-desktop");
    const rtl = getComputedStyle(document.documentElement).direction === "rtl";
    const side = rtl ? 1 : -1;

    const phone = root.querySelector<HTMLElement>("[data-story-phone]");
    const range = root.querySelector<HTMLElement>("[data-story-phone-range]");
    const phoneScreen = (id: string) => q(phone, `[data-phone-screen="${id}"]`);
    const slotOf = (s: Element | null) => (s ? s.querySelector<HTMLElement>("[data-phone-slot]") : null);
    const storyIds = ["1", "2", "3", "4", "5", "9"] as const;
    type Rest = { x: number; y: number; w: number; h: number; shift: number; yaw: number };
    let rests: Rest[] = storyIds.map(() => ({ x: 0, y: 72, w: 354, h: 531, shift: side * -56, yaw: 12 }));

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
      const raw = storyIds.map((id) => {
        const slot = slotOf(scene(id));
        const copy = q(scene(id), ".story-copy");
        const slotBox = slot?.getBoundingClientRect();
        const x = slotBox ? slotBox.left - rangeBox.left : 48;
        const copyX = copy ? copy.getBoundingClientRect().left - rangeBox.left : x;
        return {
          x,
          y: slotBox ? slotBox.top - rangeBox.top : 72,
          w: slotBox?.width || 300,
          h: slotBox?.height || 450,
          shift: copyX + 24 < x ? -56 : 56,
        };
      });
      const slotW = raw[0]?.w ?? 300;
      const slotH = raw[0]?.h ?? 450;
      const grow = 1.18;
      const w = Math.round(slotW * grow);
      const h = Math.round(slotH * grow);
      const yawFor = (x: number) => (x + w / 2 < rangeBox.width / 2 ? 1 : -1) * 12;
      rests = raw.map((item, index) => {
        const copy = q(scene(storyIds[index]), ".story-copy");
        const copyBox = copy?.getBoundingClientRect();
        const copyLeft = copyBox ? copyBox.left - rangeBox.left : null;
        const copyRight = copyBox ? copyLeft! + copyBox.width : null;
        const card = q(scene(storyIds[index]), ".source-card");
        const cardBox = card?.getBoundingClientRect();
        const cardLeft = cardBox ? cardBox.left - rangeBox.left : null;
        const cardRight = cardBox ? cardLeft! + cardBox.width : null;
        const project = 28;
        const minX = 16 + project - rangeBox.left;
        const maxX = window.innerWidth - 16 - project - rangeBox.left - w;
        let x = item.x - (w - item.w) / 2;
        let y = item.y - (h - item.h) / 2;
        y = gsap.utils.clamp(8, Math.max(8, rangeBox.height - h - 10), y);
        x = gsap.utils.clamp(minX, Math.max(minX, maxX), x);
        const bleed = Math.round((h / 2) * Math.sin((12 * Math.PI) / 180)) + 20;
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
        return { x, y, w, h, shift: item.shift, yaw: yawFor(x) };
      });
    };

    const lenis = new Lenis({
      autoRaf: false,
      lerp: 0.3,
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1,
      syncTouch: false,
    });
    const onLenisScroll = () => {
      ScrollTrigger.update();
    };
    lenis.on("scroll", onLenisScroll);
    const lenisTick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(lenisTick);
    gsap.ticker.lagSmoothing(0);

    const typingThenAnswer = (
      tl: gsap.core.Timeline,
      screenId: string,
      at: number,
    ) => {
      const screen = phoneScreen(screenId);
      const typing = q(screen, "[data-seq='typing']");
      const answer = q(screen, "[data-seq='answer']");
      if (typing) {
        tl.fromTo(
          typing,
          { autoAlpha: 0, height: 0, paddingTop: 0, paddingBottom: 0, borderColor: "transparent" },
          { autoAlpha: 1, height: 28, paddingTop: 6, paddingBottom: 6, borderColor: "#d7e4db", duration: 0.12, immediateRender: false },
          at,
        );
        tl.to(typing, { autoAlpha: 0, height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.08 }, at + 0.22);
      }
      if (answer) tl.fromTo(answer, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, immediateRender: false }, at + 0.34);
    };

    measureRests();
    if (phone && range) {
      const first = rests[0] ?? { x: 0, y: 72, w: 300, h: 450 };
      gsap.set(phone, {
        x: rests[0]?.x ?? first.x,
        y: rests[0]?.y ?? first.y,
        scale: 1,
        width: rests[0]?.w ?? first.w,
        height: rests[0]?.h ?? first.h,
        rotate: 0,
        rotationX: 4,
        rotationY: rests[0]?.yaw ?? 12,
        opacity: 1,
      });
      root.classList.add("motion-theater-ready");
      setScreenMix("1", "1", 0);
      storyIds.slice(1).forEach((id) => {
        const panel = scene(id);
        const answer = q(phoneScreen(id), "[data-seq='answer']");
        const menu = q(phoneScreen(id), "[data-seq='menu']");
        if (panel) gsap.set(panel, { autoAlpha: 0 });
        if (answer) gsap.set(answer, { autoAlpha: 0 });
        if (menu) gsap.set(menu, { autoAlpha: 0 });
      });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: range,
          start: `top ${HEADER}px`,
          end: () => `+=${Math.round(window.innerHeight * 5.7)}`,
          pin: true,
          pinSpacing: true,
          anticipatePin: 1,
          scrub: true,
          invalidateOnRefresh: true,
          onRefreshInit: measureRests,
          onRefresh: (self) => {
            if (self.progress < 0.02) setScreenMix("1", "1", 0);
          },
        },
      });

      const copyOf = (id: (typeof storyIds)[number]) => q(scene(id), ".story-copy");
      const visualOf = (id: (typeof storyIds)[number]) => q(scene(id), ".story-visual");
      const sideX = (index: number, amount = 96) => ((rests[index]?.shift ?? 56) < 0 ? -amount : amount);

      tl.set(phone, {
        x: () => rests[0]?.x ?? 0,
        y: () => rests[0]?.y ?? 0,
        width: () => rests[0]?.w ?? 354,
        height: () => rests[0]?.h ?? 531,
        rotationX: 4,
        rotationY: () => rests[0]?.yaw ?? 12,
        scale: 1,
      }, 0);
      tl.to(q(scene("1"), "[data-seq='environment']"), { yPercent: -6, ease: "none", duration: 0.35 }, 0);
      tl.to({}, { duration: 0.85 });

      const handoff = (from: (typeof storyIds)[number], to: (typeof storyIds)[number]) => {
        const fromIndex = storyIds.indexOf(from);
        const toIndex = storyIds.indexOf(to);
        const fromScene = scene(from);
        const toScene = scene(to);
        const fromCopy = copyOf(from);
        const toCopy = copyOf(to);
        const fromVisual = visualOf(from);
        const toVisual = visualOf(to);
        const at = tl.duration();
        if (toCopy) tl.set(toCopy, { x: () => sideX(toIndex), autoAlpha: 0, immediateRender: false }, at);
        if (toVisual) tl.set(toVisual, { x: () => -sideX(toIndex, 48), autoAlpha: 0, immediateRender: false }, at);
        const orbit = from === "1" ? q(phone, "[data-seq='orbit']") : null;
        if (orbit) tl.to(orbit, { autoAlpha: 0, duration: 0.28, immediateRender: false }, at);
        if (fromCopy) {
          tl.to(fromCopy, {
            x: () => sideX(fromIndex),
            autoAlpha: 0,
            duration: 0.34,
            ease: "power2.in",
            immediateRender: false,
          }, at);
        }
        if (fromVisual) {
          tl.to(fromVisual, {
            x: () => -sideX(fromIndex, 40),
            autoAlpha: 0,
            duration: 0.28,
            ease: "power2.in",
            immediateRender: false,
          }, at);
        }

        const travelAt = at + 0.22;
        const travelDur = 1.05;
        const travelSign = () => {
          const delta = (rests[toIndex]?.x ?? 0) - (rests[fromIndex]?.x ?? 0);
          return delta === 0 ? (rests[toIndex]?.yaw ?? 12) / 12 : Math.sign(delta);
        };
        tl.to(phone, {
          x: () => rests[toIndex]?.x ?? 0,
          y: () => rests[toIndex]?.y ?? 0,
          width: () => rests[toIndex]?.w ?? 354,
          height: () => rests[toIndex]?.h ?? 531,
          scale: 1,
          duration: travelDur,
          ease: "sine.inOut",
          immediateRender: false,
        }, travelAt);
        tl.to(phone, {
          rotationY: () => travelSign() * 18,
          rotationX: 5,
          duration: travelDur * 0.48,
          ease: "sine.inOut",
          immediateRender: false,
        }, travelAt);
        tl.to(phone, {
          rotationY: () => rests[toIndex]?.yaw ?? 12,
          rotationX: 4,
          duration: travelDur * 0.52,
          ease: "sine.out",
          immediateRender: false,
        }, travelAt + travelDur * 0.48);
        const mix = { t: 0 };
        tl.fromTo(mix, { t: 0, immediateRender: false }, {
          t: 1,
          duration: travelDur,
          ease: "none",
          onUpdate: () => setScreenMix(from, to, mix.t),
        }, travelAt);
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
          tl.to(toCopy, { x: 0, autoAlpha: 1, duration: 0.55, ease: "power2.out", immediateRender: false }, arrive);
        }
        if (toVisual) {
          tl.to(toVisual, { x: 0, autoAlpha: 1, duration: 0.45, ease: "power2.out", immediateRender: false }, arrive);
        }
        const readAt = arrive + 0.3;
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
      setScreenMix("1", "1", 0);
      gsap.set(scene("1"), { autoAlpha: 1 });
      gsap.set(phone, {
        x: rests[0]?.x ?? 0,
        y: rests[0]?.y ?? 72,
        scale: 1,
        rotationX: 4,
        rotationY: rests[0]?.yaw ?? 12,
        width: rests[0]?.w ?? 300,
        height: rests[0]?.h ?? 450,
      });
    }

    const enter = (
      trigger: Element,
      items: Element[],
      from: gsap.TweenVars,
      start: string,
      end: string,
    ) => {
      if (!items.length) return;
      gsap.fromTo(items, from, {
        x: 0,
        y: 0,
        scale: 1,
        autoAlpha: 1,
        stagger: 0.12,
        ease: "power2.out",
        scrollTrigger: { trigger, start, end, scrub: true },
      });
    };

    const s6 = scene("6");
    if (s6) {
      const lead = s6.querySelector(".order-1");
      const panel = s6.querySelector("[data-seq='panel']");
      if (lead) enter(s6, [lead], { x: -72, autoAlpha: 0 }, "top 80%", "top 48%");
      if (panel) enter(s6, [panel], { x: 84, autoAlpha: 0 }, "top 78%", "top 46%");
      enter(
        s6,
        [...s6.querySelectorAll("[data-seq='tab'], [data-seq='row-active'], [data-seq='row']")],
        { x: 40, autoAlpha: 0 },
        "top 70%",
        "top 34%",
      );
    }

    const s7 = scene("7");
    if (s7) {
      const lead = s7.querySelector(".order-1");
      if (lead) enter(s7, [lead], { x: -64, autoAlpha: 0 }, "top 82%", "top 52%");
      enter(s7, [...s7.querySelectorAll("[data-seq='step']")], { x: 72, autoAlpha: 0 }, "top 76%", "top 30%");
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
      enter(faq, [...faq.querySelectorAll("[data-seq='faq-item']")], { x: (i: number) => (i % 2 ? 48 : -48), autoAlpha: 0 }, "top 84%", "top 42%");
    }

    const about = root.querySelector("[data-seq='about-block']");
    const contact = root.querySelector("[data-seq='contact-block']");
    if (about) enter(about, [about], { x: -70, autoAlpha: 0 }, "top 86%", "top 58%");
    if (contact) enter(contact, [contact], { x: 70, autoAlpha: 0 }, "top 84%", "top 56%");

    const footer = root.querySelector("[data-seq='footer']");
    if (footer) enter(footer, [footer], { y: 48, autoAlpha: 0 }, "top 96%", "top 68%");

    return () => {
      gsap.ticker.remove(lenisTick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.off("scroll", onLenisScroll);
      lenis.destroy();
      root.classList.remove("motion-desktop", "motion-theater-ready");
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
  });

  // Mobile: lighter scrub, no pin/theater; content ends fully visible.
  mm.add("(max-width: 1023px) and (prefers-reduced-motion: no-preference)", () => {
    root.querySelectorAll("[data-scene]").forEach((section) => {
      const plans = section.querySelectorAll("[data-seq='plan']");
      if (plans.length) {
        gsap.fromTo(
          plans,
          { y: 18, opacity: 1 },
          {
            y: 0,
            opacity: 1,
            stagger: 0.08,
            ease: "none",
            scrollTrigger: { trigger: section, start: "top 88%", end: "top 40%", scrub: 0.35 },
          },
        );
      }
      const copy = section.querySelector(".story-copy");
      // Scene 1 must stay readable on first paint. Later scenes rise vertically only —
      // a sideways tween caused horizontal overflow on narrow phones.
      if (copy && section.getAttribute("data-scene") !== "1") {
        gsap.fromTo(
          copy,
          { y: 22, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            ease: "power2.out",
            scrollTrigger: { trigger: section, start: "top 90%", end: "top 58%", scrub: 0.35 },
          },
        );
      }
      const parts = section.querySelectorAll(
        ".story-phone-local, .phone-shell:not(.story-theater-phone), .source-card, [data-seq='step'], [data-seq='panel'], [data-seq='chip']",
      );
      if (!parts.length) return;
      gsap.fromTo(
        parts,
        { y: 16, opacity: 1 },
        {
          y: 0,
          opacity: 1,
          stagger: 0.06,
          ease: "none",
          scrollTrigger: { trigger: section, start: "top 88%", end: "top 42%", scrub: 0.35 },
        },
      );
    });
    const trace = root.querySelector("[data-trace]");
    if (trace) gsap.set(trace, { clearProps: "strokeDasharray,strokeDashoffset" });
  });

  return () => mm.revert();
}

/** Replays the sample inside the visible phone: the theater screen, or the local phone below 1024. */
export function replaySample(root: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const theater = root.classList.contains("motion-desktop");
  const scope = theater
    ? root.querySelector("[data-phone-screen='9']")
    : root.querySelector("[data-scene='9'] [data-seq='sample']");
  if (!scope) return;
  const question = scope.querySelector("[data-seq='question']");
  const answer = scope.querySelector("[data-seq='answer']");
  const phone = theater ? null : scope.querySelector("[data-seq='demo-phone']");
  const tl = gsap.timeline({ defaults: { ease: "power2.out", overwrite: "auto" } });
  if (phone) tl.fromTo(phone, { opacity: 0.7, y: 16 }, { opacity: 1, y: 0, duration: 0.35 }, 0);
  tl.fromTo(question, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28 }, 0.08)
    .fromTo(answer, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28 }, 0.32);
}

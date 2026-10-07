import gsap from "gsap";

let registered = false;

export function registerPreviewGsap() {
  if (registered || typeof window === "undefined") return;
  registered = true;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Stagger cards + soft ambient loops. Cleanup kills all tweens on root. */
export function playPreviewBoardMotion(root: HTMLElement, scenarioKey: string) {
  registerPreviewGsap();
  void scenarioKey;

  if (prefersReducedMotion()) {
    gsap.set(root.querySelectorAll("[data-preview-card], [data-preview-hero], [data-preview-banner], [data-preview-next]"), {
      opacity: 1,
      y: 0,
      clearProps: "transform",
    });
    return () => {
      gsap.killTweensOf(root.querySelectorAll("*"));
    };
  }

  const cards = root.querySelectorAll<HTMLElement>("[data-preview-card]");
  const heroes = root.querySelectorAll<HTMLElement>("[data-preview-hero]");
  const banners = root.querySelectorAll<HTMLElement>("[data-preview-banner]");
  const nextStep = root.querySelector<HTMLElement>("[data-preview-next]");
  const character = root.querySelector<HTMLElement>("[data-preview-character]");
  const avatar = root.querySelector<HTMLElement>("[data-preview-avatar]");
  const badgeDots = root.querySelectorAll<HTMLElement>("[data-preview-badge-dot]");

  const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
  const targets = [...heroes, ...banners, ...(nextStep ? [nextStep] : []), ...cards];
  gsap.set(targets, { opacity: 0, y: 16 });

  tl.to(heroes, { opacity: 1, y: 0, duration: 0.45, stagger: 0.06 }, 0);
  if (banners.length) tl.to(banners, { opacity: 1, y: 0, duration: 0.4, stagger: 0.05 }, 0.06);
  if (nextStep) tl.to(nextStep, { opacity: 1, y: 0, duration: 0.45 }, 0.1);
  tl.to(cards, { opacity: 1, y: 0, duration: 0.5, stagger: 0.07 }, 0.14);

  if (nextStep) {
    gsap.fromTo(
      nextStep,
      { boxShadow: "0 0 0 0 rgba(8, 116, 67, 0)" },
      {
        boxShadow: "0 0 32px 0 rgba(56, 220, 137, 0.35)",
        duration: 1.8,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      },
    );
  }

  if (character && avatar) {
    gsap.to(avatar, {
      y: -8,
      duration: 2.4,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });
    gsap.to(character, {
      borderColor: "rgba(8, 116, 67, 0.45)",
      duration: 2.8,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });
  }

  badgeDots.forEach((dot, i) => {
    gsap.to(dot, {
      scale: 1.35,
      opacity: 0.55,
      duration: 1.2,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
      delay: i * 0.2,
    });
  });

  return () => {
    tl.kill();
    gsap.killTweensOf(root.querySelectorAll("*"));
  };
}

export function playPreviewShellMotion(root: HTMLElement) {
  registerPreviewGsap();
  if (prefersReducedMotion()) return;

  const header = root.querySelector<HTMLElement>("[data-preview-header]");
  const ambient = root.querySelector<HTMLElement>("[data-preview-ambient]");

  if (header) {
    gsap.fromTo(
      header,
      { y: -12, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.45, ease: "power2.out" },
    );
  }

  if (ambient) {
    gsap.to(ambient, {
      backgroundPosition: "80% 40%",
      duration: 14,
      ease: "none",
      repeat: -1,
      yoyo: true,
    });
  }
}

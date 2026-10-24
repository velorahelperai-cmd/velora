// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { landingCopy } from "@/lib/landing-copy";
import { SourceCard } from "./conversation-stage";
import { Packages } from "./packages";
import { AboutContact } from "./about-contact";
import { SiteFooter } from "./footer";

const routeState = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => routeState.path }));
let paused: WeakMap<HTMLMediaElement, boolean>;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  routeState.path = "/";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
  paused = new WeakMap<HTMLMediaElement, boolean>();
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function(this: HTMLMediaElement) { return paused.get(this) ?? true; });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function(this: HTMLMediaElement) { paused.set(this, false); this.dispatchEvent(new Event("play")); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) { if (paused.get(this) === false) { paused.set(this, true); this.dispatchEvent(new Event("pause")); } });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function click(node: Element) { node.dispatchEvent(new MouseEvent("click", { bubbles: true })); }

describe("approved homepage integration contracts", () => {
  it("keeps each card tier independent and never treats pricing controls as video selection", async () => {
    const select = vi.fn();
    await act(async () => root.render(createElement(Packages, { copy: landingCopy("en"), locale: "en", selectedPlan: null, onSelect: select, offersView: { status: "empty", offers: [] } })));
    const play = vi.mocked(HTMLMediaElement.prototype.play), calls = play.mock.calls.length;
    const cards = host.querySelectorAll("article.persona");
    await act(async () => click(cards[0].querySelectorAll(".plan-segment button")[1]));
    expect(cards[0].querySelector(".price")!.textContent).toContain("90.000");
    expect(cards[1].querySelector(".price")!.textContent).toContain("65.000");
    expect(cards[2].querySelector(".price")!.textContent).toContain("90.000");
    expect((cards[2].querySelector(".cta") as HTMLButtonElement).disabled).toBe(false);
    expect(cards[2].querySelector("[data-purchase-state]")!.getAttribute("data-purchase-state")).toBe("unavailable");
    await act(async () => click(host.querySelectorAll(".segment button")[1]));
    expect(cards[2].querySelector(".price")!.textContent).toContain("864.000");
    expect(play.mock.calls.length).toBe(calls); expect(select).not.toHaveBeenCalled();
    await act(async () => click(cards[1].querySelector("button.character")!));
    const videos = [...host.querySelectorAll<HTMLVideoElement>("article.persona video")];
    expect(videos.map(video => video.paused)).toEqual([true, false, true]);
    expect(videos[1].getAttribute("src")).toContain("lina-en-");
    expect(host.querySelectorAll(".preview-track")[0].querySelectorAll(".preview-dot")[1].classList.contains("active")).toBe(true);
    expect(select).not.toHaveBeenCalled();
  });
  it("switches to the actual locale sources and preserves the explicit sound preference", async () => {
    const props = { selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty" as const, offers: [] } };
    await act(async () => root.render(createElement(Packages, { ...props, copy: landingCopy("ar"), locale: "ar" })));
    const old = [...host.querySelectorAll<HTMLVideoElement>("article.persona video")];
    await act(async () => host.querySelector("button.character")!.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true })));
    expect(old[0].muted).toBe(true);
    await act(async () => root.render(createElement(Packages, { ...props, copy: landingCopy("en"), locale: "en" })));
    expect(old.every(video => video.paused && !video.hasAttribute("src"))).toBe(true);
    expect(host.querySelector<HTMLVideoElement>("article.persona video")!.getAttribute("src")).toContain("noura-en-");
    expect(host.querySelector<HTMLVideoElement>("article.persona video")!.muted).toBe(true);
    expect(host.querySelectorAll(".preview-caption")[0].textContent).toBe("Cultural preview");
  });
  it("exposes a manual draft on clipboard denial without sending a server request", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied")), fetch = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } }); vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(createElement(AboutContact, { copy: landingCopy("en"), locale: "en", sector: "services", plan: "support", question: "Please discuss follow-up for our business.", onQuestion: vi.fn(), onSector: vi.fn() })));
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect((host.querySelector(".manual textarea") as HTMLTextAreaElement).value).toContain("Please discuss follow-up");
    expect(host.querySelector(".manual a")!.getAttribute("href")).toContain("mailto:velorahelperai@gmail.com?subject=");
    expect(host.querySelector('[role="status"]')!.textContent).toContain("manually");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fences a pending clipboard result when locale changes", async () => {
    let resolve!: () => void;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(() => new Promise<void>(done => { resolve = done; })) } });
    const common = { sector: "services" as const, plan: null, question: "Details about customer follow-up.", onQuestion: vi.fn(), onSector: vi.fn() };
    await act(async () => root.render(createElement(AboutContact, { ...common, copy: landingCopy("ar"), locale: "ar" })));
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => root.render(createElement(AboutContact, { ...common, copy: landingCopy("en"), locale: "en" })));
    await act(async () => root.render(createElement(AboutContact, { ...common, copy: landingCopy("ar"), locale: "ar" })));
    await act(async () => resolve());
    expect(host.querySelector('[role="status"]')!.textContent).toBe("");
    expect(host.querySelector("button[type=submit]")!.hasAttribute("disabled")).toBe(false);
  });
  it("preserves legal routes and registered company details", async () => {
    await act(async () => root.render(createElement(SiteFooter, { copy: landingCopy("en"), locale: "en" })));
    const links = [...host.querySelectorAll("nav a")].map(link => link.getAttribute("href"));
    expect(links).toEqual(expect.arrayContaining(["#about", "#how", "#packages", "#contact", "/privacy", "/terms", "/data-deletion"]));
    expect(host.textContent).toContain("1480610"); expect(host.textContent).toContain("TAG CITY TRAD LLC");
  });
});

describe("minimal package controls", () => {
  it.each(["ar", "en"] as const)("removes the redundant helper and large pills while retaining card actions and accessible character interaction in %s", async locale => {
    await act(async () => root.render(createElement(Packages, { copy: landingCopy(locale), locale, selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty", offers: [] } })));
    expect(host.querySelector(".catalog-next")).toBeNull();
    expect(host.querySelectorAll(".global-controls > button")).toHaveLength(0);
    expect(host.querySelectorAll(".segment button")).toHaveLength(2);
    expect(host.querySelectorAll("article .cta")).toHaveLength(3);
    expect(host.querySelector(".character-controls")).toBeNull();
    host.querySelectorAll("button.character").forEach(button => { expect(button.getAttribute("aria-keyshortcuts")).toBe("M"); expect(button.getAttribute("aria-describedby")).toBeTruthy(); });
  });
});

describe("lazy preview accessibility", () => {
  it("keeps all three preview actions enabled before their media loads", async () => {
    await act(async () => root.render(createElement(Packages, { copy: landingCopy("en"), locale: "en", selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty", offers: [] } })));
    const previews = [...host.querySelectorAll("button.character")]; expect(previews).toHaveLength(3);
    previews.forEach(button => { expect(button.hasAttribute("disabled")).toBe(false); expect(button.getAttribute("aria-label")).toContain("Play preview"); expect(button.querySelector("video")!.getAttribute("aria-hidden")).toBe("true"); });
    expect(host.querySelector("video[role=button]")).toBeNull();
  });
});

describe("media control focus", () => {
  it("retains keyboard focus when automatic playback advances", async () => {
    await act(async () => root.render(createElement(Packages, { copy: landingCopy("en"), locale: "en", selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty", offers: [] } })));
    const mute = host.querySelector("button.character") as HTMLButtonElement; mute.focus();
    const first = host.querySelector<HTMLVideoElement>("article.persona video")!; Object.defineProperty(first, "ended", { configurable: true, value: true });
    await act(async () => first.dispatchEvent(new Event("ended", { bubbles: true })));
    expect(host.querySelectorAll(".preview-dot")[1].classList.contains("active")).toBe(true);
    expect(document.activeElement).toBe(mute); expect(mute.isConnected).toBe(true);
  });
});

describe("restored film and comparison disclosure", () => {
  it("keeps the original standalone film above and separate from the three character previews", async () => {
    await act(async () => root.render(createElement(Packages, { copy: landingCopy("en"), locale: "en", selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty", offers: [] } })));
    const film = host.querySelector('video[src="/assets/subscription/velora-intro.mp4"]')!;
    expect(film).not.toBeNull(); expect(film.closest("article.persona")).toBeNull();
    expect(film.getAttribute("poster")).toBe("/assets/subscription/velora-intro-poster.jpg");
    expect(host.querySelectorAll<HTMLVideoElement>("article.persona video")).toHaveLength(3);
    expect(film.compareDocumentPosition(host.querySelector("#packages")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it.each(["ar", "en"] as const)("opens and closes the real comparison without invoking character playback in %s", async locale => {
    await act(async () => root.render(createElement(Packages, { copy: landingCopy(locale), locale, selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty", offers: [] } })));
    const toggle = host.querySelector<HTMLButtonElement>(".compare-toggle")!;
    expect(toggle).not.toBeNull(); expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const region = host.querySelector("#" + toggle.getAttribute("aria-controls"))!;
    expect(region.getAttribute("aria-hidden")).toBe("true"); expect(region.hasAttribute("inert")).toBe(true);
    const before = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    await act(async () => click(toggle));
    expect(toggle.getAttribute("aria-expanded")).toBe("true"); expect(region.getAttribute("aria-hidden")).toBe("false"); expect(region.hasAttribute("inert")).toBe(false);
    expect(region.querySelector("table")!.textContent).toContain("90.000");
    await act(async () => click(host.querySelectorAll(".segment button")[1]));
    expect(region.querySelector("table")!.textContent).toContain("864.000");
    expect(vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length).toBe(before);
    await act(async () => click(toggle)); expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
  it("pauses with the character action and changes mute preference from its keyboard shortcut", async () => {
    await act(async () => root.render(createElement(Packages, { copy: landingCopy("en"), locale: "en", selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty", offers: [] } })));
    const character = host.querySelector("button.character")!;
    const video = character.querySelector("video")!; video.currentTime = 2.5;
    await act(async () => click(character));
    expect([...host.querySelectorAll<HTMLVideoElement>("article.persona video")].every(video => (video as HTMLVideoElement).paused)).toBe(true);
    await act(async () => character.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true })));
    expect([...host.querySelectorAll<HTMLVideoElement>("article.persona video")].every(video => (video as HTMLVideoElement).muted)).toBe(true);
    await act(async () => click(character));
    expect((character.querySelector("video") as HTMLVideoElement).paused).toBe(false);
    expect(video.currentTime).toBe(2.5);
  });
});

describe("homepage media route and lifecycle fence", () => {
  const props = () => ({ copy: landingCopy("en"), locale: "en" as const, selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty" as const, offers: [] } });
  it("stops both film and character media on pagehide and resumes only after pageshow on the homepage", async () => {
    await act(async () => root.render(createElement(Packages, props())));
    const media = [...host.querySelectorAll("video")];
    expect(media.filter(video => !video.paused)).toHaveLength(2);
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(media.every(video => video.paused)).toBe(true);
    await act(async () => click(host.querySelectorAll("button.character")[1]));
    expect(media.every(video => video.paused)).toBe(true);
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    expect(media.filter(video => !video.paused)).toHaveLength(2);
  });
  it.each(["/login", "/signup"])("keeps retained homepage media paused while the active route is %s", async path => {
    await act(async () => root.render(createElement(Packages, props())));
    const media = [...host.querySelectorAll("video")];
    routeState.path = path;
    await act(async () => root.render(createElement(Packages, props())));
    expect(media.every(video => video.paused)).toBe(true);
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    expect(media.every(video => video.paused)).toBe(true);
    routeState.path = "/";
    await act(async () => root.render(createElement(Packages, props())));
    expect([...host.querySelectorAll("video")].filter(video => !video.paused)).toHaveLength(2);
  });
  it("fences delayed film and character play completion after unmount", async () => {
    const pending: Array<{video: HTMLMediaElement; finish: () => void}> = [];
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function(this: HTMLMediaElement) {
      paused.set(this, false);
      return new Promise<void>(resolve => pending.push({video: this, finish: resolve}));
    });
    await act(async () => root.render(createElement(Packages, props())));
    const media = [...host.querySelectorAll("video")]; expect(new Set(pending.map(request => request.video)).size).toBe(2);
    await act(async () => root.render(null));
    expect(media.every(video => video.paused)).toBe(true);
    await act(async () => { for (const request of pending) { paused.set(request.video, false); request.finish(); } });
    expect(media.every(video => video.paused)).toBe(true);
  });
});

describe("compact comparison semantics and contact example", () => {
  it.each(["ar", "en"] as const)("marks plan inclusion without claiming readiness in %s", async locale => {
    await act(async () => root.render(createElement(Packages, { copy: landingCopy(locale), locale, selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty", offers: [] } })));
    const mark = host.querySelector(".feature-inclusion")!;
    expect(mark).not.toBeNull(); expect(mark.textContent).toBe("✓");
    expect(mark.getAttribute("aria-label")).toBe(locale === "ar" ? "ضمن الباقة" : "Included in plan");
    expect(mark.parentElement!.textContent).toContain(locale === "ar" ? "قيد التجهيز" : "Being prepared");
    const scroll = host.querySelector(".feature-comparison-scroll")!;
    expect(scroll.getAttribute("role")).toBe("region"); expect(scroll.getAttribute("tabindex")).toBe("0");
    expect(scroll.querySelectorAll("thead th[scope=col]")).toHaveLength(7);
    expect([...scroll.querySelectorAll("tbody td")].some(cell => cell.textContent === "—")).toBe(true);
  });
  it.each(["ar", "en"] as const)("shows a realistic empty-field example and preserves an entered inquiry across rerenders in %s", async locale => {
    const props = { copy: landingCopy(locale), locale, sector: "services" as const, plan: null, onQuestion: vi.fn(), onSector: vi.fn() };
    await act(async () => root.render(createElement(AboutContact, { ...props, question: "" })));
    const field = host.querySelector("form textarea") as HTMLTextAreaElement;
    expect(field.value).toBe("");
    expect(field.placeholder).toBe(locale === "ar" ? "عندي متجر وعايز أنظّم استفسارات العملاء على واتساب وإنستجرام؛ أنهي باقة تناسبني؟" : "I run a store and want to organize customer inquiries on WhatsApp and Instagram. Which plan would suit me?");
    const inquiry = "Please keep my own business inquiry unchanged.";
    await act(async () => root.render(createElement(AboutContact, { ...props, question: inquiry, sector: "restaurant" })));
    expect(field.value).toBe(inquiry); expect(props.onQuestion).not.toHaveBeenCalled();
  });
});

describe("card feature viewport and premium marker", () => {
  it.each(["ar", "en"] as const)("keeps feature scrolling separate from its footer and adds three decorative crowns in %s", async locale => {
    await act(async () => root.render(createElement(Packages, { copy: landingCopy(locale), locale, selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty", offers: [] } })));
    const cards = [...host.querySelectorAll("article.persona")];
    for (const card of cards) {
      const viewport = card.querySelector(".feature-viewport")!;
      expect(viewport).not.toBeNull(); expect(viewport.hasAttribute("data-lenis-prevent")).toBe(true);
      expect(viewport.getAttribute("tabindex")).toBe("0");
      expect(card.querySelector(".plan-footer .cta")).not.toBeNull();
      expect(card.querySelector(".plan-footer .purchase-note")).not.toBeNull();
      const crown = card.querySelectorAll(".plan-segment button")[1].querySelector(".premium-crown")!;
      expect(crown).not.toBeNull(); expect(crown.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("intro request ownership", () => {
  const props = () => ({ copy: landingCopy("en"), locale: "en" as const, selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty" as const, offers: [] } });
  it("keeps an explicit film pause when lifecycle visibility returns", async () => {
    await act(async () => root.render(createElement(Packages, props())));
    const film = host.querySelector<HTMLVideoElement>('video[src*="velora-intro"]')!;
    await act(async () => click(film)); expect(film.paused).toBe(true);
    await act(async () => { window.dispatchEvent(new Event("pagehide")); window.dispatchEvent(new Event("pageshow")); });
    expect(film.paused).toBe(true);
  });
  it("does not let an old film promise pause the newer active-route owner", async () => {
    const pending: Array<{video: HTMLMediaElement; finish: () => void}> = [];
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function(this: HTMLMediaElement) {
      paused.set(this, false); return new Promise<void>(resolve => pending.push({video: this, finish: resolve}));
    });
    await act(async () => root.render(createElement(Packages, props())));
    const film = host.querySelector<HTMLVideoElement>('video[src*="velora-intro"]')!;
    const stale = pending.find(request => request.video === film)!;
    routeState.path = "/login"; await act(async () => root.render(createElement(Packages, props())));
    routeState.path = "/"; await act(async () => root.render(createElement(Packages, props())));
    const latest = pending.filter(request => request.video === film).at(-1)!;
    expect(latest).not.toBe(stale);
    await act(async () => latest.finish()); expect(film.paused).toBe(false);
    await act(async () => stale.finish()); expect(film.paused).toBe(false);
  });
});

describe("history exit before React commit", () => {
  it("stops homepage media on popstate before the retained page rerenders", async () => {
    await act(async () => root.render(createElement(Packages, { copy: landingCopy("en"), locale: "en", selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty", offers: [] } })));
    const media = [...host.querySelectorAll("video")];
    await act(async () => { window.history.pushState({}, "", "/signup"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(media.every(video => video.paused)).toBe(true);
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    expect(media.every(video => video.paused)).toBe(true);
  });
});

describe("illustrative team summary", () => {
  it("uses a team icon and labeled rows while retaining the unconfirmed booking wording", async () => {
    await act(async () => root.render(createElement(SourceCard, { team: true, title: "ملخص للفريق", body: "الخدمة: جلسة عناية بالشعر\nالموعد: السبت 4:00 عصراً\nالأخصائية: ريم\nالمطلوب: مراجعة الجدول وتأكيد الحجز" })));
    const card = host.querySelector("[data-team-summary]")!;
    expect(card).not.toBeNull(); expect(card.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(card.querySelectorAll("dt")).toHaveLength(4); expect(card.querySelectorAll("dd")).toHaveLength(4);
    expect(card.querySelectorAll("dd")[1].textContent).toBe("السبت 4:00 عصراً");
    expect(card.textContent).toContain("مراجعة الجدول وتأكيد الحجز");
  });
});

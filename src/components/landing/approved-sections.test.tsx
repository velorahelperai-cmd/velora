// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { landingCopy } from "@/lib/landing-copy";
import { Packages } from "./packages";
import { AboutContact } from "./about-contact";
import { SiteFooter } from "./footer";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
  const paused = new WeakMap<HTMLMediaElement, boolean>();
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
    await act(async () => cards[1].querySelector("video")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const videos = [...host.querySelectorAll("video")];
    expect(videos.map(video => video.paused)).toEqual([true, false, true]);
    expect(videos[1].getAttribute("src")).toContain("lina-en-");
    expect(host.querySelectorAll(".preview-track")[0].querySelectorAll(".preview-dot")[1].classList.contains("active")).toBe(true);
    expect(select).not.toHaveBeenCalled();
  });
  it("switches to the actual locale sources and preserves the explicit sound preference", async () => {
    const props = { selectedPlan: null, onSelect: vi.fn(), offersView: { status: "empty" as const, offers: [] } };
    await act(async () => root.render(createElement(Packages, { ...props, copy: landingCopy("ar"), locale: "ar" })));
    const old = [...host.querySelectorAll("video")];
    await act(async () => click(host.querySelectorAll(".global-controls > button")[0]));
    expect(old[0].muted).toBe(false);
    await act(async () => root.render(createElement(Packages, { ...props, copy: landingCopy("en"), locale: "en" })));
    expect(old.every(video => video.paused && !video.hasAttribute("src"))).toBe(true);
    expect(host.querySelector("video")!.getAttribute("src")).toContain("noura-en-");
    expect(host.querySelector("video")!.muted).toBe(false);
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

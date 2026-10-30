// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LandingPage } from "./landing-page";
import { DemoProvider } from "@/lib/demo-state";
import { AccountSessionProvider } from "@/components/app/account-chrome";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {}, push() {} }), usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({href,children,...props}: {href:string;children:React.ReactNode}) => createElement("a", {href,...props}, children) }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => createElement("img", {alt:"",...props}) }));
vi.mock("@gsap/react", () => ({ useGSAP: () => undefined }));
vi.mock("@/lib/landing-motion", () => ({ registerLandingMotion() {}, playLandingMotion: () => ({kill(){}}), scrollLandingHash() {} }));
vi.mock("./packages", () => ({ Packages: () => null }));
vi.mock("./story-scenes", () => ({ StoryScenes: () => null, Catalogue: () => null }));
vi.mock("./landing-chatbot", () => ({ LandingChatbot: () => null }));
it("closes the mobile navigation on Escape and returns focus to its trigger", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  /* eslint-disable react/no-children-prop -- provider typings require children in props */
  await act(async () => root.render(createElement(DemoProvider,{initialLocale:"en",children:createElement(AccountSessionProvider,{children:createElement(LandingPage,{initialLocale:"en"})})})));
  /* eslint-enable react/no-children-prop */
  const button = [...host.querySelectorAll("button")].find(el => el.textContent === "Menu")!;
  await act(async () => button.click());
  expect(button.getAttribute("aria-expanded")).toBe("true");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(button);
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

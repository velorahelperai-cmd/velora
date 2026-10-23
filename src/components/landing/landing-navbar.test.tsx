import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DemoProvider } from "@/lib/demo-state";
import { AccountSessionProvider } from "@/components/app/account-chrome";
import { LandingPage } from "@/components/landing/landing-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode; className?: string }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => createElement("img", { alt: "", ...props }),
}));

vi.mock("@gsap/react", () => ({ useGSAP: () => undefined }));

vi.mock("@/lib/landing-motion", () => ({
  registerLandingMotion: () => undefined,
  playLandingMotion: () => ({ kill: () => undefined }),
  scrollLandingHash: () => undefined,
}));

function renderLanding(locale: "ar" | "en") {
  return renderToStaticMarkup(
    createElement(DemoProvider, {
      initialLocale: locale,
      children: createElement(AccountSessionProvider, {
        children: createElement(LandingPage, { initialLocale: locale }),
      }),
    }),
  );
}

describe("landing navbar structure", () => {
  it("keeps a fixed header with compensatory spacer (ar)", () => {
    const html = renderLanding("ar");
    expect(html).toContain('data-landing-nav="fixed"');
    expect(html).toContain("fixed inset-x-0 top-0");
    expect(html).toContain("data-landing-nav-spacer");
    expect(html).toContain("h-16");
    expect(html).not.toContain("sticky top-0");
  });

  it("keeps a fixed header with compensatory spacer (en)", () => {
    const html = renderLanding("en");
    expect(html).toContain('data-landing-nav="fixed"');
    expect(html).toContain("data-landing-nav-spacer");
    expect(html).toContain("scroll-mt-16");
  });

  it("exposes primary nav anchors and shows Sign-in / Create-account while session is loading", () => {
    const html = renderLanding("ar");
    expect(html).toContain('href="#how"');
    expect(html).toContain('href="#demo"');
    expect(html).toContain('href="#packages"');
    expect(html).toContain('href="#faq"');
    expect(html).toContain('data-account-chrome="public"');
    expect(html).toContain("min-w-[12.5rem]");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("تعذّر جلب هوية الحساب");
  });

  it("keeps mobile menu trigger, locale chooser control, and start CTA wiring", () => {
    const html = renderLanding("en");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Menu");
    expect(html).toContain('aria-label="Choose language"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain(">EN<");
    expect(html).toContain('href="/signup"');
    const ar = renderLanding("ar");
    expect(ar).toContain('aria-label="اختيار اللغة"');
    expect(ar).toContain('aria-haspopup="listbox"');
    expect(ar).toContain(">AR<");
  });
});


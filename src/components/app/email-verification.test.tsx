import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: "email=qa-a%40example.test", locale: "ar" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: state.locale, state: {} }) }));
vi.mock("@/components/app/account-chrome", () => ({ AccountMenu: () => null, useOptionalAccountSession: () => null }));
vi.mock("@/components/app/auth-motion-canvas", () => ({ AuthMotionCanvas: () => null }));
vi.mock("@/lib/tenancy/actions", () => ({
  completeProfileName: vi.fn(), requestPasswordReset: vi.fn(), resendVerificationEmail: vi.fn(),
  resolvePostAuthPath: vi.fn(), signUpWithEmail: vi.fn(), updatePassword: vi.fn(), verifyEmailCode: vi.fn(),
}));
import { LoginPage, VerifyEmailPage } from "./auth-pages";

describe("email confirmation UI", () => {
  it.each(["ar", "en"])("offers an accessible six-digit code on %s without browser storage as proof", (locale) => {
    state.locale = locale; state.query = "email=qa-a%40example.test";
    const html = renderToStaticMarkup(createElement(VerifyEmailPage));
    expect(html).toContain('data-auth-entry-card="true"');
    expect(html).toContain('data-auth-otp-modal="true"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('inputMode="numeric"');
    expect((html.match(/data-auth-otp-cell="/g) ?? []).length).toBe(6);
    expect(html).not.toContain('type="password"');
    expect(html).toContain(locale === "ar" ? "6 أرقام" : "6 digits");
  });
  it("explains the missing-browser verification context without exposing the SDK diagnostic", () => {
    state.locale = "ar"; state.query = "error=verification_browser";
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toContain("متصفح");
    expect(html).not.toContain("PKCE");
    expect(html).not.toContain("code verifier");
  });
});

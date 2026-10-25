import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { appCopy } from "@/lib/app-copy";
import { AuthOtpModal } from "./auth-otp-modal";

vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en", state: {}, update: vi.fn() }) }));
vi.mock("./ui", async () => {
  const actual = await vi.importActual<typeof import("./ui")>("./ui");
  return {
    ...actual,
    useAppCopy: () => appCopy("en"),
    useErrorText: () => undefined,
  };
});

const base = {
  open: true,
  email: "qa@example.test",
  title: "Confirm your email",
  body: "Enter the confirmation code of 6 digits sent to qa@example.test.",
  realBody: "Read the code on any device.",
  codeLabel: "Email confirmation code — 6 digits",
  codeHint: "Do not share it.",
  codeFormat: "Enter the complete code: 6 digits.",
  verifyLabel: "Verify",
  resendLabel: "Resend",
  resendInLabel: "Resend in 60s",
  resentNotice: "Sent",
  correctEmailLabel: "Correct email",
  correctEmailHint: "Opens signup.",
  loginLabel: "Sign in",
  loginHref: "/login",
  closeLabel: "Close",
  onClose: vi.fn(),
  onSubmitCode: vi.fn(),
  onResend: vi.fn(),
  onCorrectEmail: vi.fn(),
  onSuccessAnimDone: vi.fn(),
};

describe("AuthOtpModal", () => {
  it("renders six digit cells with OTP autofill hooks and no fake success chrome", () => {
    const html = renderToStaticMarkup(createElement(AuthOtpModal, base));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-auth-otp-modal="true"');
    expect(html).toContain('data-auth-otp-phase="input"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('dir="ltr"');
    expect((html.match(/data-auth-otp-cell="/g) ?? []).length).toBe(6);
    expect(html).toContain("6 digits");
    expect(html).not.toContain("data-auth-otp-success");
    expect(html).not.toContain("Remember me");
  });

  it("does not show success check until verified is true", () => {
    const waiting = renderToStaticMarkup(createElement(AuthOtpModal, { ...base, verified: false }));
    expect(waiting).not.toContain("data-auth-otp-success");
    const done = renderToStaticMarkup(createElement(AuthOtpModal, { ...base, verified: true }));
    // Static markup still starts at input until effects run — verified alone must not invent filled digits.
    expect(done).not.toMatch(/auto-verify|setTimeout\(.*done/i);
  });

  it("sizes OTP cells to the scene without full-width translated anchors or overflow-x clip hacks", () => {
    const html = renderToStaticMarkup(createElement(AuthOtpModal, {
      ...base,
      error: "تغيّرت جلسة المتصفح أو انتهت. أغلق هذه النافذة وسجّل الدخول مجددًا للمتابعة بأمان.",
    }));
    expect(html).toContain("--otp-cell:");
    expect(html).toContain("100cqi");
    expect(html).toContain("container-type: inline-size");
    expect(html).toContain("width: 0");
    expect(html).toContain("height: 0");
    expect(html).toContain("min-w-0");
    expect(html).toContain("break-words");
    expect(html).not.toMatch(/overflow-x:\s*hidden/);
    expect(html).not.toContain('minHeight:"44px"');
    expect(html).not.toContain("minHeight: \"44px\"");
    expect(html).not.toMatch(/auth-otp-anchor[^>]*inset-0/);
    // Input anchors use slot-center percentages, not ±% of a full-width box.
    expect(html).toMatch(/left:8\.333/);
    expect(html).toMatch(/left:91\.666/);
  });
});

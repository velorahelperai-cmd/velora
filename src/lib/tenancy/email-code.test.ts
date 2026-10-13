vi.mock('server-only',()=>({}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyContext } from "./types";

const state = vi.hoisted(() => ({ client: vi.fn(), verify: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: state.client }));
vi.mock("@/lib/billing/operations/actions", () => ({ readSubscriptionJourneyAction: vi.fn() }));
vi.mock("@/lib/knowledge/actions", () => ({ listKnowledgeSources: vi.fn() }));
vi.mock("@/lib/whatsapp/connection-actions", () => ({ getWhatsappCompanyLink: vi.fn() }));
vi.mock("@/lib/tenancy/access", async (original) => ({
  ...await original<typeof import("./access")>(), getCompanyAccess: state.access,
}));
import * as actions from "./actions";

type CodeAction = (input: { email: string; code: string; next?: string }) => Promise<{
  ok: boolean; code?: string; message?: string; data?: { next: string };
}>;
async function submit(input = { email: "qa-a@example.test", code: "012345", next: "" }) {
  const action = Reflect.get(actions, "verifyEmailCode");
  expect(action, "email confirmation must support six-digit OTP without a PKCE verifier").toBeTypeOf("function");
  return (action as CodeAction)(input);
}
const user = { id: "synthetic-user-a", email: "qa-a@example.test", email_confirmed_at: "2026-10-10T00:00:00Z" };
const context: CompanyContext = {
  userId: user.id, email: user.email, phone: "", fullName: "QA A", supportCode: "",
  needsProfileName: false, emailConfirmed: true, identityVerified: true, isPlatformAdmin: false,
  company: null, membership: null, needsCompanyContext: false, workspaceChoices: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.client.mockResolvedValue({ auth: { verifyOtp: state.verify } });
  state.verify.mockResolvedValue({ data: { user, session: { user } }, error: null });
  state.access.mockResolvedValue({ ok: true, context });
});

describe("six-digit signup confirmation with offline Auth boundary", () => {
  it.each([
    null, {}, { name: 42, email: "qa@example.test", password: "password", confirmPassword: "password" },
    { name: "QA", email: "invalid", password: "password", confirmPassword: "password" },
    { name: "a".repeat(121), email: "qa@example.test", password: "password", confirmPassword: "password" },
    { name: "QA", email: "qa@example.test", password: null, confirmPassword: "password" },
  ])("rejects malformed signup input before contacting Auth: %j", async input => {
    expect(await actions.signUpWithEmail(input as Parameters<typeof actions.signUpWithEmail>[0])).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(state.client).not.toHaveBeenCalled();
  });
  it("confirms in a fresh browser and keeps leading zeroes without exchanging a PKCE code", async () => {
    expect(await submit({ email: " QA-A@example.test ", code: "012345", next: "" })).toEqual({ ok: true, data: { next: "/setup" } });
    expect(state.verify).toHaveBeenCalledExactlyOnceWith({ email: user.email, token: "012345", type: "email" });
  });
  it.each(["٠١٢٣٤٥", "۰۱۲۳۴۵"])("accepts six localized digits: %s", async (code) => {
    expect((await submit({ email: user.email, code, next: "" })).ok).toBe(true);
    expect(state.verify).toHaveBeenCalledWith({ email: user.email, token: "012345", type: "email" });
  });
  it.each(["12345", "1234567", "12a456", "123 45", ""])("rejects malformed code before contacting Auth: %s", async (code) => {
    expect(await submit({ email: user.email, code, next: "" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(state.client).not.toHaveBeenCalled();
  });
  it("rejects an invalid email before contacting Auth", async () => {
    expect(await submit({ email: "not-an-email", code: "012345", next: "" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(state.client).not.toHaveBeenCalled();
  });
  it("retains the chosen plan but refuses an external or privileged return destination", async () => {
    const plan = "/app/settings?tab=plan&term=monthly&persona=level_1&package=basic";
    expect(await submit({ email: user.email, code: "012345", next: plan })).toEqual({ ok: true, data: { next: `/setup?next=${encodeURIComponent(plan)}` } });
    for (const next of ["https://example.test/steal", "/admin"]) {
      expect(await submit({ email: user.email, code: "012345", next })).toEqual({ ok: true, data: { next: "/setup" } });
    }
  });
  it("refuses wrong, expired or replayed codes without exposing provider diagnostics", async () => {
    state.verify.mockResolvedValue({ data: { user: null, session: null }, error: { code: "otp_expired", status: 403, message: "private provider diagnostic" } });
    const result = await submit();
    expect(result).toMatchObject({ ok: false, code: "AUTH_ERROR", message: "verification_code_invalid" });
    expect(JSON.stringify(result)).not.toContain("private provider");
    expect(state.access).not.toHaveBeenCalled();
  });
  it("does not treat replay after a successful confirmation as another success", async () => {
    state.verify.mockResolvedValueOnce({ data: { user, session: { user } }, error: null })
      .mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: "otp_expired", status: 403 } });
    expect((await submit()).ok).toBe(true);
    expect((await submit()).ok).toBe(false);
    expect(state.access).toHaveBeenCalledTimes(1);
  });
  it("honors the provider rate limit", async () => {
    state.verify.mockResolvedValue({ data: { user: null, session: null }, error: { status: 429, code: "over_request_rate_limit" } });
    expect(await submit()).toMatchObject({ ok: false, message: "verification_rate_limited" });
  });
  it("does not retry a timeout after the provider may have consumed the code", async () => {
    state.verify.mockRejectedValue(new Error("synthetic timeout"));
    expect(await submit()).toMatchObject({ ok: false, message: "verification_unavailable" });
    expect(state.verify).toHaveBeenCalledTimes(1);
    expect(state.access).not.toHaveBeenCalled();
  });
  it.each([
    { user: { ...user, email_confirmed_at: null }, session: { user } },
    { user, session: null },
    { user: { ...user, email: "qa-b@example.test" }, session: { user } },
    { user, session: { user: { ...user, id: "synthetic-user-b" } } },
  ])("requires matching confirmed identity and session, not just error:null", async (data) => {
    state.verify.mockResolvedValue({ data, error: null });
    expect(await submit()).toMatchObject({ ok: false, message: "verification_incomplete" });
    expect(state.access).not.toHaveBeenCalled();
  });
});

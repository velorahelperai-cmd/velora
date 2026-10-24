vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyContext } from "./types";

const NONCE = "synthetic-request-nonce";
const INTENT = { id: "synthetic-verify-intent", stateNonce: "synthetic-state-nonce", browserLineageId: "synthetic-lineage" };
const BOUNDARY = "0123456789abcdef";

const state = vi.hoisted(() => ({
  createProvider: vi.fn(),
  verify: vi.fn(),
  signup: vi.fn(),
  resend: vi.fn(),
  access: vi.fn(),
  prepare: vi.fn(),
  reserve: vi.fn(),
  claim: vi.fn(),
  admit: vi.fn(),
  cleanup: vi.fn(),
  cookieClient: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: state.cookieSet,
    get: () => undefined,
    getAll: () => [],
    delete: state.cookieSet,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: state.cookieClient }));
vi.mock("@/lib/auth/broker/provider", () => ({ createProviderAuthClient: state.createProvider }));
vi.mock("@/lib/auth/broker/lineage-auth", () => ({ prepareBrokerAdmissionLineage: state.prepare }));
vi.mock("@/lib/auth/broker/crypto", () => ({ encryptSecret: () => Buffer.from("synthetic-encrypted") }));
vi.mock("@/lib/auth/broker/cookies", () => ({ commitIntentCookie: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  const query = { update: () => query, eq: () => query, is: () => query,
    select: async () => ({ data: [{ id: INTENT.id }], error: null }) };
  return { from: () => query };
} }));
vi.mock("@/lib/auth/broker", () => ({
  admitNativeSession: state.admit,
  prepareBrokerAdmissionLineage: state.prepare,
}));
vi.mock("@/lib/auth/broker/registry", () => ({
  reserveBoundAuthIntent: state.reserve,
  claimProviderAttempt: state.claim,
  probeBrokerCapability: async () => ({ ok: true, boundAdmit: true }),
  loadAuthIntentByNonce: async () => ({ ...INTENT, purpose: "signup_resend", status: "reserved", expiresAt: new Date(Date.now() + 600_000).toISOString(), pkceVerifier: null }),
}));
vi.mock("@/lib/auth/broker/provider-session", () => ({
  signOutProviderSessionAfterAdmitFailure: state.cleanup,
}));
vi.mock("@/lib/billing/operations/actions", () => ({ readSubscriptionJourneyAction: vi.fn() }));
vi.mock("@/lib/knowledge/actions", () => ({ listKnowledgeSources: vi.fn() }));
vi.mock("@/lib/whatsapp/connection-actions", () => ({ getWhatsappCompanyLink: vi.fn() }));
vi.mock("@/lib/tenancy/access", async (original) => ({
  ...await original<typeof import("./access")>(),
  getCompanyAccess: state.access,
}));
import * as actions from "./actions";

type CodeAction = (input: {
  email: string;
  code: string;
  next?: string;
  requestNonce?: string | null;
}) => Promise<{ ok: boolean; code?: string; message?: string; data?: { next: string } }>;

async function submit(
  input: { email: string; code: string; next?: string; requestNonce?: string | null } = {
    email: "qa-a@example.test",
    code: "012345",
    next: "",
    requestNonce: NONCE,
  },
) {
  const action = Reflect.get(actions, "verifyEmailCode");
  expect(action, "email confirmation must support six-digit OTP without a PKCE verifier").toBeTypeOf("function");
  return (action as CodeAction)(input);
}

const user = { id: "synthetic-user-a", email: "qa-a@example.test", email_confirmed_at: "2026-10-10T00:00:00Z" };
const context: CompanyContext = {
  userId: user.id,
  email: user.email,
  phone: "",
  fullName: "QA A",
  supportCode: "",
  needsProfileName: false,
  emailConfirmed: true,
  identityVerified: true,
  isPlatformAdmin: false,
  company: null,
  membership: null,
  needsCompanyContext: false,
  workspaceChoices: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.createProvider.mockImplementation((options?: { persistPkceVerifier?: (v: string) => Promise<void> }) => ({
    client: { auth: { verifyOtp: state.verify, signUp: state.signup, resend: async (input: unknown) => {
      await options?.persistPkceVerifier?.("synthetic-verifier");
      return state.resend(input);
    } } },
  }));
  state.cookieClient.mockResolvedValue({ auth: { verifyOtp: state.verify, resend: state.resend } });
  state.resend.mockResolvedValue({ error: null });
  state.verify.mockResolvedValue({ data: { user, session: { user } }, error: null });
  state.access.mockResolvedValue({ ok: true, context });
  state.prepare.mockResolvedValue({
    ok: true,
    bootstrapHash: "synthetic-root",
    browserLineageId: INTENT.browserLineageId,
  });
  state.reserve.mockResolvedValue(INTENT);
  state.claim.mockResolvedValue({ ok: true, claimed: true });
  state.admit.mockResolvedValue({ ok: true, committed: { userId: user.id, boundaryFingerprint: BOUNDARY } });
  state.cleanup.mockResolvedValue({ outcome: "confirmed", durable: true });
});

describe("six-digit signup confirmation with offline Auth boundary", () => {
  it.each([
    null,
    {},
    { name: 42, email: "qa@example.test", password: "password", confirmPassword: "password" },
    { name: "QA", email: "invalid", password: "password", confirmPassword: "password" },
    { name: "a".repeat(121), email: "qa@example.test", password: "password", confirmPassword: "password" },
    { name: "QA", email: "qa@example.test", password: null, confirmPassword: "password" },
  ])("rejects malformed signup input before contacting Auth: %j", async (input) => {
    expect(await actions.signUpWithEmail(input as Parameters<typeof actions.signUpWithEmail>[0])).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(state.createProvider).not.toHaveBeenCalled();
    expect(state.signup).not.toHaveBeenCalled();
  });

  it("refuses signup without a request nonce before contacting Auth", async () => {
    expect(
      await actions.signUpWithEmail({
        name: "QA",
        email: "qa@example.test",
        password: "password1",
        confirmPassword: "password1",
      }),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(state.createProvider).not.toHaveBeenCalled();
    expect(state.signup).not.toHaveBeenCalled();
  });

  it("refuses verify without a request nonce before contacting Auth", async () => {
    expect(await submit({ email: user.email, code: "012345", next: "" })).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      message: "verification_unavailable",
    });
    expect(state.createProvider).not.toHaveBeenCalled();
    expect(state.verify).not.toHaveBeenCalled();
  });

  it("confirms in a fresh browser and keeps leading zeroes without exchanging a PKCE code", async () => {
    expect(await submit({ email: " QA-A@example.test ", code: "012345", next: "", requestNonce: NONCE })).toEqual({
      ok: true,
      data: { next: "/setup", userId: user.id, boundaryFingerprint: BOUNDARY },
    });
    expect(state.verify).toHaveBeenCalledExactlyOnceWith({ email: user.email, token: "012345", type: "email" });
    expect(state.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "verify_email", requestNonce: NONCE, bootstrapHash: "synthetic-root" }),
    );
    expect(state.admit).toHaveBeenCalledTimes(1);
  });

  it.each(["٠١٢٣٤٥", "۰۱۲۳۴۵"])("accepts six localized digits: %s", async (code) => {
    expect((await submit({ email: user.email, code, next: "", requestNonce: NONCE })).ok).toBe(true);
    expect(state.verify).toHaveBeenCalledWith({ email: user.email, token: "012345", type: "email" });
  });

  it.each(["12345", "1234567", "12a456", "123 45", ""])(
    "rejects malformed code before contacting Auth: %s",
    async (code) => {
      expect(await submit({ email: user.email, code, next: "", requestNonce: NONCE })).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(state.createProvider).not.toHaveBeenCalled();
      expect(state.verify).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid email before contacting Auth", async () => {
    expect(await submit({ email: "not-an-email", code: "012345", next: "", requestNonce: NONCE })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(state.createProvider).not.toHaveBeenCalled();
  });

  it("retains the chosen plan but refuses an external or privileged return destination", async () => {
    const plan = "/app/settings?tab=plan&term=monthly&persona=level_1&package=basic";
    expect(await submit({ email: user.email, code: "012345", next: plan, requestNonce: NONCE })).toEqual({
      ok: true,
      data: { next: `/setup?next=${encodeURIComponent(plan)}`, userId: user.id, boundaryFingerprint: BOUNDARY },
    });
    for (const next of ["https://example.test/steal", "/admin"]) {
      expect(await submit({ email: user.email, code: "012345", next, requestNonce: NONCE })).toEqual({
        ok: true,
        data: { next: "/setup", userId: user.id, boundaryFingerprint: BOUNDARY },
      });
    }
  });

  it("refuses wrong, expired or replayed codes without exposing provider diagnostics", async () => {
    state.verify.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "otp_expired", status: 403, message: "private provider diagnostic" },
    });
    const result = await submit();
    expect(result).toMatchObject({ ok: false, code: "AUTH_ERROR", message: "verification_code_invalid" });
    expect(JSON.stringify(result)).not.toContain("private provider");
    expect(state.access).not.toHaveBeenCalled();
    expect(state.admit).not.toHaveBeenCalled();
  });

  it("does not treat replay after a successful confirmation as another success", async () => {
    state.verify
      .mockResolvedValueOnce({ data: { user, session: { user } }, error: null })
      .mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: "otp_expired", status: 403 } });
    expect((await submit()).ok).toBe(true);
    expect((await submit()).ok).toBe(false);
    expect(state.access).toHaveBeenCalledTimes(1);
  });

  it("honors the provider rate limit", async () => {
    state.verify.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 429, code: "over_request_rate_limit" },
    });
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
    expect(state.admit).not.toHaveBeenCalled();
  });
});

describe("verification resend validates mailbox before Auth transport", () => {
  it.each([null, 42, "not-an-email", "a@", "a b@example.test", "a".repeat(250) + "@example.test"])(
    "rejects malformed mailbox %j locally",
    async (email) => {
      expect(await actions.resendVerificationEmail(email as string)).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(state.cookieClient).not.toHaveBeenCalled();
    },
  );

  it("normalizes a valid mailbox and uses native signup resend", async () => {
    expect(await actions.resendVerificationEmail(" QA-A@example.test ", "/setup", NONCE)).toMatchObject({ ok: true });
    expect(state.resend).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "signup", email: user.email, options: { emailRedirectTo: expect.stringContaining(`vel_intent=${INTENT.stateNonce}`) } }),
    );
  });
});

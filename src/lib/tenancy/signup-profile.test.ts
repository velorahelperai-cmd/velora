import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const NONCE = "synthetic-request-nonce";
const INTENT = { id: "synthetic-signup-intent", browserLineageId: "synthetic-lineage" };
const uid = "synthetic-user";

const mocks = vi.hoisted(() => ({
  signup: vi.fn(),
  upsert: vi.fn(),
  cookie: vi.fn(),
  access: vi.fn(),
  createProvider: vi.fn(),
  prepare: vi.fn(),
  reserve: vi.fn(),
  claim: vi.fn(),
  admit: vi.fn(),
  cleanup: vi.fn(),
  bound: vi.fn(),
  member: vi.fn(),
  from: vi.fn(),
  commit: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: mocks.cookie,
    get: () => undefined,
    getAll: () => [],
    delete: mocks.cookie,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signUp: mocks.signup },
    from: () => ({ upsert: mocks.upsert }),
  }),
  createBrokerBoundClient: mocks.bound,
}));
vi.mock("@/lib/auth/broker/provider", () => ({ createProviderAuthClient: mocks.createProvider }));
vi.mock("@/lib/auth/broker", () => ({
  admitNativeSession: mocks.admit,
  prepareBrokerAdmissionLineage: mocks.prepare,
  commitWorkspaceForGeneration: mocks.commit,
}));
vi.mock("@/lib/auth/broker/registry", () => ({
  reserveBoundAuthIntent: mocks.reserve,
  claimProviderAttempt: mocks.claim,
}));
vi.mock("@/lib/auth/broker/provider-session", () => ({
  signOutProviderSessionAfterAdmitFailure: mocks.cleanup,
}));
vi.mock("@/lib/tenancy/access", async (original) => ({
  ...await original<typeof import("./access")>(),
  getCompanyAccess: mocks.access,
}));

import { signUpWithEmail, selectWorkspaceCompany } from "./actions";

const input = {
  name: "New Name",
  email: "qa@example.test",
  password: "test-password",
  confirmPassword: "test-password",
  requestNonce: NONCE,
};
const user = { id: uid, email: input.email, email_confirmed_at: null as string | null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createProvider.mockReturnValue({ client: { auth: { signUp: mocks.signup } } });
  mocks.signup.mockResolvedValue({ data: { user, session: null }, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.prepare.mockResolvedValue({
    ok: true,
    bootstrapHash: "synthetic-root",
    browserLineageId: INTENT.browserLineageId,
  });
  mocks.reserve.mockResolvedValue(INTENT);
  mocks.claim.mockResolvedValue({ ok: true, claimed: true });
  mocks.admit.mockResolvedValue({ ok: true });
  mocks.cleanup.mockResolvedValue({ outcome: "confirmed", durable: true });
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: mocks.member,
  };
  mocks.from.mockReturnValue(query);
  mocks.member.mockResolvedValue({
    data: { company_id: "company-a", user_id: uid, status: "active" },
    error: null,
  });
  mocks.bound.mockResolvedValue({
    bound: {
      ok: true,
      client: { from: mocks.from },
      resolve: { boundary: { userId: uid, generation: "generation-a" } },
    },
  });
  mocks.commit.mockImplementation((store, generation, userId, companyId) => {
    store.set(`velora_ws_${generation}`, `${userId}:${companyId}`);
  });
});

describe("signup profile recovery without recreating Auth", () => {
  it("refuses signup without a request nonce before contacting Auth", async () => {
    const { requestNonce: _omit, ...withoutNonce } = input;
    expect(await signUpWithEmail(withoutNonce)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.signup).not.toHaveBeenCalled();
  });

  it("does not attempt a profile write before email verification", async () => {
    expect(await signUpWithEmail(input)).toMatchObject({ ok: true, data: { needsVerification: true } });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "signup_email", requestNonce: NONCE }),
    );
    expect(mocks.admit).not.toHaveBeenCalled();
  });

  it("does not write a profile for the provider's obfuscated existing-user response", async () => {
    mocks.signup.mockResolvedValue({
      data: { user: { ...user, identities: [] }, session: null },
      error: null,
    });
    expect(await signUpWithEmail(input)).toMatchObject({ ok: true, data: { needsVerification: true } });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("handles an explicit existing account error with the same neutral verification flow", async () => {
    mocks.signup.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "user_already_exists", message: "private account information" },
    });
    expect(await signUpWithEmail(input)).toMatchObject({
      ok: true,
      data: { needsVerification: true, email: input.email },
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("inserts without replacing a persisted profile when a confirmed session is returned", async () => {
    const confirmed = { ...user, email_confirmed_at: "confirmed" };
    mocks.signup.mockResolvedValue({ data: { user: confirmed, session: { user: confirmed } }, error: null });
    expect(await signUpWithEmail(input)).toMatchObject({ ok: true, data: { needsVerification: false } });
    expect(mocks.admit).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: user.id, full_name: input.name },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  });

  it.each(["error", "throw"])("keeps the created Auth account recoverable on profile %s", async (mode) => {
    const confirmed = { ...user, email_confirmed_at: "confirmed" };
    mocks.signup.mockResolvedValue({ data: { user: confirmed, session: { user: confirmed } }, error: null });
    if (mode === "error") mocks.upsert.mockResolvedValue({ error: { code: "42501", message: "private persistence failure" } });
    else mocks.upsert.mockRejectedValue(new Error("private persistence failure"));
    const result = await signUpWithEmail(input);
    expect(result).toMatchObject({
      ok: true,
      data: { needsVerification: false, profilePending: true },
      diagnostic: { stage: "profile", code: "UNAVAILABLE" },
    });
    expect(JSON.stringify(result)).not.toContain("private persistence failure");
    expect(mocks.signup).toHaveBeenCalledTimes(1);
  });

  it("refuses to treat a mismatched session as a confirmed signup", async () => {
    mocks.signup.mockResolvedValue({
      data: {
        user: { ...user, email_confirmed_at: "confirmed" },
        session: { user: { ...user, id: "other" } },
      },
      error: null,
    });
    expect(await signUpWithEmail(input)).toMatchObject({ ok: false, code: "AUTH_ERROR" });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.admit).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("workspace selection resumes the selected role's journey", () => {
  const context = {
    userId: uid,
    needsProfileName: false,
    isPlatformAdmin: false,
    company: null,
    membership: null,
    needsCompanyContext: true,
    workspaceChoices: [{ companyId: "company-a" }],
  };

  it("validates the rendered account before changing the workspace cookie", async () => {
    mocks.access.mockResolvedValue({ ok: true, context });
    expect(await selectWorkspaceCompany("company-a", { expectedUserId: "other" })).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(mocks.cookie).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.bound).not.toHaveBeenCalled();
  });

  it("rechecks selection and returns setup with the saved subscription intent", async () => {
    mocks.access
      .mockResolvedValueOnce({ ok: true, context })
      .mockResolvedValueOnce({
        ok: true,
        context: {
          ...context,
          needsCompanyContext: false,
          company: { id: "company-a", status: "setup" },
          membership: { role: "owner" },
        },
      });
    const next = "/app/settings?tab=plan";
    expect(await selectWorkspaceCompany("company-a", { expectedUserId: uid, next })).toMatchObject({
      ok: true,
      data: { companyId: "company-a", next: `/setup?next=${encodeURIComponent(next)}` },
    });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.member).toHaveBeenCalledTimes(2);
  });

  it("sends staff to conversations even when the previous intent was setup", async () => {
    mocks.access
      .mockResolvedValueOnce({ ok: true, context })
      .mockResolvedValueOnce({
        ok: true,
        context: {
          ...context,
          needsCompanyContext: false,
          company: { id: "company-a", status: "setup" },
          membership: { role: "staff" },
        },
      });
    expect(await selectWorkspaceCompany("company-a", { expectedUserId: uid, next: "/setup" })).toMatchObject({
      ok: true,
      data: { next: "/app/conversations" },
    });
  });
});

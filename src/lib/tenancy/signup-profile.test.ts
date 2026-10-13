import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ signup: vi.fn(), upsert: vi.fn(), cookie: vi.fn(), access: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.cookie, delete: mocks.cookie }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { signUp: mocks.signup }, from: () => ({ upsert: mocks.upsert }),
}) }));
vi.mock("@/lib/tenancy/access", async original => ({ ...await original<typeof import("./access")>(), getCompanyAccess: mocks.access }));
import { signUpWithEmail, selectWorkspaceCompany } from "./actions";
const input = { name: "New Name", email: "qa@example.test", password: "test-password", confirmPassword: "test-password" };
const user = { id: "synthetic-user", email: input.email, email_confirmed_at: null as string | null };
beforeEach(() => { vi.clearAllMocks(); mocks.signup.mockResolvedValue({ data: { user, session: null }, error: null }); mocks.upsert.mockResolvedValue({ error: null }); });
describe("signup profile recovery without recreating Auth", () => {
  it("does not attempt a profile write before email verification", async () => {
    expect(await signUpWithEmail(input)).toMatchObject({ ok: true, data: { needsVerification: true } });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("does not write a profile for the provider's obfuscated existing-user response", async () => {
    mocks.signup.mockResolvedValue({ data: { user: { ...user, identities: [] }, session: null }, error: null });
    expect(await signUpWithEmail(input)).toMatchObject({ ok: true, data: { needsVerification: true } });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("handles an explicit existing account error with the same neutral verification flow", async () => {
    mocks.signup.mockResolvedValue({ data: { user: null, session: null }, error: { code: "user_already_exists", message: "private account information" } });
    expect(await signUpWithEmail(input)).toMatchObject({ ok: true, data: { needsVerification: true, email: input.email } });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("inserts without replacing a persisted profile when a confirmed session is returned", async () => {
    const confirmed = { ...user, email_confirmed_at: "confirmed" };
    mocks.signup.mockResolvedValue({ data: { user: confirmed, session: { user: confirmed } }, error: null });
    expect(await signUpWithEmail(input)).toMatchObject({ ok: true, data: { needsVerification: false } });
    expect(mocks.upsert).toHaveBeenCalledWith({ user_id: user.id, full_name: input.name }, { onConflict: "user_id", ignoreDuplicates: true });
  });
  it.each(["error", "throw"])("keeps the created Auth account recoverable on profile %s", async mode => {
    const confirmed = { ...user, email_confirmed_at: "confirmed" };
    mocks.signup.mockResolvedValue({ data: { user: confirmed, session: { user: confirmed } }, error: null });
    if (mode === "error") mocks.upsert.mockResolvedValue({ error: { code: "42501", message: "private persistence failure" } });
    else mocks.upsert.mockRejectedValue(new Error("private persistence failure"));
    const result = await signUpWithEmail(input);
    expect(result).toMatchObject({ ok: true, data: { needsVerification: false, profilePending: true }, diagnostic: { stage: "profile", code: "UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain("private persistence failure");
    expect(mocks.signup).toHaveBeenCalledTimes(1);
  });
  it("refuses to treat a mismatched session as a confirmed signup", async () => {
    mocks.signup.mockResolvedValue({ data: { user: { ...user, email_confirmed_at: "confirmed" }, session: { user: { ...user, id: "other" } } }, error: null });
    expect(await signUpWithEmail(input)).toMatchObject({ ok: false, code: "AUTH_ERROR" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
describe("workspace selection resumes the selected role's journey", () => {
  const context = { userId: user.id, needsProfileName: false, isPlatformAdmin: false, company: null, membership: null,
    needsCompanyContext: true, workspaceChoices: [{ companyId: "company-a" }] };
  it("validates the rendered account before changing the workspace cookie", async () => {
    mocks.access.mockResolvedValue({ ok: true, context });
    expect(await selectWorkspaceCompany("company-a", { expectedUserId: "other" })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
  it("rechecks selection and returns setup with the saved subscription intent", async () => {
    mocks.access.mockResolvedValueOnce({ ok: true, context }).mockResolvedValueOnce({ ok: true,
      context: { ...context, needsCompanyContext: false, company: { id: "company-a", status: "setup" }, membership: { role: "owner" } } });
    const next = "/app/settings?tab=plan";
    expect(await selectWorkspaceCompany("company-a", { expectedUserId: user.id, next })).toMatchObject({ ok: true, data: { companyId: "company-a", next: `/setup?next=${encodeURIComponent(next)}` } });
  });
  it("sends staff to conversations even when the previous intent was setup", async () => {
    mocks.access.mockResolvedValueOnce({ ok: true, context }).mockResolvedValueOnce({ ok: true,
      context: { ...context, needsCompanyContext: false, company: { id: "company-a", status: "setup" }, membership: { role: "staff" } } });
    expect(await selectWorkspaceCompany("company-a", { expectedUserId: user.id, next: "/setup" })).toMatchObject({ ok: true, data: { next: "/app/conversations" } });
  });
});

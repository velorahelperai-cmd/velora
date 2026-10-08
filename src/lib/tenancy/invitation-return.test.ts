import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { pathForAccess } from "./access";
import type { CompanyContext } from "./types";

const invitation = `/accept-invite?token=${"a".repeat(43)}`;
const context: CompanyContext = {
  userId: "account", email: "member@example.com", phone: "", fullName: "Member", supportCode: "",
  needsProfileName: false, emailConfirmed: true, identityVerified: true, isPlatformAdmin: false,
  company: null, membership: null, needsCompanyContext: false, workspaceChoices: [],
};
describe("invitation acceptance through the Auth journey", () => {
  it("returns a verified new account to invitation acceptance before business setup", () => {
    expect(pathForAccess({ ok: true, context }, invitation)).toBe(invitation);
  });
  it("preserves profile completion and the invitation return", () => {
    expect(pathForAccess({ ok: true, context: { ...context, needsProfileName: true } }, invitation)).toBe(`/complete-profile?next=${encodeURIComponent(invitation)}`);
  });
  it("preserves confirmation and session-expiry gates", () => {
    expect(pathForAccess({ ok: false, code: "UNVERIFIED" }, invitation)).toBe(`/verify-email?next=${encodeURIComponent(invitation)}`);
    expect(pathForAccess({ ok: false, code: "UNAUTHENTICATED", sessionExpired: true }, invitation)).toBe("/login?reason=session_expired");
  });
  it("does not allow invitation routing to bypass failures or grant workspace access", () => {
    expect(pathForAccess({ ok: false, code: "FORBIDDEN" }, invitation)).toBe("/access?code=FORBIDDEN");
    expect(pathForAccess({ ok: true, context }, "/app/conversations")).toBe(`/setup?next=${encodeURIComponent("/app/conversations")}`);
  });
});

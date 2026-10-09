import { describe, expect, it, vi } from "vitest";
import { decideClaimedTenantSend } from "./send-attempt";

// The secret boundary is unavailable locally; exercise the actual binding gate
// with an offline token so missing retained generation cannot hide behind setup.
vi.mock("@/lib/whatsapp/access-secrets", () => ({
  lookupWhatsappAccessSecret: () => ({ ok: true, accessToken: "offline-fixture-token" }),
}));

const input = {
  companyId: "company-offline-a", phoneNumberId: "phone-offline-a", recipientWaId: "10000000001",
  conversation: { companyId: "company-offline-a", phoneNumberId: "phone-offline-a", customerWaId: "10000000001" },
  resolved: { ok: true as const, eligible: true as const, companyId: "company-offline-a", linkId: "link-offline-a",
    linkGeneration: 1, providerPhoneNumberId: "phone-offline-a", status: "verified" },
  intentLinkId: "link-offline-a", intentLinkGeneration: 1,
};

describe("retained claimed tenant generation", () => {
  it.each([null, NaN, 0, 1.5])("rejects invalid retained generation %s before Graph", (generation) => {
    expect(decideClaimedTenantSend({ ...input, intentLinkGeneration: generation }))
      .toEqual({ action: "rejected", code: "link_changed" });
  });
  it("rejects a claimed tenant intent that lost its link id", () => {
    expect(decideClaimedTenantSend({ ...input, intentLinkId: null }))
      .toEqual({ action: "rejected", code: "link_changed" });
  });
  it("permits only the same retained link generation with a scoped secret", () => {
    expect(decideClaimedTenantSend(input)).toEqual({ action: "graph", accessToken: "offline-fixture-token" });
  });
});

import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SetupDraftRecord } from "@/lib/tenancy/setup-draft";
vi.mock("@/lib/tenancy/setup-draft-actions", () => ({ setupDraftLifecycleAction: vi.fn() }));
import { SetupDraftLifecycleControls } from "./setup-draft-lifecycle-controls";
const record: SetupDraftRecord = { draft: { version: 1, userId: "owner", companyId: null, business: { name: "", type: "other", replyLanguage: "both", country: "OM", city: "", hours: "", contactPhone: "", contactEmail: "" }, businessSaved: false, setupDone: [], setupStep: 0 }, revision: 1, updatedAt: "2026-10-14", draftId: "d1", generation: 1, state: "active", expiresAt: "2026-11-13T12:00:00Z", paidProtected: false, cleanupPolicy: "UNCONFIGURED" };
const render = (patch: Partial<SetupDraftRecord>) => renderToStaticMarkup(<SetupDraftLifecycleControls scope={{ expectedUserId: "owner", expectedCompanyId: null }} record={{ ...record, ...patch }} ar={false} onChange={() => {}} onClosed={() => {}} />);
it("paid protection does not show the free deadline as a deletion promise", () => {
  const html = render({ paidProtected: true, expiresAt: null });
  expect(html).toContain("Payment protects this setup"); expect(html).not.toContain("Free draft expires");
});
it("closed drafts expose cleanup pending without writable controls or a deletion success claim", () => {
  const html = render({ state: "cancelled" });
  expect(html).toContain("File deletion is not complete"); expect(html).not.toContain("Keep draft"); expect(html).not.toContain("Close draft");
});
it("unbound legacy receipts cannot expose mutation controls", () => {
  const html = render({ draftId: undefined, generation: undefined });
  expect(html).toContain("Reload the saved draft"); expect(html).not.toContain("Keep draft");
});

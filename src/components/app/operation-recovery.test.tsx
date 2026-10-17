import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => state }));
vi.mock("@/lib/auth/broker-actions", () => ({ acknowledgeBrokerClientCleanupAction: vi.fn(), recoveryReauthForOperationAction: vi.fn(), resumeBrokerOperationAction: vi.fn() }));
import { OperationRecovery } from "./operation-recovery";

it.each(["en", "ar"])("unknown response has an honest %s safe return without a false busy/success state", locale => {
  state.locale = locale;
  const html = renderToStaticMarkup(<OperationRecovery receipt={null} isCaptured={() => true} />);
  expect(html).toContain('href="/login"');
  expect(html).toContain(locale === "ar" ? "لم نتمكن من تأكيد" : "Completion could not be confirmed");
  expect(html).not.toContain('aria-busy="true"');
  expect(html).not.toContain("<form");
});
it("known original receipt offers explicit reconciliation without rendering secrets or replay controls", () => {
  state.locale = "en";
  const html = renderToStaticMarkup(<OperationRecovery receipt={{ operationKey: "synthetic-private-receipt", userId: "synthetic-actor", boundaryFingerprint: "synthetic-fp", kind: "password_revoke" }} isCaptured={() => true} />);
  expect(html).toContain("Check original operation");
  expect(html).not.toContain("synthetic-private-receipt");
  expect(html).not.toContain("synthetic-actor");
  expect(html).not.toContain("Set password");
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenancy/branch-hours-actions", () => ({
  readOwnedBranchHoursAction: vi.fn(async () => ({ ok: false, code: "unavailable", snapshot: null })),
  saveOwnedBranchHoursAction: vi.fn(),
  copyOwnedBranchHoursAction: vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-branch-knowledge-actions", () => ({
  readOwnedBranchKnowledgeAction: vi.fn(async () => null),
  addOwnedBranchWebsiteAction: vi.fn(),
  pageActionOwnedBranchKnowledgeAction: vi.fn(),
  saveOwnedBranchKnowledgeTextAction:vi.fn(),
  uploadOwnedBranchKnowledgeFilesAction:vi.fn(),
  approveOwnedBranchKnowledgeSourceAction:vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-reply-language-actions", () => ({
  readOwnedBranchReplyLanguageAction: vi.fn(async () => null),
  confirmOwnedBranchReplyLanguageAction: vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-assistant-trial-actions", () => ({
  readOwnedBranchAssistantTrialAction: vi.fn(async () => null),
  askOwnedBranchAssistantTrialAction: vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-launch-actions", () => ({
  readOwnedBranchLaunchSummaryAction: vi.fn(async () => null),
  confirmOwnedBranchLaunchAction: vi.fn(),
}));

import { PaidSetupStepHost, type PaidSetupStepHostProps } from "./paid-setup-step-host";

const baseProps: PaidSetupStepHostProps = {
  locale: "en",
  scope: {
    expectedAccountId: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    branchId: "33333333-3333-4333-8333-333333333333",
    boundaryFingerprint: "boundary",
  },
  step: "hours",
  isCurrent: () => true,
  read: null,
};

describe("PaidSetupStepHost", () => {
  it("renders hours step view loading state in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "hours" }));
    expect(html).toContain("Loading branch hours…");
  });

  it("renders knowledge step view loading state in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "knowledge" }));
    expect(html).toContain("Loading branch knowledge…");
  });

  it("renders language step view loading state in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "language" }));
    expect(html).toContain("Loading reply-language settings.");
  });

  it("renders test assistant step view loading state in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "test" }));
    expect(html).toContain("Loading the assistant trial.");
  });

  it("renders team invitations step view showing unavailable status", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "team" }));
    expect(html).toContain("Branch team data is unavailable");
  });

  it("renders launch step view loading state in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "launch" }));
    expect(html).toContain("Loading the launch summary.");
  });
});

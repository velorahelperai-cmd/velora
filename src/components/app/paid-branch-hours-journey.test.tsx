// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { emptyBranchHours, type BranchHoursSnapshot } from "@/lib/tenancy/branch-hours-contracts";
import { PaidSetupStepHost, type PaidSetupStepHostProps } from "./paid-setup-step-host";

const VALID_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const VALID_BRANCH_ID = "33333333-3333-4333-8333-333333333333";
const scope = {
  expectedAccountId: VALID_ACCOUNT_ID,
  companyId: VALID_COMPANY_ID,
  branchId: VALID_BRANCH_ID,
};

let hoursActionResolve: ((res: { ok: boolean; code?: string; snapshot: BranchHoursSnapshot | null; copyTargets?: never[] }) => void) | null = null;

vi.mock("@/lib/tenancy/branch-hours-actions", () => ({
  readOwnedBranchHoursAction: vi.fn(() => new Promise((resolve) => {
    hoursActionResolve = resolve;
  })),
  saveOwnedBranchHoursAction: vi.fn(async () => ({ ok: true, snapshot: { scope, version: 2, branchLabel: "Main", timezone: "Asia/Muscat", schedule: emptyBranchHours() } })),
  copyOwnedBranchHoursAction: vi.fn(async () => ({ ok: true, targets: [] })),
}));

describe("PaidBranchHours radical fix & non-blocking UI journey", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    hoursActionResolve = null;
  });

  it("immediately renders the weekly schedule form inside PaidSetupStepHost without blocking navigation", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    const stepHostProps: PaidSetupStepHostProps = {
      read:null,
      locale: "ar",
      scope: { ...scope, boundaryFingerprint: "boundary" },
      step: "hours",
      isCurrent: () => true,
    };

    try {
      await act(async () => {
        root.render(createElement(PaidSetupStepHost, stepHostProps));
      });

      // Form is immediately visible (7 day fieldsets)
      const dayFieldsets = host.querySelectorAll("[data-hours-day]");
      expect(dayFieldsets).toHaveLength(7);

      // Loading status is visible inline without hiding the form
      expect(host.textContent).toContain("جارٍ تحميل مواعيد الفرع…");

      // Save button is disabled while waiting for server snapshot
      const saveBtn = host.querySelector<HTMLButtonElement>("button[type='submit']");
      expect(saveBtn).not.toBeNull();
      expect(saveBtn!.disabled).toBe(true);
      expect(host.textContent).toContain("الحفظ غير متاح قبل تأكيد الاتصال بالخادم");

      // User can immediately interact with form (select 'open' for Monday)
      const mondaySelect = host.querySelector<HTMLSelectElement>("fieldset[data-hours-day='monday'] select")!;
      await act(async () => {
        mondaySelect.value = "open";
        mondaySelect.dispatchEvent(new Event("change", { bubbles: true }));
      });

      // Monday is now open with time inputs
      expect(host.querySelector("fieldset[data-hours-day='monday'] input[type='time']")).not.toBeNull();

      // Now server snapshot arrives with a different schedule
      const serverSchedule = emptyBranchHours();
      serverSchedule.sunday = { state: "open", intervals: [{ start: "09:00", end: "17:00", nextDay: false }] };
      const serverSnapshot: BranchHoursSnapshot = {
        scope,
        version: 1,
        branchLabel: "فرع مسقط الرئيسي",
        timezone: "Asia/Muscat",
        schedule: serverSchedule,
      };

      await act(async () => {
        hoursActionResolve?.({ ok: true, snapshot: serverSnapshot, copyTargets: [] });
      });

      // CRITICAL: User's draft edit on Monday MUST NOT be overwritten!
      const mondayInputs = host.querySelectorAll("fieldset[data-hours-day='monday'] input[type='time']");
      expect(mondayInputs.length).toBeGreaterThan(0);

      // Conflict warning is displayed because user draft differs from server snapshot
      expect(host.textContent).toContain("وصلت المواعيد المحفوظة من الخادم وتختلف عن مسودتك الحالية");
      const loadServerBtn = Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("استعادة مواعيد الخادم")
      );
      expect(loadServerBtn).toBeDefined();

      // Clicking load server hours replaces draft with server schedule
      await act(async () => {
        loadServerBtn!.click();
      });

      // Now sunday is open from server, and conflict banner disappears
      expect(host.textContent).not.toContain("وصلت المواعيد المحفوظة من الخادم وتختلف عن مسودتك الحالية");
      expect(host.querySelector("fieldset[data-hours-day='sunday'] input[type='time']")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("handles background read failure gracefully without breaking the schedule form", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    const stepHostProps: PaidSetupStepHostProps = {
      read:null,
      locale: "en",
      scope: { ...scope, boundaryFingerprint: "boundary" },
      step: "hours",
      isCurrent: () => true,
    };

    try {
      await act(async () => {
        root.render(createElement(PaidSetupStepHost, stepHostProps));
      });

      // Form is immediately rendered
      expect(host.querySelectorAll("[data-hours-day]")).toHaveLength(7);

      // Background read returns failure
      await act(async () => {
        hoursActionResolve?.({ ok: false, code: "unavailable", snapshot: null });
      });

      // Form REMAINS rendered and interactive
      expect(host.querySelectorAll("[data-hours-day]")).toHaveLength(7);

      // Inline non-blocking failure message and retry button are shown
      expect(host.textContent).toContain("Hours for this branch are unavailable");
      const retryBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Retry"));
      expect(retryBtn).toBeDefined();

      // Clicking retry triggers a fresh read
      const { readOwnedBranchHoursAction } = await import("@/lib/tenancy/branch-hours-actions");
      const callsBefore = vi.mocked(readOwnedBranchHoursAction).mock.calls.length;

      await act(async () => {
        retryBtn!.click();
      });

      expect(vi.mocked(readOwnedBranchHoursAction).mock.calls.length).toBe(callsBefore + 1);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});

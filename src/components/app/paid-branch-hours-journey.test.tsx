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

  it("does not report unsaved changes when server JSON keys arrive in a different order", async () => {
    const host=document.createElement("div"),root=createRoot(host);
    try {
      await act(async()=>root.render(createElement(PaidSetupStepHost,{read:null,locale:"en",scope:{...scope,boundaryFingerprint:"boundary"},step:"hours",isCurrent:()=>true})));
      const schedule=Object.fromEntries(Object.entries(emptyBranchHours()).reverse()) as BranchHoursSnapshot["schedule"];
      await act(async()=>hoursActionResolve?.({ok:true,snapshot:{scope,version:1,branchLabel:"Main",timezone:"Asia/Muscat",schedule},copyTargets:[]}));
      expect(host.querySelector('[data-setup-unsaved="true"]')).toBeNull();
    } finally {await act(async()=>root.unmount());}
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
      expect(host.textContent).toContain("وصلت مواعيد محفوظة تختلف عن مسودتك");
      const loadServerBtn = Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("استعادة مواعيد الخادم")
      );
      expect(loadServerBtn).toBeDefined();

      // Clicking load server hours replaces draft with server schedule
      await act(async () => {
        loadServerBtn!.click();
      });

      // Now sunday is open from server, and conflict banner disappears
      expect(host.textContent).not.toContain("وصلت مواعيد محفوظة تختلف عن مسودتك");
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

  it("applies Sun-Thu quick preset in a single click and allows copying across days", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    const stepHostProps: PaidSetupStepHostProps = {
      read: null,
      locale: "ar",
      scope: { ...scope, boundaryFingerprint: "boundary" },
      step: "hours",
      isCurrent: () => true,
    };

    try {
      await act(async () => {
        root.render(createElement(PaidSetupStepHost, stepHostProps));
      });

      const sunThuBtn = host.querySelector<HTMLButtonElement>('button[data-hours-preset="workdays_sun_thu"]');
      expect(sunThuBtn).not.toBeNull();
      expect(sunThuBtn!.textContent).toContain("الأحد – الخميس");
      expect(host.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);

      await act(async () => {
        sunThuBtn!.click();
      });

      // Sunday through Thursday are now OPEN with time inputs
      expect(host.querySelector("fieldset[data-hours-day='sunday'] input[type='time']")).not.toBeNull();
      expect(host.querySelector("fieldset[data-hours-day='monday'] input[type='time']")).not.toBeNull();
      expect(host.querySelector("fieldset[data-hours-day='tuesday'] input[type='time']")).not.toBeNull();
      expect(host.querySelector("fieldset[data-hours-day='wednesday'] input[type='time']")).not.toBeNull();
      expect(host.querySelector("fieldset[data-hours-day='thursday'] input[type='time']")).not.toBeNull();

      // Friday and Saturday are CLOSED (no time inputs)
      expect(host.querySelector("fieldset[data-hours-day='friday'] input[type='time']")).toBeNull();
      expect(host.querySelector("fieldset[data-hours-day='saturday'] input[type='time']")).toBeNull();
      expect(host.querySelector<HTMLSelectElement>("fieldset[data-hours-day='friday'] select")?.value).toBe("closed");
      expect(host.querySelector<HTMLSelectElement>("fieldset[data-hours-day='saturday'] select")?.value).toBe("closed");

      // Verify that unsaved changes are tracked
      expect(host.querySelector('[data-setup-unsaved="true"]')).not.toBeNull();

      // Now test copying: change Sunday start time using native value setter for React
      const sunStartInput = host.querySelector<HTMLInputElement>("fieldset[data-hours-day='sunday'] input[type='time']")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(sunStartInput, "08:00");
        sunStartInput.dispatchEvent(new Event("input", { bubbles: true }));
      });

      // Click copy from Sunday to Sun-Thu
      const copyBtn = host.querySelector<HTMLButtonElement>("fieldset[data-hours-day='sunday'] button[title*='الأحد والاثنين']")!;
      expect(copyBtn).not.toBeNull();
      await act(async () => {
        copyBtn.click();
      });

      // Monday through Thursday now also have start time 08:00!
      const monStartInput = host.querySelector<HTMLInputElement>("fieldset[data-hours-day='monday'] input[type='time']")!;
      expect(monStartInput.value).toBe("08:00");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});

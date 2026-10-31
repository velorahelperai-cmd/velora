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

  it("immediately renders the weekly summary without per-day editors and keeps preset drafts across hydration", async () => {
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

      expect(host.querySelectorAll("[data-hours-day]")).toHaveLength(7);
      expect(host.querySelector("[data-hours-day] select")).toBeNull();
      expect(host.querySelector("[data-hours-day] input[type='time']")).toBeNull();
      expect(host.textContent).not.toContain("+ إضافة فترة");
      expect(host.textContent).not.toContain("جارٍ تحميل مواعيد الفرع");
      expect(host.querySelector('[data-hours-studio][aria-busy="true"]')).not.toBeNull();
      expect(host.querySelector('[data-hours-action="add"]')).not.toBeNull();

      await act(async () => {
        host.querySelector<HTMLButtonElement>('[data-hours-action="add"]')!.click();
      });
      const preset = host.querySelector<HTMLButtonElement>('button[data-hours-preset="workdays_sun_thu"]')!;
      expect(preset).not.toBeNull();
      await act(async () => {
        preset.click();
      });

      expect(host.querySelector('[data-hours-day="monday"]')?.getAttribute("data-state")).toBe("open");
      expect(host.querySelector('[data-hours-day="friday"]')?.getAttribute("data-state")).toBe("closed");
      expect(host.querySelector('[data-setup-unsaved="true"]')).not.toBeNull();

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

      expect(host.querySelector('[data-hours-day="monday"]')?.getAttribute("data-state")).toBe("open");
      expect(host.querySelector('[data-hours-day="friday"]')?.getAttribute("data-state")).toBe("closed");
      // User draft remains undisturbed without disruptive conflict banners
      expect(host.textContent).not.toContain("وصلت مواعيد محفوظة تختلف عن مسودتك");
      const loadServerBtn = Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("استعادة مواعيد الخادم")
      );
      expect(loadServerBtn).toBeUndefined();
      expect(host.querySelector('[data-hours-day="monday"]')?.getAttribute("data-state")).toBe("open");
      expect(host.querySelector('[data-hours-day="friday"]')?.getAttribute("data-state")).toBe("closed");
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

      expect(host.querySelectorAll("[data-hours-day]")).toHaveLength(7);

      await act(async () => {
        hoursActionResolve?.({ ok: false, code: "unavailable", snapshot: null });
      });

      expect(host.querySelectorAll("[data-hours-day]")).toHaveLength(7);
      expect(host.querySelector("[data-hours-day] select")).toBeNull();

      expect(host.textContent).not.toContain("Hours for this branch are unavailable");
      expect(host.textContent).not.toContain("Saving is not confirmed");
      expect(host.textContent).not.toContain("Loading branch hours");
      expect(host.textContent).not.toContain("Retry");
      expect(host.querySelectorAll("[data-hours-day]")).toHaveLength(7);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("applies Sun-Thu quick preset and quick-apply without per-day editors", async () => {
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

      await act(async () => {
        host.querySelector<HTMLButtonElement>('[data-hours-action="add"]')!.click();
      });
      const sunThuBtn = host.querySelector<HTMLButtonElement>('button[data-hours-preset="workdays_sun_thu"]');
      expect(sunThuBtn).not.toBeNull();
      expect(sunThuBtn!.textContent).toContain("الأحد – الخميس");
      expect(host.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
      expect(host.querySelector('[data-hours-compose]')).not.toBeNull();

      await act(async () => {
        sunThuBtn!.click();
      });

      for (const day of ["sunday", "monday", "tuesday", "wednesday", "thursday"] as const) {
        expect(host.querySelector(`[data-hours-day='${day}']`)?.getAttribute("data-state")).toBe("open");
        expect(host.querySelector(`[data-hours-day='${day}']`)?.textContent).toContain("09:00");
      }
      expect(host.querySelector("[data-hours-day='friday']")?.getAttribute("data-state")).toBe("closed");
      expect(host.querySelector("[data-hours-day='saturday']")?.getAttribute("data-state")).toBe("closed");
      expect(host.querySelector("[data-hours-day] select")).toBeNull();
      expect(host.querySelector('[data-setup-unsaved="true"]')).not.toBeNull();

      const quickStart = host.querySelector<HTMLInputElement>('input[aria-label="توقيت البدء السريع"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(quickStart, "08:00");
        quickStart.dispatchEvent(new Event("input", { bubbles: true }));
        quickStart.dispatchEvent(new Event("change", { bubbles: true }));
      });

      expect(host.querySelector("[data-hours-day='monday']")?.textContent).toContain("08:00");
      expect(host.textContent).not.toContain("تطبيق سريع");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});

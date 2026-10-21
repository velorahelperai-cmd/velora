import { describe, expect, it, vi } from "vitest";
import { emptyBranchHours } from "./branch-hours-contracts";
import {
  runBranchHoursCopy,
  runBranchHoursRead,
  runBranchHoursSave,
} from "./branch-hours-flow";
import type { BranchHoursStorePorts } from "./branch-hours-store";

const VALID_UUID_A = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_B = "22222222-2222-4222-8222-222222222222";
const VALID_UUID_C = "33333333-3333-4333-8333-333333333333";
const VALID_UUID_D = "44444444-4444-4444-8444-444444444444";

const validScope = {
  expectedAccountId: VALID_UUID_A,
  companyId: VALID_UUID_B,
  branchId: VALID_UUID_C,
};

describe("branch-hours-flow", () => {
  const mockStore: BranchHoursStorePorts = {
    read: vi.fn().mockResolvedValue({
      ok: true,
      snapshot: {
        scope: validScope,
        version: 1,
        branchLabel: "Main",
        timezone: "Asia/Muscat",
        schedule: emptyBranchHours(),
      },
      copyTargets: [],
      capabilities: { canSave: true, canCopy: false },
      confirmation: "unset",
    }),
    save: vi.fn().mockResolvedValue({
      ok: true,
      snapshot: {
        scope: validScope,
        version: 2,
        branchLabel: "Main",
        timezone: "Asia/Muscat",
        schedule: emptyBranchHours(),
      },
      receipt: { branchId: VALID_UUID_C, version: 2, fingerprint: "fp1" },
    }),
    copy: vi.fn().mockResolvedValue({
      ok: true,
      results: [{ branchId: VALID_UUID_D, version: 1, receiptId: "rec1" }],
      targets: [],
    }),
  };

  it("rejects invalid scope on read", async () => {
    const res = await runBranchHoursRead({ expectedAccountId: "bad" }, mockStore);
    expect(res).toEqual({ ok: false, code: "invalid_input", snapshot: null });
  });

  it("passes normalized scope to store on read", async () => {
    const res = await runBranchHoursRead(validScope, mockStore);
    expect(res.ok).toBe(true);
    expect(mockStore.read).toHaveBeenCalledWith(validScope);
  });

  it("rejects invalid save input", async () => {
    const res = await runBranchHoursSave({ scope: validScope, expectedVersion: -1 }, mockStore);
    expect(res).toEqual({ ok: false, code: "invalid_input" });
  });

  it("runs valid save through store", async () => {
    const draft = {
      scope: validScope,
      expectedVersion: 1,
      schedule: emptyBranchHours(),
    };
    const res = await runBranchHoursSave(draft, mockStore);
    expect(res.ok).toBe(true);
    expect(mockStore.save).toHaveBeenCalledWith(draft);
  });

  it("rejects copy with empty targets or invalid input", async () => {
    const res = await runBranchHoursCopy({ source: { scope: validScope, expectedVersion: 1, schedule: emptyBranchHours() }, mode: "local-weekday-clock", targets: [] }, mockStore);
    expect(res).toEqual({ ok: false, code: "invalid_input" });
  });

  it("runs valid copy through store", async () => {
    const copyDraft = {
      source: {
        scope: validScope,
        expectedVersion: 1,
        schedule: emptyBranchHours(),
      },
      mode: "local-weekday-clock" as const,
      targets: [{ branchId: VALID_UUID_D, expectedVersion: 0 }],
    };
    const res = await runBranchHoursCopy(copyDraft, mockStore);
    expect(res.ok).toBe(true);
    expect(mockStore.copy).toHaveBeenCalledWith(copyDraft);
  });
});

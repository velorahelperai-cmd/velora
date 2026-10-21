import type {
  BranchHoursCopyTarget,
  BranchHoursScope,
  BranchHoursSnapshot,
} from "./branch-hours-contracts";

export type BranchHoursFailureReason =
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "not_owned"
  | "suspended"
  | "not_provisioned"
  | "inconsistent"
  | "unpaid"
  | "conflict"
  | "invalid_schedule"
  | "unknown_timezone"
  | "unavailable";

export type BranchHoursReadSuccess = {
  ok: true;
  snapshot: BranchHoursSnapshot;
  copyTargets: BranchHoursCopyTarget[];
  capabilities: { canSave: boolean; canCopy: boolean };
  confirmation: "unset" | "saved" | "confirmed";
};

export type BranchHoursReadFailure = {
  ok: false;
  code: BranchHoursFailureReason;
  snapshot: null;
};

export type BranchHoursReadResult = BranchHoursReadSuccess | BranchHoursReadFailure;

export type BranchHoursSaveReceipt = {
  branchId: string;
  version: number;
  fingerprint: string;
};

export type BranchHoursSaveSuccess = {
  ok: true;
  snapshot: BranchHoursSnapshot;
  receipt: BranchHoursSaveReceipt;
};

export type BranchHoursSaveFailure = {
  ok: false;
  code: BranchHoursFailureReason;
  snapshot?: BranchHoursSnapshot;
};

export type BranchHoursSaveResult = BranchHoursSaveSuccess | BranchHoursSaveFailure;

export type BranchHoursCopyTargetResult = {
  branchId: string;
  version: number;
  receiptId: string;
};

export type BranchHoursCopySuccess = {
  ok: true;
  results: BranchHoursCopyTargetResult[];
  targets: BranchHoursCopyTarget[];
};

export type BranchHoursCopyFailure = {
  ok: false;
  code: BranchHoursFailureReason;
};

export type BranchHoursCopyResult = BranchHoursCopySuccess | BranchHoursCopyFailure;

export function unavailableBranchHoursSnapshot(scope: BranchHoursScope): BranchHoursSnapshot {
  return {
    scope: { ...scope },
    version: 0,
    branchLabel: "",
    timezone: null,
    schedule: {
      monday: { state: "unset" },
      tuesday: { state: "unset" },
      wednesday: { state: "unset" },
      thursday: { state: "unset" },
      friday: { state: "unset" },
      saturday: { state: "unset" },
      sunday: { state: "unset" },
    },
  };
}

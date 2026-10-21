import type {
  BranchHoursCopyDraft,
  BranchHoursCopyTarget,
  BranchHoursSaveDraft,
  BranchHoursScope,
  BranchHoursSnapshot,
} from "./branch-hours-contracts";
import type {
  BranchHoursCopyResult,
  BranchHoursFailureReason,
  BranchHoursReadResult,
  BranchHoursSaveResult,
} from "./branch-hours-service-contracts";

export type BranchHoursRpc = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

const FAILURE_REASONS = new Set<BranchHoursFailureReason>([
  "invalid_input",
  "unauthenticated",
  "forbidden",
  "not_owned",
  "suspended",
  "not_provisioned",
  "inconsistent",
  "unpaid",
  "conflict",
  "invalid_schedule",
  "unknown_timezone",
  "unavailable",
]);

function normalizeReason(raw: unknown): BranchHoursFailureReason {
  const code = String(raw ?? "").toLowerCase() as BranchHoursFailureReason;
  return FAILURE_REASONS.has(code) ? code : "unavailable";
}

export interface BranchHoursStorePorts {
  read(scope: BranchHoursScope): Promise<BranchHoursReadResult>;
  save(draft: BranchHoursSaveDraft): Promise<BranchHoursSaveResult>;
  copy(draft: BranchHoursCopyDraft): Promise<BranchHoursCopyResult>;
}

export function createBranchHoursStore(client: BranchHoursRpc): BranchHoursStorePorts {
  return {
    read: async (scope: BranchHoursScope): Promise<BranchHoursReadResult> => {
      try {
        const res = await client.rpc("es02_read_owned_branch_hours", {
          p_expected_account_id: scope.expectedAccountId,
          p_company_id: scope.companyId,
          p_branch_id: scope.branchId,
        });

        if (res.error || !res.data || typeof res.data !== "object") {
          return { ok: false, code: "unavailable", snapshot: null };
        }

        const data = res.data as Record<string, unknown>;
        if (data.ok !== true) {
          return { ok: false, code: normalizeReason(data.code), snapshot: null };
        }

        const payload = data.data as {
          snapshot: BranchHoursSnapshot;
          copyTargets: BranchHoursCopyTarget[];
          capabilities: { canSave: boolean; canCopy: boolean };
          confirmation: "unset" | "saved" | "confirmed";
        };

        return {
          ok: true,
          snapshot: payload.snapshot,
          copyTargets: payload.copyTargets ?? [],
          capabilities: payload.capabilities ?? { canSave: true, canCopy: false },
          confirmation: payload.confirmation ?? "unset",
        };
      } catch {
        return { ok: false, code: "unavailable", snapshot: null };
      }
    },

    save: async (draft: BranchHoursSaveDraft): Promise<BranchHoursSaveResult> => {
      try {
        const res = await client.rpc("es02_save_owned_branch_hours", {
          p_expected_account_id: draft.scope.expectedAccountId,
          p_company_id: draft.scope.companyId,
          p_branch_id: draft.scope.branchId,
          p_expected_revision: draft.expectedVersion,
          p_schedule: draft.schedule,
        });

        if (res.error || !res.data || typeof res.data !== "object") {
          return { ok: false, code: "unavailable" };
        }

        const data = res.data as Record<string, unknown>;
        if (data.ok !== true) {
          return { ok: false, code: normalizeReason(data.code) };
        }

        const payload = data.data as {
          snapshot: BranchHoursSnapshot;
          receipt: { branchId: string; version: number; fingerprint: string };
        };

        return {
          ok: true,
          snapshot: payload.snapshot,
          receipt: payload.receipt,
        };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },

    copy: async (draft: BranchHoursCopyDraft): Promise<BranchHoursCopyResult> => {
      try {
        const res = await client.rpc("es02_copy_owned_branch_hours", {
          p_expected_account_id: draft.source.scope.expectedAccountId,
          p_company_id: draft.source.scope.companyId,
          p_source_branch_id: draft.source.scope.branchId,
          p_expected_source_revision: draft.source.expectedVersion,
          p_targets: draft.targets,
        });

        if (res.error || !res.data || typeof res.data !== "object") {
          return { ok: false, code: "unavailable" };
        }

        const data = res.data as Record<string, unknown>;
        if (data.ok !== true) {
          return { ok: false, code: normalizeReason(data.code) };
        }

        const payload = data.data as {
          results: { branchId: string; version: number; receiptId: string }[];
          targets: BranchHoursCopyTarget[];
        };

        return {
          ok: true,
          results: payload.results,
          targets: payload.targets,
        };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
  };
}

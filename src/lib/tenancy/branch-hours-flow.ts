import {
  parseOwnedBranchHoursCopyInput,
  parseOwnedBranchHoursSaveInput,
} from "./branch-hours-command-contracts";
import type { BranchHoursScope } from "./branch-hours-contracts";
import type {
  BranchHoursCopyResult,
  BranchHoursReadResult,
  BranchHoursSaveResult,
} from "./branch-hours-service-contracts";
import type { BranchHoursStorePorts } from "./branch-hours-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validScope(scope: unknown): scope is BranchHoursScope {
  if (!scope || typeof scope !== "object") return false;
  const s = scope as Record<string, unknown>;
  return (
    typeof s.expectedAccountId === "string" &&
    UUID.test(s.expectedAccountId) &&
    typeof s.companyId === "string" &&
    UUID.test(s.companyId) &&
    typeof s.branchId === "string" &&
    UUID.test(s.branchId)
  );
}

export async function runBranchHoursRead(
  scope: unknown,
  store: BranchHoursStorePorts
): Promise<BranchHoursReadResult> {
  if (!validScope(scope)) {
    return { ok: false, code: "invalid_input", snapshot: null };
  }
  return store.read({
    expectedAccountId: scope.expectedAccountId.toLowerCase(),
    companyId: scope.companyId.toLowerCase(),
    branchId: scope.branchId.toLowerCase(),
  });
}

export async function runBranchHoursSave(
  draft: unknown,
  store: BranchHoursStorePorts
): Promise<BranchHoursSaveResult> {
  const parsed = parseOwnedBranchHoursSaveInput(draft);
  if (!parsed.ok) {
    return { ok: false, code: "invalid_input" };
  }
  return store.save(parsed.input);
}

export async function runBranchHoursCopy(
  draft: unknown,
  store: BranchHoursStorePorts
): Promise<BranchHoursCopyResult> {
  const parsed = parseOwnedBranchHoursCopyInput(draft);
  if (!parsed.ok) {
    return { ok: false, code: "invalid_input" };
  }
  return store.copy(parsed.input);
}

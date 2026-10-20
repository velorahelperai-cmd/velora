import {
  BRANCH_HOURS_DAYS,
  validateBranchHours,
  type BranchHoursCopyDraft,
  type BranchHoursSaveDraft,
} from "./branch-hours-contracts";

type Parsed<T> = {ok: true; input: T} | {ok: false; code: "invalid_input"};
const invalid = (): {ok: false; code: "invalid_input"} => ({ok: false, code: "invalid_input"});
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const version = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Validate a transport command, not ownership, timezone, readiness or persistence. */
export function parseOwnedBranchHoursSaveInput(value: unknown): Parsed<BranchHoursSaveDraft> {
  if (!record(value) || !exact(value, ["scope", "expectedVersion", "schedule"])) return invalid();
  const {scope, expectedVersion, schedule} = value;
  if (!record(scope) || !exact(scope, ["expectedAccountId", "companyId", "branchId"])
    || !uuid(scope.expectedAccountId) || !uuid(scope.companyId) || !uuid(scope.branchId)
    || !version(expectedVersion)) return invalid();

  // Sparse arrays are not valid transport schedules. The shared validator owns
  // all day/interval semantics; this only rejects holes its forEach would skip.
  if (record(schedule)) {
    for (const day of BRANCH_HOURS_DAYS) {
      const entry = schedule[day];
      if (record(entry) && Array.isArray(entry.intervals)) {
        for (let i = 0; i < entry.intervals.length; i++) {
          if (!Object.hasOwn(entry.intervals, i)) return invalid();
        }
      }
    }
  }
  const checked = validateBranchHours(schedule);
  if (!checked.ok) return invalid();
  return {ok: true, input: {
    scope: {
      expectedAccountId: scope.expectedAccountId.toLowerCase(),
      companyId: scope.companyId.toLowerCase(),
      branchId: scope.branchId.toLowerCase(),
    },
    expectedVersion,
    schedule: checked.schedule,
  }};
}

/** Copy targets use their own expected revisions; no target-count policy here. */
export function parseOwnedBranchHoursCopyInput(value: unknown): Parsed<BranchHoursCopyDraft> {
  if (!record(value) || !exact(value, ["source", "mode", "targets"])
    || value.mode !== "local-weekday-clock" || !Array.isArray(value.targets) || value.targets.length === 0) return invalid();
  const source = parseOwnedBranchHoursSaveInput(value.source);
  if (!source.ok) return invalid();
  const seen = new Set<string>([source.input.scope.branchId]);
  const targets: BranchHoursCopyDraft["targets"] = [];
  for (const target of value.targets) {
    if (!record(target) || !exact(target, ["branchId", "expectedVersion"])
      || !uuid(target.branchId) || !version(target.expectedVersion)) return invalid();
    const branchId = target.branchId.toLowerCase();
    if (seen.has(branchId)) return invalid();
    seen.add(branchId);
    targets.push({branchId, expectedVersion: target.expectedVersion});
  }
  return {ok: true, input: {source: source.input, mode: "local-weekday-clock", targets}};
}

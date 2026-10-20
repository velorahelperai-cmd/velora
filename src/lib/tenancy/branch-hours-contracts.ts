/** Pure draft contracts only: no persistence, endpoint, or readiness assertion. */
export const BRANCH_HOURS_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type BranchHoursDay = typeof BRANCH_HOURS_DAYS[number];
export type BranchHoursInterval = {start: string; end: string; nextDay: boolean};
/** Intervals belong to the weekday on which they START. Closed means no starts
 * that day; an explicit overnight interval from the prior day may still extend
 * into it. The UI must show that carry-over rather than hide it. */
export type BranchHoursDayValue = {state: "unset" | "closed"} | {state: "open"; intervals: BranchHoursInterval[]};
export type BranchHoursSchedule = Record<BranchHoursDay, BranchHoursDayValue>;
export type BranchHoursScope = {expectedAccountId: string; companyId: string; branchId: string};
export type BranchHoursSnapshot = {
  scope: BranchHoursScope;
  version: number;
  branchLabel: string;
  timezone: string | null;
  schedule: BranchHoursSchedule;
};
export type BranchHoursCopyTarget = {branchId: string; label: string; timezone: string | null; version: number};
export type BranchHoursSaveDraft = {scope: BranchHoursScope; expectedVersion: number; schedule: BranchHoursSchedule};
export type BranchHoursCopyDraft = {
  source: BranchHoursSaveDraft;
  mode: "local-weekday-clock";
  targets: {branchId: string; expectedVersion: number}[];
};
export type BranchHoursIssue = {
  code: "invalid_schedule" | "invalid_day" | "empty_intervals" | "invalid_interval" | "invalid_time" | "end_not_after_start" | "overlap";
  day?: BranchHoursDay;
  interval?: number;
  otherDay?: BranchHoursDay;
  otherInterval?: number;
};
export type BranchHoursValidation = {ok: true; schedule: BranchHoursSchedule} | {ok: false; issues: BranchHoursIssue[]};

export function emptyBranchHours(): BranchHoursSchedule {
  return Object.fromEntries(BRANCH_HOURS_DAYS.map(day => [day, {state: "unset"}])) as BranchHoursSchedule;
}
export function cloneBranchHours(schedule: BranchHoursSchedule): BranchHoursSchedule {
  return Object.fromEntries(BRANCH_HOURS_DAYS.map(day => [day, schedule[day].state === "open"
    ? {state: "open", intervals: schedule[day].intervals.map(interval => ({...interval}))}
    : {...schedule[day]}])) as BranchHoursSchedule;
}
export function branchHoursMinute(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function validateBranchHours(value: unknown): BranchHoursValidation {
  if (!record(value) || !exactKeys(value, BRANCH_HOURS_DAYS)) return {ok: false, issues: [{code: "invalid_schedule"}]};
  const issues: BranchHoursIssue[] = [];
  const spans: {day: BranchHoursDay; interval: number; start: number; end: number}[] = [];
  for (const [dayIndex, day] of BRANCH_HOURS_DAYS.entries()) {
    const item = value[day];
    if (!record(item) || typeof item.state !== "string" || !["unset", "closed", "open"].includes(item.state) ||
      !exactKeys(item, item.state === "open" ? ["state", "intervals"] : ["state"])) {
      issues.push({code: "invalid_day", day}); continue;
    }
    if (item.state !== "open") continue;
    if (!Array.isArray(item.intervals) || !item.intervals.length) {
      issues.push({code: "empty_intervals", day}); continue;
    }
    item.intervals.forEach((interval: unknown, index: number) => {
      if (!record(interval) || !exactKeys(interval, ["start", "end", "nextDay"]) || typeof interval.nextDay !== "boolean") {
        issues.push({code: "invalid_interval", day, interval: index}); return;
      }
      const start = branchHoursMinute(interval.start), end = branchHoursMinute(interval.end);
      if (start === null || end === null) {issues.push({code: "invalid_time", day, interval: index}); return;}
      const durationEnd = end + (interval.nextDay ? 1440 : 0);
      if (durationEnd <= start) {issues.push({code: "end_not_after_start", day, interval: index}); return;}
      spans.push({day, interval: index, start: dayIndex * 1440 + start, end: dayIndex * 1440 + durationEnd});
    });
  }
  // Compare actual local-week spans, including Sunday -> Monday wrap. Touching
  // endpoints are allowed; no UTC conversion or DST inference occurs here.
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
    const a = spans[i], b = spans[j];
    if ([-10080, 0, 10080].some(offset => Math.max(a.start, b.start + offset) < Math.min(a.end, b.end + offset)))
      issues.push({code: "overlap", day: a.day, interval: a.interval, otherDay: b.day, otherInterval: b.interval});
  }
  return issues.length ? {ok: false, issues} : {ok: true, schedule: cloneBranchHours(value as BranchHoursSchedule)};
}

export function sameBranchHoursScope(a: BranchHoursScope, b: BranchHoursScope): boolean {
  return !!a.expectedAccountId && !!a.companyId && !!a.branchId &&
    a.expectedAccountId === b.expectedAccountId && a.companyId === b.companyId && a.branchId === b.branchId;
}
export function knownBranchHoursTimezone(timezone: unknown): timezone is string {
  if (typeof timezone !== "string" || !timezone.trim() || timezone !== timezone.trim()) return false;
  try {new Intl.DateTimeFormat("en", {timeZone: timezone}).format(0); return true;} catch {return false;}
}
const validVersion = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export function prepareBranchHoursSave(scope: BranchHoursScope, snapshot: BranchHoursSnapshot, schedule: unknown):
  {ok: true; draft: BranchHoursSaveDraft} | {ok: false; code: "scope" | "version" | "timezone" | "schedule"} {
  if (!sameBranchHoursScope(scope, snapshot.scope)) return {ok: false, code: "scope"};
  if (!validVersion(snapshot.version)) return {ok: false, code: "version"};
  if (!knownBranchHoursTimezone(snapshot.timezone)) return {ok: false, code: "timezone"};
  const validated = validateBranchHours(schedule);
  if (!validated.ok) return {ok: false, code: "schedule"};
  return {ok: true, draft: {scope: {...scope}, expectedVersion: snapshot.version, schedule: validated.schedule}};
}

export function prepareBranchHoursCopy(scope: BranchHoursScope, snapshot: BranchHoursSnapshot, schedule: unknown,
  inventory: readonly BranchHoursCopyTarget[], selected: readonly string[]):
  {ok: true; draft: BranchHoursCopyDraft} | {ok: false; code: "scope" | "version" | "timezone" | "schedule" | "selection"} {
  const source = prepareBranchHoursSave(scope, snapshot, schedule);
  if (!source.ok) return source;
  if (!selected.length || new Set(selected).size !== selected.length ||
    new Set(inventory.map(target => target.branchId)).size !== inventory.length) return {ok: false, code: "selection"};
  const targets: BranchHoursCopyDraft["targets"] = [];
  for (const id of selected) {
    const target = inventory.find(item => item.branchId === id);
    if (!id || id === scope.branchId || !target) return {ok: false, code: "selection"};
    if (!validVersion(target.version)) return {ok: false, code: "version"};
    if (!knownBranchHoursTimezone(target.timezone)) return {ok: false, code: "timezone"};
    targets.push({branchId: id, expectedVersion: target.version});
  }
  return {ok: true, draft: {source: source.draft, mode: "local-weekday-clock", targets}};
}

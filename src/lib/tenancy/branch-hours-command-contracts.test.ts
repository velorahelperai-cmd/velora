import {expect, it} from "vitest";
import {emptyBranchHours, type BranchHoursSaveDraft} from "./branch-hours-contracts";
import {parseOwnedBranchHoursCopyInput as copy, parseOwnedBranchHoursSaveInput as save} from "./branch-hours-command-contracts";

const actor = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const company = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
const branch = "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC";
const target = "DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD";
function input(): BranchHoursSaveDraft {
  const schedule = emptyBranchHours();
  schedule.monday = {state: "open", intervals: [{start: "09:00", end: "12:00", nextDay: false}, {start: "12:00", end: "18:00", nextDay: false}]};
  schedule.tuesday = {state: "closed"};
  schedule.sunday = {state: "open", intervals: [{start: "22:00", end: "02:00", nextDay: true}]};
  return {scope: {expectedAccountId: actor, companyId: company, branchId: branch}, expectedVersion: 0, schedule};
}
const copyInput = () => ({source: input(), mode: "local-weekday-clock", targets: [{branchId: target, expectedVersion: 4}]});
const bad = {ok: false, code: "invalid_input"};
it("rejects actual array records and an actually empty target list", () => {
  expect(save([])).toEqual(bad);
  expect(save({...input(), scope: []})).toEqual(bad);
  expect(copy([])).toEqual(bad);
  expect(copy({...copyInput(), targets: []})).toEqual(bad);
  expect(copy({...copyInput(), targets: [[]]})).toEqual(bad);
});

it("accepts partial local-week schedules, touching endpoints and Sunday carry-over without claiming readiness", () => {
  const value = input(), result = save(value);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.input).toEqual({...value, scope: {expectedAccountId: actor.toLowerCase(), companyId: company.toLowerCase(), branchId: branch.toLowerCase()}});
  expect(result.input.schedule.wednesday).toEqual({state: "unset"});
  expect(Object.keys(result.input).sort()).toEqual(["expectedVersion", "schedule", "scope"]);
});
it("accepts fully unset drafts and maximum safe revision", () => {
  expect(save({...input(), expectedVersion: Number.MAX_SAFE_INTEGER, schedule: emptyBranchHours()}).ok).toBe(true);
});
it("copies normalized source and target IDs without timezone conversion", () => {
  const result = copy(copyInput()); expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.input.targets).toEqual([{branchId: target.toLowerCase(), expectedVersion: 4}]);
  expect(result.input.source.scope.branchId).toBe(branch.toLowerCase());
  expect(result.input.source.schedule.sunday).toEqual(input().schedule.sunday);
});
it.each([null, undefined, [], "save", 1, true, new Date()])("rejects non-record commands %j", value => {
  expect(save(value)).toEqual(bad); expect(copy(value)).toEqual(bad);
});
it.each(["expectedAccountId", "companyId", "branchId"] as const)("validates actual UUID at scope.%s", field => {
  for (const value of ["id", "", ` ${actor}`, actor + " ", "00000000-0000-0000-0000-000000000000", "aaaaaaaa-aaaa-4aaa-1aaa-aaaaaaaaaaaa", [actor], 1, null]) {
    expect(save({...input(), scope: {...input().scope, [field]: value}})).toEqual(bad);
  }
  const missing: Record<string, unknown> = {...input().scope}; delete missing[field];
  expect(save({...input(), scope: missing})).toEqual(bad);
});
it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0", null, [], true])("rejects unsafe/non-numeric revision %j", expectedVersion => {
  expect(save({...input(), expectedVersion})).toEqual(bad);
  expect(copy({...copyInput(), targets: [{branchId: target, expectedVersion}]})).toEqual(bad);
});
it.each(["timezone", "status", "verified", "capabilities", "unexpected"])("rejects forged/unknown %s fields at every command record boundary", key => {
  expect(save({...input(), [key]: "forged"})).toEqual(bad);
  expect(save({...input(), scope: {...input().scope, [key]: "forged"}})).toEqual(bad);
  expect(copy({...copyInput(), [key]: "forged"})).toEqual(bad);
  expect(copy({...copyInput(), source: {...input(), [key]: "forged"}})).toEqual(bad);
  expect(copy({...copyInput(), targets: [{branchId: target, expectedVersion: 1, [key]: "forged"}]})).toEqual(bad);
});
it.each([null, [], actor, {}])("rejects wrong scope shape %j", scope => expect(save({...input(), scope})).toEqual(bad));
it("requires own exact keys and rejects nonenumerable/symbol extras", () => {
  const inherited = Object.create(input().scope);
  expect(save({...input(), scope: inherited})).toEqual(bad);
  expect(save(Object.defineProperty(input(), "timezone", {value: "UTC"}))).toEqual(bad);
  expect(copy({...copyInput(), [Symbol("claim")]: true})).toEqual(bad);
});
it.each([null, [], {}, "schedule"])("rejects invalid schedule shape %j", schedule => expect(save({...input(), schedule})).toEqual(bad));
it("delegates invalid day, time, nextDay and unknown schedule claims to the shared validator", () => {
  for (const day of [{state: ["closed"]}, {state: "open", intervals: []}, {state: "closed", timezone: "UTC"}, {state: "open", intervals: [{start: "25:00", end: "26:00", nextDay: false}]}, {state: "open", intervals: [{start: "09:00", end: "08:00", nextDay: false}]}, {state: "open", intervals: [{start: "09:00", end: "10:00", nextDay: "false"}]}]) {
    expect(save({...input(), schedule: {...input().schedule, monday: day}})).toEqual(bad);
  }
  expect(save({...input(), schedule: {...input().schedule, timezone: "UTC"}})).toEqual(bad);
});
it("rejects same-day, next-day and Sunday-wrap overlap", () => {
  const sameDay = input(); if (sameDay.schedule.monday.state === "open") sameDay.schedule.monday.intervals[1].start = "11:59";
  expect(save(sameDay)).toEqual(bad);
  const nextDay = input(); nextDay.schedule.tuesday = {state: "open", intervals: [{start: "23:00", end: "04:00", nextDay: true}]}; nextDay.schedule.wednesday = {state: "open", intervals: [{start: "03:00", end: "05:00", nextDay: false}]};
  expect(save(nextDay)).toEqual(bad);
  const wrap = input(); wrap.schedule.monday = {state: "open", intervals: [{start: "01:59", end: "04:00", nextDay: false}]};
  expect(save(wrap)).toEqual(bad); expect(copy({...copyInput(), source: wrap})).toEqual(bad);
  wrap.schedule.monday.intervals[0].start = "02:00"; expect(save(wrap).ok).toBe(true);
});
it.each([null, [], {}, "targets", [null], [[]], [{}]])("rejects missing/malformed targets %j", targets => expect(copy({...copyInput(), targets})).toEqual(bad));
it("rejects sparse arrays at interval and target boundaries", () => {
  expect(save({...input(), schedule: {...input().schedule, monday: {state: "open", intervals: Array(1)}}})).toEqual(bad);
  expect(copy({...copyInput(), targets: Array(1)})).toEqual(bad);
});
it("rejects invalid target UUID, duplicate IDs ignoring case and source as target", () => {
  expect(copy({...copyInput(), targets: [{branchId: "not-a-uuid", expectedVersion: 0}]})).toEqual(bad);
  expect(copy({...copyInput(), targets: [{branchId: target, expectedVersion: 0}, {branchId: target.toLowerCase(), expectedVersion: 1}]})).toEqual(bad);
  expect(copy({...copyInput(), targets: [{branchId: branch.toLowerCase(), expectedVersion: 0}]})).toEqual(bad);
});
it.each(["utc", "local", null, ["local-weekday-clock"]])("rejects unsupported copy mode %j", mode => expect(copy({...copyInput(), mode})).toEqual(bad));
it("does not invent a branch-count capacity limit", () => {
  const targets = Array.from({length: 40}, (_, i) => ({branchId: `${(i + 1).toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, expectedVersion: i}));
  expect(copy({...copyInput(), targets}).ok).toBe(true);
});
it("clones both directions for scope, days, intervals, source and targets", () => {
  const original = copyInput(), result = copy(original); expect(result.ok).toBe(true); if (!result.ok) return;
  const before = structuredClone(original);
  result.input.source.scope.companyId = actor;
  result.input.source.schedule.tuesday.state = "unset";
  if (result.input.source.schedule.monday.state === "open") result.input.source.schedule.monday.intervals[0].start = "08:00";
  result.input.targets[0].expectedVersion = 99; result.input.targets.push({branchId: actor, expectedVersion: 0});
  expect(original).toEqual(before);
  const parsedBefore = structuredClone(result.input);
  original.source.scope.expectedAccountId = company;
  original.source.schedule.friday.state = "closed";
  if (original.source.schedule.sunday.state === "open") original.source.schedule.sunday.intervals[0].end = "03:00";
  original.targets[0].branchId = actor; original.targets.length = 0;
  expect(result.input).toEqual(parsedBefore);
});
it("accepts frozen inputs without mutating any record or interval", () => {
  function freeze(value: object): void { for (const item of Object.values(value)) if (item && typeof item === "object") freeze(item); Object.freeze(value); }
  const value = copyInput(); freeze(value); expect(copy(value).ok).toBe(true);
});

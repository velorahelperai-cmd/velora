import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {emptyBranchHours} from "@/lib/tenancy/branch-hours-contracts";
import {PaidBranchHours,branchHoursViewKey,type PaidBranchHoursProps} from "./paid-branch-hours";

const scope = {expectedAccountId: "account", companyId: "company", branchId: "branch"};
const props: PaidBranchHoursProps = {
  locale: "en",
  scope,
  boundaryFingerprint: "capture",
  snapshot: {
    scope,
    version: 1,
    branchLabel: "Main",
    timezone: "Asia/Muscat",
    schedule: emptyBranchHours(),
  },
  state: {scope, version: 1, phase: "ready"},
  copyTargets: [],
  isCurrent: () => true,
};

const render = (patch: Partial<PaidBranchHoursProps> = {}) =>
  renderToStaticMarkup(createElement(PaidBranchHours, {...props, ...patch}));

describe("PaidBranchHours", () => {
  it.each(["ar", "en"] as const)("renders grouped read-only summaries without per-day editors in %s", locale => {
    const html = render({locale});
    expect(html.match(/data-hours-group=/g)).toHaveLength(1);
    expect(html).not.toContain("+ Add interval");
    expect(html).not.toContain("+ إضافة فترة");
    expect(html).not.toMatch(/data-hours-day="[^"]+"[\s\S]*?<select/);
    expect(html).toContain('dir="' + (locale === "ar" ? "rtl" : "ltr") + '"');
    expect(html).toContain("Asia/Muscat");
    expect(html).toContain(locale === "ar" ? "إضافة مواعيد" : "Add hours");
  });

  it("does not show server-confirmed status copy to the customer", () => {
    expect(render()).not.toContain("server confirmed");
    expect(render({onSave: () => { throw Error("No render side effects"); }})).not.toContain("server confirmed");
    expect(render({state: {...props.state, phase: "saved"}})).not.toContain("server confirmed");
  });

  it.each([
    {scope: {...scope, branchId: "other"}},
    {state: {...props.state, scope: {...scope, expectedAccountId: "other"}}},
    {state: {...props.state, version: 2}},
  ])("fails closed for security boundary or scope mismatch %#", patch => {
    const html = render(patch);
    expect(html).toContain("unavailable");
    expect(html).not.toContain("data-hours-day");
  });

  it("renders schedule form immediately when snapshot is null (non-blocking local draft)", () => {
    const html = render({snapshot: null, state: {...props.state, version: null, phase: "loading"}});
    expect(html.match(/data-hours-group=/g)).toHaveLength(1);
    expect(html).not.toContain("Loading branch hours");
    expect(html).not.toContain("جارٍ تحميل مواعيد الفرع");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-hours-action="add"');
    expect(html).toContain('disabled=""');
  });

  it("distinguishes loading and conflict without blocking the form", () => {
    const loadingHtml = render({state: {...props.state, phase: "loading"}});
    expect(loadingHtml).not.toContain("Loading branch hours");
    expect(loadingHtml).toContain('aria-busy="true"');
    expect(loadingHtml.match(/data-hours-group=/g)).toHaveLength(1);

    const conflictHtml = render({state: {...props.state, phase: "conflict"}});
    expect(conflictHtml).toContain("Saved hours changed");
    expect(conflictHtml.match(/data-hours-group=/g)).toHaveLength(1);
    expect(conflictHtml).toContain('disabled=""');
  });

  it("keeps the form usable while loading without the unavailable error banner", () => {
    const html = render({snapshot: null, state: {...props.state, version: null, phase: "loading"}, onReload: () => {}});
    expect(html.match(/data-hours-group=/g)).toHaveLength(1);
    expect(html).not.toContain("Loading branch hours");
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("Hours for this branch are unavailable");
    expect(html).not.toContain("Saving is not confirmed");
  });

  it("does not render the unavailable hours error banner", () => {
    const html = render({snapshot: null, state: {...props.state, version: null, phase: "unavailable"}, onReload: () => {}});
    expect(html).not.toContain("Hours for this branch are unavailable. Saving is not confirmed.");
    expect(html).not.toContain("مواعيد هذا الفرع غير متاحة. الحفظ غير مؤكد.");
  });

  it("does not substitute a default timezone", () => {
    const html = render({snapshot: {...props.snapshot!, timezone: null}});
    expect(html).toContain("Unknown");
    expect(html).not.toContain("Asia/Muscat");
    expect(html).not.toContain(">UTC<");
  });

  it("remounts drafts on scope, capture or version changes, but not language", () => {
    const key = branchHoursViewKey(props);
    for (const field of ["expectedAccountId", "companyId", "branchId"] as const) {
      expect(branchHoursViewKey({...props, scope: {...scope, [field]: "other"}})).not.toBe(key);
    }
    expect(branchHoursViewKey({...props, boundaryFingerprint: "new"})).not.toBe(key);
    expect(branchHoursViewKey({...props, snapshot: {...props.snapshot!, version: 2}})).not.toBe(key);
    expect(branchHoursViewKey({...props, locale: "ar"})).toBe(key);
  });

  it("shows prior-day carry-over explicitly even when no interval starts today", () => {
    const schedule = emptyBranchHours();
    schedule.monday = {state: "open", intervals: [{start: "22:00", end: "02:00", nextDay: true}]};
    schedule.tuesday = {state: "closed"};
    expect(render({snapshot: {...props.snapshot!, schedule}})).toContain("Carry-over from the previous day until:");
  });

  it.each(["ar", "en"] as const)("renders persisted holiday dates with full-day override guidance in %s", locale => {
    const schedule = {...emptyBranchHours(), exceptions: [{date: "2026-12-01", hours: {state: "closed" as const}}]};
    const html = render({locale, snapshot: {...props.snapshot!, schedule}});
    expect(html).toContain('value="2026-12-01"');
    expect(html).toContain(locale === "ar" ? "مغلق طوال اليوم" : "Closed all day");
    expect(html).toContain(locale === "ar" ? "امتداد اليوم السابق" : "previous-day carry-over");
  });

  it.each(["ar", "en"] as const)("renders a centered add/edit rest state without the old quick-apply bar in %s", locale => {
    const html = render({locale});
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(html).toContain(locale === "ar" ? "مواعيد العمل" : "Working hours");
    expect(html).toContain(locale === "ar" ? "إضافة مواعيد" : "Add hours");
    expect(html).toContain('data-hours-mode="rest"');
    expect(html).toContain('data-hours-action="add"');
    expect(html).not.toContain(locale === "ar" ? "تطبيق سريع" : "Quick apply");
    expect(html).not.toContain(locale === "ar" ? "على أيام العمل" : "To workdays");
    expect(html).not.toContain(`>${locale === "ar" ? "تطبيق" : "Apply"}<`);
  });

  it("renders days starting with Sunday for natural Arab regional business week", () => {
    const html = render({locale: "ar",snapshot:{...props.snapshot!,schedule:{...emptyBranchHours(),monday:{state:"closed"}}}});
    const firstDayIndex = html.indexOf('data-hours-days="sunday"');
    const mondayIndex = html.indexOf('data-hours-days="monday"');
    expect(firstDayIndex).toBeGreaterThan(-1);
    expect(mondayIndex).toBeGreaterThan(-1);
    expect(firstDayIndex).toBeLessThan(mondayIndex);
  });
});

it('does not claim days are unset while the saved hours are still loading',()=>{
 const html=render({snapshot:null,state:{...props.state,version:null,phase:'loading'}});
 expect(html).toContain('Checking');expect(html).not.toContain('Not set');
});
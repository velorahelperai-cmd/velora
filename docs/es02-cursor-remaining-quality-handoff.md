# ES02 remaining quality — Cursor handoff

Status: **Implemented / Not Verified**. Cursor did not run tests. Codex phone, journey, review, order, and migration work is not treated as complete here.

Path: `C:\Users\DELL\Desktop\Velora new`. This file is the only documentation write for this task.

## Ownership

Read-only while Codex owns the optional branch phone: `prepayment-preparation.ts`, `branch-contact-phone.test.ts`, `prepayment-preparation.tsx`, `prepayment-preparation.test.tsx`, `setup-plan-journey.ts`, `setup-plan-journey.test.ts`, `setup-order-review-model.ts`, `setup-order-review.tsx`, `setup-order-review.test.tsx`, `account-order-actions.ts`, `account-order-actions.test.ts`, `es02-sql-contract.test.ts`, `supabase/migrations/20261019172428_es02_optional_branch_contact_phone.sql`, plus `PROJECT_STATE.md`, `designbrief.md`, and `docs/superpowers/plans/2026-10-19-es02-optional-branch-contact-phone.md`.

Edited only:

- `src/components/app/setup-team-plans.tsx`
- `src/components/app/setup-team-plans.test.tsx`

## What changed

Plans leaf only.

- Arabic Standard badge is `القياسية`, matching the tier and summary. It no longer says `أساسي`.
- Premium-only feature prefix is `إضافة المميزة` in Arabic.
- Unchosen summary copy matches the branch row: `لم يُختر بعد`.
- Continue arrow is `←` in Arabic and `→` in English.
- Branch buttons, summary rows, and the mobile options keep `localId` when the snapshot already has one. Display still reads persona and package from that slot object, so a reordered snapshot does not paint one branch’s choice on another name.

Test definition added in `setup-team-plans.test.tsx`: `keeps each branch choice on that slot after the list order changes`. Not run.

Correction: `texts` already returns a string (`JSON.stringify`). The four new `.join` calls in that test were removed. The same four assertions still check `إضافة Premium`, `إضافة المميزة`, `→`, and `←` with `toContain`. No other `texts(...).join` remains in this file. TypeScript sees `texts` as `string`, so `.join` was the same type error.

## Contracts left in place

- Business and branch facts stay local before payment. Phone and `localId` stay off the financial payload.
- One shared term. Prices and replies come from `readPlan` and the catalog. Yearly replies stay monthly. Calls addon stays `FUTURE_NOT_READY_FOR_SALE`.
- Plans continue calls local review only. `confirmWired` stays false.
- Create business and branches only after one proven settlement. No fake payment success and no unpaid order from review.
- Session protection and RLS were not changed. No extra migration.

## Remaining gaps

- Optional branch phone, invalid-phone rejection, and contact persistence after settlement are Codex’s reserved files. Migration `20261019172428_es02_optional_branch_contact_phone.sql` is not applied by this task.
- Choice retention when a branch is renamed, duplicated, or deleted is the reserved journey’s unique name+city rule. This leaf only displays the snapshot it receives.
- Terms open from reserved `setup-order-review.tsx` to `/terms` in a new tab. `LegalPage` still returns home and appends the existing subscription policy. Final legal wording and a bound return path are not approved, so they were not rewritten.
- Paymob and browser-loss recovery stay deferred. Homepage and the approved plans layout were not redesigned.

## Release

Writing is finished. `src/components/app/setup-team-plans.tsx` and `src/components/app/setup-team-plans.test.tsx` are released for Codex to read and verify. Cursor did not rerun the test. No design, contract, or extra scope change.

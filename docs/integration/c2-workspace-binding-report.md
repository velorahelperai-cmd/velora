# C2 rendered-company binding

Implemented in the integration worktree only; nothing staged or committed.

## Security contract

The affected forms previously submitted changes without identifying the company they rendered. Every server action resolved the currently selected company, so an owner belonging to A and B could render an A form, select B elsewhere, and submit A's values into B.

The actions now accept an optional `expectedCompanyId`. They still run their existing authoritative `getCompanyAccess` and owner/capability gates. A supplied ID must have the existing UUID shape and equal the company returned by those gates before any requested mutation, Storage upload, billing order creation, provider attempt, or bound knowledge/review read. The supplied ID does not select or authorize a company.

- A valid mismatch returns `FORBIDDEN` with the constant message `workspace_changed`.
- A malformed supplied value, including explicit `undefined`, returns `INVALID_INPUT` with `invalid_company`.
- Omitted fields retain the legacy contract.
- Only `saveOwnerBusiness` accepts explicit `null`; it binds creation to authoritative `company === null` and cannot silently become an existing-company update.
- File upload reads `expectedCompanyId` from FormData. A Blob/File value or multiple values fails closed.
- `listKnowledgeSources`, `getCompanyReviewRequest`, and `listCompanyReviewEvents` take an optional object `{ expectedCompanyId?: string }`. Wrong empty lists and null reviews are refused before the data query, so they cannot be adopted as facts about the rendered company.
- `getCustomerReadiness` passes its captured company ID into nested knowledge and review reads; a scope mismatch produces an item with `load_failed`.

## Scoped review-event RPC dependency

Root found that the legacy `list_owner_company_review_events()` RPC chooses the first active owned company rather than the selected workspace. Every `listCompanyReviewEvents` call now uses `list_owner_company_review_events_for_company({ p_company_id: gate.companyId })`, including callers that omit the rendered-company expectation. It has no fallback to the old first-company RPC.

Root owns the forward read-only RPC migration, generated database type entry, canonical session/owner checks, and SQL verification. This action depends on that new RPC being available. No SQL or generated/shared types were edited by the workspace-binding agent.

## Changed files and review boundaries

| File | Binding evidence | Review boundary |
| --- | --- | --- |
| `src/lib/tenancy/actions.ts` | Helper line 59; nested reads lines 395/419; review check line 570; events check line 593/scoped RPC line 598; submit check line 626; resubmit check line 659; business check line 753 | Optional inputs and private expectation validation, captured-company nested reads, new scoped event read RPC caller; no Auth, access-gate, or review-write-policy changes |
| `src/lib/whatsapp/connection-actions.ts` | Input line 87; check line 105 | Saved request only, after existing owner/suspension gates and before the existing RPC |
| `src/lib/knowledge/actions.ts` | Helper line 53; list input/check lines 405/409; text check line 442; upload check line 490 | Bound list read, text create/update, upload; existing capability gates, approval probing, extraction, version approval, and Storage policy preserved |
| `src/lib/billing/wiring/test-checkout-actions.ts` | Input line 9; check line 12 | Initial Test checkout only, before config/order/provider work; local result allows bounded message, existing global billing/Auth contracts preserved |
| `src/lib/tenancy/c2-workspace-binding.test.ts` | Offline boundaries line 5; action matrix line 120; knowledge-read tests line 149; review-read tests line 197; write tests line 247 | Real server actions with external boundaries replaced for offline regressions |
| `docs/integration/c2-workspace-binding-report.md` | This report | Integration evidence only |

Caller shapes were coordinated with the C2 UI owner: `expectedCompanyId` belongs inside each existing write input object, including both review actions; upload uses one FormData field; all three bound getters use an optional object. The UI owner confirmed that knowledge editor/route reloads and ActivationStep review/event reloads now pass these objects. UI implementation and final caller verification remain owned by the C2 UI owner/root.

## Actual verification

1. RED before implementation: `node node_modules/vitest/vitest.mjs run src/lib/tenancy/c2-workspace-binding.test.ts --reporter=dot` exited 1: **52 failed, 25 passed**. Stale business/review/WhatsApp/knowledge actions returned success and reached B mutations; checkout reached its order boundary and returned `plan_not_published` instead of refusing the binding. Malformed/Blob/duplicate binding regressions also failed because the input was ignored.
2. GREEN after implementation: the same command exited 0: **77 passed**.
3. Adjacent regressions: `node node_modules/vitest/vitest.mjs run src/lib/tenancy/review-refresh.test.ts src/lib/knowledge/access-grants.test.ts src/lib/whatsapp/control-tenant-binding.test.ts src/lib/billing/wiring/test-checkout-actions.test.ts src/lib/tenancy/c2-workspace-binding.test.ts --reporter=dot` exited 0: **5 files, 97 passed** (includes the 77 binding tests).
4. Scoped lint: `node node_modules/eslint/bin/eslint.js src/lib/tenancy/actions.ts src/lib/whatsapp/connection-actions.ts src/lib/knowledge/actions.ts src/lib/billing/wiring/test-checkout-actions.ts src/lib/tenancy/c2-workspace-binding.test.ts` exited 0 with no diagnostics.
5. `git diff --check` for the four backend files exited 0.
6. An integration `tsc --noEmit` snapshot during parallel UI edits exited 1 with diagnostics in `knowledge-editor.tsx`, `setup-wizard.tsx`, and `subscription-offer-cards.tsx`; none in the assigned backend files or test. Root owns the final full offline suite, typecheck, lint, and build after UI edits settle.
7. Knowledge-read RED before its guard: the dedicated test command exited 1 with **9 failed, 82 passed** (91 total). B-empty and B-nonempty reloads were accepted; malformed expectations were ignored; readiness mislabeled B's empty list as A's `knowledge_empty`. After the guard and nested binding, the five-file focused suite exited 0 with **111 passed**.
8. Review/event-read RED before those guards/scoped caller: the dedicated command exited 1 with **11 failed, 96 passed** (107 total). Both absent/existing B reviews and B events were accepted by A reloads; malformed expectations were ignored; exact emitted RPC checks showed the old no-argument first-company RPC; readiness mislabeled B's null review as A's `review_none`.
9. Final focused GREEN: the same five-file suite exited 0 with **127 passed**, including **107 dedicated workspace-binding tests**. Scoped lint of the same five changed code/test files again exited 0 with no diagnostics; scoped diff check also exited 0.

No live database, paid AI, WhatsApp, Paymob, or cloud write was executed. No RPC/migration was authored by this agent; the scoped read RPC caller is coordinated with root's migration work. No flag activation, policy change, source-branch edit, staging, commit, push, merge, or backup was performed by this work.

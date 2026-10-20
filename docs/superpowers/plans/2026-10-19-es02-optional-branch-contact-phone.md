# ES02 optional branch contact phone implementation plan

### ES02 concurrent provisioning gap - closed (2026-10-19)

15/15 additional real PostgreSQL assertions PASS; the previous111unit/128Chrome receipts are retained unchanged and were not rerun. Two distinct PostgreSQL backends invoked the current provisioning RPC for the same existing approved synthetic account/session, verified synthetic settlement/order, and operation UUID. The first transaction was held after successful provision; the second actual RPC was observed waiting on the first backend's native advisory authority lock before the first COMMIT. After commit the second returned reuse with the identical company/order/order-group receipt. Actual committed result:1company,4branches,1order,1verified settlement,1provisioning,1billing subscription,1activation foundation,1credit balance,4branch rights. Phones and distinct authoritative branch IDs match; business-wide contact stays unchanged.

Retry contract checked: a valid changed phone payload reuses the completed immutable receipt and cannot overwrite contacts/IDs/effects; malformed later-branch phone returns INVALID_INPUT before reuse. The existing contract does not promise rejection of every valid changed completed retry payload. No product or migration change was required.

Isolation: a disposable logical snapshot of the existing owned fixture was used because separate concurrent backends must commit to see each other's result; a single outer rollback cannot encompass both. Existing identities/session/lineage and current RPCs were copied, with no new account or credential. Unrelated pg_cron/cron scheduler was excluded because it is restricted to the canonical database name. Existing native supabase_admin was used only to restore original owners; both tested RPC backends remained authenticated through the actual registered session checks. PostgreSQL acldefault expands NULL owner ACL to its equivalent exact grantor/options set when comparing restored metadata; no grants, RLS, role attributes or authority functions were changed. Source before/after security is additionally compared byte-for-byte with the original accepted security baseline.

All disposable databases and mode0600 in-container snapshot dumps from harness diagnosis and final run were removed by exact owned names; final prefix scan found0remaining. Canonical c1_ui_integration remains orders/settlements/provisions/companies/branches0,authUsers4, original ACL/RLS/owner/search_path unchanged. Initial snapshot restore diagnostics (pg_cron database restriction, existing-role ownership and explicit-vs-default owner ACL representation) were harness isolation issues, not product defects; cleanup succeeded for each. No unsafe auth seeding, provider call, Production access, commit/push or next-stage advance.

Evidence: task/es02-branch-phone-concurrency.cjs; es02-branch-phone-concurrency-result.json (real overlap, receipts, effects, contacts and cleanup); es02-branch-phone-concurrency-source-final.json; updated es02-branch-phone-final-receipt.json. Fresh final presentation guard PASS: viewport:null/native maximized1600x773/scale1, OS media preference restored, video time4.009->5.517, muted loop/ready4/poster hidden, inputs preserved. Provider/live-payment and terms-publication limitations remain unchanged.


## Current ES02 optional branch phone and bounded Cursor quality review - verified locally (2026-10-19)

Approval Sentinel_b926590487208191bedf5bc302e4480a executed on the existing isolated c1_ui_integration fixture only. Optional additional-branch phone now maps local contactPhone -> local review -> independently normalized paid-action p_branches.contact_phone -> nullable public.company_branches.contact_phone in the existing verified-settled provisioning transaction. No main-phone copying, financial payload metadata, or prepayment business/order creation. Original-row defaults and editor identity remain attached to their original local UUID.

111 focused unit checks PASS: retained branch-phone98/8 suites plus independent plans13/1 suite.128 actual Chrome checks PASS: retained branch-phone86 in AR/EN desktop1600 and390/320 plus new Cursor integration42 in AR/EN desktop1600 and320. Scoped lint0 and final TypeScript0. Actual four-branch PostgreSQL persistence, unpaid/foreign/stale/invalid-later-branch guards, stable IDs/contacts on retry, single settlement/provision/ledger, and denied direct-role read PASS; fixture writes rolled back. Exact owner/ACL/effective privileges/RLS/policies/search_path unchanged. CLI migration20261019172428_es02_optional_branch_contact_phone.sql applied locally only; no remote migration claimed.

Cursor's one authorized bounded task changed only setup-team-plans.tsx/test.tsx plus its new handoff doc, without overlapping Codex's13 reserved paths. Reviewed Arabic القياسية / إضافة المميزة / لم يُختر بعد, AR←EN→, and local-ID display anchors. Cursor corrected four invalid test .join calls after independent RED. Codex then proved duplicate-ID sibling-key collision RED and added unique nonempty-ID keys with separate legacy fallback; missing/empty/duplicate IDs now pass. Actual choice retention still belongs to the journey's unique normalized name+city mapping, not React keys; rename/ambiguous branch rules remain unchanged. Terms opening in a separate tab preserves review and leaves consent off. No new task or duplicate submission.

Ownership RELEASED after verified final hashes: all13 paths in task/es02-branch-phone-owned-files.json, the two released Cursor plans files, PROJECT_STATE.md, this design brief and the implementation plan. Release closes this authorized task; it does not authorize an ES-stage advance or new writer. Final visible Chrome is native maximized viewport:null,1600x773,scale1; reduced-motion emulation cleared to OS preference, video ready4/muted/loop/actual time progression/poster hidden, original inputs unchanged.

Evidence: task/es02-branch-phone-final-receipt.json (frozen source/candidate hashes and component receipts); es02-branch-phone-unit.log/json; es02-branch-phone-browser-result.json; es02-branch-phone-apply-result.json; es02-branch-phone-native-result.json/log; es02-branch-phone-security-before.json/after.json; es02-cursor-unit/lint/types.json and logs; es02-cursor-browser-result.json; es02-branch-phone-final-preview-result.json/png; docs/es02-cursor-remaining-quality-handoff.md. Prior25auth/54country/12defaults browser receipts are reused historical evidence and are not counted as new runs.

Limits: payment provider/real settlement and browser-loss payment recovery remain deferred. Terms DOCX draft IS approved as drafting baseline (Velora_Service_Terms_AR_DRAFT.docx); final publication/version binding awaits unresolved legal-entity/commercial details. Native provision proof is transaction-scoped PostgreSQL/RPC using an existing registered fixture session and SQL-local request claims, not a browser/provider paid flow. Two-real-backend duplicate provisioning now verified15/15 in a disposable snapshot; native lock overlap, identical receipt, stable phones/IDs and single billing effects passed, with the source fixture unchanged. Final DB counts orders/settlements/provisions/companies/branches0,authUsers4. No Production, commit, push, deployment, provider call, new credential or account. No claim that all possible bugs or Production readiness are verified.

### Current ES02 acceptance matrix

| Area | Result | Evidence / boundary |
| --- | --- | --- |
| Business and branch entry, optional/blank/invalid/Arabic phone, no copying | PASS |98units;86Chrome; AR/EN desktop1600,390,320 |
| Stable editor/default ownership; removal/reorder; plan/contact association | PASS |86Chrome, domain/journey units;13plans units include missing/empty/duplicate IDs; no reorder UI added |
| Personas, package/term, canonical totals, entitlements and add-on boundaries | PASS |13plans units;42Chrome; shared catalog unchanged, replies remain monthly under annual term |
| Local review, back/edit, consent initially off, terms tab and return | PASS |86+42Chrome; final terms publication remains separate |
| Keyboard/country options/accessibility touch targets | PASS (reused + targeted) | Prior54country Chrome/27contact units retained; new optional labels/control geometry in86Chrome |
| Session/capture/logout/cookie replay and refusal/error states | PASS (bounded/reused) |98focused refusal/lifecycle units; native stale/foreign guards; prior25host and native transport/session receipts retained |
| Actual paid RPC branch contact persistence and idempotent retry | PASS (local SQL) | Four real branches, atomic invalid later row, authoritative IDs, duplicate settlement/retry, rollback; no browser-paid assertion |
| ACL/RLS/owner/search_path and prepayment zero writes | PASS | Exact before/after/final security;128Chrome financialPosts0; final fixture financial/business counts0 |
| Native visible media, viewport and input preservation | PASS | Final preview receipt: viewport:null/native maximized1600x773/scale1/native motion/video advancing/input fingerprint preserved |
| Two-real-backend same-operation provisioning race | PASS (isolated snapshot) |15native assertions; observed lock overlap, identical receipt,1company/4branches/single billing effects, valid changed retry immutable, malformed retry rejected, snapshot removed |
| Provider payment/reconciliation/browser-loss payment recovery | BLOCKED / DEFERRED | Deliberately outside current integration; no live provider or charge tested |
| Terms draft baseline / legal publication | APPROVED BASELINE / PUBLICATION BLOCKED | Approved DOCX retained; unresolved entity/commercial details and version-bound publication |

Resolved verification failures: Cursor test string.join calls and duplicate React keys; no unresolved failure in the bounded implemented task. Initial DDL missing terminator rolled back, corrected, then applied and verified. Test harness corrections (Arabic persona expectation, native mobile branch selector, expanding feature details before reading visible copy) changed no product behavior. Existing historical entries below are chronology, not the current task status.

## Global constraints and approval boundary

- Plan only today: no application, SQL migration, database, credential, provider or preview changes were made for this planning task.
- Additional-branch phone is already requested. Remaining approval is for the DTO/storage/RPC extension and applying its additive migration **only to the owned isolated local fixture**. Production deployment/migration requires separate authorization.
- Keep prepayment page-local, optional, and nonpersistent. Never copy the business contact phone into branch rows. No phone ownership/WhatsApp verification claim.
- Preserve existing actor/capture fences, consent invalidation, branch-plan binding, price/settlement guards, transaction atomicity, idempotent reuse and exact ACLs. No new financial writes.
- No new account/keys/grants, full-page/picker redesign, stage advance, Production, commit or push.

## Verified baseline and reuse decision

Local evidence: `C:/Users/DELL/Documents/Codex/2026-10-16/task/es02-density-defaults-db-and-phone-contract.json` and `es02-branch-phone-plan-local-metadata.jsonl`.

| Existing location | Actual behavior / required change |
| --- | --- |
| `src/lib/tenancy/prepayment-preparation.ts` — `Preparation`, `emptyPreparation`, `validatePreparation` | Branch currently has only name/city. Extend the local branch contract and validate optional canonical contact phone. |
| `src/lib/business-phone-input.ts` — `parseBusinessPhoneInput`, `storedPhoneDisplay`, `phoneCountryFromValue` | Reuse international normalization, optional empty value and numbering-plan checks; do not invent another parser. |
| `src/components/app/business-phone-field.tsx` — `BusinessPhoneField` | Reuse per-row editor, localized validation, LTR digits, country picker and Studio `groupLabel` layout. |
| `src/components/app/prepayment-preparation.tsx` — `StudioPreparationForm`, `branch`, `addBranch`, `removeBranch` | Stable local row keys and per-branch contact editing; retain tested first-branch default provenance. |
| `src/components/app/setup-plan-journey.ts` — `clonePreparation`, `deriveSlots`, `snapshot`, `projectSelection` | `clonePreparation` explicitly drops fields other than name/city today. Carry phone/local ID in local snapshots; retain phone-independent plan binding and offer-only projection. |
| `src/components/app/setup-order-review-model.ts` — `ReviewSlot`, `ReviewRow`, `buildReviewModel`, `buildOrderModel` | Carry optional phone as local display metadata in both preview/order models. |
| `src/components/app/setup-order-review.tsx` — review row rendering | Show supplied branch contact in LTR isolation; no business-phone fallback. |
| `src/lib/billing/es02/account-order-actions.ts` — `completeOwnedProvisioningAction` | Current `p_branches` mapping sends name/city only. Normalize/revalidate and explicitly map the new field after existing authority checks. |
| `public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)` | Latest implementation is `supabase/migrations/20261017140000_es02_c2_atomicity_ledger_snapshot.sql`. Validate every optional phone before any write; persist in existing branch UPDATE/INSERT statements. |

`public.companies.contact_phone` is the business-wide contact, not a per-branch destination. Actual `public.company_branches` columns are `id, company_id, name, timezone, status, is_primary, created_at, city`; no phone column exists. No phone column was found on branch-named public/private tables. Reuse the existing **table and row IDs**, but one additive column is necessary; reusing the business-wide field would overwrite a different contact.

Verified local baseline: `c1_ui_integration`, PostgreSQL17.6; table/RPC owner `postgres`; branch RLS enabled, force-RLS false, no branch policy rows returned; table ACL only `postgres=arwdDxtm/postgres`; RPC ACL `postgres=X/postgres, authenticated=X/postgres`, SECURITY DEFINER, empty search_path. This is local evidence, not a claim about a hosted baseline. Do not add direct browser SELECT/UPDATE grants.

## Approved contract — implemented and verified locally

- Local `PreparationBranch`: existing `name`, `city`, plus optional `contactPhone?: string` and optional **UI-only** `localId?: string`. New UI rows receive a local ID once; legacy name/city-only preparations remain valid. Persisted database branch IDs are never replaced by local IDs.
- Blank/absent contact phone means no branch contact: normalize to `null` at the server/storage boundary. A nonempty draft value committed by `BusinessPhoneField` is canonical E.164. Server validation parses it independently with no inferred country for ambiguous national-only payloads.
- Proposed reusable helper in `prepayment-preparation.ts`: `normalizeOptionalBranchContactPhone(value: unknown): {ok:true; value:string|null} | {ok:false; code:"INVALID_BRANCH_PHONE"}`. Reuse `parseBusinessPhoneInput`; undefined/blank is valid, non-string or invalid nonempty input fails. `validatePreparation` emits `branches.<index>.contactPhone`; server action returns existing `INVALID_INPUT` without calling RPC.
- Local review metadata may extend `BranchSlotChoice.label` / `ReviewSlot.label` with optional `contactPhone` and `localId`; `ReviewRow` exposes optional `contactPhone`. Phone is never a branch identity or pricing key. Existing unique name/city choice retention and rename/ambiguity safeguards remain.
- Server projection: `Preparation.branches[i].contactPhone` → `p_branches[i].contact_phone` → `public.company_branches.contact_phone`. Strip `localId`; never send either value to `beginAccountPaymentAction`, `createAccountBoundOrderAction`, the immutable offer or provider payload.
- Initial original branch has no independently entered branch phone. Each additional logical row starts empty and retains its own optional editor even if removal/reordering moves it to position0. Track original-row identity by its local ID rather than treating index0 as that identity. No reorder UI is added.

## Review focus

1. Invalid unblurred editor text must block navigation rather than silently submitting the last valid stored value — Task1/3 tests.
2. Removing/reordering rows must not transfer an editor's draft, country selection, phone or plan — Task1 tests.
3. A renamed branch still requires the existing explicit plan decision; changing only its phone must preserve plan/term while resetting consent through the existing preparation transition — Task1/3 tests.
4. Invalid phone on a later branch must reject the entire provision before any company/branch/ledger write — Task2 tests.
5. Completed provisioning reuse must never overwrite an existing contact with a retry payload; native OS reduced-motion preferences must survive QA handoff — Task2/4 tests.

## Task1 — Local draft, stable editor identity and review

**Modify:** the five local draft/host/journey/review files in the baseline table. Reuse `BusinessPhoneField`; no new picker.
**Tests:** `prepayment-preparation.test.tsx`, `setup-plan-journey.test.ts`, `setup-order-review.test.tsx`, `business-contact-fields.test.tsx`, and `src/lib/tenancy/prepayment-preparation.test.ts`.

- [ ] Add failing tests: absent/empty phone accepted; malformed nonempty phone rejected; Arabic digits and international numbers normalized by existing parser; fixed lines remain valid; no copy from business phone.
- [ ] Add local row creation/identity once in `emptyPreparation`/`addBranch`, preserve ID in `clonePreparation`, key fieldsets/editors by it, and bind first-branch pristine defaults to the original ID. IDs are local metadata, not server authority.
- [ ] Add optional phone editor for additional logical rows. Keep first-branch name/city defaults and manual clears intact. Preserve optional phone, editor country/draft and plan through back/edit/remove/reorder; new rows stay empty. Invalid editor drafts block Next through existing validity checks.
- [ ] Extend local cloning/slot/review metadata explicitly. Both review-model branches retain supplied contact; render it only when present in `<bdi dir="ltr">`. No raw phones in logs, URLs or purchase payloads.
- [ ] Run the focused existing Vitest suites; verify phone-only edits retain choices/term and reset consent, stale callbacks cannot restore contacts, and capture/logout clears value **and provenance**. Do not apply schema or ship an orphan input independently of Task2 approval.

## Task2 — One additive migration and existing settled provision

**Create after approval:** `supabase/migrations/20261019170000_es02_optional_branch_contact_phone.sql` (currently absent; latest observed migration is `20261017150000_es02_c3_exact_client_op_unique.sql`). Never edit historical migrations.
**Modify:** `account-order-actions.ts`, `account-order-actions.test.ts`, `es02-sql-contract.test.ts`.

- [ ] Add failing action/SQL tests for exact phone projection, invalid phone causing zero RPC calls, and missing phone remaining compatible.
- [ ] Add nullable `public.company_branches.contact_phone text` with a named constraint accepting NULL or canonical format `^\+[1-9][0-9]{6,14}$`. No uniqueness requirement or backfill from `companies.contact_phone`. Fail closed if a conflicting preexisting column/constraint is discovered.
- [ ] In `completeOwnedProvisioningAction`, independently normalize every nonempty phone and pass `contact_phone` or null. Keep business phone and all authority/UUID/preparation checks separate.
- [ ] `CREATE OR REPLACE` the existing RPC with its **unchanged signature**. Extend the existing pre-write loop to validate optional JSON phone type/canonical format on EVERY branch. Add contact_phone only to the existing primary-branch UPDATE and additional-branch INSERT. Persist a supplied contact for the same logical branch even if that branch moved to the first slot; never infer a business-phone fallback.
- [ ] Preserve active-actor recheck, owned settled-order requirement, slot counts, stored offer consistency, advisory lock, whole-transaction rollback, ledger binding and existing completed/reconciliation paths. Completed reuse preserves already stored contacts; it is not a contact-edit endpoint. No extra order, payment, settlement or provisioning calls.
- [ ] Snapshot/compare owner, function ACL/grantors/options, effective inherited rights, RLS, SECURITY DEFINER and search_path before/after. No new grants, policies, tables or sequences. Direct unauthenticated reads remain denied.
- [ ] Apply/test only on the approved isolated local baseline after explicit contract/migration approval. Reuse the existing synthetic-fixture settlement gate (`fixture-synthetic-settlement.ts: settleAccountOrderSyntheticFixture`) for paid-path proof; never enable provider/customer synthetic settlement. Use disposable transaction-scoped test records/rollback; preserve current preview data and fixture, no rebuild.
- [ ] Native DB assertions: unsettled/foreign/stale/invalid-later-branch cases create nothing; valid owned settled order stores separate optional phones with server-generated branch IDs; blank is NULL; retry/concurrent duplicate preserves row IDs, one provision/ledger binding and original contacts. Existing business phone is unchanged. Confirm fixture-owned labels/database before any apply; record actual result separately from static SQL-contract tests.

## Task3 — Purchase/recovery boundary regression

**Verify existing:** `preparation-handoff.ts`, `preparation-handoff.test.ts`, journey/action tests and `readOwnedPurchaseRecoveryAction` / `completeOwnedProvisioningAction`.

- [ ] Keep `sanitizeCheckoutPayload` rejecting preparation/business/branches/phone facts. Frozen financial selection still consists of persona/package slots and term only; no local ID/contact enters the order or changes amount/rights.
- [ ] Verify local preparation→plans→review→edit/back in AR/EN on desktop and320/390, including blank/invalid/cleared contacts and two branches sharing a valid contact. Preserve48px picker options,46px controls and existing accessibility associations.
- [ ] Keep page-close behavior explicit: unsaved draft facts are gone and must be re-entered in owned paid recovery; do not add autosave or invent a persisted quote. Provision only through the existing verified-settled recovery path, never from prepayment Next/Review.
- [ ] Run targeted Vitest, scoped lint and TypeScript; then actual local Chrome/SQL checks for the changed paths only. Preserve old receipts as historical; freeze candidate hashes and record separate PASS/FAIL/Blocked evidence. Do not repeat unrelated full suites.

## Task4 — Mandatory native-motion preview handoff guard

**Record/update the local QA harness:** existing work artifacts `es02-country-density-browser.js`, `es02-user-restored-preview.mjs` and `es02-restore-natural-motion.js`; no product motion redesign.

- [ ] User-visible preview contexts omit `reducedMotion:'reduce'`. Deterministic reduced-motion tests use separate contexts.
- [ ] In handoff/finally, call `page.emulateMedia({reducedMotion:null})`, not `no-preference`. Assert effective preference equals the native preference sampled with emulation cleared. Never change Windows/browser accessibility preferences.
- [ ] Record an input fingerprint before/after reset (never raw inputs/credentials), native maximized viewport without forced sizing, active/visible state and real media evidence. If native reduce is true, require the static poster and respect it. Otherwise, when in view, require readyState≥2, visible muted loop video, advancing currentTime, no media error and poster hidden only after actual playing.
- [ ] Test success **and failed/aborted QA** handoffs; a timeout/rejected promise must settle immediately in the independent worker and still restore native presentation. Do not kill the retained preview/controller or overwrite user input. Preserve per-run result files rather than replacing an earlier PASS with a blocked retry.

## Delivery / acceptance gate

- UI→local snapshot→review→server normalization→existing paid RPC→branch column has one explicit mapping, with no dropped field and no new financial side effect.
- Stable local row keys and authoritative database branch IDs are distinct and preserved; no value migrates to a different branch.
- Optionality, normalization, invalid-input localization, account/tenant/capture fences, all-or-nothing provision and replay safety pass focused tests.
- Native-motion handoff guard passes; existing user input and completed evidence remain intact.
- Technical contract/migration approval was received and executed locally. Implementation, local apply and scoped verification are recorded above; Production readiness and provider integration are not claimed.

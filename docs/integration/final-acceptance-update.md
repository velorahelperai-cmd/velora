# Final integration acceptance update

**Local unified candidate: YES, for offline fixtures/public preview. Ready for Staging: NO.** Release Security Gate remains blocked. This update does not certify real payment, Auth, AI or WhatsApp activation.

Branch: `integration/overnight-velora`. Fixed acceptance base: `200100bf9937d7c790b679a1435ab4d216505ff7`. The final local commit containing this report is supplied in the delivery message. All changes are confined to the attached independent integration worktree; original source branches/worktrees are preserved.

## Source inclusion

Each required source is an ancestor and occurs exactly once in `git log --format=%H`; all three `merge-base --is-ancestor` checks exited 0. No new merge or duplicate cherry-pick was necessary.

| Source | Full SHA | Count |
|---|---|---:|
| A2 Business Dashboard / Onboarding / Knowledge | `58415d038cd1e62ac09870ad16e51a8e9a157c6e` | 1 |
| A2 variants / feature matrix / Admin Catalog | `1aca1904cefc9ab459b2868df7b2c8fdd1899108` | 1 |
| A1 Unified Inbox | `7bca9ff8c867e6eedd1da6d5194f78dc2c7c2b49` | 1 |

The previously saved C1 local correction gate is PASS, while its release gate is BLOCKED. Financial changes were already included as a locally tested fail-closed candidate, not as commercially approved or production-ready payment. See `docs/security-foundation/c1-report.md` and `overnight-final-report.md`.

## Acceptance findings and corrections

| Requirement / finding | Evidence file:line | Correction / current result | Limit |
|---|---|---|---|
| Visible Noura identity; residual raw `noor` Admin labels | `src/components/app/admin-catalog-model.ts:5`, `admin-catalog.tsx:295` | Localized selector/history/summary/publication-review labels now use Noura/نورا. Internal codes/assets are unchanged. Four rendered Arabic/English regressions reproduce the old labels and approval copy. | No identifier migration. |
| Unsupported monthly/annual purchases and misleading price approval | `src/components/app/subscription-offers-view.ts:62`, `admin-catalog.tsx:59` | Preserved the inherited supported published Test-selection gate; removed false Live/commercial approval disclosures. Current public catalog is monthly only; annual cards remain unavailable for purchase. Published price/capacity/version evidence is required. | Owner commercial approval, supported annual contracts and processor Live contract remain unapproved. |
| Selected plan lost at public continuation/account panel | `src/components/landing/packages.tsx:55`, `src/components/app/subscription-navigation.ts:64`, `subscription-panel.tsx:24` | Bounded persona/package/term/version/amount/currency intent survives existing authentication links/storage. Panel derives selection from the current intent and exact current published offer on every render. URL change/refresh cannot retain a stale cached choice. | Inspection does not grant purchase; no automatic checkout. Unsupported cards stay nonselectable for purchase. |
| Setup-company branch and wizard lost return selection | `src/lib/tenancy/access.ts:372`, `src/lib/auth/setup-return.ts:12`, `src/app/setup/page.tsx:18`, `setup/layout.tsx:9`, `setup-wizard.tsx:503` | Required setup retains the allowed return path without nesting it. Login/verification/profile redirects retain it; plan-tab link restores it. Duplicate/external/oversized destinations are rejected. Existing staff/admin/provisioning gates remain. | Real Auth browser round trip is NOT RUN. |
| Payment return link lost selected plan | `src/lib/billing/wiring/return-load.ts:69`, `src/components/app/subscription-navigation.ts:95`, `src/app/app/subscription/orders/[orderId]/page.tsx:19` | Added optional existing locked-order metadata to the same-company read. Back-link restores only an exact current published version/amount/currency match. Legacy/retired/changed/unavailable catalog cases use the generic subscription link. | Navigation only; settlement predicates, actions, RPCs and schema are unchanged. |
| Browser payment success must not prove collection | `src/lib/billing/wiring/return-status.ts:34`, `selection-return.test.tsx` | Retained DB-only status/settlement processing and operational entitlement readers. Forged success/amount/version query is ignored by the actual return route test. A stored provider event without a grant does not confirm activation. | Real collection and merchant/amount contract still unverified. |
| Dashboard/Inbox tenant and A1/A2 compatibility | `src/components/app/dashboard.tsx:91`, `onboarding-contracts.ts:53`, `docs/integration/c2-inbox-ui-report.md` | Re-reviewed integrated role routes, bounded SQL totals, company-scoped panels/knowledge/review/read controls, refreshed-thread permissions and unknown-send guards. No duplicate components/routes or new material issue was found. | Source/default fixtures and prior actual PostgreSQL evidence; no configured real account browser journey. |
| Review request/approval is not Noura/Meta activation | `src/components/app/onboarding-contracts.ts:53`, `setup-wizard.tsx:1388` | Review, paid entitlement, Meta ownership/authorization/test evidence and rollout remain separate. Live Answering remains false and external send was not enabled. | Meta/customer Live rollout requires separately approved configuration. |

RED runs reproduced three setup-routing failures, the rendered plan loss and four Admin label/disclosure failures before corrections. Focused tests also cover annual inspection, invalid/duplicate intent, changed catalog, wrong tenant, legacy payment rows, forged return query and safe error states. Independent final source re-review: PASS, no remaining material issue in this update's scope.

## Fresh unified verification

| Category | PASS | FAIL | Skipped / NOT RUN |
|---|---:|---:|---|
| Fresh default unified application suite | 1243 | 0 | 40 skipped; 110 files passed, 10 skipped (120 total) |
| Fresh TypeScript check | PASS | 0 | Exit 0 |
| Fresh full repository ESLint | PASS | 0 errors | 2 pre-existing unused-variable warnings: `reconcile.ts:344`, `return-status.ts:78` |
| Fresh Next.js 16.3.8 production build | PASS | 0 | Compile, TypeScript and static generation completed; exit 0 |
| Fresh browser loopback checks | 5 | 0 | Four public desktop/mobile/access cases; one annual-inspection guard + manually opened login/signup return-link case |
| PostgreSQL / PGlite in this acceptance update | — | — | NOT RUN; no SQL/schema changes |
| Real Auth / cloud parity / payment / models / Meta | — | — | NOT RUN; no real provider authorization |

Focused source checks were also independently rerun in the full unified suite. The default skipped cases include opt-in database tests; none are counted as successful. Actual-provider and real Auth tests remain NOT RUN. PostgreSQL/PGlite were not rerun for this navigation/display/read-projection update; no SQL or schema changed.

The additional browser check initially assumed configured anonymous Auth and timed out waiting for a login link; actual public navigation correctly goes to `UNAVAILABLE` because local Auth is absent. A second harness assertion incorrectly equated automatic account-observer Server Action POSTs with form submission. The corrected final case explicitly verifies the unavailable-account guard, manually opens login with inspection intent, and checks its signup link/URL without filling credentials or submitting forms. All external traffic and POSTs were blocked (two observer POSTs; zero form submissions). These earlier harness failures are not concealed or counted as application regressions/passes; a real registration/authenticated round trip remains NOT RUN.

Previous fixed-base evidence is separate: at `200100b`, actual isolated multi-session PostgreSQL passed 207 assertions/cases, SQL-backed application journeys passed 22, including populated legacy upgrade (18 scenarios / 20 assertions, retaining 23 financial grants). These are not added to the fresh default-suite count or represented as newly run here. The disposable PostgreSQL container was removed after those checks; no backup was created.

## Remaining launch blockers

- Exact cloud migration history, functions/ACLs/Vault/data parity and separately approved forward application; cloud verification remains BLOCKED.
- Actual Paymob merchant/environment/order namespace and OMR processing-unit contract, deadline/late-payment/refund/reconciliation policy and supported commercial catalog approval. Conversion factors and business policies were not changed.
- Real local Supabase Auth/HTTP setup for password/OAuth and protected UI acceptance; production worker operations, Meta app/domains/scopes/webhooks/customer grants, company AI budget provisioning and real-provider testing remain separately approved work.

No cloud SQL, real payment/paid model/WhatsApp message, push, deployment, merge into original/main branches, secret configuration or backup was performed. See `overnight-local-testing.md` for the offline fixture setup and loopback preview. The preview serves public/unconfigured states; it contains no authentication bypass or fabricated customer account.

Changed-file credential-pattern scan covered 23 files and found zero matching files. No migration was added/edited in this acceptance update. Final whitespace check passed; fresh application TypeScript/lint/build/test evidence precedes the local commit.

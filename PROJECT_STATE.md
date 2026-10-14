# Velora — central completion plan

Updated 2026-10-15, Asia/Muscat. Audit baseline: origin/main = `601813596f51086d74cca20f2f4b483caaf90447`. This audit changes PROJECT_STATE.md only; no new feature, workflow, Production SQL, secret or hosting-setting changes.

## Scope and evidence rules

- Preserve all 48 approved sections in `docs/integration/velora-plan-status.md`, Master scope in `docs/superpowers/plans/2026-10-14-master-customer-journey.md`, enterprise scope in `docs/integration/enterprise-customer-lifecycle.md`, and the commercial specification below. Old unchecked plans are requirements, not current completion evidence.
- Independent phases: **Implemented** = scoped code exists; **Integrated** = main contains it and consumers are wired; **Verified** = named acceptance proof; **Production Ready** = exact schema/config/release and actual operating journey proven. No whole-product Done claim.
- Matrix: Y = proven for stated limited scope; P = partial; N = not found in inspected implementation; U = unverified; R = earlier recorded scoped tests, not rerun here; B = blocked. Test existence alone never proves verification. Detailed acceptance remains in referenced source/tests/documents.
- Inventory: 19 src/lib domains, 320 tracked source test files, 127 SQL migrations. Counts are discovery metrics, not completion percentages. Obsidian references in repository docs were not followed.

## Decisions and release facts

- **OPS-001 — Approved:** Policy A, automatic Vercel Production deployment from main **after mandatory quality gates**. User authorized routine safe tested deployments without a separate approval per release. Policy-decision wait is closed; enforcement remains BLOCKED below. The unapplied vercel.json proposal disabling main deployment was removed; do not recreate it against Policy A.
- **SAFE-001:** preserve unrelated local work; no forced push/reset, guessed migration replay, destructive SQL or broad grants. Sensitive Production SQL/permissions/secrets require independent authorization and recovery proof. No extra paid AI verification; deliberate owner trials retain the enforced lifetime 1 OMR cap. Never expose credentials.
- **BILL-001:** commercial display is an approved versioned specification, not financial authority. Checkout needs a published server offer matching persona/tier/term/OMR amount/monthly allowance; missing or ambiguous matches deny payment. URL/storage cannot mint IDs or entitlements.
- **BILL-002:** current financial reader supports legacy monthly Noura offers and company/environment subscription scope. Six new financial bindings, annual checkout and per-branch enforcement are not implemented by commercial display. Preserve immutable existing financial history.
- **MEDIA-001:** supplied Noura/Lina H.264/AAC portrait videos + WebP posters total 1,745,280 bytes. Original Downloads files remain; AAC packets verified unchanged. Hosting/traffic and supplied Gemini-generation costs are unmeasured, never presumed zero. Keep new direct/shared expenses in `C:/Users/DELL/Desktop/التكاليف - Velora.txt`.
- Feature release `5e70beb0e1ca26db98f566ec1da9f9062ec951d0`: six displayed plans/two supplied videos. Documentation/authorization follow-up `6018135` is main. Latest observed deployment `dpl_EancNcnS6NRqx6rUN3BPCXW4tdZQ`, `velora-h4z8ccb9f-velora-9513.vercel.app`, READY/Production; earlier feature deployment `dpl_ZSUoS9C7c54MM8wDt9FdEoh6MvMW` also READY, bound to public domain.
- CAT/VID evidence: 108 targeted tests passed; targeted ESLint zero errors/warnings; TypeScript and Webpack production build passed; hosted build passed. Local Turbopack is limited by external node_modules junction. Public-domain postflight verified all monthly/annual totals, both supplied clips playing without media errors and mutual playback pause; local mobile/annual login intent checked. No payment activation.
- **ONB-001:** previous approved Production release recorded three migrations: `20261014080108_smart_setup_foundation`, `20261014080155_smart_profile_and_branch_attempts_v2`, `20261014080217_smart_review_native_scope`. Last recorded flags: Smart enabled, Master/Enterprise not enabled, private smart-review policy disabled. Not re-queried in this audit. Owner authenticated signup/logout/return remains unverified; SMS supplier explicitly deferred.

## Approved commercial contract

Per branch; annual upfront = monthly x 12 x 0.8. Reply allowances remain monthly. Standard: owner + 2 employees, WhatsApp OR Instagram. Premium: owner + 4 employees, both channels. Enforcing these is CAT-002.

| Persona / tier | Monthly OMR | Annual OMR | Replies/month |
|---|---:|---:|---:|
| Noura Standard | 45 | 432 | 1,000 |
| Noura Premium | 90 | 864 | 3,000 |
| Lina Standard | 65 | 624 | 2,000 |
| Lina Premium | 120 | 1,152 | 6,000 |
| Dana Standard | 75 | 720 | 3,000 |
| Dana Premium | 150 | 1,440 | 10,000 |

- All: approved business FAQ/services/prices/policies in Arabic/English, enquiries/contact collection, staff handoff, history and quick replies.
- Noura Premium: case classification/tracking/routing, summaries, CSAT and alerts/reports; optional voice-message understanding remains separate.
- Lina Standard: recommendations, leads, order/quote requests and appointment details for staff confirmation. Premium: follow-up/reminders, segments/campaigns, Instagram comments/DM replies, store-bound cart recovery, sales assignments/reports, bounded workflows.
- Dana Standard: requests/bookings for staff review, status tracking, change/cancel requests, bounded reminders. Premium: operations/workflows, branch assignment, delay alerts/reports, payment follow-up with configured add-on.
- **ADD-001:** optional Premium Velora-owned website/store and cashier/POS, stock/bookings/payment/accounting, custom n8n/Make workflows. Separate selectable setup/recurring charges; scope/supplier/limits/prices not finalized.
- **VOICE-001:** actual phone conversations taking orders/bookings/appointments and voice-message handling. Supplier/number/minutes/consent contracts unfinished; no new paid trials authorized.
- **CONTENT-001:** images/reels/supported scheduled stories/content/campaigns from conversation, preview/approval and bounded publishing. Ads/WhatsApp fees separate/customer-funded; automatic WhatsApp Status publishing is not verified supported.
- Full service definitions: `src/components/app/subscription-commercial-catalog.ts`. Availability derives from proven capability, not marketing persona. Standard display retains internal legacy basic keys.

## Evidence index

- **E-AUTH:** `src/lib/auth/`, `src/lib/tenancy/access.ts`, `docs/auth-session-authorization-report.md`: recorded 506 focused tests, 30 native identity/35 draft checks, dated Production identity/draft metadata checks. Real email/Google/account/provider round trips explicitly incomplete.
- **E-SMART:** `src/components/app/smart-autosave.ts`, `use-smart-autosave.ts`, Smart components/tenancy actions; `scripts/integration/smart-local-journey.mjs`, `scripts/internal-ui/smart-autosave-journey.mjs`; prior 31-assertion native browser journey recorded in E-ENT. Production boundary above.
- **E-MASTER:** tenancy business-authority/setup-draft/setup-file/personal-phone/identity-recovery; billing activation/cycle-credits/autorenew-wallet/lifecycle; Master plan and `20261014015904`–`20261014033012` SQL candidates. Main presence does not prove Production application.
- **E-ENT:** `src/lib/enterprise/`, organization UI, enterprise branch/staff/guard SQL; `docs/integration/enterprise-customer-lifecycle.md`: recorded 81 native assertions, 3,237 source tests/122 skips, later 13 focused checks. Enterprise browser/Production and branch conversation routing remain open.
- **E-TEAM:** `src/lib/platform-teams/`, `src/components/teams/`, `docs/integration/platform-teams-ui-acceptance.md`: recorded native/functional proof, 18 presentation groups, 105 focused/2,078 aggregate tests; dated transport/Production boundaries retained.
- **E-FIN:** `src/lib/billing/`, `docs/billing/p2-readiness-report.md`, `docs/billing/acceptance/`, `docs/integration/g07-financial-truth-report.md`; synthetic settlement/concurrency proof does not prove Live OMR processing.
- **E-SVC:** `src/lib/services/`; service-capability-readiness/service-purchase-orchestration/noura-worker-authority/staff-final-dispatch acceptance docs under docs/integration. Recorded 39 orchestration SQL cases plus prerequisite-denial checks; grant/runtime allowlist narrower than approved commercial catalog.
- **E-KNOW:** `src/lib/knowledge/`, approved retrieval, `docs/integration/g03-main-acceptance.md`: recorded 24 native checks, 1,333 tests/42 skips; exact-generation review/publication/retrieval scope.
- **E-AI:** `src/lib/answers/`, `docs/real-ai-runtime-verification.md`, `docs/multi-model-phase-one-review.md`, `docs/integration/p3-p4-safe-report.md`; adapters/routing/budget/usage/owner diagnostics. Prior owner execution is separate from customer activation; no paid calls in this audit.
- **E-CHANNEL:** `src/lib/channels/contract.ts`, whatsapp/instagram/meta-review modules; docs/integration d1-d6-identity-delivery/unified-inbox-contracts/p4-meta-multitenant-report and `docs/whatsapp-coexistence-release-handoff.md`; OAuth/webhook/send/uncertainty proof, no fresh real Meta acceptance.
- **E-BASE:** `docs/integration/velora-plan-status.md` preserves all 48 sections. Supersede old missing claims only with current main/newer scoped evidence. `docs/integration/final-acceptance-update.md` records older 1,243-test offline integration; never sum historical counts into one fresh run.

## Feature Completion Matrix

Every row retains independent phases and acceptance limits. Y covers the named scope, not every associated future control.

| Stable ID / scoped feature | Implemented | Integrated | Verified | Production Ready | Acceptance / missing work |
|---|---|---|---|---|---|
| AUTH-001 registration/confirmed identity/profile/safe login and Google returns | Y | Y | R/P | U | E-AUTH: actual new/existing account/email/Google, redirects/SMTP/code expiry |
| AUTH-002 session inactivity/cross-tab invalidation/password reset/revocation | Y | Y | R/P | U | E-AUTH/Master: real two-session idle/logout/revoke/recovery |
| AUTH-003 personal phone change/enrollment/reviewed identity recovery | Y | Y | R/P | B | E-MASTER; SMS deferred; old/new proof and privileged recovery |
| ACCT-001 account/profile/workspace picker/person-business separation | Y | Y | R/P | U | E-AUTH: stable identity, multiple businesses/staff returns |
| ACCT-002 MFA/step-up/session UI/preferences/avatar/provider links/ownership transfer | P | P | U | N | E-BASE §§1–3,7–8,34–36; versioned consents and remaining/later controls |
| BUS-001 idempotent business creation/CAS profile/contact/hours/language/timezone | Y | Y | R/P | U | E-MASTER/SMART: sensitive edits reviewed, old customer compatibility |
| ONB-001 Smart cards/branch question/settings and branch autosave/safe retry | Y | Y | R/P | P | E-SMART: named Production foundation only; real owner journey pending |
| ONB-002 durable resume/cancel/expiry/paid retention/file-generation jobs | Y | Y | R/P | U | E-MASTER: late write/lost response/cancel/payment-delete races, legal retention |
| REV-001 version-bound setup/knowledge review/resubmission/G03 proof | Y | Y | R/P | U | E-KNOW/SMART: actual owner-reviewer-owner/channel-independent journey; policy not enabled at last check |
| ORG-001 branch/manager/employee/schedule/presence foundations | Y | Y | R/P | B | E-ENT: enterprise rollout off; complete role UI and branch dispatch required |
| STAFF-001 invitations/acceptance/reissue/cancel/recovery | Y | Y | R/P | U | E-AUTH/ENT: replacement/race/revoke, seats/supervisor/branch ceilings |
| RBAC-001 tenant/session/server capability/RLS authority | Y | Y | R/P | U | E-AUTH/SVC/ENT: RPC/Storage/direct API/branch final-dispatch acceptance |
| TEAM-001 internal platform hierarchy/owner-delegated-team UI | Y | Y | R/P | U | E-TEAM: exact current runtime/revisions/transfer/replay/live scope |
| CAT-001 six displayed plans/annual 20% totals | Y | Y | Y | Y | Narrow display scope only: 108 tests/public postflight, no service activation |
| CAT-002 twelve financial offers/annual/per-branch quota-seat-channel enforcement | N | N | U | B | BILL-001/002/E-FIN: legacy binding only; compatible financial contract required |
| BILL-003 Paymob checkout/HMAC/proven settlement/reconciliation/reversal | Y | Y | R/P | B | E-FIN: merchant/environment/OMR contract/real provider proof; return query never proves payment |
| BILL-004 activation deadline/trusted start/cycle/expiry | Y | Y | R/P | U | E-MASTER: payment/entitlement/start distinct; annual CAT-002 compatibility |
| BILL-005 upgrade/downgrade/cancel/consented auto-renew/wallet | Y | Y | R/P | B | E-MASTER: provider mandate/legal policy/legacy-new quota mapping/unknown charge |
| BILL-006 invoice documents/manual collection/refund/export | P | P | R/P | U | E-FIN/BASE §18: stored evidence is not complete operator/document workflow |
| AI-001 approved knowledge extraction/retrieval/version-bound answers | Y | Y | R/P | U | E-KNOW/AI: exact files/Storage/current provider/Production budget |
| AI-002 model routing/adapters/bounded owner console | Y | Y | R/P | P | E-AI: prior owner-only runtime scope; not customer activation |
| AI-003 cycle credits/reservations/cost/compensation/limits | Y | Y | R/P | U | E-MASTER/AI: concurrency/provenance/expiry; old 500/1500 vs new 1000/3000 Noura credits |
| AI-004 assistant/model policy draft-publish-rollback/quality triage UI | P | P | U | N | E-BASE §§12–14: version management/affected-company preview/correction reports |
| CHAN-001 entitled channel selection distinct from role/provider/readiness | Y | Y | R/P | U | E-CHANNEL/SVC: plan revision/paid proof/account-branch/native readiness |
| WA-001 Meta signup/tenant number/Vault/coexistence/migration | Y | Y | R/P | U | E-CHANNEL: app/domains/scopes/ownership/cancellation/reconnect/native sync |
| WA-002 durable inbound-outbound/window/worker/handoff/final dispatch | Y | Y | R/P | U | E-CHANNEL/SVC: real delivery/uncertainty/scheduler fairness; branch extension blocked |
| IG-001 Instagram OAuth/assets/webhook/inbox/manual send/recovery | Y | Y | R/P | U | E-CHANNEL: scopes/revocation/windows/real provider journey; preserved local overlap |
| META-001 isolated review drafts/bootstrap/test dispatch | Y | Y | R/P | U | meta-review module: explicit review scope, current provider proof; no generic customer enablement |
| MSG-001 Messenger | N | N | U | N | E-BASE §40: native auth/events/send/window contracts absent |
| INBOX-001 customer unified inbox/scoped reads/manual controls/leads | Y | Y | R/P | U | E-CHANNEL: authenticated multichannel/role/browser/delivery journey |
| INBOX-002 branch routing/least-loaded assignment/takeover/shift recovery | P | P | U | B | E-ENT critical gate: scope throughout server/worker/final provider dispatch |
| CRM-001 masking/notes/tags/close-reopen-rating/reports/attachments | P | P | R/P | U | E-ENT/BASE §§20,42: full scoped lifecycle/dedupe/export/revocation |
| SERV-001 complete Noura/Lina/Dana advertised services | P | P | U | B | Approved catalog above; capability/grant/runtime allowlist currently narrower |
| AUTO-001 internal guarded workers/automatic replies | Y | Y | R/P | U | E-SVC/CHANNEL: claim-bound usage/authority/live schedule/recovery |
| ADD-001 website/store/POS/stock/accounting/n8n/Make optional integrations | N | N | U | B | Scope/supplier/prices/real persistence/auth/integration required |
| VOICE-001 phone conversations/order-booking/voice messages | N | N | U | B | Supplier/minutes/consent/recording/persistence/handoff; videos are not telephony |
| CONTENT-001 generated media/campaigns/supported scheduled publishing | N | N | U | B | Preview/approval/provider limits/charges and actual publishing |
| ADMIN-001 company/account/review/access/billing/catalog/AI dashboards | Y | Y | R/P | U | E-BASE/FIN/TEAM: current real owner routes/drill-downs/period filters/remaining controls |
| ADMIN-002 official Velora inbox/support tickets | P | P | U | N | E-BASE §§15–16,20: explicit platform workspace/native inbox reuse/ticket lifecycle |
| OPS-002 notifications/tasks/daily queue/search/saved views/reports | P | P | U | N | E-BASE §§2,21,28,30: narrow outboxes/leads exist, full recipient dedupe/snooze absent |
| OPS-003 health/queues/incidents/emergency controls/monitoring | P | P | R/P | U | Worker outcomes exist; alerting/queue console/incidents/operational proof missing |
| AUDIT-001 mutation-outcome history/unified audit/export/retention | P | P | R/P | U | E-BASE §24/TEAM: complete scope/filter/export/retention; no tamper-proof claim |
| SETTINGS-001 platform publication/maintenance/templates/settings/backups | P | P | U | U | E-BASE §25: catalog/runtime subset only; controlled wider configuration/recovery |
| DATA-001 scoped export/deletion/archive/retention/restore | P | P | R/P | B | Public policy/draft-archive jobs exist; full request-approval/export/erasure/full restore missing |
| SEC-001 launch security/abuse/cost reconciliation | P | P | R/P | B | security-launch-plan-01.md: no Critical/High, actual isolation/abuse/restore evidence |
| OPS-001 mandatory CI/main protection/automatic release enforcement | N | N | B | B | Fresh audit proves enforcement absent; readiness cannot be claimed |
| QA-001 complete real-business launch acceptance | P | P | R/P | B | Owner/two businesses/branches/staff/channels/payment/AI, interruption/revocation, AR/EN/mobile |
| VID-001 supplied Noura/Lina introductions | Y | Y | Y | Y | On-demand, one speaking clip, mute/pause/static fallback, unchanged original audio |
| VID-002 Dana introduction if supplied | N | N | U | B | Waiting for user media; keep portrait, no paid replacement generation |
| FUT-001 later admin assistant/specialist tools/partners/White Label/two-person approvals | N | N | U | N | E-BASE §29: retained later scope, never silently cancelled |

## Shared contracts

- **IDENT-001:** user_id = native auth.users.id, never editable email/phone/metadata. Require verified identity, valid native session_id and active server membership; expected user/company fencing prevents late-account results. Broadcast/storage signals invalidate only; recovery cannot silently merge accounts.
- **TENANT-001:** persisted business key = public.companies.id / company_id / TS companyId. Product business_id refers to this identity; do not invent a second key or choose first company. Workspace picker/server revalidation supports multiple businesses per account.
- **BRANCH-001:** company_branches.id / branch_id belongs to company via composite (company_id,id) FK. Enterprise employee identities/account bindings are explicit. Null/primary branch is not blanket access; company-level inbox/billing does not establish branch isolation.
- **ROLE-001:** company owner/staff, enterprise manager/employee and internal platform teams are separate authority systems. Platform admin cannot substitute customer membership. Invitation identity/company/branch/role/revision and current session are checked at action/dispatch boundaries.
- **WRITE-001:** CAS profile/branch/channel revisions plus durable actor-bound attempt IDs; identical retries reuse receipts, different payload conflicts. Late responses/cancelled generations/account switches cannot overwrite newer state or delete replacement Storage objects.
- **FIN-001:** immutable plan version -> server quote/order snapshot -> merchant/environment/amount-bound evidence -> proven settlement/application -> grant -> trusted activation/cycle. Preserve company/environment lock order; no duplicate ledgers/guessed backfills/display-derived entitlement.
- **CHAN-001:** paid plan entitlement, selected channel revision, native provider connection/permission and account/role/branch operation are four independent facts. Every worker/final sender rechecks current authority and connection; payment alone is not readiness.
- **MSG-001:** conversation/message/job/send-intent/company/recipient/link-generation bindings stay immutable. Reconcile unknown provider outcome before retry; retain window/takeover/final-dispatch rules across reconnect/renewal.
- **KNOW-001:** approval/retrieval pin company/source/file generation/hash/version. Replacement/invalidation removes stale authority. Review approval never activates payment, Meta or AI.
- **USAGE-001:** reservations/credit/cost/reply capacity bind proven company subscription cycle; expiry/reversal/replay cannot extend time or mint grants. Tariff estimates differ from final provider cost; merchant accounting is not Velora billing accounting.
- **FLAGS-001:** Smart, Master, Enterprise, smart-review and provider/send/payment rollout are separate. smart-rollout.ts covers presentation/setup writes only. Revalidate exact schema/config before separately approved activation; no broad flags to bypass dependency gates.

## Worktrees / ownership / overlap

21 existing worktrees; branch names identify checkouts, not live chats. This chat owns the state audit only. Other active owners/tasks are unrecorded/unknown; no automatic communication is assumed. Recheck current status before work and integrate serially against latest main.

- Current: codex/master-customer-journey at `C:/Users/DELL/.codex/worktrees/velora-auth-release/Velora new`; main integration at `C:/Users/DELL/.codex/worktrees/main-consolidation/Velora new`. Both clean at 6018135 before this file edit; main publication held by OPS-001.
- Primary: `C:/Users/DELL/Desktop/Velora new`, codex/enterprise-customer-lifecycle at 10403f9, 22 behind/4 ahead by ancestry, 49 status entries at audit start including this plan copy. Compared individual changed blobs: 15 equal main, 29 differ; directories/plan excluded. Preserve all; differences do not prove publishable improvements.
- Primary overlap: IG OAuth/send/bootstrap, WA config/send, conversations/settings/admin-company UI, channel AI drafts, Meta review and four 2026101315..1705 SQL candidates; overlap with main session/billing/channel guards. Inspect each diff on current main, not branch name/commit count.
- codex/instagram-subscription-lifecycle (meta-review-browser-flow worktree) cb2d246: clean, 21 behind/0 ahead. codex/smart-business-onboarding e7e05b0: clean, 12 behind/0 ahead. Historical checkouts, no independent unpublished commits proven.
- codex/p2-billing-readiness 3f2ed0f: clean, 148 behind/1 ahead but git cherry marks patch already represented in main. Primary 50e7f28/80aad97/10403f9 also patch-equivalent; c28a858 differs as whole patch, while inspected enterprise modules/UI/three enterprise SQL files match main exactly. Do not blindly merge duplicates.
- integration/overnight-velora 8210e06: 118 behind/0 ahead, four untracked old local-HTTP harness/test copies; preserve. Reviewed harness/opt-in counterparts are in main; compare content before reuse/publication.
- Other clean historical ancestors (0 ahead): codex/g03-verified-review 116 behind; overnight/ai-whatsapp-runtime 134; overnight/security-foundation 135; codex/p1-p2-security-acceptance 143; codex/p3-ai-readiness 146; codex/p3-p4-safe-integration 138; codex/p4-meta-multitenant 137; codex/p4-whatsapp-readiness 146; codex/remainders-validation 116; codex/unified-inbox-backend 136.
- Gemini checkouts: integration/p1-p2-billing 144 behind, overnight/ui-inbox 143, overnight/ui-onboarding 138, detached ux-01-review 117; all clean/0 ahead. Exact paths available from git worktree list --porcelain. Other unattached branches do not prove active tasks; remote branches retained.

## CI Gates / main Protection / Vercel / postflight

- **CI Gates: NOT ENFORCED.** No tracked .github workflows. GitHub Actions API total_count=0; latest commit zero check runs, only Vercel success status. package.json has typecheck/lint/build, no mandatory test/CI script. Default Vitest can collect archived artifacts; native integration suites are opt-in. Local passing checks cannot prevent another direct untested main push.
- **GitHub main Protection: OFF.** Branch API protected=false, protection.enabled=false, required checks enforcement=off, empty contexts. Dedicated protection read 403 (integration lacks admin access); rulesets read 403 explicitly requires GitHub Pro or public visibility. Do not make the private repo public as workaround.
- **Vercel Auto Deployment: ACTIVE, UNPROTECTED.** Main pushes actually triggered READY Production deployments. Project CLI shows Next.js/default build, buildCommand=null; its projection does not expose advanced deployment checks/full Git settings. No mandatory pre-main gate proven; successful Vercel build is not proof CI ran before main. No hosting settings changed.
- **Post-deployment Verification: scoped.** CAT/VID public checks passed; latest 6018135 deployment READY with GitHub Vercel success. It changes documentation only. Authenticated Smart/enterprise/real payment/Meta/customer AI remain unverified; no unsafe redeploy/rollback.
- **Dependency scan:** fresh read-only npm audit --omit=dev --json: 3 Moderate, 0 High, 0 Critical. Not a complete security audit; assess affected paths before launch, no silent dependency updates.
- **Required preparation, not applied:** main-targeting PR CI with stable required contexts: locked install, TypeScript, ESLint, source-only offline tests, Production Build, dependency/credential/security scan and shared-contract compatibility. Affected high-risk changes need isolated native Auth/PostgREST/RLS tests; never Production customer fixtures/credentials/paid providers.
- **Enforce before main:** suitable private-repo protection entitlement, mandatory PR checks and current base/merge queue, no direct-main/admin/actor bypass. Running checks only after push main is insufficient because Vercel can start concurrently. Existing scripts/integration/vitest.enterprise.config.mts and offline guards are candidates to adapt, not proven mandatory CI.
- **Practical proof UNRUN:** failing PR cannot merge/reach main; passing PR runs every required job, integrates serially on latest main, deploys that exact SHA READY, and passes affected smoke. Hold main publication until this is proven or requirement explicitly revised; do not claim protected automatic deployment ready.
- Latest instruction limits edits to PROJECT_STATE.md and prohibits hosting/secret/Production changes. Workflow/protection repair is queued rather than applied in this audit. Sensitive permission/plan/secret changes need separate authorization; no passwords/keys requested.

## Dependency Map / critical path

`OPS-001 enforced release -> SEC/recovery -> AUTH/ACCT -> BUS/ONB + RBAC -> ORG/BRANCH -> CAT-002/BILL -> CHAN/native Meta -> INBOX/dispatch -> AI/USAGE -> SERV/AUTO -> QA-001 launch`.

- OPS-001 blocks main delivery, not authorized isolated coding. Identity/session/company/branch contracts are shared prerequisites for every mutation/order/worker/sender.
- ONB/review/knowledge prepare a business independently; payment/review/native connection/actual AI readiness converge before activation. Deferred SMS is not authorization to bypass confirmation.
- CAT-002 needs branch scope/immutable finance/compatible SQL; annual paid duration must coexist with monthly usage. Legacy Master 500/1500 credit/upgrade assumptions must not override approved 1000/3000 Noura quotas.
- Enterprise foundation is integrated; branch assignment/routing/final dispatch remains critical for multiple-branch activation. UI filtering alone cannot close it.
- Add-on voice/media/site/POS/accounting/workflows need supplier/cost/consent/capability and core paid/channel contracts, not generic flags.
- **Recovery blocker:** docs/recovery/README.md records an encrypted scoped snapshot with authenticated decryption/hash/count verification, not full Supabase Auth/Storage backup or tested SQL restore. Full recovery proof precedes sensitive Production changes; keep key outside repository.

## Next Task Queue

| Priority / ID | Next complete slice | Dependencies / acceptance / gates |
|---|---|---|
| P0 OPS-001 | Prepare CI and enforce private main protection | Plan/admin entitlement + permission beyond doc-only scope; prove failing/passing PR and exact-SHA READY/smoke; no settings changed here |
| P0 SEC-002 | Reconcile Production schema/ACL/function hashes and full recoverable backup/restore proof | Correct project + separately approved safe recovery environment; no guessed migration replay; scoped snapshot not full backup |
| P1 CAT-002 | Compatible twelve-offer annual/per-branch financial and quota-seat-channel contract | TENANT/BRANCH/FIN + legacy-credit mapping; wrong tenant/term/amount denies, concurrency/renewal/expiry; sensitive SQL separately approved |
| P1 INBOX-002 | Branch channel routing/assignment/takeover/worker/final dispatch | ORG/RBAC/CHAN/MSG; reconcile preserved Meta overlaps; two companies/multiple branches/shift/revoke/unknown-send tests before enterprise activation |
| P1 QA-ONB | Real dedicated-account Smart signup/save/logout/return acceptance | Existing Smart release; new/existing/branches/CAS/offline retry; no customer data; provider execution separately authorized, SMS deferred |
| P2 CHAN-LIVE | Meta/IG permission-delivery and Paymob merchant/OMR acceptance, separately | Secure provider configuration + specific live verification authorization; cancellation/reconnect/unknown outcome, not fixture/query success |
| P2 SERV-001 | Capability-by-capability Noura/Lina/Dana grant/worker/usage implementation | CAT/CHAN/INBOX/AI contracts; persistent authorized working workflows, no sale from price display alone |
| P2 OPS-002/003 | Notifications/daily queue/health/alerts/operator recovery | Existing outboxes/jobs and role scopes; dedupe/recipient scope/incidents/restore/export revocation |
| P3 ADD/VOICE/CONTENT | Priced optional real integrations | Suppliers/cost/consent/limits/stable core; preview/approval/safe retry, record setup/monthly charges |
| Later ADMIN/DATA/FUT | Support/audit/settings/export/privacy/preferences/specialist roadmap | Retain every E-BASE commitment; scoped policy/acceptance, no silent omission |

## Parallel work / integration rules

- Independent after contracts: CI preparation, recovery metadata/plan, scoped Smart QA, operator UI and supplier/cost discovery. Assign a separate codex/ branch/worktree and real owner to each future slice; unknown historic owners are not locks.
- Serialize shared billing/activation/usage/grants; branch/RBAC/Meta/inbox/dispatch; auth/drafts/Storage/review. Coordinate explicitly; no assumption chats exchange work automatically.
- Preserve local differences; fetch latest main, review task diff, run appropriate offline/native/build/security gates, update affected IDs, stage task files only, commit and integrate serially. Main publication/deployment resumes after OPS-001 enforcement is proven under Policy A.
- Verify exact Vercel SHA/READY and affected anonymous/authenticated smoke after each authorized release. Report failures immediately; reviewed non-destructive rollback/forward repair preserves new data and financial history. Source/display checks alone never certify full product.

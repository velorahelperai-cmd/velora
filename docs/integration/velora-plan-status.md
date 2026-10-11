Source attribution: the following dated baseline is preserved from Library `libfile_5e35343a1d948191bf6a78fd1d886408`; its statements about reading the full plan refer to that prior review. The current cloud writer read the complete 48-section checklist and adds the bounded current package status below.

# Velora — canonical 48-section reconciliation

Saved from the completed review, 11 October 2026. No audit or product tests were rerun to save this checklist. This is the single retained review checklist; the routing/revision clarification at the end records the already-delivered follow-up.

**R3 completes the internal-team foundation, not the 48-section product plan.** The next useful package is the owner’s team UI, followed by invitation recovery and durable customer onboarding.

The complete latest Library source was read: `libfile_39c2d774a6488191b2440a7661411199`, Pasted text(20261011-081429).md, **116,113 bytes, all 48 sections**, including §23.1–23.14; supported read returned both long lines with has_more=false and was inspected in bounded character chunks. The supplied summary `libfile_26010a6c47308191b92de17eb81fe132` was also read. Exact local text copy SHA256: `ae8c3ea3023dc0d9732e1324425c90c47d94b74098121e09193277cecbaad13d`.

Fetched origin/main at review time: **e0a7295ada51c2a2b4c8a80e9317b5aeae6983e2**. Product files were inspected from an isolated archive of that exact commit; the existing product checkout was not changed. Released R3 installer SHA256 matched `51edc97e450a892f5e6ea5c76dbc17eadf342d9c08b6d1956fa8122977b65d32`. Production installation and deployment/desktop synchronization are recorded from the parent’s named release handoff; no new production acceptance was performed by this reviewer.

Status: **I** implemented in this main baseline; **P** production verification recorded for the stated scope; **U** acceptance untested; **M** missing or incomplete; **F** explicitly later scope. “I” does not mean every related button works.

## Evidence references

- **A — Identity/account:** src/lib/tenancy/actions.ts:164,374,384,515; account-page.tsx, account-chrome.tsx; account/profile/control tests.
- **B — Company/setup/review:** tenancy actions :638,684,717,751,776,801; setup-wizard.tsx, company-draft.ts; review tests and docs/integration/internal-ui-acceptance.md.
- **C — Billing/metrics:** catalog backend, billing wiring/operations, financial-read.ts:60, dashboard-billing-actions.ts:10, admin-truth.ts:9; billing acceptance reports.
- **D — Knowledge/AI:** knowledge actions, exact-generation/publication contracts, approved retrieval, routing and budget runtime; knowledge/runtime tests.
- **E — Channel/inbox:** existing WhatsApp integration and unified-inbox contracts; identity/delivery and staff-final-dispatch acceptance reports. Production inbox remains with its existing writer, thread 01a1293c-1dfb-740c-9e4a-e4e33053a060.
- **T — Internal teams:** platform-team actions/contracts, R3 SQL, cases.mjs, and supabase/upgrade-packages/platform-teams/RELEASE-NOTES.md.
- **G — Earlier control corrections:** commits a6c06aa, ba601a3, 7856616; controls regressions, checkout-action, account and metric-validation tests.
- **R — Route/UI inventory:** current src/app, admin shell and workspace shell; absent destinations indicate UI omissions, not redundant controls.

## Complete checklist

| § | Canonical reconciliation |
|---|---|
| 1 Login/owner destination | **I/U:** verified identity, safe returns and workspace separation exist. **M:** administrative step-up/MFA experience. A |
| 2 Header/account menu | **I:** account/admin/workspace/logout links and retry. **M:** global search, notification centre, contextual help and expanded preferences menu. A/R |
| 3 My account | **I:** persisted name, role display, support/email copy, cancellation. **M:** security setup, session-management UI, notification/timezone/theme preferences. **F:** avatar/provider linking. A/G |
| 4 Admin navigation | **I:** companies, accounts, reviews, AI, billing, catalog, access. **M:** team and remaining operational destinations. Preserve labelled roadmap entries. R |
| 5 Overview | **I:** real counts, collections and AI ledger metrics. **M:** requested periods, complete operational cards and record drill-downs. **U:** current owner-browser acceptance. C/G |
| 6 Companies | **I:** scoped list/search/status/return filters and details. **M:** complete columns, exports, documented creation/archive workflows. **U:** full customer journey. B/R |
| 7 Company profile | **I:** business edits, reviews, members, knowledge and diagnostic links. **M:** complete tab set, ownership transfer and integrated support/history workflows. B/C |
| 8 Accounts | **I:** independent account search, memberships and access snapshot. **M:** session revocation, account suspension/recovery and ownership-transfer product flows. A/R |
| 9 Setup reviews | **I:** persisted submissions, resubmission history, version-bound decisions. **U:** complete current-release owner→reviewer→owner acceptance. **M:** internal-note workflow if required. B |
| 10 Independent states/readiness | **I:** separate review, billing, connection and knowledge evidence. **M/U:** complete, accepted manual-versus-AI gates and trial/manual-entitlement policy coverage. B/C/E |
| 11 Channels | **I:** WhatsApp connection/binding paths. **M/U:** full channel management, Instagram/Messenger integration, disconnect/repair and provider acceptance. E |
| 12 Assistants | **I:** knowledge-based tester/runtime and bounded execution. **M:** assistant configuration/version-management page. **F:** accounting, inventory and other specialist assistants. D/R |
| 13 Models/providers | **I:** adapters, routing, diagnostics and budget boundaries. **M:** policy draft/publish/rollback and affected-company preview UI. **U:** approved provider execution. D |
| 14 Knowledge/quality | **I:** persisted sources, preparation, version-bound approval and retrieval. **U:** current Storage/browser acceptance. **M:** issue triage, correction tasks and comparable quality reports. D |
| 15 Velora official inbox | **M/U:** explicit platform workspace, official-channel inbox and complete sales/support journey. Reuse existing inbox; coordinate exclusively with its writer. E/R |
| 16 Diagnostic conversations | **I:** scoped diagnostic access and recorded reason contracts. **U:** current acceptance. **F:** temporary delegated support sessions. E/B |
| 17 Plans/subscriptions | **I:** revisioned catalog, immutable offers, purchase/journey/cancellation backend. **M/U:** remaining subscription controls, policy coverage and live payment configuration. C |
| 18 Invoices/payments | **I:** order/payment evidence, reconciliation and reversal foundations. **M/U:** invoice documents, manual collection/refund workflows and provider acceptance. C |
| 19 Usage/cost/profitability | **I:** recorded usage, reservations and qualified collections. **M:** requested filters, limits/alerts UI and provider-cost reconciliation. Contribution margin remains later work. C/D |
| 20 Support tickets | **M:** ticket lifecycle, assignment, internal notes, external replies and links. **F:** SLA/reporting enhancements. R |
| 21 Notifications/tasks | **M:** durable recipient-scoped notifications, deduplication, ownership, snooze and daily work summary. R |
| 22 Health/queues | **I:** jobs, send outcomes and guarded processing foundations. **M:** health console, incident workflow and scope-specific emergency controls. **U:** operational acceptance. E/D/R |
| 23 Internal hierarchy | **I/P:** R3 schema/actions installed per release handoff; source and recorded native runtime checks. **M:** owner/delegated/staff UI, internal invitations, assignments, approvals and team reports. **U:** Next SSR/browser transport. T |
| 24 Audit log | **I:** existing audit writes and team mutation/outcome atomicity. **M:** unified filtering/export UI and retention policy. Do not claim tamper-proof history. B/T/R |
| 25 Platform settings | **I:** narrower catalog/runtime configuration exists. **M:** general settings, maintenance, templates, retention, backups and controlled configuration publication. C/D/R |
| 26 Export/deletion | **I:** public information page. **M:** scoped request/approval/export/download/deletion lifecycle and ownership handling. R |
| 27 Control contracts | **I:** earlier draft, action-lock, validation, confirmation and metric fixes are in main. **U:** remaining route-by-route acceptance, interrupted flows and accessibility. G |
| 28 Near-term owner conveniences | **M:** actionable daily queue, health card, saved views, safe bulk work, internal guidance and measured customer contribution. Readiness links provide only part. B/C/R |
| 29 Future features | **F:** administrative assistant, automation, specialist tools, integrations, expansion reports, partners/White Label and two-person approvals. Preserve roadmap. |
| 30 Daily/weekly workflow | **I:** existing review, company, billing and AI entry points. **M:** consolidated work queue and weekly/monthly operational reports; restore evidence. B/C/R |
| 31 Implementation sequence | **I:** audit and foundational releases completed. **M:** remaining packages. Continue functionality-first; design follows accepted behavior. G/T |
| 32 Launch acceptance | **U:** complete owner/two-company/roles/provider journey. Recorded isolated tests cover subsets, not the complete launch matrix. A–T |
| 33 Planning references | **I:** latest plan fully reconciled. Historical documents remain evidence of their dated scope, not current completion claims. |
| 34 Person/company separation | **I:** Auth, company memberships and internal platform roles are separate. **M:** customer manager/supervisor/branch model; current company roles are owner or staff. A/B/T |
| 35 Owner registration | **I:** signup/verification, company persistence and staged setup. **M:** durable cross-device setup intent/progress, service choice and complete resumable onboarding. B |
| 36 Registration data | **I:** basic identity/business/contact fields. **M:** versioned terms/consents and exposed timezone/required preferences; staged optional data and first-use telemetry. A/B |
| 37 Customer staff invitations | **I:** hash-only, email-bound acceptance into existing company. **M:** replay-safe creation, replacement/reissue/cancellation, role/supervisor/channel/seat proposals. Existing duplicate-link bug remains. B |
| 38 Customer role pages | **I:** owner/staff and capability checks. **M:** customer-manager/team/branch scopes, role-specific work pages and owner-facing permission management. A/B/E |
| 39 WhatsApp onboarding | **I:** company/user/session-bound signup and verified binding foundations. **U/M:** resumability and coverage of v4, coexistence/migration paths; approved real inbound/reply evidence. E |
| 40 Instagram/Messenger | **M:** native authorization, asset binding, events, replies and channel-specific controls. They are not implemented by WhatsApp support. E/R |
| 41 Provider versus user approval | **I:** identity and channel readiness are represented separately. **U/M:** actual product permissions/app approval and honest customer recovery for partial authorization. E |
| 42 Customer inbox | **I:** existing scoped inbox foundation. **M/U:** requested attachments, drafts, notes, tags, tasks/orders and multichannel capabilities; writer-owned acceptance. E |
| 43 Sending rules | **I:** WhatsApp window, deduplication, uncertainty and final-dispatch checks. **M/U:** other-channel eligibility, scheduling, opt-out and native-app synchronization. E |
| 44 Customer data relationships | **I:** tenant-bound memberships, channels, messages, knowledge and entitlement identities. **M:** branch/supervisor/proposal/consent/progress expansion. B/C/D/E |
| 45 Interrupted onboarding cases | **I:** safe auth returns, tenant binding and existing membership acceptance. **M/U:** invitation recovery, provider cancellation/partial grants, second-device resume and seat-limit journey. A/B/E |
| 46 Operating gates/order | **I:** underlying identity, entitlement and channel contracts. **M/U:** separate accepted manual/AI product gates and complete staged execution. B/C/D/E |
| 47 Customer acceptance | **U:** complete two-company owner→invite→channel→staff reply journey, delivery proof, interruption/revocation and bilingual/mobile checks. |
| 48 Meta references | Planning sources retained. **U:** reverify exact provider versions, deadlines, windows and permissions before implementation/activation; do not hardcode unverified claims. |

The R3 release addendum supersedes older “unrun” statements for its **desktop-reported 33 runtime groups**, including scenario-20 rollback/containment. It still does not establish team UI/SSR acceptance, complete historical 78-migration replay or real customer/provider acceptance.

## Smallest next package and acceptance

Owner internal-team UI using the installed RPCs: new /admin/teams page and dedicated component/tests, one admin-navigation entry, and existing platform-team actions/contracts. Reuse account search/access snapshots for existing identities. No new Auth system, role promotion, customer-team schema or inbox changes.

- Create/read/reload a team and enroll existing verified members with persisted specialty/status.
- Support existing owner operations with explicit consequences, reasons and revision conflicts.
- Search/paginate without writes; display actual counts and distinguish unavailable from zero.
- Preview/commit transfers with four revisions, stable operation IDs and preserved unrelated memberships/grants.
- Preserve confirmed outcomes after refresh failure; reject repeated clicks and stale account/request responses.
- Verify actual Next SSR→GoTrue/PostgREST transport, second-client persistence, revocation and Arabic/English/mobile/keyboard behavior.

Then address invitation retry/reissue, durable owner onboarding and customer scopes, and remaining persistence/readiness/metrics before expanding channel/provider work. Invitation recovery must preserve hash-only tokens and use explicit replacement; it must not invent broad staff grants or send email automatically.

## Already-delivered routing/revision clarification

The writer’s bounded owner editor, delegated-manager roster and caller-only account memberships panel are supported. One route adjustment is required:

- src/app/admin/layout.tsx uses requirePlatformAdmin(). src/lib/tenancy/access.ts:323–327 requires isPlatformAdmin.
- supabase/migrations/20261006120000_vel_access_management_01.sql:149 defines is_platform_admin() as owner, or active delegated user with a company scope.
- R3 team-manager authorization independently requires active delegated role, manager pointer and active team membership; it does not require company scope.
- Therefore /admin/teams alone cannot serve every authorized team manager. Preserve the existing admin gate; serve that manager’s scoped roster under /account/teams or another verified-session route protected by the R3 reader. Employees receive only their own summary. Do not grant dummy company scopes or relax global admin access. No SQL change is needed.

R3 SQL:267–269 requires authoritative source/destination team and membership revisions; :273 rejects a disabled source membership. A disabled source team may retain an active membership eligible for transfer. Denied account summaries omit team metadata, so obtain team revisions through the authorized owner directory. Never substitute revision zero for unavailable data or silently reactivate a membership to enable transfer.

Useful unfinished controls are retained with honest eligibility/integration feedback. No removal candidate was identified. No broad suites, SQL, grants, credentials, provider calls, product edits or deployment were performed during reconciliation or checklist retention.

## Current bounded teams UI package — 2026-10-11

Implementation base: `e0a7295ada51c2a2b4c8a80e9317b5aeae6983e2` on main. The exact candidate commit and file hashes are supplied with the review artifact; a document cannot embed its own eventual commit hash. The 48-section review above retains its original dated baseline and source attribution. This addendum changes only the current internal-team UI stage. No full-controls audit was repeated.

| Section | Current actual state |
|---|---|
| 4 — Internal navigation | Owner-only teams navigation and account entry implemented locally. Delegated roster route uses verified session + R3 scope without dummy company grants; global admin layout unchanged. Production navigation acceptance unrun. |
| 23 — Internal platform teams | Existing R3 foundation installed previously. This package adds actual owner management, scoped manager reads, caller-only summaries, current revision lookups, transfer confirmation and exact replay. Local candidate tests are recorded in the delivery evidence. Independent source review cleared the implementation after two material fixes. Genuine candidate Next SSR/Auth/PostgREST browser acceptance remains a release gate. Invitations, assignments, approvals and reports remain missing; no team manager write authority added. |
| 27 — Existing controls fixes | Previously completed controls retained. Account integration adds own membership panel and verified-account journal cleanup; existing controls tests included in focused checks. No new full-controls audit claim. |
| All other sections | The dated baseline review remains applicable; this package makes no completion claim for unrelated controls. |

Platform role, team managerial position and actual scope are separate: an owner performs existing R3 mutations; an active delegated administrator receives a roster only through the stored manager assignment plus active same-team membership and current verified session. Employees receive their own permitted summaries. Specialty is descriptive text and grants no authority. `/account/teams` is read-only, including for an owner visiting that route.

### Controls for this package

All server mutations below call unchanged R3 actions/parsers/RPCs, require current owner authorization and a 2–240 character reason, and persist the existing atomic audit/outcome ledger. Current Auth identity and account generation bind reads/responses. Failed reads clear protected rows; unavailable is never interpreted as empty or revision zero.

| Visible control | Viewer / executor | Input and server validation | Persistence and result handling |
|---|---|---|---|
| Teams navigation / account link | Known active owner / permitted current account | Navigation only; destination validates current session and role/scope | No data write. Current actor failure prevents old rows. |
| Own memberships / Refresh | Current verified account | R3 self decoder binds every entry to caller; denied entry omits team and manager | Read only. Loading, empty and failure distinct; late/account-switched responses discarded. |
| Directory search / Apply / New search | Owner or eligible manager | Actor/team/search/cursor validated; R3 scope and cursor fingerprint rechecked | Read only. New search clears team/search/cursor; URL Back/Forward reapplies scope. Current actual totals only. |
| View team / All teams | Owner or eligible manager | R3 checks requested team against current scope | Read only. Old scope hidden while loading; no foreign roster counts. |
| First / Next page | Owner or eligible manager | Cursor bound to actor/team/search/current scope; conflict requires fresh read | Read only. No invented totals or absent-member inference from current page. |
| Account search / First / Next / Select | Owner | Existing account directory browse limits; actual UUID/name/email/support code. Manager choice checks delegated-active snapshot; R3 rechecks Auth/role eligibility at commit | No account creation, grant or role write. Query generations discard stale hits; eligibility failures explicit. |
| Create team | Owner | New UUID, name 2–120, eligible chosen manager, reason, expected revision 0; exact create keys | Existing R3 atomic persistence + audit. Explicit review/confirm; current page refreshed after confirmed save. |
| Edit name / status / manager | Owner | Captured team revision, explicit status/manager; disabled team sends null manager; R3 invariants enforced | Existing R3 update/audit. Manager change enrolls selected manager per existing contract; no platform role granted. |
| Enroll or edit membership | Owner | Existing account; authoritative unfiltered pages establish existing row or absence; captured team/member revisions; specialty ≤120 | Existing R3 member/audit. Disabled membership stays disabled unless explicitly chosen active; unrelated memberships unchanged. |
| Transfer destination search / Select | Owner | Actual active destination; authoritative complete member lookup includes disabled row and revision; current manager lookup; no unavailable-to-zero fallback | Read only preparation; four revisions passed unchanged to R3 preview. |
| Review transfer / Confirm | Owner | Server preview required; current actor/owner and all four revisions rechecked by R3. Disabled source team with active membership permitted; disabled source membership rejected | Atomic selected-source disable + destination activate; unrelated memberships/grants preserved by R3. Reason shown; no silent retry with new UUID. |
| Review / Cancel | Owner | Draft inputs disable during review; confirmation uses frozen validated request | Cancel drops preview and preserves mounted draft. No write until explicit confirm. |
| Confirm / saving state | Owner | Validated request saved to actor-bound minimal journal before transport; duplicate submit blocked | Exact UUID/payload persists across uncertain response/reload. No optimistic protected-row updates. |
| Retry same change | Current authorized owner of pending intent | Original validated UUID/payload only; server rechecks current authority and idempotency | Unknown outcome remains explicit. Confirmed save survives failed refresh; confirmed journal contains only actor/operation ID. Known new account discards prior actor journal. |
| Read / error / fresh refresh | Permitted current account | Existing R3 failure codes translated AR/EN | Protected data cleared on failed preview/write/read; concurrent late read cannot restore it. Conflict never auto-overwrites. |

The existing contract supports name/specialty search and scoped pagination; it has no new status-filter parameter. Manager writes are owner-denied by R3 and therefore absent from the roster UI. Any future expanded filter or manager mutation contract requires a separately reviewed proposal; this package does not change SQL, Auth, grants or RPC authority.

### Acceptance and evidence boundaries

Fresh local verification: focused 95/95; aggregate 2,078 passing / 42 existing skips; TypeScript and Next build pass; lint 0 errors / 7 existing warnings. Evidence is for the final candidate source snapshot in the delivery manifest. Independent read-only review closed stale-render and automatic draft-loss findings; no remaining material source finding. These results do not establish browser transport acceptance.

The original numbered 20-to-16 mapping is **unverified — original wording/source unavailable**. The repository's `SCENARIO-MAPPING.md` twenty rows are authored summary criteria first added in `88039f7`, not verified quotations. Historical R1's sixteen cases used a superseded membership model. Current R3 native suite contains forty cases. Desktop-reported thirty-three groups remain separate until raw IDs/assertions establish correspondence; see the package coverage evidence for the summary crosswalk and actual gaps.

Current UI verification is local source/tests only. Genuine candidate Next SSR-cookie/Auth/PostgREST acceptance, two existing sessions, runtime persistence/revocation, forged direct requests, team isolation, duplicate/transfer/conflict/refresh-failure behavior, Arabic/English/mobile/keyboard browser acceptance and deployment/live acceptance are **UNRUN for this candidate**. Desktop baseline login/action transport evidence predates the candidate and does not close those gates. Desktop subsequently reported baseline revoked-account and unrelated-account SSR checks passing after a harness hydration-input fix, with guards/timeouts unchanged. The earlier timeout did not reproduce; its cause remains unverified. These are infrastructure baseline results, not candidate acceptance.

### Next work, ordered and held

1. Internal invitations: retry, reissue and cancel with durable outcomes.
2. Durable customer onboarding and recovery.
3. Customer roles and teams.

No work on these later packages begins in this stage. No email delivery, service activation, real payments, paid AI, production fixtures or database mutation are included.

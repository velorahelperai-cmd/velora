# Enterprise customer lifecycle

Scope: customer organizations only. `companies.id` remains the organization identifier; billing, credits, Meta bindings and platform administration retain their existing contracts. Work branch: `codex/enterprise-customer-lifecycle`, baseline `50e7f28`. Existing Meta changes were present before this work and are not staged with it.

## Repository audit (2026-10-14)

| Feature | Existing | Missing | Broken / status | Evidence | Required action |
|---|---|---|---|---|---|
| Framework | Next 16.3.8, React 19.3.0, TS 6.0.3 | — | IMPLEMENTED_NOT_VERIFIED | package.json; installed Next server-actions guide | Build/typecheck |
| Auth | Supabase SSR, verified identity, native sessions | Customer device UI, absolute staff lifetime | PARTIALLY_IMPLEMENTED | src/lib/auth; verified_identity_authority migration | Validate sessions and revocation per request |
| Database | companies, company_members, grants | Branch hierarchy | PARTIALLY_IMPLEMENTED | 20261004070000; 20261006120000 | Add branches without duplicating companies |
| Organization/branches | Company ownership and workspace selection | Explicit branch scope | MISSING | src/lib/tenancy/access.ts; migration search | Add immutable employee branch identity |
| RBAC | Capability catalog and explicit grants | Customer branch managers and grant ceilings | PARTIALLY_IMPLEMENTED | src/lib/access; access_management migration | Separate customer delegation from platform delegation |
| RLS/server authorization | Existing company/session policies and guarded RPCs | Branch restriction on legacy paths | PARTIALLY_IMPLEMENTED | authorization_scope_fixes; unified_inbox_contracts | Fail closed when legacy API cannot express branch scope |
| Conversations | WA status, revision, automation generation | Full enterprise state machine | PARTIALLY_IMPLEMENTED | wa_handoff; unified_inbox_contracts | Extend existing control, invalidate stale work |
| Meta | Durable WA/IG ingestion, intents and binding checks | Branch-specific channel binding | PARTIALLY_IMPLEMENTED | src/lib/whatsapp; src/lib/instagram | Preserve bindings; require separate reviewed routing integration |
| Staff/shifts | Owner staff invitations | Shifts, automatic attendance | PARTIALLY_IMPLEMENTED | staff_invitations/recovery | Add schedule and authoritative presence |
| Assignment | Manual assignment and atomic control | Least-loaded automatic assignment, disconnect recovery | PARTIALLY_IMPLEMENTED | control_whatsapp_conversation; Instagram assignment RPC | Integrate worker with branch/shift eligibility |
| AI | Orchestrator, reservations, bounded owner console | Branch AI handoff/readiness | PARTIALLY_IMPLEMENTED | src/lib/answers/runtime | Preserve paid gates; no paid verification |
| Audit | Admin and channel event logs | Unified branch-scoped customer event trail | PARTIALLY_IMPLEMENTED | write_admin_audit; conversation_events | Add customer audit without platform permission changes |
| Notifications | Billing email outbox | Customer staff/security notifications | MISSING | billing_subscription_email_outbox | Permission-filtered delivery and deduplication |
| Reports/exports | Platform billing metrics | Branch performance, revocable Excel/PDF | MISSING | src/lib/billing/admin | Build customer report/export path |
| Tests | Vitest; isolated PostgreSQL/GoTrue/PostgREST/browser harnesses | Enterprise acceptance coverage | PARTIALLY_IMPLEMENTED | vitest.config.ts; scripts/integration | Add real database isolation/concurrency tests |
| Git/migrations | Dirty Meta branch; 4 untracked Meta SQL migrations | Remote application status unverified | IMPLEMENTED_NOT_VERIFIED | Initial git status | Preserve changes; no production migration |

## Implementation sequence

1. Extend companies with branches; derive owner authority from existing active owner membership. Preserve existing role/status contracts. Store customer manager identity separately from platform admins.
2. Bind employees immutably to one branch/account; use live grants and explicit per-branch manager ceilings. Owner-only, identity-bound, 72-hour invitations; atomic acceptance and replacement.
3. Add customer session registry, absolute 30-day limit, membership epochs, suspension/termination and request/approval reactivation. Preserve history and invalidate old sessions.
4. Connect customer UI through authenticated server actions with strict projection; verify using native PostgreSQL, GoTrue and PostgREST before broader integrations.
5. Extend channel control, shifts/presence, assignment, notes/tags, exports and notifications only with equivalent server/dispatch isolation. Legacy integrations must not silently become multi-branch integrations.

## Release/recovery gate

Production SQL remains prohibited. The owner's later explicit coordination request authorizes merging and publishing code; that authorization does not activate customer channels or apply these SQL files. `VELORA_ENTERPRISE_LIFECYCLE_ENABLED` defaults off and only the exact server value `true` enables customer entry points; disabled actions return before Auth/RPC and the organization route is unavailable. Do not enable it before the remaining gates are resolved. Apply SQL only to disposable local fixtures. Before a future database release, review legacy memberships with multiple staff affiliations; never silently relocate those accounts. Rollback an unapplied change by reverting its files. Once applied with customer data, disable customer enterprise entry points, preserve tables/history, and restore a database backup or perform a reviewed forward repair; do not drop live customer tables.

Decision numbers were explicitly waived by the owner; acceptance is against the supplied behavioral requirements.

## A–D. Delivered architecture, database and security

`enterprise_branch_authority` adds primary/setup branches, immutable employee identities, historical customer accounts, explicit branch grants/manager ceilings, append-only audit, scoped session revocations and idempotent operations. Existing company ownership, memberships, native Auth sessions and invitation storage remain authoritative. The server checks identity, selected company and role; database RPCs independently check native session, membership, branch and current grants. Shared/exclusive transaction locks serialize sensitive work with authority withdrawal; successful mutations repeat authorization before commit. Customer revocation preserves platform and other-organization sessions.

`enterprise_staff_operations` adds revisioned schedules (timezone, overnight and exceptions), session heartbeats, author-owned versioned WA internal notes and a primary branch foreign key on WA conversations. Reply/takeover requires a current eligible employee; a late heartbeat releases old human control without asserting AI readiness. Pending assignment keeps AI enabled. Presence does not extend the native inactivity timer. These are foundation paths, not the completed assignment/handoff engine.

The third migration, `20261014051045_enterprise_business_lifecycle_guard.sql`, composes enterprise authorization/commit and invitation acceptance with Master archive/file-destruction markers. It keeps original function OIDs and owner/company membership history reads; a company row lock prevents its lifecycle changing during operations. Fields are checked through `to_jsonb` so the guard also supports the earlier schema without those markers.

All three migrations are reviewable additive SQL with unique/composite constraints, indexes and denied direct client table writes. RLS uses the guarded capability function's original OID; private archive helpers have no client EXECUTE. Legacy invite acceptance and replacement preserve enterprise scope, confirmed target email and the 72-hour/single-use contract. Suspended accounts lose access immediately; terminated membership requires a fresh invitation. Additional branches remain in setup pending reviewed channel routing. Platform permissions, provider bindings, prices and credit rules are unchanged.

## E. Verification evidence

- Native PostgreSQL/GoTrue/PostgREST: **81 assertions passed**, exit 0; real migrations through `20261009215520_g03_verified_review.sql` (72), existing invitation recovery SQL and all three new enterprise SQL files applied in disposable containers. Covers direct REST/RLS preflight, invitation races/replacement, cross-organization/branch denial, immutable identity, manager ceilings, schedule boundaries/CAS, notes, suspension/termination, scoped revocation and two-minute presence recovery. The archive bypass was demonstrated before the third migration, then denied afterward; owner history, the other company and a blocked invitation's post-restore acceptance were also verified. Master marker columns were installed synthetically with their actual schema names; complete Master financial/file executors were not run in this fixture.
- Current `src` regression suite: **3,237 passed, 122 skipped**, 243 files passed/18 skipped; offline network guard. After the final heartbeat/rollout guard, focused enterprise/presence/workspace checks: **13 passed**, typecheck, scoped ESLint and the final Next production build passed. Disabled actions perform no Auth/RPC calls; disconnected polling retries safely and stops on authorization/rollout denial. The combined release initially had two setup type errors and one obsolete route fixture; these were corrected, followed by 30 focused passing checks and a passing combined build/type/lint. Its earlier broad run had 3,465 passing/49 skipped/one fixture failure; a fresh full-suite count after that fixture repair is not claimed. No paid model/provider calls.
- Default root suite also discovers archived snapshot artifacts: 61 failures/184 skips in that run. Those snapshot failures are not claimed fixed. A dedicated configuration runs the current production source, aliases the installed server-only marker and gives the native IG fixture its required hook timeout; the current P4 expected result was aligned with its existing `connectionMode` contract.
- Complete historical migration replay is blocked by the existing `20261010050337_g03_exact_file_generation.sql` prerequisite hash guard. It was not weakened. The release integrator must reconcile its historical baseline before cloud database application.
- Independent read-only security review found no remaining concrete blockers in the delivered invitation, presence, archive or default-off release guards after fixes. The coordinated Smart Onboarding browser test passed at widths 320/390/768/1280, Arabic RTL and reduced motion. Its later native integration with this lifecycle bridge passed **35 assertions**, including concurrent save conflict, expiry and archive denial. It did not visit the enterprise organization route, so enterprise browser E2E and live production SQL/channel behavior remain unverified here.

## F. Git

Work branch: `codex/enterprise-customer-lifecycle`; baseline `50e7f28`. Commits: `c28a858` scoped foundation; `80aad97` offline presence repair; `10403f9` lifecycle/rollout guard. All were pushed on the work branch and cherry-picked into the combined release as `b4e15c9`, `7486853` and `31b83d5`. Changes: three enterprise SQL files; `src/lib/enterprise`; organization page/components; staff heartbeat in workspace shell; native integration runner and source-test configuration; one existing P4 test expectation; this requested report. Existing dirty Meta changes were preserved and excluded.

Release verified on 2026-10-14: remote `main` is **f5bbe4ddfc028a121a0a080220998766e6d3c00d**. A direct Git diff confirmed that the released enterprise code/SQL matches `10403f9`. GitHub's Vercel status for that exact SHA is `success` and points to deployment **2QDpnKPhneccBAukdPqhb2DiWtJ6**; Vercel CLI independently confirms `READY`, `production`, and the `www.velorahelper.com`/`velorahelper.com` aliases. Read-only HTTP checks: `/`, `/login`, `/signup` 200; `/setup`, `/app/organization`, `/admin` redirect to login; the public catalog shows no load error. These are deployment/auth-boundary checks, not authenticated enterprise E2E. The release coordinator confirmed rollout flags absent/off and no production SQL/provider execution. This report was updated locally after release; no runtime code changed afterward.

## G. Remaining release gates

- **CRITICAL:** branch channel/inbox/send routing; atomic least-loaded assignment; complete takeover/AI readiness/handoff and dispatch checks; scheduled disconnect/shift/inactivity recovery. Do not activate multiple branches before these paths are complete.
- **HIGH:** close/reopen/rating deduplication; customer full-contact masking; scoped tags; filtered notifications/security alerts; revocable reports/Excel/PDF; full permissions/schedule/device/recovery UI.
- **MEDIUM:** role templates, personal statistics and bulk operational controls after the protected paths exist.
- **LOW:** optional presentation polish; no extra work included.
- **REQUIRES_OWNER_DECISION:** reviewed channel architecture and approval to apply production SQL; any new commercial rule remains outside this change.
- **REQUIRES_LIVE_VERIFICATION:** production identity/session recovery, channel delivery and worker behavior, complete browser security/concurrency scenarios and production migration preconditions. Real SMS/Meta/payment or paid AI execution is not authorized.

## H. Verdict

**PARTIALLY VERIFIED.** The protected foundation has native integration evidence and a passing current-source build/regression suite. The full requested conversation lifecycle and live integrations are not complete; code publication must not be presented as enterprise activation or production readiness.

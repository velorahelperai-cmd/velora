# Global data/performance implementation evidence — 2026-10-30

Owner task GLOBAL-DATA-PERFORMANCE-20261030; plan/decisions live in Obsidian Brain `03-CUSTOMER.md` (C01/C08/C10–C19/C22 + Admin). This is the source/evidence inventory, not a second product plan. Base main `692cc72556ebf0a3deb14749880f6c98d3440c8e`; Graphify build `cb8e3e80-d3e8-4a39-bd1f-e9365530cdb1`, indexed 2026-10-30T02:28:22.949195Z, matched before edits. Other ongoing channel UI changes are outside this package.

## Confirmed causes and implemented changes

- Paid setup: entry → composed workspace, which performed owner access, two setup-binding reads with embedded channel reads, two further explicit channel observations, then launch/clock metadata. A slow channel gated hours and knowledge. New native binding-only shell enables independent editors; full channel/launch proof loads separately. The workspace now reuses its two explicit channel observations rather than fetching each channel inside the two binding reads as well. Stable revision, link id/generation, scope, entitlement recheck and fresh launch authority remain required. A changed/unknown proof never becomes confirmed.
- Client Server Actions are queued by Next.js. Existing hours/knowledge/language reads could wait behind unrelated read actions. The read-only `/api/setup/read` endpoint dispatches existing readers with explicit native account/boundary check and existing RPC authorization. Browser GETs run independently; writes remain actions. `Cache-Control: private, no-store`, no shared route or user result cache.
- Settings/subscription: link then access then subscription then catalog then activation then credits were serial. Link/access now overlap; after access the four independent sections overlap. Dependencies and owner gates preserved.
- Dashboard/settings Suspense previously wrapped content after awaited I/O; boundaries now wrap async children so fallback can stream while data is read.
- Admin support: filtered ticket page and three status counts were sequential batches. They now overlap after authorization/filter validation. Company display names remain a single batched query.

## Data policy and reviewed surface groups

| Surface/data | Source/timing | Existing duplication / chosen response | Freshness, failure and scope policy |
|---|---|---|---|
| Identity/account/navigation | broker + native session + profiles/membership via `access.ts` and account session | Existing React `cache` and cookie-snapshot client cache retained; do not build another session service | Per React request only; native action/route checks remain live; no cross-user server cache |
| Paid setup navigation | owned branch list then native paid binding | lightweight shell; channel proof deferred | Fresh identity/paid ownership before exposing branches; zero fabricated completion |
| Hours | owned native hours RPC; only opened/intent-prefetched | branch-owned in-flight dedup + 30s display preview | Preview is read-only; fresh read required before Save. Clear on scope/lifecycle/write. No persistence |
| Knowledge/languages | branch native read actions, now independent GETs | no eager content loading; fetch selected step only | No retained knowledge cache. Existing scoped drafts/CAS preserved; fresh mutations; timeout never replayed |
| Meta / launch / trial | native proof/readiness/operation readers | background proof and selected leaf reads | No settled cache. Before/after proof retained. Provider/link/payment/launch actions untouched |
| Dashboard | readiness + initial paginated WA inbox in parallel; billing card separate | existing parallel reads kept; fix streaming boundary | Failed readiness/inbox/billing remain separate unknowns; existing request fences retained |
| Unified inbox / CRM worklists | WA/IG first pages; selected thread; existing events/refresh | already paginated (WA initial limit 40); no eager full-history fetch added | Tenant/capability rechecks, no localStorage conversations. Full export path is separate from first-page navigation |
| Settings/team/branches/subscription | access + link + native billing/catalog/activation/credits; selected panels | parallelize independent server reads | Roles, seats, money and entitlement stay server authoritative; failed sections do not become zero/paid |
| Admin overview/accounts/companies/billing/support/analytics/health | owner/admin readers, filtered/paged native sources | overview already parallel; support list/count parallelism changed | Fresh admin/owner checks; no speculative private-data prefetch or public cache |
| Auth / account/payment | native broker and order readers; actions for writes | existing auth parallel reads and generation isolation retained | No caching credentials, no repeat payment or unknown mutation |
| Public marketing/legal | static assets/components + account chrome where present | immutable assets already configured; no private data prefetch added | Public assets long-cache only; session content separate |
| Notifications/reports | only actual routes/modules in tables below; no invented notification/CRM route | no new polling system | Existing service access/permission boundaries retained |
| Webhooks/internal workers/OAuth | existing explicit handlers | excluded from user-read cache/prefetch | Idempotency, signatures, worker leases and provider writes unchanged |

The hours cache belongs to a mounted account + boundary + company + branch, not a module singleton. Pending replies are generation-fenced and aborted on invalidation, pagehide/storage signals and unmount; identity is checked before and after fetch. Only hours hover/focus prefetch is allowed, once per generation, disabled for data-saver/2G. Preview use never skips a fresh authorization read. No new dependency, global polling, auth TTL, service, SQL or production configuration.

## Performance evidence limits

Before implementation: 36 targeted tests passed (3 files); source shows 4N channel observations inside a full workspace read (two embedded + two explicit per channel), excluding the separate launch-summary read. After: 2N in that same stage, with both proof observations retained. Settings critical source chain changes from link → access → subscription → offers → activation → credits to two parallel batches. These are source/request-count improvements, **not measured live latency speedups**.

No authenticated local before/after P50/P95 exists. Owner opened production TAG CITY `/setup`; observed saved 2/5 and disabled launch; no write executed. The connected browser hides Performance API from read-only evaluation; no network timing fabricated. Owner declined separate local login. Local auth gating can be checked, but production is unchanged by this task. Vercel/Supabase regional RTT and cold-start attribution remain UNKNOWN; no region move proposed without measurements. Test clocks/mocks establish scheduling and isolation only.

## Complete route entrypoint inventory

Static inventory of actual files; imports identify owning loaders/components for each route. Await counts are local syntax counts, not network counts or performance measurements. Group policies above cover data freshness, selective prefetch, failure boundaries and isolation; this inventory does not claim exhaustive live runtime acceptance of every route.

### pages

| Route | Entrypoint | Mode | Local awaits | Owning data/component modules |
|---|---|---|---:|---|
| `/(auth-entry)/login` | page.tsx | server | 0 |  |
| `/(auth-entry)/signup` | page.tsx | server | 0 |  |
| `/accept-invite` | page.tsx | server | 0 | `@/components/app/auth-pages` |
| `/access` | page.tsx | server | 2 | `@/components/app/access-gate`, `@/lib/tenancy/access` |
| `/account/businesses/manage` | page.tsx | server | 2 | `@/lib/i18n`, `@/lib/tenancy/access`, `@/lib/master-journey/rollout`, `@/components/app/access-gate` |
| `/account/businesses/new` | page.tsx | server | 4 | `@/lib/tenancy/account-prep-eligibility`, `@/lib/tenancy/access`, `@/components/app/prepayment-preparation`, `@/components/app/access-gate`, `@/lib/billing/es02/local-live-policy`, `@/lib/billing/es02/local-live-operation`, `@/lib/billing/es02/contracts`, `@/components/app/local-live-checkout-recovery`, `@/lib/supabase/server`, `@/lib/billing/es02/account-order` |
| `/account` | page.tsx | server | 1 | `@/components/app/access-gate`, `@/components/app/account-page`, `@/lib/tenancy/actions`, `@/lib/auth/auth-journey`, `@/lib/master-journey/rollout` |
| `/account/payment/[orderId]` | page.tsx | server | 5 | `@/lib/supabase/server`, `@/lib/auth/session-guard`, `@/lib/billing/es02/contracts`, `@/lib/billing/es02/account-order`, `@/components/app/ui`, `@/components/app/access-gate`, `@/lib/billing/es02/local-live-policy` |
| `/account/payment/[orderId]/popup` | page.tsx | server | 1 | `@/lib/billing/es02/contracts` |
| `/account/recovery` | page.tsx | server | 1 | `@/components/app/identity-recovery-page`, `@/lib/tenancy/identity-recovery-actions` |
| `/account/teams` | page.tsx | server | 0 | `@/components/teams/teams-route` |
| `/admin/access` | page.tsx | server | 1 | `@/lib/tenancy/access-actions`, `@/components/admin/admin-platform-access`, `@/components/app/access-gate` |
| `/admin/accounts` | page.tsx | server | 3 | `@/components/app/access-gate`, `@/lib/tenancy/access`, `@/lib/tenancy/actions`, `@/components/admin/admin-accounts-directory` |
| `/admin/ai/cycle-costs` | page.tsx | server | 1 | `@/lib/i18n` |
| `/admin/ai` | page.tsx | server | 1 | `@/components/admin/admin-ai-operations`, `@/components/app/access-gate`, `@/lib/answers/runtime/admin-actions`, `@/lib/answers/runtime/synthetic-gemini-actions` |
| `/admin/analytics` | page.tsx | server | 1 | `@/lib/tenancy/analytics-actions`, `@/components/admin/admin-financial-analytics`, `@/components/app/access-gate` |
| `/admin/audit` | page.tsx | server | 2 | `@/lib/tenancy/audit-actions`, `@/components/admin/admin-audit-compliance`, `@/components/app/access-gate` |
| `/admin/billing/orders/[id]` | page.tsx | server | 3 | `@/lib/billing/admin/actions`, `@/components/admin/billing-order`, `@/lib/auth/safe-next` |
| `/admin/billing` | page.tsx | server | 2 | `@/lib/billing/admin/actions`, `@/components/admin/billing-ledger` |
| `/admin/catalog` | page.tsx | server | 1 | `@/components/app/admin-catalog`, `@/lib/billing/catalog-backend/actions` |
| `/admin/channels` | page.tsx | server | 2 | `@/components/app/access-gate`, `@/lib/tenancy/access`, `@/lib/tenancy/channels-actions`, `@/components/admin/admin-channels-hub` |
| `/admin/companies/[id]/conversations` | page.tsx | server | 8 | `@/components/app/access-gate`, `@/components/app/admin-conversations`, `@/lib/supabase/server`, `@/lib/tenancy/actions`, `@/lib/tenancy/access` |
| `/admin/companies/[id]` | page.tsx | server | 9 | `@/components/app/admin-company-navigation`, `@/components/app/access-gate`, `@/components/app/admin-company-detail`, `@/lib/knowledge/actions`, `@/lib/whatsapp/connection-actions`, `@/lib/whatsapp/connection`, `@/lib/supabase/server`, `@/lib/tenancy/access`, `@/lib/tenancy/types` |
| `/admin/companies` | page.tsx | server | 1 |  |
| `/admin/health` | page.tsx | server | 1 | `@/lib/tenancy/health-actions`, `@/components/admin/admin-platform-health`, `@/components/app/access-gate` |
| `/admin/identity-recovery` | page.tsx | server | 1 | `@/components/admin/identity-recovery-panel`, `@/lib/tenancy/identity-recovery-actions` |
| `/admin/operations` | page.tsx | server | 2 | `@/lib/tenancy/operations-actions`, `@/components/admin/admin-operations-center`, `@/components/app/access-gate` |
| `/admin` | page.tsx | server | 2 | `@/components/app/admin-company-navigation`, `@/components/app/admin-list`, `@/lib/tenancy/actions`, `@/lib/answers/runtime/admin-truth` |
| `/admin/qa` | page.tsx | server | 3 | `@/lib/tenancy/access`, `@/components/admin/qa-business-reset`, `@/lib/supabase/server` |
| `/admin/settings` | page.tsx | server | 1 | `@/lib/tenancy/settings-actions`, `@/components/admin/admin-platform-settings`, `@/components/app/access-gate` |
| `/admin/support` | page.tsx | server | 2 | `@/lib/tenancy/support-actions`, `@/components/admin/admin-support-reviews`, `@/components/app/access-gate` |
| `/admin/teams` | page.tsx | server | 0 | `@/components/teams/teams-route` |
| `/app/conversations` | page.tsx | server | 1 | `@/components/app/unified-inbox`, `@/lib/customer/service-inbox-actions`, `@/lib/instagram/config`, `@/lib/whatsapp/config` |
| `/app/instagram` | page.tsx | server | 1 | `@/lib/tenancy/access`, `@/components/app/instagram-connection-page`, `@/lib/diagnostics/contract` |
| `/app/knowledge` | page.tsx | server | 5 | `@/lib/access/actions`, `@/components/app/access-gate`, `@/components/app/workspace-pages`, `@/lib/knowledge/actions`, `@/lib/tenancy/access` |
| `/app/organization` | page.tsx | server | 2 | `@/lib/tenancy/access`, `@/lib/enterprise/actions`, `@/components/app/enterprise-organization`, `@/lib/enterprise/config` |
| `/app` | page.tsx | server | 1 | `@/lib/whatsapp/inbox`, `@/components/app/dashboard`, `@/lib/tenancy/actions` |
| `/app/settings` | page.tsx | server | 0 | `@/components/app/settings-route` |
| `/app/subscription/orders/[orderId]` | page.tsx | server | 4 | `@/lib/tenancy/access`, `@/lib/billing/wiring/return-load`, `@/lib/billing/wiring/return-status`, `@/components/app/access-gate`, `@/components/app/subscription-payment-status`, `@/lib/billing/catalog-backend/rpc`, `@/components/app/subscription-offers-view`, `@/components/app/subscription-navigation` |
| `/app/subscription` | page.tsx | server | 0 | `@/components/app/settings-route` |
| `/app/test` | page.tsx | server | 1 | `@/lib/tenancy/access`, `@/components/app/access-gate`, `@/components/app/workspace-pages` |
| `/branch` | page.tsx | server | 5 | `@/lib/tenancy/access`, `@/lib/auth/server-identity`, `@/lib/tenancy/branch-inbox`, `@/lib/i18n`, `@/components/app/branch-inbox-realtime` |
| `/complete-profile` | page.tsx | server | 2 | `@/lib/auth/safe-next`, `@/lib/auth/auth-journey`, `@/components/app/access-gate`, `@/components/app/auth-pages`, `@/lib/tenancy/access` |
| `/data-deletion` | page.tsx | server | 0 | `@/components/app/workspace-pages` |
| `/forgot-password` | page.tsx | server | 0 | `@/components/app/auth-pages` |
| `/` | page.tsx | server | 3 | `@/components/app/subscription-navigation`, `@/lib/billing/catalog-backend/rpc`, `@/components/app/subscription-offers-view`, `@/components/landing/landing-page`, `@/lib/i18n`, `@/lib/tenancy/access` |
| `/preview/dashboards/admin` | page.tsx | server | 0 |  |
| `/preview/dashboards/client` | page.tsx | server | 0 |  |
| `/preview/dashboards` | page.tsx | server | 0 |  |
| `/preview/subscription` | page.tsx | server | 0 | `@/preview/subscription/subscription-preview` |
| `/privacy` | page.tsx | server | 0 | `@/components/app/workspace-pages` |
| `/reset-password` | page.tsx | server | 0 | `@/components/app/auth-pages` |
| `/setup/branches/[branchId]/whatsapp` | page.tsx | server | 5 | `@/lib/tenancy/access`, `@/lib/auth/auth-journey`, `@/lib/auth/setup-return`, `@/lib/tenancy/paid-setup-actions`, `@/lib/tenancy/paid-branch-connection-actions`, `@/components/app/access-gate`, `@/components/app/paid-whatsapp-route` |
| `/setup/branches` | page.tsx | server | 0 |  |
| `/setup` | page.tsx | server | 2 | `@/lib/tenancy/account-prep-eligibility`, `@/lib/auth/auth-journey`, `@/lib/auth/setup-return`, `@/components/app/access-gate`, `@/components/app/setup-wizard`, `@/components/app/prepayment-preparation`, `@/components/app/setup-loading`, `@/lib/tenancy/access`, `@/lib/master-journey/rollout` |
| `/setup/qa` | page.tsx | server | 0 |  |
| `/terms` | page.tsx | server | 1 | `@/components/app/workspace-pages`, `@/lib/service-terms-draft` |
| `/verify-email` | page.tsx | server | 0 | `@/components/app/auth-pages` |
| `/verify-phone` | page.tsx | server | 1 | `@/components/app/personal-phone-page`, `@/lib/tenancy/personal-phone-actions`, `@/lib/auth/safe-next` |

### layouts/loading

| Route | Entrypoint | Mode | Local awaits | Owning data/component modules |
|---|---|---|---:|---|
| `/(auth-entry)` | layout.tsx | server | 0 | `@/components/app/auth-pages` |
| `/admin` | layout.tsx | server | 2 | `@/components/app/access-gate`, `@/lib/tenancy/access`, `@/lib/auth/safe-next`, `@/components/admin/admin-shell`, `@/components/admin/admin-theme.module.css` |
| `/admin` | loading.tsx | client | 0 | `@/lib/demo-state` |
| `/app` | layout.tsx | server | 2 | `@/components/app/access-gate`, `@/lib/auth/safe-next`, `@/lib/tenancy/access` |
| `/` | layout.tsx | server | 1 | `@/lib/auth/session-activity-tracker`, `@/lib/i18n`, `@/components/app/account-chrome`, `@/components/cache-bootstrap`, `@/lib/demo-state` |
| `/setup` | layout.tsx | server | 2 | `@/lib/auth/auth-journey`, `@/lib/auth/setup-return`, `@/components/app/access-gate`, `@/lib/tenancy/access` |
| `/setup` | loading.tsx | server | 0 | `@/components/app/setup-loading` |

### API/auth handlers

| Route | Entrypoint | Mode | Local awaits | Owning data/component modules |
|---|---|---|---:|---|
| `/api/admin/knowledge-file` | route.ts | server | 10 | `@/lib/supabase/server`, `@/lib/tenancy/access`, `@/lib/knowledge/constants`, `@/lib/tenancy/setup-file`, `@/lib/tenancy/setup-file-server`, `@/lib/logging/logger.mjs` |
| `/api/auth/sms-hook` | route.ts | server | 1 | `@/lib/supabase/admin`, `@/lib/tenancy/personal-phone-hook`, `@/lib/tenancy/personal-phone-hook-config`, `@/lib/tenancy/personal-phone` |
| `/api/billing/local-live-readiness` | route.ts | server | 2 | `@/lib/billing/es02/local-live-policy` |
| `/api/branch/inbox-events` | route.ts | server | 6 | `@/lib/supabase/server`, `@/lib/tenancy/branch-inbox-events` |
| `/api/company/service-access` | route.ts | server | 1 | `@/lib/services/access`, `@/lib/services/decision` |
| `/api/instagram/oauth/callback` | route.ts | server | 1 | `@/lib/instagram/owner-actions`, `@/lib/instagram/oauth-meta`, `@/lib/instagram/oauth-route`, `@/lib/tenancy/paid-branch-connection-actions` |
| `/api/instagram/webhook` | route.ts | server | 5 | `@/lib/supabase/admin`, `@/lib/logging/ingress-observation-server`, `@/lib/instagram/connection-store`, `@/lib/instagram/inbound-producer`, `@/lib/instagram/webhook-route`, `@/lib/instagram/config`, `@/lib/instagram/webhook-challenge`, `@/lib/instagram/review-bootstrap`, `@/lib/instagram/webhook-parse` |
| `/api/internal/billing/email` | route.ts | server | 2 | `@/lib/billing/email/internal`, `@/lib/billing/email/expiry-internal` |
| `/api/internal/billing/lifecycle` | route.ts | server | 1 | `@/lib/billing/lifecycle-runtime` |
| `/api/internal/knowledge/setup-file-worker` | route.ts | server | 1 | `@/lib/tenancy/setup-file-server` |
| `/api/internal/whatsapp/worker` | route.ts | server | 4 | `@/lib/supabase/admin`, `@/lib/whatsapp/integration-store`, `@/lib/whatsapp/fixed-ack`, `@/lib/whatsapp/worker-observation`, `@/lib/whatsapp/integration-worker`, `@/lib/whatsapp/inbound-worker` |
| `/api/knowledge/setup-file` | route.ts | server | 3 | `@/lib/supabase/server`, `@/lib/tenancy/access`, `@/lib/tenancy/setup-file-server`, `@/lib/tenancy/setup-file` |
| `/api/setup/read` | route.ts | server | 2 | `@/lib/auth/server-identity`, `@/lib/tenancy/paid-setup-workspace-actions`, `@/lib/tenancy/branch-hours-actions`, `@/lib/tenancy/paid-branch-knowledge-actions`, `@/lib/tenancy/paid-reply-language-actions`, `@/lib/tenancy/paid-assistant-trial-actions`, `@/lib/tenancy/paid-launch-actions` |
| `/api/whatsapp/webhook` | route.ts | server | 10 | `@/lib/supabase/admin`, `@/lib/logging/ingress-observation-server`, `@/lib/whatsapp/config`, `@/lib/whatsapp/store`, `@/lib/whatsapp/tenant-resolve`, `@/lib/whatsapp/coexistence/webhook-events`, `@/lib/whatsapp/coexistence/webhook-store`, `@/lib/whatsapp/coexistence/projection-store`, `@/lib/whatsapp/webhook` |
| `/auth/broker/continuity` | route.ts | server | 5 | `@/lib/diagnostics/server-flow`, `@/lib/diagnostics/correlation.mjs`, `@/lib/auth/site-url`, `@/lib/auth/broker/continuity` |
| `/auth/callback` | route.ts | server | 3 | `@/lib/auth/safe-next`, `@/lib/supabase/env`, `@/lib/tenancy/access`, `@/lib/auth/broker` |

## Component and action inventory

126 client entry modules; 83 other TSX modules (server or shared, not proof of server-only execution); 64 Server Action modules. Machine-readable manifest: `docs/global-data-route-inventory.json`.


## Final Release Candidate — GLOBAL-DATA-PERFORMANCE-20261030

CORRECTION: owner authorized engineering integration, not Commit/Push/Deploy. The agent incorrectly treated the prior wording as publication approval and published 94da317. No further publication is allowed without explicit approval. Candidate base: `692cc72556ebf0a3deb14749880f6c98d3440c8e`. Publication/hosted evidence is recorded separately after the resulting SHA exists.

- Full unchanged `ci:lint` PASS on an archive of all HEAD-tracked files overlaid with exactly the 29 release files below. Dependencies use the existing locked installation. No ESLint rules, ignores, CI commands, or account-deletion tools changed. The previous shared-workspace lint failure remains attributable to unpublished untracked tools; those files are absent from the release tree by explicit staging, as in a clean CI checkout.
- Prior full unit (5285 PASS, 54 existing skips) and contracts (313 PASS, 38 existing skips) were retained, not rerun without cause. Final Meta/draft integration tests: 50/50 PASS. Security/CI contract suite: 69/69 PASS. Dependency audit: zero vulnerabilities. Final typecheck PASS. Production build evidence is in the local release receipt; hosted CI must pass on the exact pushed SHA.
- Tracked security baseline PASS on 2106 paths; pinned Gitleaks 8.24.3 tree scan: zero findings. No new security exclusions or test skips added.
- Review: native account/boundary plus existing owner/branch authorization precede setup reads; responses are private/no-store. In-flight dedup and the 30-second hours display preview belong to a mounted account/company/branch boundary, invalidate on write/scope/lifecycle, and never grant save/launch authority. Unknown proofs fail closed. Late workspace proof preserves active dirty drafts. Meta evidence is an owner-authorized company-level historical receipt displayed in the selected authorized branch, not proof of commercial branch activation; no verified/launch/outbound authority changes. UI remount identity includes scope and entitlement; late Meta replies check mounted/current scope.
- Concurrent work: all Meta source/UI/tests included intact; final async Meta enrichment uses the other agent's direct soft read. No stale generic patch was restored. Unrelated auth/live-customer changes, reconciliation/migration work, and 153 untracked files are excluded; all 155 preserved file hashes matched at candidate preparation. Source hashes are rechecked before commit.
- Limits: no authenticated local before/after latency, mobile journey, native RLS runtime, or provider/payment acceptance was performed. Owner declined local login. Existing skipped native tests remain limitations, not synthetic exceptions. No regional speed claim, P50/P95, commercial Meta activation, SQL migration, environment change, or product-wide launch acceptance is claimed.

### Exact release files

- `src/app/app/page.tsx`
- `src/app/api/setup/read/route.ts`
- `src/app/api/setup/read/route.test.ts`
- `src/components/app/paid-assistant-checklist.tsx`
- `src/components/app/paid-setup-step-host.tsx`
- `src/components/app/paid-setup-workspace.tsx`
- `src/components/app/paid-setup-workspace.test.tsx`
- `src/components/app/paid-setup-workspace.interaction.test.tsx`
- `src/components/app/paid-setup-loading-flow.test.tsx`
- `src/components/app/settings-route.tsx`
- `src/components/app/settings-route.test.tsx`
- `src/lib/tenancy/paid-setup-actions.ts`
- `src/lib/tenancy/paid-setup-actions.test.ts`
- `src/lib/tenancy/paid-setup-workspace-actions.ts`
- `src/lib/tenancy/paid-setup-workspace-actions.test.ts`
- `src/lib/tenancy/support-actions.ts`
- `src/lib/tenancy/setup-read-types.ts`
- `src/lib/tenancy/setup-read-client.ts`
- `src/lib/tenancy/setup-read-client.test.ts`
- `docs/GLOBAL-DATA-PERFORMANCE-20261030.md`
- `docs/global-data-route-inventory.json`
- `PROJECT_STATE.md`
- `src/components/app/paid-channel-view.tsx`
- `src/components/app/paid-channel-view.module.css`
- `src/components/app/paid-channel-view.interaction.test.tsx`
- `src/lib/tenancy/whatsapp-meta-test-receive-actions.ts`
- `src/lib/tenancy/whatsapp-meta-test-receive-actions.test.ts`
- `src/lib/tenancy/whatsapp-meta-test-receive-proof.ts`
- `src/lib/tenancy/whatsapp-meta-test-receive-proof.test.ts`

## Earlier local verification and handoff (superseded for release status)

- `ci:unit`: 498 files passed / 5 skipped; 5285 tests passed / 54 skipped, 439.06 s. Shared changing checkout, not a frozen release candidate. Subsequent targeted runs cover the final loading/draft fence and hours preview changes.
- `ci:contracts`: 44 passed / 3 skipped; 313 tests passed / 38 skipped. Native PostgreSQL/live acceptance is not implied.
- `ci:build`: PASS after minimal type reconciliation of the concurrent Meta receive-proof UI. No feature changes to that work; only explicit generic result type at `paid-channel-view.tsx` read timeout call.
- Final core regressions: 43/43 in 6 files (shell/native actions, HTTP boundary, in-flight/cache invalidation, settings parallelism, slow-proof draft retention). Additional affected channel/workspace/host suite: 72/72; final workspace/navigation suite: 31/31. Counts overlap and must not be added as unique tests.
- Scoped ESLint: PASS. Full `ci:lint`: FAIL from pre-existing untracked account-deletion scripts: `acceptance-rpc-cases.mjs` unused `lit`, `missing-acceptance.mjs` and `restore-protocol.mjs` unused `createHash`, `native-test-order.mjs` forbidden `module` assignment. Preserved rather than silently excluded or changed. Mandatory global lint is not closed.
- `ci:secrets`: tracked baseline PASS, 2093 paths. New task files contain no credentials; no production secrets/config changed.
- Initial concurrent build/typecheck collided in generated `.next/types` (TS6053); subsequent checks run after generation. Initial build also caught a concurrent Meta UI generic inference error; corrected narrowly, preserving all other work. Final `ci:typecheck` PASS after correcting the new fixture to the existing entry contract; final `ci:build` PASS after all source refinements.
- Live verification: production TAG CITY read-only UI observed, 2/5 saved progress and launch disabled. Local normal `/setup` correctly reached login. No authenticated local before/after, mobile/desktop acceptance, native RLS runtime, provider, payment, or save execution established. Owner explicitly declined local sign-in. Server processes started for this task were stopped.
- No Commit/Push/Deploy, SQL migration, customer data mutation or region change performed by this task. Publication remains separate and global lint/live acceptance remain open.

## Official guidance used

- [Next.js data fetching and streaming](https://nextjs.org/docs/app/getting-started/fetching-data), also checked against installed `next@16.4.2` docs.
- [Next.js backend for frontend and queued Server Actions](https://nextjs.org/docs/app/guides/backend-for-frontend).
- [React request-scoped cache](https://react.dev/reference/react/cache).
- [Supabase server-side auth cache guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide).
- [Vercel region/data-source locality](https://vercel.com/docs/functions/configuring-functions/region): geography is a hypothesis until measured, not a reason to move Production here.

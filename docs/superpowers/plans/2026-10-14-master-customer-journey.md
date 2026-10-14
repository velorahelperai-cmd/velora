# Master customer journey implementation plan

> For agentic workers: use subagent-driven-development for independent authority tasks, then integrate and review each change. Checkboxes track verified deliverables.

Goal: implement the owner-approved master specification locally in the existing Velora product, preserving deployed functionality and evidence.

Architecture: retain Supabase Auth, the account/session authority, company membership and native Paymob settlement. Extend existing company drafts, financial provenance and canonical company locks; do not create alternative identity or settlement engines. Deferred provider, price, channel and legal configuration remains explicitly unavailable.

Tech stack: Next.js 16.3.8, React 19.3, Supabase Auth/PostgreSQL/RLS, Vitest and the existing guarded PostgreSQL fixtures.

Spec: user attachment `C:/Users/DELL/.codex/attachments/ec1ed0f5-8f11-4568-bfa7-6ef32f1a9c38/Pasted text.txt`, 14 October 2026. Baseline: `3d771e30560f8e3369ef9f304e92a608878c101f`.

## Global constraints

- Local branch `codex/master-customer-journey`; no production writes, migrations, deployment, paid provider calls, SMS, real financial operations or channel disconnection.
- No Obsidian access. Preserve all original checkout changes and other implementers' work.
- Keep two-hour human-activity inactivity policy; user/account/company binding is authoritative on server and database.
- No assumed channel allocations, top-up prices, SMS provider, legal retention policy or administrative escalation limits.
- Real provider execution and production readiness require separate evidence and authorization.
- Tests run against owned disposable databases and offline provider ports. They do not prove live SMS, payment or Meta success.

## Review focus

- Direct RPC/API bypass of UI gates, including unverified personal phone and revoked native sessions.
- Lost response or changed account during company creation; stable receipts cannot authorize another user or duplicate a company.
- Late save/upload after draft cancellation and replacement object generation; no path-only deletion.
- Payment versus irreversible deletion under the same company lock; money cannot be lost or deleted data resurrected.
- Subscription-cycle AI credits and compensation cannot extend paid time, duplicate grants or outlive the cycle.

## A. Baseline and conflicts

- [x] Compare actual branch/main, preserve dirty original checkout, audit identity/business, billing and lifecycle independently.
- [x] Reuse clean attached release worktree and branch from deployed main.
- [ ] Read production schema/configuration only; compare required dependency functions and exact duration path, without user-row disclosure.
- [ ] Record existing tests versus new regressions in the final evidence report.

## B1. Initial personal phone enrollment

Files: new tenancy personal-phone contracts/actions, enrollment UI, CLI-generated personal phone migration and isolated tests.
Interface: database predicate `private.master_account_can_create_company(uuid)` reads separate confirmed email and confirmed native Auth phone; `public.master_personal_phone_status()` exposes only the current account's verification state.

- [ ] Test E.164, wrong account/session, pending versus confirmed phone, duplicate ownership, expiry/cooldown/attempt limits, replay and disabled configuration making zero provider calls.
- [ ] Implement session-bound durable enrollment intents and audited outcomes through Auth `updateUser({phone})` and `verifyOtp({type:'phone_change'})`.
- [ ] Prevent replacement of an existing confirmed phone until old/new proof or strong reviewed recovery is available. Never merge users or grant access from contact/Meta numbers.
- [ ] Exercise actual database constraints locally and integrate accessible Arabic/English UI with explicit configuration state.

## B2. Business creation and versioned editing

Files: business authority migration, tenancy business actions/contracts/tests, create-business route, existing wizard/settings integration.
Interfaces: `create_owner_company_attempt(expected_user_id,idempotency_key,payload)` returns the committed company receipt; `update_owner_company_profile(expected_user_id,company_id,expected_version,patch)` returns a new version or conflict.

- [ ] Test required name/type/country, optional hours/contacts, duplicate requests/tabs, same-key different payload, active-draft exclusion and staff/admin bypass.
- [ ] Remove only the obsolete one-owner-membership index. Serialize creation with the existing account draft lock; attach the matching draft atomically and preserve first-company legacy compatibility.
- [ ] Add authoritative company versioning and deny stale writes, including direct writes/legacy paths bypassing CAS; sensitive country changes become review requests.
- [ ] Expose additional-business creation without requiring a previous paid subscription; preserve valid workspace selection and stable account/company identity.

## B3/F. Draft lifecycle and safe file deletion

Files: extend existing draft SQL/actions/types/UI; scoped upload/deletion authority and guarded worker tests.
Interfaces: stable draft ID, lifecycle/generation, meaningful-activity timestamp; owner version-bound preview/cancel/keep/complete RPCs. New creation uses the same account-wide lock.

- [ ] Test one active draft/account, legacy-conflict preservation, actual change versus identical save/polling, paid protection and late writes after closure.
- [ ] Implement free 30-day expiry and 14/7/1-day notice outbox, explicit keep, cancellation tombstones and paid protection from proven receipts.
- [ ] Add immutable upload intents and durable deletion jobs with scope/generation, leases, retries/backoff, verified absence and explicit blocked legal policy.
- [ ] Fence Storage access immediately on approved closure; preserve preexisting unrelated files and company IDs. Do not advertise completed deletion until absence is verified.
- [ ] Extend paid lifecycle to day90 setup retention, continuing candidate selection after day60; payment-first cancels jobs, deletion-first preserves financial obligations without resurrection.
- [ ] Expose draft scope/file counts, strong confirmation, retention/protection and truthful progress in the existing UI.

## C. Subscription activation authority

Files: activation extension around existing settlement, subscription UI/readiness and isolated SQL tests.

- [ ] Test separate payment/entitlement/start timestamps, 14-day deadline, 30-day duration and once-per-trusted-person seven-day grant.
- [ ] Start at trustworthy readiness of the first entitled selected channel or deadline; prevent AI until operational readiness. Preserve old customers without silently resetting cycles.
- [ ] Record proven Velora/Meta outages and pause only remaining activation deadline; no customer-incomplete exemption.
- [ ] Carry explicit channel entitlement/configuration and approved partial-operation disclosure into purchase evidence.

## D. Checkout, renewal, upgrade and financial wallet

- [ ] Extend native Paymob immutable quote/attempt/cycle evidence to exact 15-minute quotes, preserved on method retry, with unknown-outcome reconciliation before a new attempt.
- [ ] Block early manual renewal; explicit auto-renew consent plus approved provider mandate, one24h notice, cancel-before-commit and one retry24h after confirmed failure.
- [ ] Manual verified payment cancels scheduled renewal under the cycle lock; provider-confirmed payment retries entitlement idempotently without requesting another charge.
- [ ] Implement immediate45OMR upgrade preserving expiry, new1500base grant, retained top-ups/compensation and no extra week. Downgrade only after expiry; cancellation stops renewal, not current paid access.
- [ ] Record proven duplicate collection as a financial liability; explicit consent creates renewal-only wallet credit with an immutable ledger and refund rights preserved.
- [ ] Test sandbox/offline provider contracts; real1USD charge/refund and alternate gateways remain unauthorized.

## E. Paid-cycle AI accounting and compensation

- [ ] Anchor base/paid/compensation ledgers and reservations to the proven subscription cycle, not calendar month. Consume base, then paid top-up, then compensation, exactly once.
- [ ] Preserve recorded cost evidence and label estimated tariffs separately from provider-final costs; expose customer balances and admin category/cycle/model costs.
- [ ] Top-ups require trusted paid receipts, configured sizes/prices and legal policy; same expiry, no carry-over. Emit80%/100% notices once; depleted AI leaves authorized human reply/ingress intact.
- [ ] Compensate only continuous all-selected-entitled-channel proven outage>=1h within the paid cycle, with>=7operatingdays and>=30realAIreplies and comparable data. Use actual interval, exclude invalid periods, cycle cap10%, no extension/carry-over/financial conversion.
- [ ] Test concurrent reservations, upgrades, expiry, duplicate grants, stale compensation and missing comparable evidence.

## G/H. Integration, verification and delivery

- [ ] Integrate owner/customer screens and review/admin paths using existing theme, RTL/LTR and stale-response guards; leave public landing unchanged.
- [ ] Run scoped unit/real local PostgreSQL tests, TypeScript, ESLint and production build; perform safe local E2E without production credentials.
- [ ] Review authorization, migrations/backfill, recovery/rollback and external settings. Any unapproved destructive/legal behavior remains blocked.
- [ ] Deliver requested source-backed requirement mapping, statuses, modified files/migrations, exact verification results, local-versus-production differences, deployment/rollback plan and external/live-test gates. The attachment's overlapping decision ranges are not a unique1–80 enumeration; report section identifiers accurately rather than inventing original numbers.

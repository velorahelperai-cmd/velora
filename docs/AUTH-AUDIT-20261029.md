# Auth audit and availability repair — 2026-10-29

Status: PARTIAL. This fixes a reproduced defect, not a claim that the reported
Production OTP incident or every authentication lifecycle is closed.

## Confirmed defect and repair

`createBrokerUserClient` deliberately returns UNAVAILABLE for capability,
refresh lease, transport and uncertain refresh failures. `supabase/server.ts`
previously replaced every failed resolution with an unauthenticated provider
client. The actual `checkSessionActivity` then returned UNAUTHENTICATED for
AuthSessionMissingError. `SessionActivityTracker` treats this as expiry and
quarantines the captured boundary. `VerifyEmailPage` rejects a locked observation
before or after the provider result. Thus an availability failure could cause a
false expiry/lock; the sessionless fallback also misclassified profile access.

The shared factory now throws a fixed, nonsecret error for UNAVAILABLE. Existing
activity/access callers catch it as UNAVAILABLE and deny new access without
declaring logout. Confirmed UNAUTHENTICATED still receives the guest client.
No cookies, tokens, identity, expiry policy or locks are cleared or bypassed.

Regression before repair: 3 failures / 1 pass, including the actual server
factory -> activity action returning UNAUTHENTICATED on broker UNAVAILABLE.
After repair: all four pass, including recovery with the same identity.
This is controlled failure injection, not proof this caused the reported live event.

## Traced boundaries

| Area | Current implementation / evidence | Remaining limit |
| --- | --- | --- |
| Signup/email | tenancy/actions, broker/email-confirmation: durable intent/PKCE, no verified session for unconfirmed signup | Real app signup-to-broker-to-browser acceptance not run in this audit |
| OTP | actions verifyEmailCode reserves/claims before verifyOtp; checks email confirmation and provider/session user equality; atomic broker admission before success | Lost response after committed admission and original Production incident not reproduced |
| UI | auth-pages capture/epoch/boundary fence, confirmedCapture session-only retry, synchronous action lock | Genuine locked/expired and foreign-session rejection intentionally retained |
| Google/callback | browser.ts, broker/login.ts, callback route: bound cookie + intent + PKCE, scoped retry, safe redirects | Production provider acceptance UNKNOWN |
| SSR/cookies | server factory, middleware, broker cookies: opaque HttpOnly/SameSite=Lax handles; Secure in Production; no legacy sb-cookie fallback | Actual hosted cookie journey not verified |
| Refresh | broker resolve: server refresh lease, revision CAS, native session identity check, uncertain result denies access | Real broker concurrent refresh not exercised here |
| Logout/reset | captured boundary and operation receipts; recovery scope; existing broker password/logout tests pass | End-to-end browser reset not exercised here |
| Tabs/accounts | session-context signals invalidate only; server remains authority; mounted verification and session-response regressions pass | Real simultaneous browser tabs not exercised here |
| Access/drafts | access.ts verifies claims/user/idle session; account-prep actions bind expected account and eligibility, RPC version checks | Current Production RLS and branch grants not independently accepted here |
| Company/payment | repair touches no company creation, billing, memberships, branch permissions or provisioning | No paid fixture/company created; full payment provisioning outside this test |

Returning to signup while a valid server session exists can legitimately redirect
to the account. The reported observation alone proves neither an auth bypass nor
which boundary failed. No bypass was demonstrated in this audit.

## Verification

- Direct regression + session activity + mounted OTP fence + account-session response:
  4 files, 93 PASS.
- Auth/broker and email/signup/business authority targeted run: 33 files PASS,
  3 skipped; 257 tests PASS, 38 skipped. Skipped native opt-in checks are NOT PASS.
  This group overlaps the activity tests above; do not sum counts as unique tests.
- Account-prep authorization and callback routes: 15 PASS.
- Scoped ESLint PASS; isolated `ci:typecheck` PASS; tracked security scan PASS.
- `node scripts/integration/auth-lifecycle-audit.mjs`: real local GoTrue/Postgres/
  PostgREST, internal isolated Docker network and disposable credentials. 12 checks
  PASS: confirmation required, captured mail receipt, wrong/valid/consumed OTP,
  refresh identity, second signup, expired OTP, other-account failure isolation,
  logout, client session cleared, password re-login. Uses the existing local
  Send Email Hook receiver; this is not external SMTP inbox delivery. No codes,
  tokens or passwords emitted. App broker/browser acceptance remains separate.

## External evidence and remaining gates

- Base HEAD: e07c7aa92be6cb2eb206375bf95f60d5added803, canonical main.
- Graphify repository/workspace discovery both fail with missing link_id. Freshness
  UNKNOWN; only scoped known auth paths were inspected, no replacement bulk scan.
- Supabase project connector fails with the same error; dashboard requires sign-in.
  Production Auth configuration, logs, schema and RLS inspection remain UNKNOWN.
- Vercel CLI authenticated to velora-9513/velora; Production broker key and Supabase
  environment entries present. Values not extracted; correctness UNKNOWN.
- CI, deployment SHA and hosted checks must be recorded from actual release
  results; this document does not predeclare success.
- User explicitly permits isolated Auth testing and publication; Production email
  and Google remain UNKNOWN until a dedicated real test mailbox is available.

Official references: [Supabase sessions](https://supabase.com/docs/guides/auth/sessions),
[Auth flow testing](https://supabase.com/docs/guides/auth/testing-auth-flows),
[Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook).

## Follow-up: Production read-only acceptance — 2026-10-29

This supersedes the earlier missing-link_id connection blocker. No successful
local tests, CI suites or native Auth tests were repeated. No application,
Production configuration, grants or data were changed; no new release.

### PASS — scoped catalog and broker checks

- VELORA connector reached project vmpifljyozsbtssxhoxd: ACTIVE_HEALTHY,
  PostgreSQL 17.11.0.002. Metadata observations at approximately 00:29–00:33 UTC.
- All six public vel_broker tables have RLS enabled; anon/authenticated direct
  SELECT and INSERT/UPDATE/DELETE privileges are absent.
- All 33 public broker RPC overloads deny anon execution and pin empty
  search_path. Authenticated execution exists only for operation_status and
  revoke_sessions_at. Their live definitions check actor user identity; the
  revocation function also checks an active session and matching operation.
  Neither mutating function was executed.
- capability_probe executed inside BEGIN READ ONLY / ROLLBACK: ok=true,
  contract_version=2, codes=[], bound_admit/bound_resolve/refresh_lease and strict
  completion present. This checks the installed contract, not a real login.
- profiles has own-user SELECT/INSERT/UPDATE predicates including UPDATE WITH
  CHECK; active-session and deletion fences are RESTRICTIVE. Membership/grant
  reads are own-user or authorized admin, with RESTRICTIVE active-session,
  verified-identity and deletion fences. No direct authenticated membership
  writes. company_branches denies direct anon/authenticated reads and writes.
- Account-prep reads require auth.uid ownership, active/nonexpired draft and
  eligibility. Live read RPC verifies expected account and active session;
  eligibility checks confirmed, nondeleted, nonbanned identity and membership.
  Unique account_prep_drafts_one_active enforces one active draft per account.
- Unique lineage/request nonce and active user/native-session indexes present.
- authenticator has pgrst.db_pre_request=public.app_session_pre_request.

### Findings / limits

- Security advisor warns auth_leaked_password_protection: leaked-password
  protection is not enabled. No settings changed. See
  https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
- Other advisor categories: 106 informational RLS-without-policy tables,
  9 mutable-search-path warnings (billing/WA helpers), 3 anon and 187 authenticated
  SECURITY DEFINER callable warnings. These counts are not proven exploits.
  The anon pre-request and invitation reader definitions were inspected; the
  former is installed as the gateway hook, the latter requires a high-entropy
  invitation hash and returns masked recipient data. No grant was revoked.
- SMTP, Google enablement, redirect allowlist, OTP TTL and provider session policy
  are not exposed by the connected management tools used here; dashboard access
  remains required. These configuration checks are BLOCKED, not PASS.
- Cross-account/tenant runtime denial is not proved by catalog inspection alone.
- Dedicated mailbox supplied and owner performed signup/OTP entry in Chrome
  Incognito. Live acceptance is BLOCKED by the confirmed-session UI failure
  below; mailbox availability is no longer the blocker. Google, authenticated
  multi-tab, token renewal and logout acceptance remain NOT_RUN.

### Live dedicated-account incident — 2026-10-29 00:35 UTC

- Exact authorized test identity was queried read-only (address intentionally
  omitted here). User created at 00:35:25.535884 UTC; email confirmed at
  00:35:51.919577; last sign-in at 00:35:51.935709. One native session, zero
  company memberships and zero active account-prep drafts observed.
- Broker row active, created 00:35:53.731479; verify_email intent committed with
  provider_state=session_captured, refresh_revision=0, refresh_state=idle.
- Vercel /verify-email logs for 00:35:20–00:37:30 UTC show
  auth.broker.admit.committed at 00:35:53.896; verification access OK at
  00:35:59.967. Subsequent server session/access checks also return OK through
  00:36:16.523. Only allowlisted event/stage/code/timing fields inspected;
  no OTP, token or cookie values retained.
- Owner screenshot and live Chrome accessibility state show the confirmed-email
  but session-update-unavailable message and session-only retry button. This
  proves provider/Broker success with incomplete UI acceptance, not the causal
  reason for the UI failure. Do not mark the original incident resolved.
- The in-app browser contains a different test account (alias without trailing
  1); it was not used for this journey or logged out. Different browser profiles
  alone do not establish unauthorized session mixing.
- Chrome Incognito is not visible to the connected extension. Native inspection
  reached the correct page; attempted retry clicks failed before dispatch
  (window geometry unavailable), and capture timed out. Owner asked to perform
  exactly one session-only retry. No OTP resend/replay or new publication.

### Post-OTP focus race repair — local, awaiting review

- Owner confirms one session-only retry entered setup successfully. This is a
  successful recovery of the existing confirmed session, not first-attempt
  acceptance and not a fresh OTP test.
- Correlation evidence: VEL-95DF6926FB40434E includes OTP admission and the
  first session/profile read, ending at profile/access OK 00:36:07.501 without
  final Broker reattestation. Independent VEL-01C48CAEE177476B performs the next
  pre-read/profile/final Broker read through 00:36:16.523. This supports an
  interrupted client read; server logs alone cannot identify the browser event.
- Proven code defect: explicit session.refresh() after OTP did not register in
  signalRead. A focus/visibility notification started another refresh, advanced
  requestGen, and caused the original promise to resolve before READY. The OTP
  continuation then showed session-unavailable despite successful server reads.
  Both focus and visibilitychange reproduce this exact not-ready boundary in
  tests before the fix. The original browser event was not captured, so the
  incident attribution remains corroborated rather than fully observed.
- Minimal repair in account-chrome.tsx: register explicit refresh promises in
  the same generation-scoped pending-read slot used by focus/visibility. These
  hints now join the active post-auth read; explicit requests remain fresh.
  No new OTP request, timer-based retry, fence bypass or provider change.
- account-session-response.test.tsx adds two regressions: both RED before, GREEN
  after. Targeted selection: 7 PASS / 40 NOT_RUN (two new cases plus affected
  mount sharing, stale-finally, fresh explicit read, logout and lock guards).
  This tests client orchestration with mocked server boundaries; real Supabase
  success evidence is the separate live incident above, not these mocks.
- Validation: scoped ESLint PASS, TypeScript noEmit PASS, tracked-secret gate
  PASS (2020 paths), scoped git diff --check PASS. Reviewed the two-code-file
  diff: no changes to OTP consumption, cookies, identity/boundary reattestation,
  logout/quarantine invalidation or tenant authorization. Other shared WIP kept.
- Graphify recovered but indexes 361079a4, older than current 92cbb28c; scoped
  current source inspected. No broad filesystem/code scan or full suite.
- No commit/push/deployment; Production still runs the previous code. First-
  attempt hosted acceptance of this repair and Google/multi-tab remain NOT_RUN.

### Security review and authorized release

- Independent scoped security review: no findings. Logout/expiry/lock/account
  change epochs invalidate stale reads; matching-generation signal sharing and
  promise-identity cleanup preserve newer reads. Bootstrap has no self-await;
  final Broker/user/fingerprint/generation checks unchanged.
- Reused the seven targeted passing checks and prior lint/type/security receipts;
  no successful local tests repeated. Required CI remains mandatory.
- Owner authorized commit/push/Production after review. Only the two code files
  and this Auth report belong to this commit; shared PROJECT_STATE changes and
  other staged/unstaged work remain local. Hosted acceptance pending release.

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

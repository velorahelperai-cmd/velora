# Admin access recovery — 2026-10-08

- Account `velorahelperai@gmail.com` already existed in `platform_admins` and has a confirmed email.
- Supabase request logs showed `is_platform_admin` failing with HTTP 405 / PostgreSQL 25006. The session pre-request hook attempted an INSERT while PostgREST executed the stable RPC in a read-only transaction.
- Hook now validates read-only requests without writes and retains server-side checks/initialization on writable requests. Two-hour expiry, revoked-session checks and restrictive policies remain enabled.
- Local PostgreSQL reproduction failed with 25006 before the fix and passed after it, including two-hour expiry, no revival, no passive renewal and per-device isolation.
- Recorded the explicitly confirmed owner role for the existing verified account. No new admin account was created; ordinary users and other admins were not promoted. Owner status does not create missing application RPCs.
- Live read-only database check confirmed hook succeeds and both is_platform_admin and is_platform_owner return true for this account.
- Expired-JWT errors are recognized separately from unavailable services; expiry reason is preserved through server authorization and redirects.
- AccessGate offers local-device sign-out and sign-in again, and automatically redirects explicitly expired sessions. Genuine service outages remain retryable. Login explains confirmed session expiry.
- Keys are not included in this report. No AI provider request was made.

## Publication verification

- Deployment `dpl_GpTFF41tBTaQSz9bvLx8FCWJPJyS` reached READY on Vercel and was aliased to https://www.velorahelper.com.
- TypeScript and affected-file ESLint passed. Auth policy/journey tests: 12 passed. Production build passed.
- Browser smoke checked the expired-session login message and anonymous admin redirect; no real account sign-in was performed.

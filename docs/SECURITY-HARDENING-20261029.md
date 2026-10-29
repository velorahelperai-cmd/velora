# Security hardening — 2026-10-29

Scoped repairs, not certification of every product journey.

- Logger now sanitizes messages after interpolation and recognizes bare provider keys. Knowledge/access actions return fixed public errors. Admin Supabase factory is compiler-enforced server-only.
- WhatsApp rejects impossible signatures before buffering; existing signed event, retry and coexistence behavior retained.
- Setup downloads distinguish unauthenticated401, unauthorized403 and unavailable503; authority failures return empty safe responses.
- Confirmed raw delivery-receipt metadata disclosure to assigned-only staff: direct anon/authenticated privileges revoked. Message projections and trusted receipt processing retained. Production ACL verified.
- Nine internal invoker functions now pin search_path. Production bodies/ACL fingerprint unchanged. Migration ledger04003; delivery ACL04627; rate04849. No customer row/provider mutation.

Rate policies use atomic PostgreSQL counters and HMAC subjects; service-only RPC/private RLS tables. All policies MONITOR. Settings live in private.security_rate_policies; enforcement additionally requires server VELORA_RATE_LIMIT_ENFORCE=true. Existing broker key provides HMAC fallback. Defaults: checkout5/60s/account; invitations10/600s/account; AI trial6/60s/company; login20/300s/IP; verify10/300s/IP; resend3/300s/IP; signup5/300s/IP. These are engineering starting values, not provider recommendations. Existing Auth throttles, AI budget reservations and financial idempotency remain. Verified persisted checkout retries bypass only this additional limiter. Server Actions expose retry metadata, not real HTTP429 headers. Webhooks excluded.

Validation: rate package119 TS tests; native concurrent/ACL/replay/reset/monitor test1; delivery ACL native tests3; metadata/pure SQL checks6; logger11; browser4; knowledge24 PASS/1 skipped; access6; setup-download5; WhatsApp/coexistence34 after fixture correction (final affected route20 PASS). Counts overlap where stated and are not a unique grand total. Typecheck and scoped lint PASS. Tracked Gitleaks0; historical9 findings classified3 synthetic/6 false positives. Five unrelated local-evidence findings are source hashes.

Remaining: real two-user/company/branch hosted journeys, real Google/email/provider/payment acceptance remain unverified. New limits require observations before enforcement; merchant-specific AI/Thawani quotas UNKNOWN. Leaked-password protection disabled in Auth configuration. Public conversations/messages retain excess mutation/TRUNCATE grants, without proven remote SQL execution path. Broad security-definer advisory counts are not proof of vulnerabilities. Some legacy actions outside this repair still expose raw errors; full endpoint audit remains open.

References: [OWASP DoS](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html), [Supabase Auth limits](https://supabase.com/docs/guides/auth/rate-limits), [Gemini limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Thawani](https://thawani.om/developers).

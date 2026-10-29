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

## Follow-up — legacy errors and privileges

Legacy tenancy account/review/admin database failures now return fixed public messages; unknown conversation/grant refusal codes are bounded while known conflict/business codes remain. Injected failure regressions reproduced leaks before repair. Tenancy/review/profile targeted33 PASS; access errors3 PASS.

WhatsApp connection actions no longer forward five raw database failures or unknown rejection details; billing attempt wrappers return three fixed failure codes. Existing authorization/RPC arguments and financial success behavior retained. Additional26 targeted tests PASS including FIX03/04/05 regressions; synthetic leak tests first reproduced nine failures. No provider operations executed.

Production migration20261029010107 removes obsolete client mutation/TRUNCATE/MAINTAIN privileges on conversations/messages, preserves authenticated SELECT under existing RLS, and preserves service/definer writers. Three native PostgreSQL tests PASS; live catalog confirms client mutation=false, SELECT=true, service access=true. No customer rows or Meta state modified.

Leaked-password protection: inspected the actual Velora organization in Chrome; plan FREE. UI states Pro or above required. Enabling and saving did not persist: reload shows disabled. No paid upgrade initiated. See [official availability](https://supabase.com/docs/guides/auth/password-security). This remains unavailable on the current plan, not enabled or runtime-verified.

## Remaining review — no repetition of delivered repairs

New fixes: team invite/revoke RPCs allowlist documented refusal codes; unknown backend text becomes UNKNOWN. WhatsApp reply intent/claim/finalize unknown refusals become fixed public messages. Four new injected leak cases failed before repair. Affected team9 and send55 tests PASS; typecheck/scoped lint PASS. Idempotency, paid quotas, existing throttles, worker/webhook and human handoff logic unchanged; no live provider send.

Read-only Production recheck confirms conversations/messages UPDATE/DELETE/TRUNCATE absent and SELECT retained; raw delivery receipt access remains denied. No repeated grant migration. Auth advisor still reports leaked-password protection disabled; previously verified FREE-plan restriction remains unresolved, no repeated activation attempt or paid upgrade.

Rate observations at2026-10-29T01:10Z: all seven policies monitor; zero retained subjects/hits/excesses across all endpoints. Bounded Vercel runtime query00:50–01:11UTC returned no security.rate entries. This supplies no evidence to enable blocking or establish correct live observation coverage. No new enforcement activated. Existing Auth throttling, quota/financial concurrency protections remain.

Hosted isolation: requested explicit approved test identities/companies/branches; current record only identifies a dedicated registration account with no memberships. Do not create Production companies or use customers to fill this gap. Hosted multi-account/company/branch acceptance remains UNKNOWN pending that scope. Live Meta, AI, payment and human-delivery integrations remain UNKNOWN.

New native isolation3 PASS:15 unchanged Production authorization/session function bodies in a disposable database with synthetic identities, two companies and three branches. Allows own grants; denies foreign account/session/company/branch, ungranted capability, revoked/idle/deleting sessions and revoked branch grant; recovery allowed. Table shape/claims are synthetic; token verification, HTTP and full billing/inbox lifecycle not exercised.

Confirmed functional blocker: branch_active staff pass their explicit branch capability but private.billing_chat_access rejects membership unless status=active. Full branch inbox acceptance remains blocked; widening company-wide billing authority is not a safe isolated security fix. Recorded separately, no authorization expansion made.

# Phase 1 Multi-Model AI review — 2026-10-08

Scope: publish the code-only Phase 1 after Antigravity completion. AI migration, admin UI, WhatsApp/live answering and paid provider execution are not activated.

## Verified and hardened

- Existing getAnswerProvider still returns null; isLiveAnsweringEnabled remains false. No app/component caller of the new simulator/router was found.
- Provider secret loader now has a server-only import boundary.
- Production adapter network calls are blocked while live answering is disabled. Mock injection exception requires NODE_ENV=test and an explicitly injected client.
- Simulator rejects dryRun=false before routing or ledger writes.
- OpenAI reasoning tokens are a subset of completion tokens; simulation cost now avoids double counting and retains the standard output rate when no separate reasoning rate exists.
- Pricing is explicitly labelled simulation_unverified. Existing fixture rates/date are not approved billing prices. Current model IDs were found in official OpenAI and Google documentation.
- TypeScript, affected AI/session/knowledge tests and build were checked. The original 18 Multi-Model tests plus six new safety regressions passed.

## Future-live prerequisites

- Tenant-authorized durable store and atomic budget reservations, including output and fallback cost; in-memory process-global state is not a production spending guard.
- Separate simulation usage from any future real usage ledger.
- Verified provider pricing and USD-to-OMR conversion; provider-specific reasoning/thinking usage and bounded output/timeout/retry policies.
- Review migration against the actual platform_admins schema and delegated-admin scope; add current active-session predicates to newly created ledger/budget tables. The migration has not been applied.
- An admin-facing callable simulator needs explicit server authorization before exposing companyId/ledger data.

Official references: https://developers.openai.com/api/docs/models ; https://ai.google.dev/gemini-api/docs/models ; https://ai.google.dev/gemini-api/docs/pricing

## Test-isolation incident

One new pre-fix regression test called the simulator without mocking provider keys; it reached the OpenAI path and returned a 429 error, with no successful completion returned. This was an unintended verification request, not live UI activation. The test now mocks provider keys to null, and the simulator and adapters enforce the disabled-live guard. Subsequent safety tests use injected mocks/dry runs only. No claim is made about provider billing for that failed request.

## Published verification

- Vercel production deployment dpl_96yNfMs1eobZbCiMBfCJcag5RZr5 reached READY and was aliased to https://www.velorahelper.com on 2026-10-08.
- Production build passed; targeted AI/session/knowledge suite passed 41 tests.
- Browser smoke check passed login, anonymous protected-page redirect and email-confirmation flows, with no JavaScript errors. This smoke check did not perform a real account login or provider request.
- AI ledger migration remains unapplied and live AI answering remains disabled.

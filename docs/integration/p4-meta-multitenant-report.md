# P4 — Multi-tenant Meta WhatsApp acceptance

## Outcome and version

Local standard Cloud API path: **PASS**. Ready for staging/launch: **NO**.

- Branch: `codex/p4-meta-multitenant`.
- Base: `7cff51c89da09293db4953b8af1b18060d745887` (saved P1/P2 security acceptance and P3/P4 integration).
- This report accompanies the independent local implementation commit. Original worktrees/branches were preserved; no push, original-branch merge, deployment or cloud SQL was performed.
- Live answering remains hard-disabled; external sending and Embedded Signup remain off by default.

## Mandatory acceptance mapping

| Requirement | Local implementation / evidence | Operational dependency |
|---|---|---|
| Owner registration, company and subscription | Existing verified-session/company authorization and canonical paid Billing entitlement reused | Prior P1/P2 cloud/financial acceptance remains required |
| Products, services, prices and policies | Existing `knowledge_sources`; editor saves business facts or company instructions, both version-approved | Owner supplies and approves actual company knowledge |
| Embedded Signup | Owner/session-bound durable attempt, cryptographic nonce, ten-minute expiry and one-time claim; Meta SDK v4 authorization-code flow | Approved Meta app, configuration, HTTPS domains and explicit Graph version |
| Ownership and authorization | Server code exchange; debug-token app/scopes/expiry and granular WABA targets; WABA phone membership, OTP verification, Cloud registration and app subscription readback | Actual app/account permissions and first deliberate onboarding test |
| Secure company binding | Existing link registry with WABA/phone, authorization provenance, expiry and Vault reference; tokens encrypted, never returned to browser | Actual deployed Vault and server-only introspection credential |
| Trusted inbound routing | HMAC-verified `entry.id` WABA + `metadata.phone_number_id`; exact resolver and transaction-bound ingress/status wrappers; no tenant fallback | Meta webhook subscription/configuration |
| Pre-call authorization | Paid Live proof, message quota, AI cost reservation, service window, claim/generation and knowledge checks before each model | Configured tenant budgets and approved customer rollout |
| Company RAG/persona | Bounded PostgreSQL lexical retrieval of complete approved sources; current company instructions always included; canonical six paid variants map to Noura/Lina/Dana | Knowledge quality and supported query vocabulary; no paid embeddings or fine-tuning |
| Durable accounting and responses | Original job, AI usage ledger, saved response, citations and outbound intent; immutable paid persona/plan snapshot | Production worker invocation and monitored recovery/reconciliation |
| Owner human intervention | Existing atomic takeover/generation fence prevents subsequent AI dispatch; incurred costs and accepted receipt repair remain settleable | In-flight provider HTTP requests cannot be recalled |

## Changes and security evidence

| Finding | Evidence | Fix / verification |
|---|---|---|
| Signup was an in-memory stub, with predictable nonce and no durable session binding | `src/lib/whatsapp/embedded-signup.ts`, `embedded-signup-actions.ts:33`; migration `140000:52` | Cryptographic attempt, selected company/owner/Auth session, TTL, cancellation, expiry and replay rejection; actual PostgreSQL onboarding assertions |
| Browser asset IDs did not prove authorization | `src/lib/whatsapp/embedded-signup-meta.ts:21` | Server validates exact app, both permission target sets, WABA/phone membership and readback before Vault installation; mocked provider rejection cases |
| Vault readiness checked the wrong exact overload | migration `20261008140000_vel_meta_embedded_signup.sql:43` | Verified actual local `vault.create_secret(text,text,text,uuid)` with default arguments; real encrypted storage/rotation/deletion tests |
| Phone-only routing and stale timestamps could violate tenant/send policy | migration `143000:34`, `src/lib/whatsapp/service-window.ts:5` | Exact signed WABA/phone provenance; immutable inbound time, no future evidence, strict 24-hour free-form window at AI and send gates |
| Company instructions/paid persona could drift during generation or lease recovery | migration `144500:55`, `src/lib/answers/approved-retrieval.ts:12` | Version approval invalidation; full-source retrieval bounds; immutable reservation profile and original citations rechecked before start/stage/send; new-lease successful draft recovery avoids a second paid call |
| Confirmed OAuth rejection could become unknown after separate token cleanup failed | `src/lib/whatsapp/integration-store.ts`, `integration-worker.ts`; migration `140000:355` | Bounded `graph_190` error passed to original receipt finalizer; rejection and generation-bound credential deletion happen atomically. Tests reproduced RPC error/throw first, then passed |
| Finalizer wrapper initially reversed company/intent lock order and trusted replayed input cause | migration `140000:355`; `scripts/whatsapp-integration/meta-concurrency.mjs` | Company lock precedes original intent finalizer; persisted rejection cause is required. Real two-session test reproduced deadlock before correction and passed afterward; unrelated settled rejection replay preserves valid token |

New forward migrations, in order (historical migrations were not edited):

1. `20261008140000_vel_meta_embedded_signup.sql`.
2. `20261008143000_vel_meta_routing_send_policy.sql`.
3. `20261008144500_vel_company_answer_profile.sql`.

The existing queues, send intents, knowledge sources, budget accounts and AI ledger remain authoritative. New private tables hold only signed inbound provenance and authorization revocation times, not a parallel queue or billing ledger. Legacy signup attempts without a provable session are cancelled; legacy verified links without verified authorization are shown as requiring reauthorization, preserving historical data.

## Final verification

| Category | PASS | FAIL | Skipped / not run |
|---|---:|---:|---|
| Offline Vitest suite | 1014 | 0 | 22 skipped; 95 files passed, 7 skipped |
| Real isolated PostgreSQL assertions and concurrency | 107 | 0 | 0 |
| SQL-backed application worker integration | 2 | 0 | 0; model/Graph transports mocked, actual Vault and project RPCs used |
| TypeScript | PASS | 0 | — |
| Scoped ESLint / diff whitespace | PASS | 0 | — |
| Next.js 16.3.8 production build | PASS | 0 | — |
| PGlite | — | — | NOT RUN; no substitute concurrency claim |
| Actual Meta/OAuth/model/send validation | — | — | NOT RUN by instruction |
| Cloud schema/migration/credential verification | — | — | NOT RUN; no cloud changes |

Changed-file secret scan: **73 files, zero credential-pattern matches**. A fresh independent source review found one Important failure-classification issue; the atomic finalizer fix, company-first lock order and persisted rejection-cause guard closed it. Subsequent targeted checks passed; no Critical/Important finding remains open in this local review scope.

PostgreSQL 17.6 ran all **64** project migration files against synthetic Auth/Storage infrastructure in a task-labelled container with no network, exposed ports or persistent volume. Actual project constraints, RLS, RPCs, Vault encryption and transactions were exercised. Populated inconsistent legacy identity migration preflight rejected the upgrade without deleting or assigning historical rows.

Eight concurrency cases used independent PostgreSQL connections and observed real lock waits. Final backend pairs: duplicate ingress `13208/13222`, FIFO `13277/13291`, message quota `13361/13397`, AI budget `13496/13524`, takeover `13607/13621`, one-time signup claim `13677/13691`, renewed credential vs old failure `13733/13747`, receipt/usage lock order `13846/13860`. The prior deadlock was reproduced at `11349/11364`; it was not counted as a pass.

Commands: `npx vitest run --reporter=dot`; `node scripts/whatsapp-integration/run.mjs --legacy-preflight`; explicitly opted-in `integration-postgres-app.test.ts`; `npm run typecheck`; scoped ESLint; `npm run build`. Unit-test skips remain skips; the two opt-in application SQL cases were run and reported separately.

## Configuration and remaining launch dependencies

Owner-approved deployment must verify the exact existing migration history and apply the forward chain, including the saved P1/P2 and P3/P4 prerequisites. Cloud parity is unverified. Keep deployment compatible with the new schema; use a forward correction instead of dropping credential/provenance/ledger columns after new writes.

Required server configuration (names only; supply values through the deployment secret manager):

- `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
- `WHATSAPP_EMBEDDED_SIGNUP_APP_ID`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`, `WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION`.
- `WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN` for server introspection; no customer-token/global-send fallback.
- Supabase service-role configuration and functioning Vault with the verified extension contract.
- `WHATSAPP_ROUTING_MODE=tenant_registry`, authenticated worker secret/invocation and operational recovery monitoring.

Actual onboarding, customer AI and external-send enablement remain separate owner-authorized actions. Meta app review/Tech Provider eligibility, allowed HTTPS domains, business authorization scopes, webhook subscriptions and customer payment method must be validated on the intended account. Pin and validate the Graph version explicitly; tenant sends have no silent version fallback.

Token renewal uses a new deliberate Embedded Signup, atomically replacing the encrypted credential and link generation. Known expiry, owner disconnect, signed WABA `PARTNER_REMOVED` and confirmed token error 190 stop use. Old revocation/error events cannot remove a renewed credential. Disconnect stops Velora and deletes its local encrypted credential; it does not revoke broad Meta permissions belonging to other phones/companies under a shared WABA. Customers can revoke their Meta grant separately.

Standard Cloud API onboarding is implemented. `keepOnPhone`/Business App coexistence, history synchronization and unsupported finish types deliberately return `NEEDS_SETUP`; that mode is a remaining launch dependency if required. Outside the customer service window, free-form replies are blocked; no unapproved template/consent or grace policy is invented.

The prior financial acceptance blockers remain: actual Paymob merchant/processing contract and OMR conversion, owner-approved payment deadline/late-payment/refund policy, historical billing reconciliation, and verified cloud schema parity. No financial setting was changed here.

**P4 local standard Cloud API acceptance: PASS. P1/P2/P3/P4 ready for staging or production: NO.**

# C2 runtime continuation

Branch `overnight/ai-whatsapp-runtime`, base `13861eb3dd20717c84517870667b77351932800c`. Saved P3/P4 are ancestors; no repeated merge. No new SQL, AI queue/ledger, model substitutions or live activation.

The existing verified WABA/phone registry, tenant Vault, raw-body HMAC, durable jobs/FIFO, retry/dead-letter, claim/generation checks, Approved Knowledge retrieval, router, joint quota/cost reservation, saved replies/outbound intents and monotonic delivery remain the production code path. Noura/نورا is already the system-prompt name; internal stable IDs are preserved.

Added `loadWhatsappInboxInitialPage` and its server refresh action: one 40-row partial page, no complete-thread traversal, authoritative independent control capabilities, selected-company/scope recheck and explicitly page-local worklist counts. Global totals and unread boundaries still come from existing SQL page contracts.

Added offline local consumer entry `node scripts/whatsapp-integration/run-worker-local.mjs --fixtures-only`. It refuses other modes, verifies only the task-labelled ephemeral C2 PostgreSQL target and clears provider keys before invoking the opt-in tests. Model/Graph transports are mocks; the actual webhook/consumer handlers, HMAC calculation, routing, jobs, SQL/RLS/Vault, accounting and delivery functions execute.

Verification: four bounded-initial-reader tests passed.

Four actual HTTP-handler and PostgreSQL journeys passed.

Worker authorization: rejected invalid requests.

HMAC signature checks rejected forged webhook bodies.

Duplicate and FIFO ingestion through the consumer behaved as expected.

Accepted versus delivered or read states were checked.

Wrong-recipient evidence was recorded.

Possible Meta acceptance stayed unknown without regenerate or resend.

Hard-disabled rollout allowed repair-only reception.

TypeScript and scoped ESLint passed.

Initial fixture setup needed the local Vault extension.

No production SQL or API repair was performed.

Broader frozen combined-branch validation belongs to the final integration report.

Fixture target: `velora-c2-runtime-13861eb`, label `velora.task=c2-runtime-integration`, network none, no exposed ports, tmpfs data, no persistent mounts. Shared test harness targets were updated only inside this runtime branch. Billing C1 scripts are reused on a separate database in the same isolated container.

Remaining: separately approved cloud definitions/history/Vault migration, merchant OMR/namespace/refund/deadline policy, production worker scheduler/monitoring, Meta app approval/HTTPS domains/customer authorization and real-account journey. Standard Cloud API onboarding is implemented; coexistence/history sync remains NEEDS_SETUP if requested. Unknown sends require authenticated reconciliation, never blind retry. Live AI and External Send remain disabled in source; test switches exist only inside injected mocked tests.

Clean UI source tips inspected: Inbox `7bca9ff8c867e6eedd1da6d5194f78dc2c7c2b49`, Onboarding `16d7cca2ff3a6c5ad5591195628f9239c36c0b7a`. Their commit messages are not success reports; C2 will independently verify/fix the combined contracts and record final outcomes. Original worktrees remain untouched. No cloud writes, real payment/model/WhatsApp request, push, deployment, secret copying or backup.

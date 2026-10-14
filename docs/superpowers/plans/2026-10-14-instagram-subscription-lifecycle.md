# Instagram and subscription lifecycle

Approved spec: the user's four numbered requirements in this chat. Implement inline on `codex/instagram-subscription-lifecycle`; no deployment, cloud migration, provider authorization, payment, AI execution, customer detach/delete or real email.

Architecture: separate OAuth attempt revisions from the active link generation. Existing native owner/session locks, Vault, verified subscription checkpoint and billing evidence remain authoritative. A durable expiry episode serializes with payment on the existing company lock; local unlink, bounded conversation cleanup and notification outbox never imply provider account deletion or confirmed provider revocation.

- [x] OAuth: regression SQL tests first; forward migration separates attempt generation, pins account ID, preserves valid links, adds safe stored recovery and administrative-only audited unlink. Update owner state and existing UI/tests.
- [x] Subscription: exact 30-day paid duration and expiry+30/+60 boundaries, proven live receipts, server/database access and inbound fences. Test boundaries and renewal races in isolated Postgres.
- [x] Lifecycle: persisted expiry episodes, idempotent local detach and scoped history cleanup, guarded worker disabled by default. Cancel old work on verified renewal; stage attachment cleanup with account/path provenance.
- [x] Policy/email: actual deadlines in subscription UI and terms; owner-only deduplicated reminders (expiry, expiry+23d, expiry+29d), recheck before dispatch; no real sends. Focused tests, typecheck, independent final review.

Review focus: old OAuth callbacks; uncertain exchange cannot be reclaimed; payment commits before worker; denied old-account history; attachment paths cannot escape a company's storage prefix. External provider revocation is separate and remains unconfirmed unless supported and explicitly executed after deployment approval.

Local verification: 293 focused unit/UI tests + 18 isolated Postgres cases passed; TypeScript and targeted lint passed. New migrations/workers are NOT applied/enabled in production. Provider revocation remains unconfirmed. Local Next.js webpack build passed; no publish, real authorization, payment, provider AI or mail dispatch.

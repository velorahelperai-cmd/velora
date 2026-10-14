# Velora project state

Updated: 2026-10-15 (Asia/Muscat). Code, tests and verified Git state are authoritative.

## Current delivery

- **CAT-001 — Integrated / Verified:** six approved commercial plans, Standard/Premium, monthly pricing and annual 20% discount. Acceptance: Noura 45/90, Lina 65/120, Dana 75/150 OMR monthly; annual 432/864/624/1152/720/1440 OMR paid upfront; reply allowances remain monthly. Standard owner+2 employees/one channel; Premium owner+4/two channels. Optional add-ons are separately priced. Specification: `src/components/app/subscription-commercial-catalog.ts`.
- **VID-001 — Integrated / Verified:** supplied Noura and Lina introductions, on-demand playback, one speaking clip at a time, play/pause/mute, static fallback and bounded card frames. Original files remain in Downloads; AAC audio was verified unchanged in the cropped display copies. Dana currently uses her portrait.
- Release commit: `5e70beb0e1ca26db98f566ec1da9f9062ec951d0`, verified on `origin/main`.
- Vercel deployment: `dpl_ZSUoS9C7c54MM8wDt9FdEoh6MvMW`, READY, production; `www.velorahelper.com` resolves to this deployment. Public production postflight verified all six monthly/annual totals, both supplied video sources playing without media errors, and previous-clip pause when another introduction starts.
- Verification: 108 targeted tests passed; targeted ESLint passed; Next.js 16.3.8 production build with Webpack passed, including TypeScript. Turbopack is blocked locally by the shared node_modules junction; the hosted build succeeded. Browser checks verified annual totals, playback coordination, mobile layout and versionless annual selection through the login destination.
- Ownership: current chat, branch `codex/master-customer-journey`, worktree `C:/Users/DELL/.codex/worktrees/velora-auth-release/Velora new`. Main integration checkout: `C:/Users/DELL/.codex/worktrees/main-consolidation/Velora new`.

## Contracts and approved decisions

- **BILL-001:** commercial display is a versioned approved specification, not a synthetic financial catalog. A checkout choice requires an existing published server version matching persona, edition, billing term, OMR amount and monthly allowance. No invented version IDs or readiness flags; server authorization/payment qualification remains authoritative.
- **BILL-002:** the existing financial reader/checkout supports legacy monthly Noura offers; six new financial bindings and annual checkout are not implemented by CAT-001. Displayed prices do not prove service activation or enforce quotas.
- **MEDIA-001:** two H.264/AAC clips plus WebP posters total 1,745,280 bytes. Hosting/traffic cost is shared and unmeasured; recorded in `C:/Users/DELL/Desktop/التكاليف - Velora.txt`. Do not treat unknown expenses as zero.
- **SAFE-001:** preserve unrelated primary-checkout changes. Never inspect Obsidian. No paid provider verification without a new explicit request; owner AI lifetime cap remains 1 OMR. Do not expose credentials. Production SQL, flags and sensitive changes retain their explicit approval/recovery gates.
- **OPS-001 — Approved:** the user explicitly authorized automatic Production deployment of safe tested changes on 2026-10-15. Keep the existing Vercel main auto-deploy workflow; the unapplied disable-deployment proposal was removed. This authorization does not extend to destructive operations, unsafe migrations, sensitive database changes, paid provider tests or unverified service activation.

## Approved backlog — retain until verified complete

- **CAT-002 — Pending:** persistent twelve financial offers (six monthly/six annual), immutable version history, per-branch subscription scope, actual monthly quota/team/channel enforcement, annual settlement/renewal and compatible server bindings. Requires billing contract changes, safe local integration tests, recovery verification and Production approval; do not enable payment merely from commercial display.
- **SERV-001 — Pending:** operational implementation/readiness of the agreed Standard/Premium features in the commercial specification. Preserve all listed customer service, sales, Instagram comments/follow-up and operations requirements; market them according to verified availability.
- **ADD-001 — Pending:** Premium optional Velora website/store/POS, stock/bookings, payment/accounting and custom n8n/Make workflows. Define supplier, licensing, allowances, setup and recurring charges before activation; prioritize Velora-owned website/POS integration.
- **VOICE-001 — Pending:** real phone conversations and voice-message understanding. Supplier/number/minute charges are not finalized; no paid trials authorized here.
- **CONTENT-001 — Pending:** approved images/reels/stories/ad-management add-ons with preview/approval, supported publishing APIs and bounded usage. Automatic WhatsApp Status publishing has not been approved as a supported implementation.
- **VID-002 — Waiting for input:** Dana introduction video if supplied; do not generate a paid replacement automatically.
- **ONB-001 — Existing integrated increment:** Smart setup migrations and flag were deployed in the previous approved release. Production owner signup/logout/return journey still needs authenticated verification; SMS provider remains deferred by the user. New Smart/master/global flag changes need separate approval.

## Next

1. Prepare CAT-002 as the next approved billing slice after compatible contracts are established; sensitive Production activation stays gated. Do not mark the entire six-package service offering Production Ready from display tests alone.

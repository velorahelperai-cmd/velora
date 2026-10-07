# Card → later server source map

Preview-only. Sources are **required later** for real wiring — not connected now.

## Customer board (`/preview/dashboards/client`)

| Card / block | Intended server source (later) |
| --- | --- |
| Design preview badge | N/A (preview-only chrome) |
| Next step | `getCustomerReadiness()` → `nextItemId` + items |
| Plan · AI staff (levels 1–3) | Billing entitlement / subscription row for `velora_ai_staff` (single active tier) |
| Subscription period | Subscription `current_period_*` / paid window |
| Usage | Usage counters / quotas API (commercial limits TBD) |
| WhatsApp | Company WhatsApp link status (separate from company status) |
| Knowledge | Knowledge readiness / approved snapshot |
| Follow-up conversations | Conversations needing human follow-up (not demo-state) |
| Animated character slot | Deferred asset pipeline — no staff name yet |
| Expired banner | Period end vs entitlement inactive |
| Suspended banner | Company/account security hold (ops), distinct from expiry |

## Platform owner board (`/preview/dashboards/admin`)

| Card / block | Intended server source (later) |
| --- | --- |
| Accounts | `adminSearchAccounts` / accounts browse |
| Companies | `adminListCompanies` |
| Subscription statuses | Admin subscription overview (per company, single product) |
| Pending payments | Open purchase orders / unsettled attempts queue |
| Duplicate collection | Settlement / attempt duplicate-review queue |
| Activation requests | Review submissions + WhatsApp activation requests |
| Fault indicators | Ops health codes (webhook delay, settle retry, unconfigured) |
| Revenue / FX | **Explicitly omitted** until a trusted money source exists |

## Explicitly not in preview product paths

- `src/components/app/dashboard.tsx`
- `src/components/app/admin-list.tsx`
- Any `/access` or Paymob checkout routes

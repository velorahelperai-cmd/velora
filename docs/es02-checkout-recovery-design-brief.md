# ES02 checkout / recovery presentation brief (image-gated)

Status: **ready for visual approval; UI not implemented or authorized**. Based on the actual C3 contracts (unit51/51, independent24/24, local DB24/24), not a proposed payment capability. No new UI or provider operation is performed by this brief.

## First approval artifact: branch plans and order review

Use the existing authenticated `/setup` journey, immediately after its memory-only local review. The proposed step is **"Choose plans for your branches / Review order"**; this is a design destination, not an existing implemented checkout route. `/app/subscription/orders/[orderId]` is an existing company-bound order route and is not proof of this pre-company account-bound journey. Do not reuse it silently as the new account checkout.

The approved current form ends at "Plan selection and payment are currently unavailable." It imports no ES02 create/recovery/provision action. That is a real missing presentation/action binding; a successful RPC fixture is not browser purchase acceptance. The first artifact should show desktop and narrow mobile, Arabic RTL and English text accommodation, using existing service styling and accessible reading/focus order. No homepage change, new CSS system, fictional payment brand, fake paid badge or synthetic-settlement button.

| Field / display | Source and interaction contract |
|---|---|
| Account | Server-authenticated account; display only. No editable account/email-as-owner selector |
| One order term | Monthly / yearly for the whole order; server resolves approved annual price, not a browser price field |
| Branch slots | One numbered row per purchased branch, each with persona `level_1/2/3` and tier `basic/premium`; 1..32 slots in current parser. Channels are rights inside each slot, not branch quantity |
| Six plan comparisons | Existing catalog: Noura/Lina/Dana x Standard/Premium. Show price, currency, term, monthly replies, employees, messaging channels and existing included features distinctly; no invented availability or new prices |
| Immutable summary | Catalog revision2026-10-14; per-slot amount/rights, slot count, OMR total and initial-subscription purpose from canonical server order. Business/branch draft may be reviewed locally, never sent as checkout/provider metadata |
| Consent | Explicit `consentAccepted`; do not infer acceptance from viewing/selecting a plan |
| Primary action | "Review/create order" may create only a financial order after approved implementation. Provider/payment continuation remains unavailable while PAYMOB_EXTERNAL_DEFERRED; creating an order is not payment |
| Back/edit | Return to existing memory-only preparation/selection; changed offer is not silently substituted for an unresolved prior purchase |

Verified catalog amounts (OMR, one branch slot): Noura45/90 monthly and432/864 yearly; Lina65/120 and624/1152; Dana75/150 and720/1440. Existing20% annual discount, monthly reply allowances for annual terms, seats2/4 and channels1/2 remain unchanged. UI must consume the catalog/returned order; these brief examples are not a second price authority. Preserve full existing feature descriptions from `subscription-commercial-catalog.ts`.

## Exact action boundary and screen states

`createAccountBoundOrderAction`: `{expectedAccountId, clientOpId, selection:{term,slots:[{persona,package}]}, consentAccepted}`. Allocate/retain one pending operation identity for retries; no new collection on UNKNOWN. The server authenticates the actor and recomputes the offer. No business name, branch names/cities, phone or full draft in this request, URL, analytics, logs or provider payload. Navigation `next` is intent only.

| State | Required truthful presentation / next action |
|---|---|
| Loading actor / session denied | Confirm account; prevent writes; expired/foreign actor cannot continue; clear the prior actor's draft on account change |
| Editing / invalid / slot mismatch | Accessible field/slot error; no financial or business write before validation |
| Creating / open / collection_pending | Disable duplicate submit while retaining clientOpId; show original order reference and unpaid/pending status, never a paid business |
| UNKNOWN / malformed / lost reply | Outcome not confirmed. Reconcile or retry the same operation; do not show final failure, recreate a purchase or offer "pay again" |
| CONFLICT / OFFER_TAMPER / FORBIDDEN | Explicit matching error; require safe review/account correction, not automatic offer replacement |
| PAYMOB_EXTERNAL_DEFERRED | Clear unavailable external-payment continuation; no fake success or synthetic customer action |
| Owned settled_unprovisioned | Future recovery binding calls `readOwnedPurchaseRecoveryAction({expectedAccountId})`; show original paid order, re-enter missing local business/branch data, finish via `completeOwnedProvisioningAction` without another collection |
| Provisioning / provisioned | Stable order/company/order-group references; once-only retry/reuse, not duplicate company creation |
| RECONCILIATION_REQUIRED | Preserve original financial evidence and partial references; no force-complete, reprice, delete or recharge. Current technical response exists; reconciliation UI/policy is not invented here |
| Waiting readiness / active | Payment and provisioning do not prove service activation. Server channel AND actual AI facts control readiness; never display owner-editable ready toggles or backdate paid service |

The existing owned recovery reader returns paid/provisioning/provisioned purchases; it is not a general browser UI for every open/UNKNOWN order. Retaining the pending operation and reconciling open outcomes is an explicit binding acceptance item, not an already delivered screen. A reload intentionally loses the full business draft; the paid purchase remains owned server-side.

Approval scope: approve the first visual artifact and its labels/states, then implement its bounded existing-action binding. It does not authorize provider connection, charges, new business policy, identity restoration or ES03. Follow-on return/UNKNOWN/recovery/activation panels must be visually approved before implementing their new presentation.

## Restored current presentation (C8)

`/setup` `PrepaymentPreparation` is restored to the approved memory-only prepare → local review flow. Plan selection, checkout, recovery, done phases, and any automatic synthetic settlement were removed from customer UI. Review copy again states plan selection and payment are currently unavailable.

## Independent backend (proceeds without new chrome)

- Account-bound order / catalog-validated per-branch slots / once-only provisioning / owned recovery: `src/lib/billing/es02/*`
- Fixture-only synthetic settle: `fixture-synthetic-settlement.ts` + SQL `velora.es02_fixture=on` (never customer-callable)
- Paymob external verification: **Deferred** (`PAYMOB_EXTERNAL_DEFERRED`)

## Required future presentation (do not invent)

1. Checkout summary: immutable per-branch slot map + one term + server total OMR + consent; no business draft in URL/query.
2. Payment return / UNKNOWN: pending, settled, provisioning, failed — no fake paid badge; stable client operation id.
3. Browser-loss recovery: owned paid purchase → re-enter business/branches → finish once.
4. Activation readiness: waiting first-channel ∧ actual AI from server facts; no fabricated ready state.

## Shared contracts to bind visually

- `Es02ImmutableOffer` (slots[]), `Es02AccountOrderView`, `Es02OwnedRecoveryView`, `Es02ActivationFoundation`
- Actions: `createAccountBoundOrderAction`, `readOwnedPurchaseRecoveryAction`, `completeOwnedProvisioningAction`

## Explicit non-goals

- No new CSS system or marketing checkout screens until approved images exist.
- No customer path that settles via synthetic evidence.
- DEC-ES01-IDENTITY remains PrelaunchDeferred — out of scope for this brief.

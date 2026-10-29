# Branch staff isolated QA — 2026-10-29

Scope: owner-authorized fallback because no isolated Production QA business or staff accounts exist. Use VELORA QA / QA Main / QA Branch 2 in a disposable local PostgreSQL database only. The supplied owner email is fixture metadata; no mail, invitation, signup, payment, subscription provisioning, Meta operation or Production customer mutation is performed. A real staff invitation requires an explicitly authorized staff email, which has not been supplied.

Provisioning review: the inspected paid setup and checkout paths provide no independent approved QA provisioning operation. Local-live checkout requires live keys and explicit amount approval; test checkout is still a checkout path. Neither is used to bypass Production payment. Existing isolated PostgreSQL infrastructure is reused: random ownership-labelled container, network none, no published ports, temporary storage, verified ownership before deletion.

Candidate: main 7eec372eb231ccca96a43a4bb68a69bd624e3863. Graphify indexed this exact SHA on 2026-10-29. New QA tests load actual Production identity, session, capability, inbox, billing-policy, control and send-intent function definitions, with synthetic identities and reduced table shapes. Earlier successful branch-access tests are not rerun.

## Verification

Command: `node --test scripts/ci/branch-chat-qa.test.mjs`.

Final targeted verification: **3/3 PASS**, zero skips/failures, 19.05 seconds. Scoped ESLint and whitespace checks PASS. Actual Production SELECT policies and six restrictive session/identity/deletion policies execute locally: direct RLS admits all three assignment states in QA Main, hides foreign-company and foreign-account rows, returns no rows for an expired session, and denies direct UPDATE/DELETE on conversations/messages. Actual control/send-intent functions deny staff takeover/assignment/resume/close/send; authorized owner takeover/resume increments revisions and records audit events, stale revisions conflict, and staff retain message reading after takeover. Paid history without a receipt blocks owner control/send with no mutation.

QA Branch 2 exists in the same fixture company but has no second active provider link: the reduced legacy table/link uniqueness constraints do not represent a second simultaneous linked branch account. Its RPC request is refused explicitly. Foreign-account rows are independently hidden by RLS. This does **not** prove a full two-linked-branch browser journey.

## Realtime and hosted acceptance

Read-only Production catalog inspection confirms `supabase_realtime` exists with `puballtables=false`; none of the four WhatsApp/Instagram conversation/message tables belongs to that publication. `src/app/branch/page.tsx` renders server reads and links; it has no Realtime subscriber. Local configuration enabling the Realtime service alone does not enable this product flow. No Production publication or UI change was made.

Production authenticated browser, signed-token/HTTP, Realtime delivery and human delivery acceptance remain **UNKNOWN**. No Realtime container is present in the installed local image inventory. No transport substitute or mock is presented as Realtime evidence.

The lifecycle-receipt and JSON projection adapters are explicit doubles. Positive owner control uses the existing legacy/no-paid-history policy; it does not prove a paid customer's entitlement lifecycle. A receipt-verification dependency fails closed and is not exercised by a successful paid-entitlement path. No successful send or provider call is attempted. Meta, payment and live human-delivery integrations remain **UNKNOWN**.

Delivery: test/documentation package only; no application or Production database change. CI and publication evidence are recorded separately after execution.

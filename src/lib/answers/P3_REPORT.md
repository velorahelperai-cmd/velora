# P3 Multi-Model AI readiness

Date: 2026-10-08. **Ready for First Live API Test: NO.** Local code is prepared and verified offline; installed authorization, atomic budget state and provider configuration still need verification before an explicitly authorized request.

## Branch & Commit

- Branch: `codex/p3-ai-readiness`.
- Worktree: `C:/Users/DELL/.codex/worktrees/p3-ai-readiness/Velora new`.
- Base P0 commit: `657e4bafeff62f37137238a9afc61d2562629a7d`.
- P2 `3f2ed0fc0a9872e47a89f6ea90d2c1ebd6db64a2` and P4 `b24064f625e9b2a3a9f96ca84d35e4aa1b12ec13` were verified through Git object identity. P3 does not include or change their worktrees.
- Delivery is a local commit on the P3 branch. No push, merge, deployment, new backup or migration was performed. Only `src/lib/answers/` source/tests/docs changed; Billing, WhatsApp, Auth, UI and dependency manifests were not modified.

## AI Adapters Status

| Model | Prepared integration | Safety/accounting |
| --- | --- | --- |
| `gpt-6-luna` | OpenAI Responses API, pinned ID | Bounded output/time, SDK retries disabled, no legacy Chat fallback, request/response/model provenance |
| `gpt-6.1-sol` | OpenAI Responses API, pinned ID | Same safeguards; reasoning remains within total billed output |
| `gemini-3.8-flash` | Installed Google GenAI SDK: bounded GenerateContent adapter and existing Interactions administrative runtime | LOW thinking; unsupported sampling settings removed; one explicit adapter attempt / no Interactions retries; input + output + thoughts consistency checked |

Missing/incomplete/empty usage, inconsistent totals and unexpected returned model families are not priced as successful zero-cost requests. Missing optional model echoes remain compatible with legacy injected clients; they are not reported as provider-confirmed provenance. Metadata availability checks explicitly leave generation/billing access unverified. No model was replaced and no provider endpoint was called, including metadata checks.

## Router Status

Routine work uses Luna, advanced/context-rich work uses Gemini, complex work uses Sol. There is no fixed 75/20/5 allocation. A separate conservative financial/sensitive preflight requires trusted verification/human review; a forced model cannot remove that gate. This is not complete semantic/action authorization.

Eligible fallback preserves capability: Sol does not automatically downgrade, advanced Gemini can fall back to Sol, and explicitly selected models remain pinned. Known permitted nondispatch/rejection can enable fallback; timeout, unknown/empty/incomplete billed results, cancellation, credentials/usage exhaustion cannot. The real runtime reuses the same eligible-model planning and reserves/settles each attempt separately. Legacy company paid execution requires the durable runtime; customer Live remains disabled.

Approved Knowledge loading/citation checks and tenant-scoped context remain in the existing trusted path. Shape/version checks alone do not prove approval or tenant ownership. The shared prompt now forbids confirming business execution without a trusted executor result; P1 still needs the actual action-verification workflow.

## Usage Ledger Status

- Legacy simulation estimates use a separate explicit offline ledger and cannot contaminate actual spend. Unknown costs are `null`; relevant uncertain spend blocks another snapshot preflight.
- Real administrative execution reuses `ai_reserve_attempt` -> `ai_start_attempt` -> provider -> `ai_settle_attempt`. A malformed reservation, missing persistence or unconfirmed settlement cannot authorize a request or completed response.
- Per-attempt application evidence includes tenant, requested/returned model, input/output/cached/cache-write/reasoning/total tokens, request/response IDs, latency, estimated USD/baisa cost, pricing version, fallback identity and timestamp. Billed reasoning is counted once; cached reads/writes are separate input categories.
- Prices now share the published Standard schedule, including OpenAI long-context tariffs and Gemini's announced 2027 change. They are **estimates from public tariffs**, not account invoices, tax totals or proof of account-specific rates.
- Existing SQL stores only part of this evidence. Actual-model/response-ID/cache-write/total-token durability and authoritative usage validation remain P1 dependencies. No schema change was applied. Offline snapshots/mocks do not prove concurrent database budget enforcement.

## Bugs Fixed

Hidden OpenAI SDK retries; incompatible Gemini sampling/thinking; missing output/time limits; unsafe Chat fallback; omitted Gemini thought cost; invented legacy prices; malformed usage/token sums; permissive monetary input; model substitution/downgrading; unsafe timeout/quota fallback; lost attempt telemetry; mock spend in active budgets; fabricated failed-call model/cost defaults; mutable tenant telemetry; truthy malformed reservations; false completion from empty output; failed ping discarding known billed usage/latency; and unexpected model metadata crashing rather than retaining uncertainty.

These were reproduced with failing offline boundary tests before the relevant fixes. Minimal shared-contract changes are documented in [the plan](P3_PLAN.md): optional limits/provenance/retry/attempt fields, and nullable unknown cost in the offline ledger. Existing required request fields and the three model IDs remain intact.

## Tests Results

- AI suite: **207 passed, 0 failed**, 14 files. Tracked pre-change baseline: 89 passed.
- Whole-project offline regression: **571 passed, 0 failed, 18 skipped**, 63 files passed and five opted-in SQL files skipped. The skipped tests are 17 SQL checks and one deferred storage integration check; none were executed or counted as passed. The corrupt-PDF fixture emits its existing extraction warning.
- TypeScript and scoped ESLint passed; no lint errors/warnings. Diff, allowed-scope, credential-pattern and local documentation-link checks passed before the local delivery commit. Credential-shaped literals in redaction tests were reviewed as synthetic fixtures; no credential values were printed.

All generation, HTTP, RPC and database side effects were mocked. Tests cover the three model successes, network/timeout, unavailable model, usage exhaustion, controlled fallback, tenant cost isolation, ledger write failure, budget denial, malformed provider evidence and key redaction. No real client data or account credentials were used; environment credentials were cleared in the regression subprocess.

## Remaining P1 Dependencies

See [source evidence and acceptance criteria](P3_DEPENDENCIES.md): verify installed RPCs/grants and owner/session gates; verify the shared lifetime 1000-baisa administrative budget without resetting existing spend/holds; enforce the approved administrative ceiling; prove real database concurrent reservations/settlement; preserve complete telemetry and usage/pricing consistency; and provide audited reconciliation of uncertain/running holds. Customer subscription/quota and trusted action verification remain separate launch dependencies.

## Ready for First Live API Test: NO

The isolated test is prepared, but P3 did not inspect deployed secrets, installed database state, actual account limits or generation access. Public model documentation and passing mocks cannot establish those. Do not run a provider request to discover a missing database foundation; verify the authorization/budget path first.

## Required Owner Approval

After the P1 prerequisites are verified, obtain a **new explicit owner authorization** for one small synthetic request per named model. Reuse the existing global lifetime **1 OMR** allowance; do not raise/reset it. The prepared test pins each model, caps visible output at **128 tokens**, caps each reservation at **250 baisa**, uses a fixed synthetic prompt and stops on uncertainty. Gemini reserves its conservative full thought/output upper bound rather than assuming 128 visible tokens is a complete billing ceiling.

Callable entry: `runtime/admin-actions.ts` -> `runAdminAIConnectivityTest({modelId,companyId,executionId,executeConfirmed})`. Confirmation is false unless explicitly supplied. `diagnostics/ping-test.ts` -> `prepareLiveModelPings()` is side-effect-free. Keep the same execution ID on retries; do not repeat an uncertain paid attempt. Results retain response, actual usage, elapsed time, estimated cost and known failed-attempt evidence without claiming WhatsApp delivery or customer activation. **Neither entry was run against a provider during P3.**

Primary specifications: [OpenAI models](https://developers.openai.com/api/docs/models), [Responses API](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Gemini 3.8 thinking/migration](https://ai.google.dev/gemini-api/docs/latest-model), [Gemini Interactions](https://ai.google.dev/api/interactions-api), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [CBO peg](https://cbo.gov.om/Pages/FixedPeg.aspx). Installed SDK versions remain OpenAI 7.30.0 and Google GenAI 2.28.0; no package upgrade was made.

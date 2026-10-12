import { describe, expect, it, vi } from "vitest";
import { completeInstagramConnection } from "./connection-flow";
import type {
  AttemptBinding, ConnectionPorts, ConnectionProgress, InstagramIdentity, ProviderSuccess,
} from "./connection-contracts";

const identity: InstagramIdentity = { companyId: "company-a", userId: "owner-a", sessionId: "session-a" };
const binding: AttemptBinding = { ...identity, attemptId: "attempt-a", generation: 3, appId: "app-a", contractId: "oauth-contract-a" };
const input = { attemptId: binding.attemptId, state: "synthetic-state", code: "synthetic-code" };
const provider: ProviderSuccess = {
  ok: true, accessToken: "synthetic-access-token",
  evidence: { appId: binding.appId, accountId: "professional-account-a", permissions: ["synthetic-permission"], expiresAt: "2099-01-01T00:00:00Z", contractId: binding.contractId },
};
const reconciliation = { ok: false, code: "RECONCILIATION_REQUIRED" };
const linked = { ok: true, linkId: "public-link-a" };
const staged = (): ConnectionProgress => ({ kind: "vault_staged", binding, stageReceipt: "opaque-stage-a" });
const bound = (): ConnectionProgress => ({ kind: "bound", binding, linkId: "public-link-a" });

/** Port mock only: this test state is NOT a database, durable claim or Vault proof. */
function fixture(initial: ConnectionProgress = { kind: "pending", binding }) {
  let progress = initial;
  const events: string[] = [];
  const readProgress = vi.fn(async () => { events.push("read"); return progress; });
  const claim = vi.fn(async () => {
    events.push("claim");
    if (progress.kind !== "pending") return { kind: "existing" as const, progress };
    progress = { kind: "claimed", binding };
    return { kind: "claimed" as const, committed: true as const, binding };
  });
  const exchange = vi.fn(async () => { events.push("exchange"); return provider; });
  const stage = vi.fn(async () => { events.push("stage"); progress = staged(); return { stageReceipt: "opaque-stage-a" }; });
  const finalize = vi.fn(async () => { events.push("finalize"); progress = bound(); return linked as { ok: true; linkId: string }; });
  const settleClaim = vi.fn(async (_binding: AttemptBinding, outcome: "unknown" | "rejected") => {
    events.push("settle");
    if (progress.kind === "claimed") progress = { kind: outcome, binding };
    return progress;
  });
  const ports: { -readonly [Key in keyof ConnectionPorts]: ConnectionPorts[Key] } = { readProgress, claim, exchange, stage, finalize, settleClaim };
  return { ports, events, readProgress, claim, exchange, stage, finalize, settleClaim,
    get: () => progress, set: (next: ConnectionProgress) => { progress = next; } };
}
const run = (f: ReturnType<typeof fixture>) => completeInstagramConnection(identity, input, binding, f.ports);

describe("Instagram single-use OAuth completion (port-level only)", () => {
  it("call_order_claim_exchange_stage_finalize", async () => {
    const f = fixture(); expect(await run(f)).toEqual(linked);
    expect(f.events).toEqual(["claim", "exchange", "stage", "finalize"]);
    expect(f.claim).toHaveBeenCalledWith(binding, input.state);
    expect(f.exchange).toHaveBeenCalledWith(input.code, binding);
    expect(f.stage).toHaveBeenCalledWith(binding, provider);
    expect(f.finalize).toHaveBeenCalledWith(binding, "opaque-stage-a");
  });
  it("requires_committed_claim_before_exchange", async () => {
    const f = fixture(); f.ports.claim = vi.fn<ConnectionPorts["claim"]>(async () => ({ kind: "claimed", committed: false, binding } as never));
    expect(await run(f)).toEqual(reconciliation); expect(f.exchange).not.toHaveBeenCalled();
  });
  it("claim_response_lost_reads_progress_without_exchange", async () => {
    const f = fixture(); f.ports.claim = vi.fn<ConnectionPorts["claim"]>(async () => { f.set({ kind: "claimed", binding }); throw Error("synthetic lost claim"); });
    expect(await run(f)).toEqual(reconciliation); expect(f.readProgress).toHaveBeenCalledTimes(1); expect(f.exchange).not.toHaveBeenCalled();
  });
  it("claim_response_lost_can_return_durable_bound_without_exchange", async () => {
    const f = fixture(bound()); f.ports.claim = vi.fn<ConnectionPorts["claim"]>(async () => { throw Error("synthetic lost claim"); });
    expect(await run(f)).toEqual(linked); expect(f.readProgress).toHaveBeenCalledTimes(1); expect(f.exchange).not.toHaveBeenCalled();
  });
  it("claim_failure_with_pending_progress_does_not_retry_claim_or_exchange", async () => {
    const f = fixture(); f.ports.claim = vi.fn<ConnectionPorts["claim"]>(async () => { throw Error("synthetic no commit"); });
    expect(await run(f)).toEqual(reconciliation); expect(f.ports.claim).toHaveBeenCalledTimes(1); expect(f.exchange).not.toHaveBeenCalled();
  });
  it("concurrent_existing_claim_never_exchanges", async () => {
    const f = fixture(); const results = await Promise.all([run(f), run(f)]);
    expect(results).toContainEqual(linked); expect(results).toContainEqual(reconciliation);
    expect(f.exchange).toHaveBeenCalledTimes(1); expect(f.stage).toHaveBeenCalledTimes(1);
  });
  it.each(["claimed", "unknown", "rejected", "expired", "cancelled"] as const)("existing_%s_never_exchanges", async kind => {
    const f = fixture({ kind, binding }); expect(await run(f)).toEqual({ ok: false, code: kind === "expired" ? "EXPIRED" : kind === "rejected" || kind === "cancelled" ? "CONSUMED" : "RECONCILIATION_REQUIRED" }); expect(f.exchange).not.toHaveBeenCalled(); expect(f.stage).not.toHaveBeenCalled();
  });
  it("existing_bound_returns_only_stored_public_result", async () => {
    const f = fixture(bound()); expect(await run(f)).toEqual(linked); expect(f.finalize).not.toHaveBeenCalled(); expect(f.exchange).not.toHaveBeenCalled();
  });
  it("existing_vault_staged_can_finalize_without_exchange", async () => {
    const f = fixture(staged()); expect(await run(f)).toEqual(linked); expect(f.exchange).not.toHaveBeenCalled(); expect(f.finalize).toHaveBeenCalledTimes(1);
  });
  it("stage_response_lost_reconciles_vault_staged_without_exchange", async () => {
    const f = fixture(); f.ports.stage = vi.fn<ConnectionPorts["stage"]>(async () => { f.set(staged()); throw Error("synthetic lost stage response"); });
    expect(await run(f)).toEqual(linked); expect(f.exchange).toHaveBeenCalledTimes(1); expect(f.readProgress).toHaveBeenCalledTimes(1); expect(f.finalize).toHaveBeenCalledTimes(1);
  });
  it("stage_crash_without_commit_requires_reconciliation_and_never_reexchanges", async () => {
    const f = fixture(); f.ports.stage = vi.fn<ConnectionPorts["stage"]>(async () => { throw Error("synthetic no stage commit"); });
    expect(await run(f)).toEqual(reconciliation); expect(await run(f)).toEqual(reconciliation);
    expect(f.exchange).toHaveBeenCalledTimes(1); expect(f.finalize).not.toHaveBeenCalled();
  });
  it("finalize_response_lost_returns_durable_bound_result", async () => {
    const f = fixture(); f.ports.finalize = vi.fn<ConnectionPorts["finalize"]>(async () => { f.set(bound()); throw Error("synthetic lost finalization"); });
    expect(await run(f)).toEqual(linked); expect(f.exchange).toHaveBeenCalledTimes(1); expect(f.readProgress).toHaveBeenCalledTimes(1);
  });
  it("finalize_crash_reads_once_without_automatic_finalize_retry", async () => {
    const f = fixture(); f.ports.finalize = vi.fn<ConnectionPorts["finalize"]>(async () => { throw Error("synthetic finalize unavailable"); });
    expect(await run(f)).toEqual(reconciliation); expect(f.ports.finalize).toHaveBeenCalledTimes(1); expect(f.readProgress).toHaveBeenCalledTimes(1);
  });
  it("unknown_provider_exchange_requires_new_deliberate_authorization", async () => {
    const f = fixture(); f.ports.exchange = vi.fn<ConnectionPorts["exchange"]>(async () => ({ ok: false, code: "UNKNOWN" }));
    expect(await run(f)).toEqual(reconciliation); expect(await run(f)).toEqual(reconciliation);
    expect(f.ports.exchange).toHaveBeenCalledTimes(1); expect(f.get().kind).toBe("unknown"); expect(f.stage).not.toHaveBeenCalled();
  });
  it("provider_throw_settles_unknown_without_returning_error_or_reexchange", async () => {
    const f = fixture(); f.ports.exchange = vi.fn<ConnectionPorts["exchange"]>(async () => { throw Error("synthetic-access-token synthetic-code synthetic-state"); });
    expect(await run(f)).toEqual(reconciliation); expect(f.get().kind).toBe("unknown"); expect(f.stage).not.toHaveBeenCalled();
  });
  it("provider_rejection_records_consumption_and_never_stages", async () => {
    const f = fixture(); f.ports.exchange = vi.fn<ConnectionPorts["exchange"]>(async () => ({ ok: false, code: "REJECTED" }));
    expect(await run(f)).toEqual({ ok: false, code: "CONSUMED" }); expect(f.get().kind).toBe("rejected"); expect(f.stage).not.toHaveBeenCalled();
  });
  it("unknown_state_cannot_overwrite_completed_state", async () => {
    const f = fixture(); f.ports.exchange = vi.fn<ConnectionPorts["exchange"]>(async () => { f.set(bound()); return { ok: false, code: "UNKNOWN" }; });
    expect(await run(f)).toEqual(linked); expect(f.get().kind).toBe("bound"); expect(f.settleClaim).toHaveBeenCalledWith(binding, "unknown");
  });
  it("unknown_state_cannot_overwrite_durable_vault_stage", async () => {
    const f = fixture(); f.ports.exchange = vi.fn<ConnectionPorts["exchange"]>(async () => { f.set(staged()); return { ok: false, code: "UNKNOWN" }; });
    expect(await run(f)).toEqual(linked); expect(f.get().kind).toBe("bound"); expect(f.finalize).toHaveBeenCalledTimes(1);
  });
  it("settlement_response_lost_reads_current_completed_state", async () => {
    const f = fixture(); f.ports.exchange = vi.fn<ConnectionPorts["exchange"]>(async () => ({ ok: false, code: "UNKNOWN" }));
    f.ports.settleClaim = vi.fn<ConnectionPorts["settleClaim"]>(async () => { f.set(bound()); throw Error("synthetic lost outcome"); });
    expect(await run(f)).toEqual(linked); expect(f.readProgress).toHaveBeenCalledTimes(1);
  });
  it.each(["companyId", "userId", "sessionId"] as const)("mismatched_identity_%s_never_claims", async key => {
    const f = fixture(); expect(await completeInstagramConnection({ ...identity, [key]: "different" }, input, binding, f.ports)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(f.claim).not.toHaveBeenCalled(); expect(f.exchange).not.toHaveBeenCalled();
  });
  it.each(["companyId", "userId", "sessionId", "attemptId", "appId", "contractId", "generation"] as const)("mismatched_claim_binding_%s_never_exchanges_or_stages", async key => {
    const f = fixture(); f.ports.claim = vi.fn<ConnectionPorts["claim"]>(async () => ({ kind: "claimed", committed: true, binding: { ...binding, [key]: key === "generation" ? 4 : "different" } }));
    expect(await run(f)).toEqual({ ok: false, code: "FORBIDDEN" }); expect(f.exchange).not.toHaveBeenCalled(); expect(f.stage).not.toHaveBeenCalled();
  });
  it("mismatched_identity_or_generation_never_stages", async () => {
    const f = fixture(); f.ports.claim = vi.fn<ConnectionPorts["claim"]>(async () => ({ kind: "existing", progress: { ...staged(), binding: { ...binding, generation: 4 } } }));
    expect(await run(f)).toEqual({ ok: false, code: "FORBIDDEN" }); expect(f.stage).not.toHaveBeenCalled(); expect(f.finalize).not.toHaveBeenCalled();
  });
  it("read_progress_from_another_tenant_never_returns_its_link", async () => {
    const f = fixture(); f.ports.claim = vi.fn<ConnectionPorts["claim"]>(async () => { throw Error("synthetic lost claim"); });
    f.ports.readProgress = vi.fn<ConnectionPorts["readProgress"]>(async () => ({ ...bound(), binding: { ...binding, companyId: "company-b" } }));
    expect(await run(f)).toEqual({ ok: false, code: "FORBIDDEN" }); expect(f.exchange).not.toHaveBeenCalled();
  });
  it.each([
    { appId: "wrong-app" }, { contractId: "wrong-contract" }, { accountId: "" },
    { permissions: [] }, { permissions: [""] }, { expiresAt: "2000-01-01T00:00:00Z" }, { expiresAt: "invalid" },
  ])("provider_evidence_mismatch_never_stages: %j", async evidence => {
    const f = fixture(); f.ports.exchange = vi.fn<ConnectionPorts["exchange"]>(async () => ({ ...provider, evidence: { ...provider.evidence, ...evidence } }));
    expect(await run(f)).toEqual({ ok: false, code: "FORBIDDEN" }); expect(f.stage).not.toHaveBeenCalled(); expect(f.get().kind).toBe("rejected");
  });
  it("finalize_denial_never_reports_linked", async () => {
    const f = fixture(); f.ports.finalize = vi.fn<ConnectionPorts["finalize"]>(async () => ({ ok: false, code: "FORBIDDEN" }));
    expect(await run(f)).toEqual({ ok: false, code: "FORBIDDEN" }); expect(f.get().kind).toBe("vault_staged");
  });
  it("owner_revocation_or_generation_change_during_staging_blocks_finalize", async () => {
    const f = fixture(); f.ports.stage = vi.fn<ConnectionPorts["stage"]>(async () => ({ ok: false, code: "FORBIDDEN" }));
    expect(await run(f)).toEqual({ ok: false, code: "FORBIDDEN" }); expect(f.finalize).not.toHaveBeenCalled();
  });
  it("account_uniqueness_failure_at_finalize_never_reports_linked", async () => {
    const f = fixture(); f.ports.finalize = vi.fn<ConnectionPorts["finalize"]>(async () => ({ ok: false, code: "CONSUMED" }));
    expect(await run(f)).toEqual({ ok: false, code: "CONSUMED" }); expect(f.get().kind).toBe("vault_staged");
  });
  it("finalize_ambiguous_result_reconciles_completed_commit", async () => {
    const f = fixture(); f.ports.finalize = vi.fn<ConnectionPorts["finalize"]>(async () => { f.set(bound()); return { ok: false, code: "RECONCILIATION_REQUIRED" }; });
    expect(await run(f)).toEqual(linked); expect(f.readProgress).toHaveBeenCalledTimes(1);
  });
  it("results_and_diagnostics_exclude_secrets", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    try {
      const f = fixture(); f.ports.finalize = vi.fn<ConnectionPorts["finalize"]>(async () => ({ ...linked, accessToken: provider.accessToken, stageReceipt: "opaque-stage-a", code: input.code, state: input.state } as never));
      const result = await run(f); expect(result).toEqual(linked);
      const data = JSON.stringify(result); for (const secret of [provider.accessToken, "opaque-stage-a", input.code, input.state]) expect(data).not.toContain(secret);
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally { for (const log of logs) log.mockRestore(); }
  });
  it("port_failure_codes_are_allowlisted_not_raw_error_messages", async () => {
    const f = fixture(); f.ports.finalize = vi.fn<ConnectionPorts["finalize"]>(async () => ({ ok: false, code: provider.accessToken } as never));
    expect(await run(f)).toEqual(reconciliation);
  });
  it.each([{ state: "" }, { code: " " }, { attemptId: "" }])("invalid_completion_input_never_claims: %j", async changes => {
    const f = fixture(); expect(await completeInstagramConnection(identity, { ...input, ...changes }, binding, f.ports)).toEqual({ ok: false, code: "INVALID_INPUT" }); expect(f.claim).not.toHaveBeenCalled();
  });
  it("mismatched_completion_attempt_never_claims", async () => {
    const f = fixture(); expect(await completeInstagramConnection(identity, { ...input, attemptId: "attempt-b" }, binding, f.ports)).toEqual({ ok: false, code: "FORBIDDEN" }); expect(f.claim).not.toHaveBeenCalled();
  });
  it("caller_mutation_does_not_change_captured_identity_code_or_generation", async () => {
    const f = fixture(), scope = { ...binding }, callback = { ...input };
    f.ports.claim = vi.fn<ConnectionPorts["claim"]>(async captured => { scope.generation = 44; callback.code = "changed-code"; return { kind: "claimed", committed: true, binding: captured }; });
    expect(await completeInstagramConnection(identity, callback, scope, f.ports)).toEqual(linked);
    expect(f.exchange).toHaveBeenCalledWith(input.code, binding);
    expect(f.stage).toHaveBeenCalledWith(binding, provider);
  });
  it("empty_provider_token_never_stages", async () => {
    const f = fixture(); f.ports.exchange = vi.fn<ConnectionPorts["exchange"]>(async () => ({ ...provider, accessToken: "" }));
    expect(await run(f)).toEqual({ ok: false, code: "FORBIDDEN" }); expect(f.stage).not.toHaveBeenCalled();
  });
  it("invalid_stage_receipt_reads_once_and_never_finalizes_unproven_stage", async () => {
    const f = fixture(); f.ports.stage = vi.fn<ConnectionPorts["stage"]>(async () => ({ stageReceipt: "" }));
    expect(await run(f)).toEqual(reconciliation); expect(f.readProgress).toHaveBeenCalledTimes(1); expect(f.finalize).not.toHaveBeenCalled();
  });
  it("throwing_claim_result_getter_cannot_escape_secret_error", async () => {
    const f = fixture(); f.ports.claim = vi.fn<ConnectionPorts["claim"]>(async () => ({ kind: "claimed", committed: true, get binding(): never { throw Error(provider.accessToken); } }));
    expect(await run(f)).toEqual(reconciliation); expect(f.exchange).not.toHaveBeenCalled();
  });
  it("throwing_provider_evidence_getter_cannot_escape_secret_error", async () => {
    const f = fixture(); f.ports.exchange = vi.fn<ConnectionPorts["exchange"]>(async () => ({ ok: true, accessToken: provider.accessToken, get evidence(): never { throw Error(provider.accessToken); } }));
    expect(await run(f)).toEqual(reconciliation); expect(f.stage).not.toHaveBeenCalled();
  });
  it("throwing_existing_progress_getter_cannot_escape_async_secret_error", async () => {
    const f = fixture(bound()); f.ports.claim = vi.fn<ConnectionPorts["claim"]>(async () => ({ kind: "existing", progress: { kind: "bound", binding, get linkId(): never { throw Error(provider.accessToken); } } }));
    expect(await run(f)).toEqual(reconciliation); expect(f.exchange).not.toHaveBeenCalled();
  });
  it("unavailable_reconciliation_read_returns_fixed_safe_failure_once", async () => {
    const f = fixture(); f.ports.claim = vi.fn<ConnectionPorts["claim"]>(async () => { throw Error("synthetic lost response"); }); f.ports.readProgress = vi.fn<ConnectionPorts["readProgress"]>(async () => { throw Error(provider.accessToken); });
    expect(await run(f)).toEqual(reconciliation); expect(f.ports.readProgress).toHaveBeenCalledTimes(1); expect(f.exchange).not.toHaveBeenCalled();
  });
});

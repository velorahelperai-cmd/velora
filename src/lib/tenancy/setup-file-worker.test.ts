import { expect, it, vi } from "vitest";
import { runSetupFileDeletion } from "./setup-file-worker";
const companyId = "e1000000-0000-4000-8000-000000000201", sourceId = "e1000000-0000-4000-8000-000000000301";
const claim = { jobId: "j1", claimToken: "c1", bucket: "company-knowledge", path: `${companyId}/${sourceId}/setup/e1000000-0000-4000-8000-000000000401/file.pdf`, objectId: "o1", objectUpdatedAt: "2026-10-14T00:00:00Z" };
it("unconfigured deletion makes zero storage calls", async () => {
  const storage = { inspect: vi.fn(), remove: vi.fn() };
  const db = { claim: async () => ({ ok: false as const, code: "LEGAL_POLICY_UNCONFIGURED" }), finish: vi.fn() };
  expect(await runSetupFileDeletion(db, storage)).toMatchObject({ ok: false, code: "LEGAL_POLICY_UNCONFIGURED" });
  expect(storage.remove).not.toHaveBeenCalled(); expect(storage.inspect).not.toHaveBeenCalled();
});
it("a changed object generation is escalated rather than deleting replacement bytes", async () => {
  const storage = { inspect: async () => ({ id: "replacement", updatedAt: claim.objectUpdatedAt }), remove: vi.fn() };
  const outcomes: string[] = [];
  const db = { claim: async () => ({ ok: true as const, claim }), finish: async (_job: string, _token: string, outcome: string) => { outcomes.push(outcome); return true; } };
  expect(await runSetupFileDeletion(db, storage)).toMatchObject({ ok: false, code: "OBJECT_GENERATION_CHANGED" });
  expect(storage.remove).not.toHaveBeenCalled(); expect(outcomes).toEqual(["generation_conflict"]);
});
it("removal success is not reported complete until absence is verified", async () => {
  const outcomes: string[] = [];
  const db = { claim: async () => ({ ok: true as const, claim }), finish: async (_job: string, _token: string, outcome: string) => { outcomes.push(outcome); return true; } };
  const storage = { inspect: async () => ({ id: claim.objectId, updatedAt: claim.objectUpdatedAt }), remove: async () => {} };
  expect(await runSetupFileDeletion(db, storage)).toMatchObject({ ok: false, code: "ABSENCE_NOT_VERIFIED" });
  expect(outcomes).toEqual(["retry"]);
});
it("a retry finding confirmed absence finishes idempotently without another removal", async () => {
  const outcomes: string[] = []; const remove = vi.fn();
  const db = { claim: async () => ({ ok: true as const, claim }), finish: async (_job: string, _token: string, outcome: string) => { outcomes.push(outcome); return true; } };
  expect(await runSetupFileDeletion(db, { inspect: async () => null, remove })).toMatchObject({ ok: true, deleted: true });
  expect(remove).not.toHaveBeenCalled(); expect(outcomes).toEqual(["absent"]);
});
it("trusted paid-retention claims can delete an attested legacy company/source path", async () => {
  const c = { ...claim, path: `${companyId}/${sourceId}/legacy.pdf`, companyId, sourceId, reason: "paid_retention", pathBindingVerified: true };
  const db = { claim: async () => ({ ok: true as const, claim: c }), finish: async () => true };
  expect(await runSetupFileDeletion(db, { inspect: async () => null, remove: vi.fn() })).toMatchObject({ ok: true, deleted: true });
});
it.each([{ path: `${companyId}/${sourceId}/legacy.pdf` }, { path: `e1000000-0000-4000-8000-000000000202/${sourceId}/legacy.pdf`, pathBindingVerified: true }, { path: `${companyId}/${sourceId}/../secret`, pathBindingVerified: true }, { path: `${companyId}/${sourceId}/%2e%2e/secret`, pathBindingVerified: true }])("rejects foreign, traversing or unattested legacy claims before any Storage access", async patch => {
  const c = { ...claim, companyId, sourceId, reason: "paid_retention", ...patch };
  const storage = { inspect: vi.fn(), remove: vi.fn() };
  const db = { claim: async () => ({ ok: true as const, claim: c }), finish: async () => true };
  expect(await runSetupFileDeletion(db, storage)).toMatchObject({ ok: false, code: "INVALID_DELETION_SCOPE" });expect(storage.inspect).not.toHaveBeenCalled();expect(storage.remove).not.toHaveBeenCalled();
});

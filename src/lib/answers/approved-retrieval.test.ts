import { describe, expect, it, vi } from "vitest";
import { loadApprovedAnswerContext, verifyAnswerCitationsStillValid } from "./context";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => { throw Error("inject client"); } }));
const binding = { question: "espresso price", jobId: "job-a", claimToken: "claim-a" };
const source = (over: Record<string, unknown> = {}) => ({
  id: "espresso", company_id: "company-a", title: "Espresso prices", content: "Espresso costs 1.200 OMR.",
  content_version: 3, approved_version: 3, approved_for_answers: true, status: "ready", kind: "text",
  storage_path: null, byte_size: null, updated_at: "2026-10-08T10:00:00Z", usage_role: "knowledge", ...over,
});
function client(data: unknown, objectRows: unknown[] = []) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  const from = vi.fn(() => { throw Error("retrieval must not fetch the tenant corpus"); });
  const list = vi.fn().mockResolvedValue({ data: objectRows, error: null });
  return { rpc, from, storage: { from: () => ({ list }) }, list };
}
const retrieved = (sources: unknown[]) => ({ ok: true, company_id: "company-a", job_id: "job-a", sources });

describe("claimed approved retrieval", () => {
  it("uses the claimed bounded query and preserves full source text, roles and original versions", async () => {
    const style = source({ id: "style", title: "Business voice", content: "Use concise replies.", content_version: 8, approved_version: 8, usage_role: "business_instructions" });
    const db = client(retrieved([style, source()]));
    const packed = await loadApprovedAnswerContext("company-a", db as never, binding);
    expect(packed).toMatchObject({ ok: true, chunks: [{ sourceId: "style", contentVersion: 8, text: "Use concise replies.", usageRole: "business_instructions" }, { sourceId: "espresso", contentVersion: 3, text: "Espresso costs 1.200 OMR." }] });
    expect(db.rpc).toHaveBeenCalledWith("whatsapp_retrieve_approved_knowledge", { p_company_id: "company-a", p_job_id: "job-a", p_claim_token: "claim-a", p_question: "espresso price" });
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each([
    ["other tenant", retrieved([source({ company_id: "company-b" })])],
    ["other job", { ...retrieved([source()]), job_id: "job-b" }],
    ["unapproved source", retrieved([source({ approved_for_answers: false })])],
    ["changed version", retrieved([source({ approved_version: 2 })])],
    ["unknown role", retrieved([source({ usage_role: "system_override" })])],
  ])("fails closed for %s", async (_name, data) => {
    expect(await loadApprovedAnswerContext("company-a", client(data) as never, binding)).toMatchObject({ ok: false });
  });
  it("does not truncate an oversized price or policy source", async () => {
    const db = client(retrieved([source({ content: "P".repeat(12001) })]));
    expect(await loadApprovedAnswerContext("company-a", db as never, binding)).toEqual({ ok: false, code: "CONTEXT_OVERFLOW" });
  });
  it("keeps database overflow and no-match failures closed", async () => {
    for (const code of ["CONTEXT_OVERFLOW", "NO_KNOWLEDGE"] as const) {
      expect(await loadApprovedAnswerContext("company-a", client({ ok: false, code }) as never, binding)).toEqual({ ok: false, code });
    }
  });
  it("rejects style-only context for a question with no knowledge match", async () => {
    const db = client(retrieved([source({ usage_role: "business_instructions" })]));
    expect(await loadApprovedAnswerContext("company-a", db as never, binding)).toEqual({ ok: false, code: "NO_KNOWLEDGE" });
  });
  it("rejects a retrieved file after its object was replaced", async () => {
    const db = client(retrieved([source({ kind: "file", storage_path: "company-a/espresso/menu.pdf", byte_size: 50 })]), [{ name: "menu.pdf", updated_at: "2026-10-08T11:00:00Z", metadata: { size: 50 } }]);
    expect(await loadApprovedAnswerContext("company-a", db as never, binding)).toEqual({ ok: false, code: "APPROVAL_INCOMPLETE" });
  });
  it("does not silently drop an invalid instruction file and answer without the approved voice", async () => {
    const db = client(retrieved([source(), source({ id: "style", usage_role: "business_instructions", kind: "file", storage_path: "company-a/style/voice.pdf", byte_size: 50 })]));
    expect(await loadApprovedAnswerContext("company-a", db as never, binding)).toEqual({ ok: false, code: "APPROVAL_INCOMPLETE" });
  });
  it("rejects revoked instruction citations before delivery", async () => {
    const chain = { eq: () => chain, in: async () => ({ data: [source({ approved_for_answers: false })], error: null }) };
    const db = { from: () => ({ select: () => chain }) };
    expect(await verifyAnswerCitationsStillValid("company-a", [{ sourceId: "espresso", title: "Espresso prices", text: "Espresso costs 1.200 OMR.", contentVersion: 3, usageRole: "business_instructions" }], db as never)).toBe(false);
  });
});

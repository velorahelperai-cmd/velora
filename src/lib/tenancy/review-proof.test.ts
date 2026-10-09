import { describe, expect, it, vi } from "vitest";
import { prepareReviewProof } from "./review-proof";
import { reviewFailureMessage } from "./review-ui";

describe("G03 server proof orchestration", () => {
  it("cannot accept a browser readiness flag without a database snapshot and server completion", async () => {
    const begin = vi.fn(async () => ({ data: { ok: false, code: "KNOWLEDGE_INCOMPLETE" }, error: null }));
    const complete = vi.fn();
    const result = await prepareReviewProof({ rpc: begin }, { rpc: complete }, { action: "submit", companyId: "company-a", ready: true });
    expect(result).toEqual({ ok: false, code: "KNOWLEDGE_INCOMPLETE" });
    expect(complete).not.toHaveBeenCalled();
  });
  it("completes a text-only snapshot without a model, Meta, payment or Storage call", async () => {
    const begin = vi.fn(async () => ({ data: { ok: true, check_id: "check-a", files: [] }, error: null }));
    const complete = vi.fn(async () => ({ data: { ok: true }, error: null }));
    expect(await prepareReviewProof({ rpc: begin }, { rpc: complete }, { action: "submit", companyId: "company-a", ready: true })).toEqual({ ok: true });
    expect(complete).toHaveBeenCalledWith("g03_complete_review_check", { p_check_id: "check-a", p_observations: [] });
  });
  it("fails closed when service persistence or the snapshot reader is unavailable", async () => {
    const begin = vi.fn(async () => ({ data: null, error: { message: "database failed" } }));
    expect(await prepareReviewProof({ rpc: begin }, null, { action: "approve", companyId: "company-a" })).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(begin).not.toHaveBeenCalled();
    expect(await prepareReviewProof({ rpc: begin }, { rpc: vi.fn() }, { action: "approve", companyId: "company-a" })).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("keeps a revision conflict distinct from missing readiness and avoids exposing raw errors", async () => {
    const begin = vi.fn(async () => ({ data: { ok: false, code: "CONFLICT" }, error: null }));
    expect(await prepareReviewProof({ rpc: begin }, { rpc: vi.fn() }, { action: "approve", companyId: "company-a", expectedRevision: 1 })).toEqual({ ok: false, code: "CONFLICT" });
    expect(reviewFailureMessage("FILE_REPREPARE_REQUIRED", "ar")).toContain("إعادة تجهيز");
    expect(reviewFailureMessage("sk-secret", "ar")).not.toContain("sk-secret");
  });
});

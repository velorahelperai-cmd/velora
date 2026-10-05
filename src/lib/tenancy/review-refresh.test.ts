import { describe, expect, it } from "vitest";
import { resolveReviewRefresh } from "./review-refresh";

type Review = { revision: number; status: string };

const review: Review = { revision: 3, status: "pending_review" };

describe("resolveReviewRefresh", () => {
  it("adopts a server row when the read succeeds", () => {
    expect(resolveReviewRefresh<Review>({ ok: true, data: review })).toEqual({
      kind: "adopt",
      review,
    });
  });

  it("clears the snapshot when a successful read returns no row", () => {
    expect(resolveReviewRefresh<Review>({ ok: true, data: null })).toEqual({ kind: "cleared" });
  });

  it("keeps the snapshot when the read fails", () => {
    expect(resolveReviewRefresh<Review>({ ok: false })).toEqual({ kind: "keep_snapshot" });
  });
});

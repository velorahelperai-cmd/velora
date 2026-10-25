import { describe, expect, it } from "vitest";
import { accountPrepExpiresAt } from "./account-prep-draft";

describe("account prep draft expiry policy", () => {
  it("fixes retention from created_at and never extends on visit", () => {
    const created = new Date(Date.UTC(2026, 9, 25, 10, 30, 0));
    const first = accountPrepExpiresAt(created);
    const laterVisit = new Date(Date.UTC(2026, 10, 1, 10, 30, 0));
    // Policy: expiry is computed from created_at only — a later visit must not change it.
    expect(accountPrepExpiresAt(created).toISOString()).toBe(first.toISOString());
    expect(laterVisit.getTime()).toBeLessThan(first.getTime());
    expect(first.toISOString()).toBe("2027-02-25T10:30:00.000Z");
  });
});

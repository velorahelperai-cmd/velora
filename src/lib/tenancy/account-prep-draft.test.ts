import { describe, expect, it } from "vitest";
import {
  accountPrepDraftFromRow,
  accountPrepExpiresAt,
  accountPrepPayloadToFormState,
  mergeAccountPrepDraftPayload,
  parseAccountPrepDraftPatch,
  preparationToAccountPrepPatch,
} from "./account-prep-draft";
import { emptyPreparation } from "./prepayment-preparation";

describe("account prep draft contract", () => {
  it("rejects unknown keys and accepts a field allowlist patch", () => {
    expect(parseAccountPrepDraftPatch({ name: "Cafe", forged: true })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(parseAccountPrepDraftPatch({ name: "Cafe", goals: ["support"], whatsappExisting: "yes" })).toEqual({
      ok: true,
      value: { name: "Cafe", goals: ["support"], whatsappExisting: "yes" },
    });
  });

  it("merges partial updates without inventing omitted fields", () => {
    expect(mergeAccountPrepDraftPayload({ name: "A", city: "Muscat" }, { city: "Salalah", goals: ["sales"] })).toEqual({
      name: "A",
      city: "Salalah",
      goals: ["sales"],
    });
  });

  it("clamps four calendar months at month ends and does not use visit extension", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31, 12, 0, 0));
    const expires = accountPrepExpiresAt(jan31);
    expect(expires.toISOString()).toBe("2026-05-31T12:00:00.000Z");
    const may31 = new Date(Date.UTC(2026, 4, 31, 8, 0, 0));
    expect(accountPrepExpiresAt(may31).toISOString()).toBe("2026-09-30T08:00:00.000Z");
  });

  it("maps preparation to patch and back without dropping branches", () => {
    const preparation = emptyPreparation();
    preparation.name = "Studio";
    preparation.country = "OM";
    preparation.city = "Muscat";
    preparation.phone = "+96891234567";
    preparation.type = "retail";
    preparation.branches = [{ name: "Main", city: "Muscat", contactPhone: "+96891111111" }];
    const patch = preparationToAccountPrepPatch({
      preparation,
      website: { kind: "none" },
      whatsappExisting: "no",
      goals: ["support", "orders"],
    });
    const restored = accountPrepPayloadToFormState(patch);
    expect(restored.preparation.name).toBe("Studio");
    expect(restored.website).toEqual({ kind: "none" });
    expect(restored.whatsappExisting).toBe("no");
    expect(restored.goals).toEqual(["support", "orders"]);
    expect(restored.preparation.branches[0]?.name).toBe("Main");
  });

  it("rejects forged account rows and accepts a matching receipt shape", () => {
    const row = {
      draft_id: "11111111-1111-4111-8111-111111111111",
      account_id: "22222222-2222-4222-8222-222222222222",
      payload: { name: "X" },
      version: 1,
      state: "active",
      created_at: "2026-10-25T00:00:00.000Z",
      updated_at: "2026-10-25T00:00:00.000Z",
      expires_at: "2027-02-25T00:00:00.000Z",
    };
    expect(accountPrepDraftFromRow(row, "33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(accountPrepDraftFromRow(row, row.account_id)?.draftId).toBe(row.draft_id);
  });
});

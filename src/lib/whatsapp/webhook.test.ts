import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signatureMatches, splitWebhook, verifyChallenge } from "./webhook";

const secret = "test-app-secret";

function sign(body: string) {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("whatsapp webhook", () => {
  it("returns the challenge only when the verify token matches", () => {
    expect(verifyChallenge({ mode: "subscribe", token: "token", challenge: "abc" }, "token")).toBe("abc");
    expect(verifyChallenge({ mode: "subscribe", token: "wrong", challenge: "abc" }, "token")).toBeNull();
    expect(verifyChallenge({ mode: "other", token: "token", challenge: "abc" }, "token")).toBeNull();
    expect(verifyChallenge({ mode: "subscribe", token: "token", challenge: "abc" }, "")).toBeNull();
  });

  it("rejects a bad signature and accepts the raw-body signature", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    expect(signatureMatches(body, sign(body), secret)).toBe(true);
    expect(signatureMatches(body, sign(`${body} `), secret)).toBe(false);
    expect(signatureMatches(body, "sha256=deadbeef", secret)).toBe(false);
    expect(signatureMatches(body, null, secret)).toBe(false);
  });

  it("keeps customer messages separate from delivery statuses and drops duplicate ids", () => {
    const split = splitWebhook({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: "100" },
            contacts: [{ wa_id: "96890000000", profile: { name: "Sara" } }],
            messages: [
              { id: "wamid.1", from: "96890000000", timestamp: "1710000000", type: "text", text: { body: "مرحبا" } },
              { id: "wamid.1", from: "96890000000", timestamp: "1710000001", type: "text", text: { body: "again" } },
            ],
            statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1710000002", recipient_id: "96890000000" }],
          },
        }],
      }],
    });

    expect(split.messages).toHaveLength(1);
    expect(split.messages[0]?.body).toBe("مرحبا");
    expect(split.messages[0]?.customerName).toBe("Sara");
    expect(split.statuses).toEqual([
      expect.objectContaining({ waMessageId: "wamid.1", status: "delivered", phoneNumberId: "100" }),
    ]);
    expect(split.messages.some((message) => message.body === "delivered")).toBe(false);
  });
});

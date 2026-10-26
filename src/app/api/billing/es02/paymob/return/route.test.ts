import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("Paymob browser return", () => {
  it("discards browser success claims and redirects only to the owned status reader", async () => {
    const id = "12121212-3434-4656-8787-909090909090";
    const response = await GET(new Request(`https://www.velorahelper.com/api/billing/es02/paymob/return?order_id=${id}&success=true&next=https://attacker.example`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://www.velorahelper.com/account/payment/${id}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it.each(["", "foreign", "https://attacker.example"])("rejects malformed order %s", async id => {
    expect((await GET(new Request(`https://www.velorahelper.com/api/billing/es02/paymob/return?order_id=${encodeURIComponent(id)}`))).status).toBe(400);
  });
});

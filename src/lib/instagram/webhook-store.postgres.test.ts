import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createInstagramWebhookPersistence } from "./webhook-store";
import { createInstagramWebhookHandlers } from "./webhook-route";
import type { InstagramRpcClient } from "./connection-store";
// @ts-expect-error Local guarded fixture has no production TypeScript declaration.
import { setup, reset } from "../../../scripts/instagram-ingest/run-postgres.mjs";
// @ts-expect-error Local guarded fixture has no production TypeScript declaration.
import { cleanup, lit, sql } from "../../../scripts/instagram-connection/postgres.mjs";
const secret = "synthetic-parent-secret";
function request(unsupported = false) {
  const body = JSON.stringify({ object: "instagram", entry: [{ id: "100", messaging: [unsupported ? { delivery: { mids: ["unsupported"] } } : { sender: { id: "200" }, recipient: { id: "100" }, timestamp: "opaque", message: { mid: "mid.bridge", text: "synthetic" } }] }] });
  return new Request("http://localhost/api/instagram/webhook", { method: "POST", body, headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(body).digest("hex") } });
}
function fixture(loseFirst = false) {
  let lose = loseFirst;
  const rpc = vi.fn<InstagramRpcClient["rpc"]>(async (name, args) => {
    if (name !== "instagram_ingest_webhook" || Object.keys(args).join() !== "p_batch") throw Error("UNSAFE_LOCAL_RPC");
    const data = JSON.parse(await sql(`set role service_role;select public.instagram_ingest_webhook(${lit(JSON.stringify(args.p_batch))}::jsonb)`));
    // sql() resolves only after its independent autocommit psql process exits.
    if (lose) { lose = false; return { data: null, error: { code: "SYNTHETIC_LOST_COMMIT_RESPONSE" } }; }
    return { data, error: null };
  });
  const persist = createInstagramWebhookPersistence({ rpc });
  return { rpc, ...createInstagramWebhookHandlers({ readReadiness: () => ({ receiveEnabled: true, providerFixtureVerified: true, parentWebhookSecret: { source: "parent_webhook_app", value: secret } }), persist }) };
}
describe.skipIf(process.env.VELORA_IG_INGEST_POSTGRES !== "1")("reviewed route + real isolated SQL commit boundary (synthetic signature/Vault double only)", () => {
  beforeAll(setup); afterAll(cleanup); beforeEach(reset);
  it("acknowledges only after independently visible SQL commit", async () => {
    const f = fixture(), result = await f.POST(request());
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ ok: true, disposition: "persisted", eventCount: 1, ignored: {} });
    expect(await sql("select count(*) from private.instagram_messages")).toBe("1"); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("lost committed response is retryable and provider retry never duplicates", async () => {
    const f = fixture(true);
    expect((await f.POST(request())).status).toBe(503); expect(await sql("select count(*) from private.instagram_messages")).toBe("1");
    expect((await f.POST(request())).status).toBe(200); expect(await sql("select message_count from private.instagram_conversations")).toBe("1"); expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it("concurrent route redelivery yields one durable message", async () => {
    const f = fixture(), responses = await Promise.all([f.POST(request()), f.POST(request())]);
    expect(responses.map(r => r.status)).toEqual([200, 200]); expect(await sql("select count(*) from private.instagram_messages")).toBe("1");
  });
  it("signed unsupported evidence is acknowledged explicitly without DB call", async () => {
    const f = fixture(), response = await f.POST(request(true));
    expect(await response.json()).toEqual({ ok: true, disposition: "ignored", ignored: { UNSUPPORTED_EVENT: 1 } });
    expect(f.rpc).not.toHaveBeenCalled(); expect(await sql("select count(*) from private.instagram_messages")).toBe("0");
  });
  it("storage fault rolls back and returns fixed retryable response", async () => {
    await sql("create function private.ig_ingest_bridge_fault() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_PRIVATE_FAULT';end;$$;create trigger ig_ingest_bridge_fault before insert on private.instagram_messages for each row execute function private.ig_ingest_bridge_fault()");
    try {
      const f = fixture(), response = await f.POST(request());
      expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "PERSISTENCE_UNAVAILABLE" });
      expect(await sql("select count(*) from private.instagram_messages")).toBe("0"); expect(await sql("select count(*) from private.instagram_conversations")).toBe("0");
      expect(f.rpc).toHaveBeenCalledTimes(1);
    } finally { await sql("drop trigger ig_ingest_bridge_fault on private.instagram_messages;drop function private.ig_ingest_bridge_fault()"); }
  });
});

import { describe, expect, it, vi } from "vitest";
import { observeIngress, type IngressObservation, type IngressObservationPorts } from "./ingress-observation";

// Synthetic HTTP/recorder ports; no database/provider traffic.
function fixture() {
  const events: IngressObservation[] = [];
  const ports: IngressObservationPorts = {
    record: vi.fn(async event => { events.push(event); return true; }),
    diagnostic: vi.fn(), context: vi.fn(async (_ids, run) => run()),
  };
  return { events, ports };
}
describe("HTTP ingress attempt observation", () => {
  it.each([200, 202, 400, 401, 403, 503])("preserves HTTP %s without interpreting business success", async status => {
    const { events, ports } = fixture();
    const response = new Response("unchanged", { status });
    expect(await observeIngress("whatsapp", async () => response, ports)).toBe(response);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ source: "whatsapp", stage: "started", httpStatus: null, durationMs: null });
    expect(events[1]).toMatchObject({ stage: "finished", httpStatus: status, requestId: events[0].requestId, traceId: events[0].requestId });
    expect(events[1].durationMs).toBeGreaterThanOrEqual(0);
    expect(events[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("creates independent contexts for concurrent attempts", async () => {
    const { events, ports } = fixture();
    await Promise.all([observeIngress("instagram", async () => new Response(), ports), observeIngress("instagram", async () => new Response(), ports)]);
    expect(new Set(events.map(event => event.requestId)).size).toBe(2);
  });
  it("preserves thrown error without recording its message or retrying handler", async () => {
    const { events, ports } = fixture();
    const error = new Error("sensitive-provider-text");
    const handler = vi.fn(async () => { throw error; });
    await expect(observeIngress("paymob", handler, ports)).rejects.toBe(error);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(events[1]).toMatchObject({ stage: "exception", httpStatus: null });
    expect(JSON.stringify(events)).not.toContain(error.message);
  });
  it("preserves acknowledgement when recording and logging fail", async () => {
    const { ports } = fixture();
    ports.record = vi.fn(async () => { throw Error("store unavailable"); });
    ports.diagnostic = vi.fn(() => { throw Error("logger unavailable"); });
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    expect((await observeIngress("whatsapp", handler, ports)).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ports.record).toHaveBeenCalledTimes(2);
  });
});

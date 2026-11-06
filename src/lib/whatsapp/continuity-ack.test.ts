import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const send = vi.hoisted(() => vi.fn());
vi.mock("./send", () => ({ sendWhatsappText: send }));
import { runContinuityAckWatchdog } from "./continuity-ack";
import { NEUTRAL_ACK_TEXT } from "./response-continuity";

const auth = {
  ok: true, freeform: true, template: false, body: NEUTRAL_ACK_TEXT, service_window_open: true,
  phone_number_id: "123456789", recipient_wa_id: "96890000000", service_window_expires_at: "2026-11-07T00:00:00.000Z",
  link_id: "link", link_generation: 1, company_id: "company",
};
const claim = { id: "intent", claim_token: "claim", response_kind: "ack_v1" };

beforeEach(() => {
  vi.unstubAllEnvs();
  send.mockReset();
  send.mockResolvedValue({ ok: true, waMessageId: "wamid.ack" });
});

describe("continuity ack watchdog", () => {
  it("does not call the database or a sender while the ack gate is closed", async () => {
    const rpc = vi.fn();
    expect(await runContinuityAckWatchdog(rpc, send)).toEqual({ scheduled: 0, claimed: 0, dispatched: 0, code: "ACK_GATE_CLOSED" });
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not claim or send when external send is disabled", async () => {
    vi.stubEnv("WHATSAPP_CONTINUITY_ACK_ENABLED", "true");
    const rpc = vi.fn();
    expect(await runContinuityAckWatchdog(rpc, send)).toMatchObject({ scheduled: 0, claimed: 0, dispatched: 0, code: "SEND_DISABLED" });
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("schedules from persisted inbound then claims one reserved ack without an AI worker claim", async () => {
    vi.stubEnv("WHATSAPP_CONTINUITY_ACK_ENABLED", "true");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    const rpc = vi.fn(async (name: string) => {
      if (name === "whatsapp_claim_continuity_watchdog") {
        return { data: { ok: true, dispatch: false, scheduled: 1, claimed: [claim] }, error: null };
      }
      if (name === "whatsapp_authorize_continuity_ack") return { data: auth, error: null };
      if (name === "whatsapp_read_link_access_secret") return { data: { access_token: "synthetic-token" }, error: null };
      if (name === "whatsapp_finalize_continuity_ack") return { data: { ok: true, phase: "provider_accepted" }, error: null };
      return { data: { ok: true }, error: null };
    });
    expect(await runContinuityAckWatchdog(rpc, send)).toEqual({
      scheduled: 1,
      claimed: 1,
      dispatched: 1,
      code: "COMPLETE",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ body: NEUTRAL_ACK_TEXT, toWaId: "96890000000" });
    expect(rpc.mock.calls.map(call => call[0])).toEqual([
      "whatsapp_claim_continuity_watchdog",
      "whatsapp_authorize_continuity_ack",
      "whatsapp_read_link_access_secret",
      "whatsapp_finalize_continuity_ack",
    ]);
  });

  it("does not send free-form text or a template when the service window is closed", async () => {
    vi.stubEnv("WHATSAPP_CONTINUITY_ACK_ENABLED", "true");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => {
      if (name === "whatsapp_claim_continuity_watchdog") return { data: { ok: true, dispatch: false, scheduled: 0, claimed: [claim] }, error: null };
      if (name === "whatsapp_authorize_continuity_ack") return { data: { ok: false, code: "service_window_closed", template: false, freeform: false }, error: null };
      return { data: { ok: true }, error: null };
    });
    expect(await runContinuityAckWatchdog(rpc, send)).toMatchObject({ scheduled: 0, claimed: 1, dispatched: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(call => call[0])).not.toContain("whatsapp_finalize_continuity_ack");
  });

  it("cancels when ownership/generation fencing rejects the reserved ack", async () => {
    vi.stubEnv("WHATSAPP_CONTINUITY_ACK_ENABLED", "true");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    const rpc = vi.fn(async (name: string) => {
      if (name === "whatsapp_claim_continuity_watchdog") return { data: { ok: true, dispatch: false, scheduled: 1, claimed: [claim] }, error: null };
      if (name === "whatsapp_authorize_continuity_ack") return { data: { ok: false, code: "human_claimed", template: false, freeform: false }, error: null };
      return { data: { ok: true }, error: null };
    });
    expect(await runContinuityAckWatchdog(rpc, send)).toMatchObject({ scheduled: 1, claimed: 1, dispatched: 0, code: "COMPLETE" });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps one claim/send intent path and does not retry an unknown provider result", async () => {
    vi.stubEnv("WHATSAPP_CONTINUITY_ACK_ENABLED", "true");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    send.mockResolvedValueOnce({ ok: false, code: "AMBIGUOUS" });
    const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => {
      if (name === "whatsapp_claim_continuity_watchdog") return { data: { ok: true, dispatch: false, scheduled: 1, claimed: [claim] }, error: null };
      if (name === "whatsapp_authorize_continuity_ack") return { data: auth, error: null };
      if (name === "whatsapp_read_link_access_secret") return { data: { access_token: "synthetic-token" }, error: null };
      return { data: { ok: true }, error: null };
    });
    expect(await runContinuityAckWatchdog(rpc, send)).toMatchObject({ scheduled: 1, claimed: 1, dispatched: 0, code: "SEND_REQUIRES_REVIEW" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ body: NEUTRAL_ACK_TEXT });
    expect(rpc.mock.calls.find(call => call[0] === "whatsapp_finalize_continuity_ack")?.[1]).toMatchObject({ p_result: "unknown", p_wa_message_id: null });
  });

  it("treats ack COMPLETE as independent from AI WORKER_BATCH_BLOCKED outcomes", async () => {
    vi.stubEnv("WHATSAPP_CONTINUITY_ACK_ENABLED", "true");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    const rpc = vi.fn(async (name: string) => {
      if (name === "whatsapp_claim_continuity_watchdog") {
        return { data: { ok: true, dispatch: false, scheduled: 1, claimed: [claim] }, error: null };
      }
      if (name === "whatsapp_authorize_continuity_ack") return { data: auth, error: null };
      if (name === "whatsapp_read_link_access_secret") return { data: { access_token: "synthetic-token" }, error: null };
      return { data: { ok: true }, error: null };
    });
    const ack = await runContinuityAckWatchdog(rpc, send);
    expect(ack).toMatchObject({ scheduled: 1, claimed: 1, dispatched: 1, code: "COMPLETE" });
    // AI batch blocked codes are observed on the worker route, not the ack watchdog.
    expect(ack.code).not.toBe("WORKER_BATCH_BLOCKED");
  });
});

import { beforeEach,afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ rpc: vi.fn(), exchange: vi.fn(),probe:vi.fn() }));
vi.mock('@/lib/whatsapp/embedded-signup-meta',()=>({onboardMetaSignup:state.probe}));
import {openSignupPreparation,sealSignupPreparation} from '@/lib/whatsapp/signup-preparation';
vi.mock("next/headers", () => ({ cookies: async () => ({ set() {}, get: () => undefined }) }));
vi.mock("@/lib/logging/logger.mjs", () => ({ logEvent() {}, withLogContext: async (_ctx: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/auth/server-identity", () => ({ readSessionIdentity: async () => ({ ok: true, userId: "11111111-1111-4111-8111-111111111111", sessionId: "44444444-4444-4444-8444-444444444444" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, auth: { getClaims: async () => ({ data: { claims: { sub: "11111111-1111-4111-8111-111111111111", session_id: "44444444-4444-4444-8444-444444444444" } }, error: null }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/tenancy/paid-branch-connection-adapters", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenancy/paid-branch-connection-adapters")>("@/lib/tenancy/paid-branch-connection-adapters");
  return { ...actual, exchangeOwnedBranchConnection: (...args: unknown[]) => state.exchange(...args) };
});

import {
  cancelOwnedPaidBranchConnectionAction,
  completeOwnedPaidBranchConnectionAction,
  recoverOwnedPaidBranchConnectionAction,
  startOwnedPaidBranchConnectionAction,
  prepareOwnedWhatsappRegistrationAction,
} from "./paid-branch-connection-actions";
import type { CompleteWhatsappCoexistenceInput } from "./paid-branch-connection-contracts";

const scope = {
  expectedAccountId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  branchId: "33333333-3333-4333-8333-333333333333",
  channel: "whatsapp" as const,
};
const attemptId = "55555555-5555-4555-8555-555555555555";
const asOf = "2026-10-20T00:00:00.000000Z";

function connectionRead() {
  return {
    schemaVersion: 1,
    sourceStatus: "ready",
    ...scope,
    asOf,
    revision: "1",
    connection: {
      state: "pending",
      flow: "wa_coexistence",
      attempt: { id: attemptId, generation: 1, expiresAt: "2026-10-20T00:10:00.000000Z", status: "pending" },
      link: null,
      verified: false,
      reasonCodes: [],
    },
  };
}

const followUp = { ...scope, flow: "wa_coexistence" as const, attemptId, generation: 1 };
const completion: CompleteWhatsappCoexistenceInput = {
  attemptId,
  confirmed: true,
  confirmedPhoneNumber: "+96891234567",
  nonce: "a".repeat(64),
  code: "unit-code",
};

function names() {
  return state.rpc.mock.calls.map((call) => call[0]);
}

describe("coexistence actions use the attempt parser and the config gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.exchange.mockResolvedValue({ ok: true, proof: { subscribed: true } });
    state.rpc.mockImplementation(async (name: string) => {
      if (name.endsWith("_claim_owned_branch_connection")) return { data: { ok: true, fresh: true, read: connectionRead(), legacy: {} }, error: null };
      if (name.endsWith("_start_owned_branch_connection")) {
        return { data: { ok: true, read: connectionRead(), launch: { flow: "wa_coexistence", attemptId, nonce: "b".repeat(64), appId: "123456", configId: "654321", graphVersion: "v25.0", confirmedPhoneNumber: "+96891234567" } }, error: null };
      }
      return { data: { ok: true, read: connectionRead() }, error: null };
    });
  });

  it("completes, recovers, and cancels coexistence without start-only phone or confirmation fields", async () => {
    const completed = await completeOwnedPaidBranchConnectionAction({ ...followUp, completion });
    const recovered = await recoverOwnedPaidBranchConnectionAction(followUp);
    const cancelled = await cancelOwnedPaidBranchConnectionAction(followUp);
    expect(completed.ok).toBe(true);
    expect(recovered.ok).toBe(true);
    expect(cancelled.ok).toBe(true);
    expect(names()).toEqual(expect.arrayContaining([
      "es02_b3_claim_owned_branch_connection",
      "es02_b3_recover_owned_branch_connection",
      "es02_b3_cancel_owned_branch_connection",
    ]));
    expect(state.exchange).toHaveBeenCalledOnce();
  });

  it.each([
    ["flag disabled", { WHATSAPP_COEXISTENCE: "false" }],
    ["routing wrong", { WHATSAPP_ROUTING_MODE: "company" }],
    ["equal config id", { WHATSAPP_COEXISTENCE_CONFIG_ID: "111111", WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: "111111" }],
  ])("does not launch when coexistence config is %s", async (_label, overrides) => {
    const keys = ["WHATSAPP_COEXISTENCE", "WHATSAPP_ROUTING_MODE", "WHATSAPP_EMBEDDED_SIGNUP_APP_ID", "WHATSAPP_COEXISTENCE_CONFIG_ID", "WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID", "WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION", "WHATSAPP_APP_SECRET", "WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN"];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      WHATSAPP_COEXISTENCE: "true",
      WHATSAPP_ROUTING_MODE: "tenant_registry",
      WHATSAPP_EMBEDDED_SIGNUP_APP_ID: "123456",
      WHATSAPP_COEXISTENCE_CONFIG_ID: "654321",
      WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: "111111",
      WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION: "v25.0",
      WHATSAPP_APP_SECRET: "unit-test-secret",
      WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN: "unit-test-token",
      ...overrides,
    });
    const started = await startOwnedPaidBranchConnectionAction({
      ...scope,
      flow: "wa_coexistence",
      clientOpId: "66666666-6666-4666-8666-666666666666",
      expectedRevision: "0",
      confirmedPhoneNumber: "+96891234567",
      confirmed: true,
    });
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    expect(started).toMatchObject({ ok: false, code: "setup_required" });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.exchange).not.toHaveBeenCalled();
  });
});

describe('owned registration preparation',()=>{
 const input={...scope,flow:'wa_new_number' as const,attemptId,generation:1,completion:{attemptId,nonce:'a'.repeat(64),code:'one-use-code',wabaId:'222',phoneNumberId:'333',pin:''}};
 beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP','true');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_APP_ID','111');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID','123');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION','v25.0');vi.stubEnv('WHATSAPP_APP_SECRET','test-secret');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN','test-system-token');state.rpc.mockResolvedValue({data:{...connectionRead(),connection:{...connectionRead().connection,flow:'wa_new_number',attempt:{...connectionRead().connection.attempt,expiresAt:'2099-01-01T00:00:00Z'}}},error:null});state.probe.mockImplementation(async(_config,_input,_fetch,options)=>{options.capture('private-token',false);return {ok:false,code:'RECONCILIATION_REQUIRED'};});});
 afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
 it('returns only an encrypted bound ticket after checking the owned pending attempt',async()=>{const result=await prepareOwnedWhatsappRegistrationAction(input);expect(result.ok).toBe(true);if(!result.ok)return;expect(result.registrationRequired).toBe(false);expect(JSON.stringify(result)).not.toContain('private-token');expect(openSignupPreparation('test-secret',result.authorizationTicket,{accountId:scope.expectedAccountId,sessionId:'44444444-4444-4444-8444-444444444444',companyId:scope.companyId,branchId:scope.branchId,attemptId,generation:1,nonce:'a'.repeat(64),wabaId:'222',phoneNumberId:'333'})).toBe('private-token');expect(state.rpc.mock.calls.map(call=>call[0])).toEqual(['es02_b3_read_owned_branch_connection']);});
 it.each(['account','attempt','generation','expired','claimed','source'])('denies %s before exchanging an authorization code',async kind=>{let request=input;if(kind==='account')request={...input,expectedAccountId:'99999999-9999-4999-8999-999999999999'};else {const data={...connectionRead(),connection:{...connectionRead().connection,flow:'wa_new_number',attempt:{...connectionRead().connection.attempt,expiresAt:'2099-01-01T00:00:00Z'}}};if(kind==='attempt')data.connection.attempt.id='99999999-9999-4999-8999-999999999999';if(kind==='generation')data.connection.attempt.generation=2;if(kind==='expired')data.connection.attempt.expiresAt='2000-01-01T00:00:00Z';if(kind==='claimed')data.connection.attempt.status='claimed';state.rpc.mockResolvedValue({data,error:kind==='source'?{message:'offline'}:null});}expect(await prepareOwnedWhatsappRegistrationAction(request)).toEqual({ok:false});expect(state.probe).not.toHaveBeenCalled();});
 it('does not produce a ticket from a failed provider probe',async()=>{state.probe.mockResolvedValue({ok:false,code:'META_UNAVAILABLE'});expect(await prepareOwnedWhatsappRegistrationAction(input)).toEqual({ok:false});});
 it('rejects an expired continuation before any native claim or exchange',async()=>{vi.useFakeTimers();const ticket=sealSignupPreparation('test-secret',{accountId:scope.expectedAccountId,sessionId:'44444444-4444-4444-8444-444444444444',companyId:scope.companyId,branchId:scope.branchId,attemptId,generation:1,nonce:'a'.repeat(64),wabaId:'222',phoneNumberId:'333'},'private-token');vi.advanceTimersByTime(300_001);const result=await completeOwnedPaidBranchConnectionAction({...input,completion:{...input.completion,authorizationTicket:ticket}});expect(result.ok).toBe(false);expect(names()).toEqual(['es02_b3_read_owned_branch_connection']);expect(state.exchange).not.toHaveBeenCalled();});
});

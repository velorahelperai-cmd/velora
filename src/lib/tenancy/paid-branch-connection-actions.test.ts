import { beforeEach,afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ rpc: vi.fn(), exchange: vi.fn(),probe:vi.fn(),early:vi.fn(),log:vi.fn() }));
vi.mock('@/lib/whatsapp/embedded-signup-meta',()=>({onboardMetaSignup:state.probe,exchangeEarlyMetaAuthorization:state.early}));
import {openSignupPreparation,sealSignupPreparation} from '@/lib/whatsapp/signup-preparation';
vi.mock("next/headers", () => ({ cookies: async () => ({ set() {}, get: () => undefined }) }));
vi.mock("@/lib/logging/logger.mjs", () => ({ logEvent:state.log, withLogContext: async (_ctx: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/auth/server-identity", () => ({ readSessionIdentity: async () => ({ ok: true, userId: "11111111-1111-4111-8111-111111111111", sessionId: "44444444-4444-4444-8444-444444444444" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, auth: { getClaims: async () => ({ data: { claims: { sub: "11111111-1111-4111-8111-111111111111", session_id: "44444444-4444-4444-8444-444444444444" } }, error: null }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/tenancy/paid-branch-connection-adapters", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenancy/paid-branch-connection-adapters")>("@/lib/tenancy/paid-branch-connection-adapters");
  return { ...actual, exchangeOwnedBranchConnection: (...args: unknown[]) => state.exchange(...args) };
});

import {
  readOwnedPaidBranchConnectionAction,
  cancelOwnedPaidBranchConnectionAction,
  completeOwnedPaidBranchConnectionAction,
  recoverOwnedPaidBranchConnectionAction,
  startOwnedPaidBranchConnectionAction,
  prepareOwnedWhatsappRegistrationAction,
  captureOwnedWhatsappAuthorizationAction,
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

  it('reads an owned attempt without recovery, claim, completion or provider calls', async () => {
    state.rpc.mockResolvedValue({data:connectionRead(),error:null});
    const read = await readOwnedPaidBranchConnectionAction(scope);
    expect(read.connection.attempt?.status).toBe('pending');
    expect(names().every(name => name === 'es02_b3_read_owned_branch_connection')).toBe(true);
    expect(state.probe).not.toHaveBeenCalled();
    expect(state.exchange).not.toHaveBeenCalled();
  });

  it('reports the expired cancellation flag during an owned read without mutation', async () => {
    vi.stubEnv('VELORA_EXPIRED_WA_CANCEL_ENABLED','true');
    try {
      const current={...connectionRead(),connection:{...connectionRead().connection,flow:'wa_new_number',attempt:{...connectionRead().connection.attempt,expiresAt:'2000-01-01T00:00:00Z'}}};
      state.rpc.mockResolvedValue({data:current,error:null});
      await readOwnedPaidBranchConnectionAction(scope);
      expect(state.log).toHaveBeenCalledWith('info','es02.branch_connection.cancel_flag',{enabled:true});
      expect(names()).toEqual(['es02_b3_read_owned_branch_connection']);
    } finally {vi.unstubAllEnvs();}
  });

  it('logs only bounded local diagnostics and never exposes checkpoint credentials or calls Meta', async () => {
    vi.stubEnv('NODE_ENV','development');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL','http://127.0.0.1:3330');
    try {
      const localScope={...scope,branchId:'a268f9d8-fe5b-41b2-a337-97046a5eaa5c'};
      const read={...connectionRead(),...localScope,connection:{...connectionRead().connection,flow:'wa_new_number'}};
      state.rpc.mockImplementation(async name=>({data:name==='es02_b3_whatsapp_signup_checkpoint'
        ?{ok:true,token:'private-token',nonce:'a'.repeat(64),wabaId:'1',phoneNumberId:'2',appId:'3',configId:'4',graphVersion:'v26.0'}:read,error:null}));
      await readOwnedPaidBranchConnectionAction(localScope);
      expect(names()).toEqual(['es02_b3_read_owned_branch_connection','es02_b3_whatsapp_signup_checkpoint']);
      expect(state.rpc.mock.calls[1]?.[1]?.p_operation).toBe('load');
      expect(state.log).toHaveBeenCalledWith('warn','es02.branch_connection.local_read_diagnostic',expect.objectContaining({attempt_status:'pending',expired:true,checkpoint_availability:'available'}));
      expect(JSON.stringify(state.log.mock.calls)).not.toContain('private-token');
      expect(JSON.stringify(state.log.mock.calls)).not.toContain('a'.repeat(64));
      expect(state.probe).not.toHaveBeenCalled();
      expect(state.exchange).not.toHaveBeenCalled();
    } finally {vi.unstubAllEnvs();}
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
 beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP','true');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_APP_ID','111');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID','123');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION','v25.0');vi.stubEnv('WHATSAPP_APP_SECRET','test-secret');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN','test-system-token');state.rpc.mockResolvedValue({data:{...connectionRead(),connection:{...connectionRead().connection,flow:'wa_new_number',attempt:{...connectionRead().connection.attempt,expiresAt:'2099-01-01T00:00:00Z'}}},error:null});state.early.mockResolvedValue({ok:true,token:'private-token'});state.probe.mockImplementation(async(_config,_input,_fetch,options)=>{options.capture('private-token',false);return {ok:false,code:'RECONCILIATION_REQUIRED'};});});
 afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
 beforeEach(()=>{const data={...connectionRead(),connection:{...connectionRead().connection,flow:'wa_new_number',attempt:{...connectionRead().connection.attempt,expiresAt:'2099-01-01T00:00:00Z'}}};state.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='es02_b3_early_whatsapp_authorization'?{data:{ok:true,acquired:args.p_operation==='reserve',...(args.p_operation==='load'?{token:'private-token'}:{})},error:null}:{data,error:null});});
 it('returns only an encrypted bound ticket after durably reserving and saving the owned attempt',async()=>{const result=await prepareOwnedWhatsappRegistrationAction(input);expect(result.ok).toBe(true);if(!result.ok)return;expect(result.registrationRequired).toBe(false);expect(JSON.stringify(result)).not.toContain('private-token');expect(openSignupPreparation('test-secret',result.authorizationTicket,{accountId:scope.expectedAccountId,sessionId:'44444444-4444-4444-8444-444444444444',companyId:scope.companyId,branchId:scope.branchId,attemptId,generation:1,nonce:'a'.repeat(64),wabaId:'222',phoneNumberId:'333'})).toBe('private-token');expect(state.rpc.mock.calls.map(call=>call[0])).toEqual(['es02_b3_read_owned_branch_connection','es02_b3_early_whatsapp_authorization','es02_b3_early_whatsapp_authorization','es02_b3_early_whatsapp_authorization','es02_b3_early_whatsapp_authorization']);expect(state.rpc.mock.calls[1][1].p_binding).not.toHaveProperty('code');expect(state.rpc.mock.calls[2][1]).toMatchObject({p_operation:'save',p_token:'private-token'});});
 it('does not exchange again if the durable reservation already exists',async()=>{state.rpc.mockImplementation(async(name:string)=>name==='es02_b3_early_whatsapp_authorization'?{data:{ok:true,acquired:false},error:null}:{data:{...connectionRead(),connection:{...connectionRead().connection,flow:'wa_new_number',attempt:{...connectionRead().connection.attempt,expiresAt:'2099-01-01T00:00:00Z'}}},error:null});expect(await prepareOwnedWhatsappRegistrationAction(input)).toEqual({ok:false});expect(state.probe).not.toHaveBeenCalled();});
 it('withholds the ticket if the durable encrypted save fails',async()=>{const previous=state.rpc.getMockImplementation()!;state.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>args.p_operation==='save'?{data:null,error:{code:'offline'}}:previous(name,args));expect(await prepareOwnedWhatsappRegistrationAction(input)).toEqual({ok:false});});
 it.each(['account','attempt','generation','expired','claimed','source'])('denies %s before exchanging an authorization code',async kind=>{let request=input;if(kind==='account')request={...input,expectedAccountId:'99999999-9999-4999-8999-999999999999'};else {const data={...connectionRead(),connection:{...connectionRead().connection,flow:'wa_new_number',attempt:{...connectionRead().connection.attempt,expiresAt:'2099-01-01T00:00:00Z'}}};if(kind==='attempt')data.connection.attempt.id='99999999-9999-4999-8999-999999999999';if(kind==='generation')data.connection.attempt.generation=2;if(kind==='expired')data.connection.attempt.expiresAt='2000-01-01T00:00:00Z';if(kind==='claimed')data.connection.attempt.status='claimed';state.rpc.mockResolvedValue({data,error:kind==='source'?{message:'offline'}:null});}expect(await prepareOwnedWhatsappRegistrationAction(request)).toEqual({ok:false});expect(state.probe).not.toHaveBeenCalled();});
 it('does not produce a ticket from a failed provider probe',async()=>{state.probe.mockResolvedValue({ok:false,code:'META_UNAVAILABLE'});expect(await prepareOwnedWhatsappRegistrationAction(input)).toEqual({ok:false});});
 it('rejects an expired continuation before any native claim or exchange',async()=>{vi.useFakeTimers();const ticket=sealSignupPreparation('test-secret',{accountId:scope.expectedAccountId,sessionId:'44444444-4444-4444-8444-444444444444',companyId:scope.companyId,branchId:scope.branchId,attemptId,generation:1,nonce:'a'.repeat(64),wabaId:'222',phoneNumberId:'333'},'private-token');vi.advanceTimersByTime(300_001);const result=await completeOwnedPaidBranchConnectionAction({...input,completion:{...input.completion,authorizationTicket:ticket}});expect(result.ok).toBe(false);expect(names()).toEqual(['es02_b3_read_owned_branch_connection']);expect(state.exchange).not.toHaveBeenCalled();});
 function recovery(status='pending',checkpointOverride:Record<string,unknown>={}){
  const read={...connectionRead(),connection:{...connectionRead().connection,flow:'wa_new_number',attempt:{...connectionRead().connection.attempt,status,expiresAt:'2099-01-01T00:00:00Z'}}};
  state.rpc.mockImplementation(async(name:string)=>name==='es02_b3_whatsapp_signup_checkpoint'?{data:{ok:true,token:'private-token',nonce:'a'.repeat(64),wabaId:'222',phoneNumberId:'333',appId:'111',configId:'123',graphVersion:'v25.0',...checkpointOverride},error:null}:{data:{ok:true,read},error:null});
  return read;
 }
 it('resumes a pending attempt from the server checkpoint after a fresh page load without code exchange',async()=>{recovery();const result=await recoverOwnedPaidBranchConnectionAction(input);expect(result.ok&&result.continuation).toMatchObject({registrationRequired:false,wabaId:'222',phoneNumberId:'333'});expect(JSON.stringify(result)).not.toContain('private-token');expect(state.probe.mock.calls[0][3]).toMatchObject({token:'private-token',probe:true});expect(state.exchange).not.toHaveBeenCalled();expect(names()).not.toContain('es02_b3_claim_owned_branch_connection');});
 it('reconciles a claimed attempt with GET-only proof and does not issue another provider mutation',async()=>{recovery('claimed');state.probe.mockResolvedValue({ok:false,code:'RECONCILIATION_REQUIRED'});const result=await recoverOwnedPaidBranchConnectionAction(input);expect(result.read.connection.verified).toBe(false);expect(state.probe.mock.calls[0][3]).toEqual({token:'private-token',readOnly:true});expect(names()).not.toContain('es02_b3_finalize_owned_branch_connection');expect(state.exchange).not.toHaveBeenCalled();});
 it('rejects a checkpoint for another Meta application before any provider call',async()=>{recovery('pending',{appId:'999'});await recoverOwnedPaidBranchConnectionAction(input);expect(state.probe).not.toHaveBeenCalled();});
 it('does not allow the legacy PIN-only path to bypass durable preparation',async()=>{const result=await completeOwnedPaidBranchConnectionAction({...input,completion:{...input.completion,pin:'123456'}});expect(result.ok).toBe(false);expect(names()).not.toContain('es02_b3_claim_owned_branch_connection');expect(state.exchange).not.toHaveBeenCalled();});
 it('does not create a native attempt before webhook and checkpoint readiness are configured',async()=>{vi.stubEnv('WHATSAPP_ROUTING_MODE','single_tenant');const result=await startOwnedPaidBranchConnectionAction({...scope,flow:'wa_new_number',clientOpId:'77777777-7777-4777-8777-777777777777',expectedRevision:'1'});expect(result).toMatchObject({ok:false,code:'setup_required'});expect(names()).not.toContain('es02_b3_start_owned_branch_connection');expect(state.probe).not.toHaveBeenCalled();});
 it('starts Embedded Signup without the local GET verification token while retaining readiness gates',async()=>{vi.stubEnv('WHATSAPP_ROUTING_MODE','tenant_registry');vi.stubEnv('WHATSAPP_RECEIVE_ENABLED','true');vi.stubEnv('WHATSAPP_VERIFY_TOKEN','');const read={...connectionRead(),connection:{...connectionRead().connection,flow:'wa_new_number',attempt:{...connectionRead().connection.attempt,expiresAt:'2099-01-01T00:00:00Z'}}};state.rpc.mockImplementation(async(name:string)=>name==='es02_b3_whatsapp_signup_checkpoint'?{data:{ok:true},error:null}:{data:{ok:true,read,launch:{flow:'wa_new_number',attemptId,nonce:'a'.repeat(64),appId:'111',configId:'123',graphVersion:'v25.0'}},error:null});expect(await startOwnedPaidBranchConnectionAction({...scope,flow:'wa_new_number',clientOpId:'77777777-7777-4777-8777-777777777777',expectedRevision:'1'})).toMatchObject({ok:true,launch:{attemptId,flow:'wa_new_number'}});expect(names()).toEqual(['es02_b3_whatsapp_signup_checkpoint','es02_b3_start_owned_branch_connection']);expect(state.probe).not.toHaveBeenCalled();});
 it('does not cancel an attempt after a provider completion claim may have started',async()=>{const current=recovery('claimed');state.rpc.mockResolvedValue({data:current,error:null});expect(await cancelOwnedPaidBranchConnectionAction(input)).toMatchObject({ok:false,code:'reconciliation_required'});expect(names()).not.toContain('es02_b3_cancel_owned_branch_connection');expect(names()).not.toContain('es02_b3_whatsapp_signup_checkpoint');});
 it('recognizes the same confirmed cancelled attempt without another cancellation or provider call',async()=>{const current=recovery('pending');current.connection.attempt.status='cancelled';state.rpc.mockResolvedValue({data:current,error:null});expect(await cancelOwnedPaidBranchConnectionAction(input)).toMatchObject({ok:true,read:{connection:{attempt:{status:'cancelled'}}}});expect(names()).not.toContain('es02_b3_cancel_owned_branch_connection');expect(state.probe).not.toHaveBeenCalled();});
 it('cancels an expired attempt directly and logs no request or provider secrets',async()=>{
  vi.stubEnv('VELORA_EXPIRED_WA_CANCEL_ENABLED','true');
  const current=recovery('pending');current.connection.attempt.expiresAt='2020-01-01T00:00:00Z';
  const cancelled=structuredClone(current);cancelled.connection.attempt.status='cancelled';
  state.rpc.mockImplementation(async(name:string)=>name==='es02_b3_read_owned_branch_connection'?{data:current,error:null}:name==='es02_b3_cancel_expired_unstarted_whatsapp'?{data:{ok:true,read:cancelled},error:null}:{data:{ok:true},error:null});
  expect(await cancelOwnedPaidBranchConnectionAction(input)).toMatchObject({ok:true,read:{connection:{attempt:{status:'cancelled'}}}});
  expect(names()).toContain('es02_b3_cancel_expired_unstarted_whatsapp');expect(names()).not.toContain('es02_b3_cancel_owned_branch_connection');
  expect(state.log).toHaveBeenCalledWith('info','es02.branch_connection.cancel_flag',{enabled:true});
  const logs=JSON.stringify(state.log.mock.calls);expect(logs).not.toContain('one-use-code');expect(logs).not.toContain(attemptId);expect(logs).not.toContain(scope.expectedAccountId);
 });
 it.each(['transport','exception','invalid'])('keeps an unknown %s result unconfirmed without retry',async mode=>{
  vi.stubEnv('VELORA_EXPIRED_WA_CANCEL_ENABLED','true');
  const current=recovery('pending');current.connection.attempt.expiresAt='2020-01-01T00:00:00Z';
  state.rpc.mockImplementation(async(name:string)=>{if(name==='es02_b3_read_owned_branch_connection')return {data:current,error:null};if(mode==='exception')throw Error('private-token');return mode==='transport'?{data:null,error:{message:'private-token'}}:{data:{ok:true,read:current},error:null};});
  expect(await cancelOwnedPaidBranchConnectionAction(input)).toMatchObject({ok:false,code:'source_failed'});
  expect(names().filter(n=>n==='es02_b3_cancel_expired_unstarted_whatsapp')).toHaveLength(1);expect(names()).not.toContain('es02_b3_cancel_owned_branch_connection');expect(JSON.stringify(state.log.mock.calls)).not.toContain('private-token');
 });
 it.each(['disabled','unexpired','generation'])('does not use the expired RPC when %s',async mode=>{
  vi.stubEnv('VELORA_EXPIRED_WA_CANCEL_ENABLED',mode==='disabled'?'false':'true');
  const current=recovery('pending');current.connection.attempt.expiresAt=mode==='unexpired'?'2099-01-01T00:00:00Z':'2020-01-01T00:00:00Z';if(mode==='generation')current.connection.attempt.generation=2;
  state.rpc.mockImplementation(async(name:string)=>name==='es02_b3_read_owned_branch_connection'?{data:current,error:null}:{data:{ok:false,code:'forbidden',read:current},error:null});
  await cancelOwnedPaidBranchConnectionAction(input);expect(names()).not.toContain('es02_b3_cancel_expired_unstarted_whatsapp');
 });
 it('uses the reviewed fallback only when enabled and preserves its refusal',async()=>{
  vi.stubEnv('VELORA_EXPIRED_WA_CANCEL_ENABLED','true');
  const current=recovery('pending');current.connection.attempt.expiresAt='2020-01-01T00:00:00Z';
  state.rpc.mockImplementation(async(name:string)=>name==='es02_b3_read_owned_branch_connection'?{data:current,error:null}:name==='es02_b3_cancel_owned_branch_connection'?{data:{ok:false,code:'forbidden',read:current},error:null}:{data:{ok:false,code:'reconciliation_required'},error:null});
  expect(await cancelOwnedPaidBranchConnectionAction(input)).toMatchObject({ok:false,code:'reconciliation_required'});
  expect(names()).toContain('es02_b3_cancel_expired_unstarted_whatsapp');expect(names()).not.toContain('es02_b3_cancel_owned_branch_connection');expect(state.probe).not.toHaveBeenCalled();
 });
});

describe('early authorization server boundary',()=>{
 const current=()=>({...connectionRead(),connection:{...connectionRead().connection,flow:'wa_new_number',attempt:{...connectionRead().connection.attempt,expiresAt:'2099-01-01T00:00:00Z'}}});
 const input={...scope,attemptId,generation:1,nonce:'a'.repeat(64),code:'synthetic-code'};
 beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP','true');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_APP_ID','111');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID','123');vi.stubEnv('WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION','v25.0');vi.stubEnv('WHATSAPP_APP_SECRET','test-secret');state.early.mockResolvedValue({ok:true,token:'private-token'});state.rpc.mockImplementation(async(name:string,p:Record<string,unknown>)=>({data:name==='es02_b3_early_whatsapp_authorization'?{ok:true,acquired:p.p_operation==='reserve'}:current(),error:null}));});
 afterEach(()=>vi.unstubAllEnvs());
 it('persists code before FINISH without asset IDs or plaintext code in RPC binding',async()=>{expect(await captureOwnedWhatsappAuthorizationAction(input)).toEqual({ok:true});expect(state.early).toHaveBeenCalledTimes(1);const reserve=state.rpc.mock.calls.find(c=>c[1].p_operation==='reserve')![1];expect(reserve.p_binding).toMatchObject({accountId:scope.expectedAccountId,sessionId:'44444444-4444-4444-8444-444444444444',companyId:scope.companyId,branchId:scope.branchId,attemptId,generation:1,appId:'111',configId:'123',nonce:'a'.repeat(64)});expect(reserve.p_binding).not.toHaveProperty('wabaId');expect(JSON.stringify(reserve)).not.toContain('synthetic-code');});
 it.each(['account','expired','generation'])('rejects %s before exchange',async kind=>{if(kind==='expired')state.rpc.mockResolvedValue({data:{...current(),connection:{...current().connection,attempt:{...current().connection.attempt,expiresAt:'2000-01-01T00:00:00Z'}}},error:null});expect(await captureOwnedWhatsappAuthorizationAction({...input,...(kind==='account'?{expectedAccountId:'99999999-9999-4999-8999-999999999999'}:kind==='generation'?{generation:2}:{})})).toEqual({ok:false});expect(state.early).not.toHaveBeenCalled();});
 it('verifies assets using stored token and promotes without re-exchanging code',async()=>{state.rpc.mockImplementation(async(name:string,p:Record<string,unknown>)=>({data:name==='es02_b3_early_whatsapp_authorization'?p.p_operation==='load'?{ok:true,token:'private-token'}:{ok:true,promoted:true}:current(),error:null}));state.probe.mockImplementation(async(_c,_i,_f,o)=>{o.capture('private-token',false);return {ok:false};});const r=await prepareOwnedWhatsappRegistrationAction({...scope,flow:'wa_new_number',attemptId,generation:1,completion:{attemptId,nonce:input.nonce,code:'early-authorization',wabaId:'222',phoneNumberId:'333',pin:''}});expect(r.ok).toBe(true);expect(state.early).not.toHaveBeenCalled();expect(state.probe.mock.calls[0][3]).toMatchObject({token:'private-token',probe:true});expect(state.rpc.mock.calls.some(c=>c[1].p_operation==='promote')).toBe(true);expect(JSON.stringify(r)).not.toContain('private-token');});
 it('does not promote without provider asset proof',async()=>{state.rpc.mockImplementation(async(name:string)=>({data:name==='es02_b3_early_whatsapp_authorization'?{ok:true,token:'private-token'}:current(),error:null}));state.probe.mockResolvedValue({ok:false,code:'META_ASSET_REJECTED'});const r=await prepareOwnedWhatsappRegistrationAction({...scope,flow:'wa_new_number',attemptId,generation:1,completion:{attemptId,nonce:input.nonce,code:'early-authorization',wabaId:'222',phoneNumberId:'333',pin:''}});expect(r).toEqual({ok:false});expect(state.rpc.mock.calls.some(c=>c[1].p_operation==='promote')).toBe(false);});
});

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { cancelInstagramConnection, createInstagramConnectionStore, readInstagramConnectionSecret, startInstagramConnection } from "./connection-store";
import type { InstagramRpcClient } from "./connection-store";
import type { AttemptBinding } from "./connection-contracts";
const binding:AttemptBinding={companyId:"00000000-0000-4000-8000-000000000001",userId:"00000000-0000-4000-8000-000000000011",sessionId:"00000000-0000-4000-8000-000000000021",attemptId:"00000000-0000-4000-8000-000000000031",generation:1,appId:"synthetic-app",contractId:"synthetic-contract"};
function client(data:unknown){return {rpc:vi.fn<InstagramRpcClient["rpc"]>(async()=>({data,error:null}))};}
describe("Instagram committed RPC store adapter",()=>{
 it("hashes_nonce_at_start_without_returning_plaintext",async()=>{
  const rpc=client({ok:true,binding,expiresAt:"2030-01-01T00:00:00Z"});
  const state="a".repeat(64);
  const result=await startInstagramConnection(rpc,{companyId:binding.companyId,attemptId:binding.attemptId,state,appId:binding.appId,contractId:binding.contractId,expectedGeneration:0});
  expect(result).toEqual({ok:true,binding,expiresAt:"2030-01-01T00:00:00Z"});
  expect(rpc.rpc).toHaveBeenCalledWith("instagram_start_connection",{p_company_id:binding.companyId,p_attempt_id:binding.attemptId,p_nonce_hash:createHash("sha256").update(state).digest("hex"),p_app_id:binding.appId,p_contract_id:binding.contractId,p_expected_generation:0});
  expect(JSON.stringify(result)).not.toContain(state);
 });
 it("only_maps_exact_committed_claim_authority",async()=>{
  const session=client({kind:"claimed",committed:true,binding,accessToken:"synthetic-secret"}),server=client(null);
  const store=createInstagramConnectionStore(session,server);
  expect(await store.claim(binding,"b".repeat(64))).toEqual({kind:"claimed",committed:true,binding});
  expect(session.rpc).toHaveBeenCalledWith("instagram_claim_connection",{p_binding:binding,p_nonce:"b".repeat(64)});
  expect(server.rpc).not.toHaveBeenCalled();
 });
 it("throws_fixed_error_for_lost_claim_response",async()=>{
  const session={rpc:vi.fn<InstagramRpcClient["rpc"]>(async()=>{throw Error("synthetic-secret");})};
  await expect(createInstagramConnectionStore(session,client(null)).claim(binding,"b".repeat(64))).rejects.toThrow(/^INSTAGRAM_STORE_UNAVAILABLE$/);
  expect(session.rpc).toHaveBeenCalledTimes(1);
 });
 it.each([null,{kind:"claimed",committed:false,binding},{kind:"claimed",committed:true,binding:{...binding,generation:2}}])("malformed_or_mismatched_claim_never_authorizes_exchange %j",async data=>{
  await expect(createInstagramConnectionStore(client(data),client(null)).claim(binding,"b".repeat(64))).rejects.toThrow(/^INSTAGRAM_STORE_UNAVAILABLE$/);
 });
 it("maps_existing_progress_without_extra_fields",async()=>{
  const session=client({kind:"existing",progress:{kind:"bound",binding,linkId:"00000000-0000-4000-8000-000000000041",secret:"synthetic-secret"}});
  expect(await createInstagramConnectionStore(session,client(null)).claim(binding,"b".repeat(64))).toEqual({kind:"existing",progress:{kind:"bound",binding,linkId:"00000000-0000-4000-8000-000000000041"}});
 });
 it("routes_stage_finalize_settlement_to_server_only",async()=>{
  const session=client(null),server=client({stageReceipt:"00000000-0000-4000-8000-000000000051"});
  const store=createInstagramConnectionStore(session,server);
  const success={ok:true as const,accessToken:"synthetic-secret",evidence:{appId:binding.appId,contractId:binding.contractId,accountId:"synthetic-account",permissions:["synthetic-permission"],expiresAt:"2030-01-01T00:00:00Z"}};
  expect(await store.stage(binding,success)).toEqual({stageReceipt:"00000000-0000-4000-8000-000000000051"});
  expect(server.rpc).toHaveBeenCalledWith("instagram_stage_connection",{p_binding:binding,p_access_token:success.accessToken,p_evidence:success.evidence});
  server.rpc.mockResolvedValue({data:{ok:true,linkId:"00000000-0000-4000-8000-000000000041",secret:"synthetic-secret"},error:null});
  expect(await store.finalize(binding,"00000000-0000-4000-8000-000000000051")).toEqual({ok:true,linkId:"00000000-0000-4000-8000-000000000041"});
  server.rpc.mockResolvedValue({data:{kind:"bound",binding,linkId:"00000000-0000-4000-8000-000000000041"},error:null});
  expect(await store.settleClaim(binding,"unknown")).toEqual({kind:"bound",binding,linkId:"00000000-0000-4000-8000-000000000041"});
  expect(session.rpc).not.toHaveBeenCalled();
 });
 it("allowlists_known_no_effect_denials",async()=>{
  const session=client({ok:false,code:"FORBIDDEN",detail:"synthetic-secret"});
  expect(await createInstagramConnectionStore(session,client(null)).claim(binding,"b".repeat(64))).toEqual({ok:false,code:"FORBIDDEN"});
 });
 it("unknown_failure_codes_and_throwing_getters_never_escape",async()=>{
  for(const data of [{ok:false,code:"synthetic-secret"},{get kind():never{throw Error("synthetic-secret");}}]){
   await expect(createInstagramConnectionStore(client(data),client(null)).claim(binding,"b".repeat(64))).rejects.toThrow(/^INSTAGRAM_STORE_UNAVAILABLE$/);
  }
 });
 it("cancellation_returns_current_bound_progress_and_strips_diagnostics",async()=>{
  const session=client({kind:"bound",binding,linkId:"00000000-0000-4000-8000-000000000041",diagnostic:"synthetic-secret"});
  expect(await cancelInstagramConnection(session,binding)).toEqual({kind:"bound",binding,linkId:"00000000-0000-4000-8000-000000000041"});
  expect(session.rpc).toHaveBeenCalledWith("instagram_cancel_connection",{p_binding:binding});
 });
 it("secret_read_is_explicit_server_internal_and_bound_to_link_account",async()=>{
  const server=client({ok:true,accessToken:"synthetic-secret",diagnostic:"discard"});
  expect(await readInstagramConnectionSecret(server,binding,"00000000-0000-4000-8000-000000000041","synthetic-account")).toEqual({ok:true,accessToken:"synthetic-secret"});
  expect(server.rpc).toHaveBeenCalledWith("instagram_secret_connection",{p_binding:binding,p_link_id:"00000000-0000-4000-8000-000000000041",p_account_id:"synthetic-account"});
 });
 it("local_throwing_binding_getter_never_exposes_raw_error",async()=>{
  const session=client(null);
  const malformed={...binding,get appId():never{throw Error("synthetic-secret");}};
  await expect(createInstagramConnectionStore(session,client(null)).claim(malformed,"b".repeat(64))).rejects.toThrow(/^INSTAGRAM_STORE_UNAVAILABLE$/);
  expect(session.rpc).not.toHaveBeenCalled();
 });
 it("local_throwing_stage_getter_never_exposes_token_error",async()=>{
  const server=client(null);
  const success={ok:true as const,get accessToken():never{throw Error("synthetic-secret");},evidence:{appId:binding.appId,contractId:binding.contractId,accountId:"synthetic-account",permissions:["synthetic-permission"],expiresAt:"2030-01-01T00:00:00Z"}};
  await expect(createInstagramConnectionStore(client(null),server).stage(binding,success)).rejects.toThrow(/^INSTAGRAM_STORE_UNAVAILABLE$/);
  expect(server.rpc).not.toHaveBeenCalled();
 });
});

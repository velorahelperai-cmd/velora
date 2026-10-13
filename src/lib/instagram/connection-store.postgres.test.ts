import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
vi.mock("server-only", () => ({}));
import { completeInstagramConnection } from "./connection-flow";
import { createInstagramConnectionStore, startInstagramConnection } from "./connection-store";
import type { InstagramRpcClient } from "./connection-store";
import type { AttemptBinding, ProviderResult } from "./connection-contracts";
// @ts-expect-error Local Node fixture has no production TypeScript declaration.
import { bootstrap, cleanup, installVaultContractFixture, sql, lit } from "../../../scripts/instagram-connection/postgres.mjs";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const binding: AttemptBinding = { companyId: id(1), userId: id(11), sessionId: id(21), attemptId: id(31), generation: 1, appId: "synthetic-app", contractId: "synthetic-contract" };
const state = "a".repeat(64);
const success: ProviderResult = { ok: true, accessToken: "synthetic-token", evidence: { appId: binding.appId, contractId: binding.contractId, accountId: "synthetic-account", permissions: ["synthetic-permission"], expiresAt: "2030-01-01T00:00:00Z" } };
const startInput = { companyId: binding.companyId, attemptId: binding.attemptId, state, appId: binding.appId, contractId: binding.contractId, expectedGeneration: 0 };
const rpcArgs: Record<string, readonly string[]> = {
 instagram_start_connection: ["p_company_id", "p_attempt_id", "p_nonce_hash", "p_app_id", "p_contract_id", "p_expected_generation"],
 instagram_claim_connection: ["p_binding", "p_nonce"], instagram_read_connection: ["p_binding"],
 instagram_stage_connection: ["p_binding", "p_access_token", "p_evidence"],
 instagram_finalize_connection: ["p_binding", "p_stage_receipt"], instagram_settle_connection: ["p_binding", "p_outcome"],
};
/** Real local SQL commit before RPC resolution; this bridge is not PostgREST or
 * a real Meta/Vault adapter. Vault SQL double is clearly labelled in the runner.
 */
function client(role: "authenticated" | "service_role", loseResponse?: string): InstagramRpcClient {
 return { rpc: async (name, args) => {
  if (!rpcArgs[name]) throw Error("LOCAL_FIXTURE_RPC_NOT_ALLOWED");
  const params = rpcArgs[name].map(k => typeof args[k] === "object" ? `${lit(JSON.stringify(args[k]))}::jsonb` : lit(String(args[k])));
  const claims = role === "authenticated" ? { sub: binding.userId, session_id: binding.sessionId, role } : { role };
  const data = JSON.parse(await sql(`set role ${role};set request.jwt.claims=${lit(JSON.stringify(claims))};select public.${name}(${params.join(",")});`));
  return name === loseResponse ? { data: null, error: { code: "SYNTHETIC_LOST_COMMITTED_RESPONSE" } } : { data, error: null };
 } };
}
describe.skipIf(process.env.VELORA_IG_POSTGRES !== "1")("Instagram adapter + flow with real isolated PostgreSQL and Vault SQL double", () => {
 beforeAll(async () => {
  const migration = "supabase/migrations/" + readdirSync("supabase/migrations").find(n => n.endsWith("_vel_instagram_connection_store.sql"));
  await bootstrap(migration); await installVaultContractFixture();
 });
 afterAll(async () => { await cleanup(); });
 beforeEach(async () => {
  await sql(`truncate private.instagram_oauth_attempts,private.instagram_company_links,private.instagram_company_generations,private.instagram_provider_contracts,private.app_session_activity,public.company_members,public.companies,auth.sessions,auth.users cascade;
   truncate vault.secrets;
   insert into private.instagram_provider_contracts values('synthetic-contract','synthetic-app',array['synthetic-permission'],true);
   insert into auth.users(id,email,email_confirmed_at) values('${binding.userId}','synthetic@example.invalid',now());
   insert into auth.sessions(id,user_id) values('${binding.sessionId}','${binding.userId}');
   insert into public.companies(id,display_name,status) values('${binding.companyId}','Synthetic','active');
   insert into public.company_members(company_id,user_id,role,status) values('${binding.companyId}','${binding.userId}','owner','active');
   insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${binding.sessionId}','${binding.userId}',now());`);
 });
 function flow(session: InstagramRpcClient, server: InstagramRpcClient, exchange: () => Promise<ProviderResult>) {
  // This legacy suite installs only the original OAuth migration; subscription SQL
  // is exercised separately by subscription-checkpoint.postgres.test.ts.
  return completeInstagramConnection(binding, { attemptId: binding.attemptId, state, code: "synthetic-code" }, binding, { ...createInstagramConnectionStore(session, server), exchange, subscribe: async () => ({ok:true}) });
 }
 it("exchange_observes_committed_claim_from_an_independent_database_session", async () => {
  const session = client("authenticated"), server = client("service_role");
  expect((await startInstagramConnection(session, startInput)).ok).toBe(true);
  const exchange = vi.fn(async () => { expect(await sql("select status from private.instagram_oauth_attempts")).toBe("claimed"); return success; });
  expect((await flow(session, server, exchange)).ok).toBe(true); expect(exchange).toHaveBeenCalledTimes(1);
  expect(await sql("select count(*) from private.instagram_company_links where status='active'")).toBe("1");
 });
 it("two_callbacks_and_later_reload_never_exchange_again", async () => {
  const session = client("authenticated"), server = client("service_role"), exchange = vi.fn(async () => success);
  await startInstagramConnection(session, startInput);
  const results = await Promise.all([flow(session, server, exchange), flow(session, server, exchange)]);
  expect(results.some(r => r.ok)).toBe(true); expect(exchange).toHaveBeenCalledTimes(1);
  expect((await flow(session, server, exchange)).ok).toBe(true); expect(exchange).toHaveBeenCalledTimes(1);
 });
 it("lost_committed_claim_response_reads_durable_state_without_exchange", async () => {
  await startInstagramConnection(client("authenticated"), startInput);
  const exchange = vi.fn(async () => success);
  expect(await flow(client("authenticated", "instagram_claim_connection"), client("service_role"), exchange)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" });
  expect(exchange).not.toHaveBeenCalled(); expect(await sql("select status from private.instagram_oauth_attempts")).toBe("claimed");
 });
 it.each(["instagram_stage_connection", "instagram_finalize_connection"])("lost_committed_%s_response_returns_bound_result_without_second_exchange", async lost => {
  const session = client("authenticated"), server = client("service_role", lost), exchange = vi.fn(async () => success);
  await startInstagramConnection(session, startInput);
  expect((await flow(session, server, exchange)).ok).toBe(true); expect(exchange).toHaveBeenCalledTimes(1);
  expect(await sql("select count(*) from private.instagram_company_links")).toBe("1");
  expect(await sql("select count(*) from vault.secrets")).toBe("1");
 });
 it("revocation_after_exchange_blocks_staging_without_secret_write", async () => {
  const session = client("authenticated"), server = client("service_role"); await startInstagramConnection(session, startInput);
  const exchange = vi.fn(async () => { await sql(`update public.company_members set status='disabled' where user_id='${binding.userId}'`); return success; });
  expect(await flow(session, server, exchange)).toEqual({ ok: false, code: "FORBIDDEN" });
  expect(await sql("select count(*) from vault.secrets")).toBe("0");
 });
});

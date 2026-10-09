import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const providers = vi.hoisted(() => ({ model: vi.fn(), send: vi.fn() }));
// These are the only production behavior replacements. Persistence, Auth,
// authorization, retrieval, accounting and worker ports use the actual HTTP SDK.
vi.mock("@/lib/answers/guards", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/answers/guards")>(),
  isLiveAnsweringEnabled: () => true,
}));
vi.mock("@/lib/answers/runtime/provider", () => ({ callRealModel: providers.model }));
vi.mock("./send", () => ({ sendWhatsappText: providers.send }));

import { createAdminClient } from "@/lib/supabase/admin";
import { createIntegrationPorts } from "./integration-store";
import { runInboundWorkerAnswer } from "./inbound-worker";
import { onboardMetaSignup, type MetaSignupConfig, type MetaSignupInput } from "./embedded-signup-meta";
import { finishEmbeddedSignup, type SignupCompletionInput } from "./embedded-signup-flow";
import { createSignupPorts } from "./embedded-signup-store";
import { POST as receiveWebhook } from "@/app/api/whatsapp/webhook/route";
import { buildProcessedObj, signProcessedObj } from "@/lib/billing/paymob/fixtures";
import { verifyAndMapProcessedCallback } from "@/lib/billing/paymob/callback";
import { receivePaymobWebhook } from "@/lib/billing/wiring/webhook-receive";
import { findOrderByProviderOrderId, insertProviderEvent } from "@/lib/billing/wiring/store";
import { observationKeyFromVerified } from "@/lib/billing/wiring/observation-key";
import { buildPaymobHmacSettlementEvidence } from "@/lib/billing/wiring/settlement-bridge";

const enabled = process.env.C1_HTTP_E2E_TESTS === "1";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const databaseName = "c1_ui_integration";
type Row = Record<string, unknown>;
const lit = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw Error(`LOCAL_TEST_ENV_REQUIRED_${name}`);
  return value;
}
function fixtureId(name: string): string {
  const value = required(name);
  if (!uuidPattern.test(value)) throw Error(`LOCAL_TEST_UUID_REQUIRED_${name}`);
  return value;
}
function localOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash || !url.port) {
    throw Error("LOCAL_HTTP_ORIGIN_REQUIRED");
  }
  return url.origin;
}
function jwtClaims(value: string): Row {
  try {
    const parts = value.split(".");
    if (parts.length !== 3) throw Error();
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Row;
  } catch { throw Error("LOCAL_TEST_JWT_REQUIRED"); }
}
function safeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "SystemDrive", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"])
    if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}
async function docker(args: string[], input = ""): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn("docker", args, { env: safeEnvironment(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", diagnostic = "", finished = false;
    const timer = setTimeout(() => { child.kill(); finish(false); }, 30_000);
    function finish(success: boolean) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      // Never surface SQL text, auth data or Docker stderr. A SQLSTATE and the
      // fixed Docker operation name distinguish a fixture bug from an outage.
      const sqlState = diagnostic.match(/ERROR:\s+([A-Z0-9]{5})\b/)?.[1];
      if (success) ok(output.trim()); else fail(Error(`ISOLATED_LOCAL_DOCKER_OPERATION_FAILED_${args[0]}${sqlState ? `_SQLSTATE_${sqlState}` : ""}`));
    }
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.stderr.on("data", chunk => { diagnostic = (diagnostic + String(chunk)).slice(-8192); });
    child.on("error", () => finish(false));
    child.on("close", code => finish(code === 0));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
function fixtureDatabase(container: string, runId: string) {
  const networkName = required("C1_UI_TEST_NETWORK");
  if (!/^velora-c1-ui-postgres-[0-9a-f]{8}$/.test(container) || !uuidPattern.test(runId))
    throw Error("ISOLATED_LOCAL_DATABASE_IDENTITY_REQUIRED");
  if(networkName!==`velora-c1-ui-e2e-${runId.slice(0,8)}`)throw Error("ISOLATED_LOCAL_NETWORK_IDENTITY_REQUIRED");
  async function verify() {
    const [context]=JSON.parse(await docker(["context","inspect"]));
    if(!/^(npipe:\/\/|unix:\/\/)/.test(context.Endpoints?.docker?.Host??""))throw Error("LOCAL_DOCKER_ENDPOINT_REQUIRED");
    const [network] = JSON.parse(await docker(["network", "inspect", networkName]));
    const [target] = JSON.parse(await docker(["inspect", container]));
    if (network.Internal !== true || network.Labels?.["velora.task"] !== "c1-ui-http" || network.Labels?.["velora.run"] !== runId ||
        target.Config.Image !== "supabase/postgres:17.6.1.136" || target.Config.Labels?.["velora.task"] !== "c1-ui-http" || target.Config.Labels?.["velora.run"] !== runId ||
        target.HostConfig.NetworkMode !== networkName || Object.keys(target.NetworkSettings.Networks).length !== 1 || !target.NetworkSettings.Networks[networkName] ||
        Object.keys(target.HostConfig.PortBindings ?? {}).length !== 0 || target.Mounts.some((mount: { Type: string }) => mount.Type !== "tmpfs") ||
        !target.HostConfig.Tmpfs?.["/var/lib/postgresql/data"] || !target.State.Running) {
      throw Error("UNSAFE_LOCAL_DATABASE_TARGET");
    }
  }
  async function sql(query: string) {
    // Recheck ownership/isolation before every fixture statement or read.
    await verify();
    return docker(["exec", "-i", "-u", "postgres", container, "psql", "-X", "-U", "supabase_admin", "-d", databaseName, "-Atq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"],
      `SET application_name='velora_c1_ui_http_runtime';\n${query}\n`);
  }
  async function rows(query: string): Promise<Row[]> {
    return JSON.parse(await sql(`SELECT coalesce(jsonb_agg(q),'[]'::jsonb) FROM (${query}) q;`)) as Row[];
  }
  return { verify, sql, rows };
}
async function rpc(client: SupabaseClient, name: string, args: Row): Promise<Row> {
  const result = await client.rpc(name, args);
  if (result.error) throw Error(`LOCAL_HTTP_RPC_FAILED_${name}_${result.error.code ?? "UNKNOWN"}`);
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw Error(`LOCAL_HTTP_RPC_RESULT_INVALID_${name}`);
  return result.data as Row;
}
function must(condition: unknown, code: string): asserts condition {
  if (!condition) throw Error(code);
}

/** Strict fake Graph transport: it has no fallback to a network implementation. */
function fakeMetaHttp(config: MetaSignupConfig, input: MetaSignupInput, token: string) {
  const steps = [
    ["GET", "oauth/access_token"], ["GET", "debug_token"], ["GET", input.wabaId],
    ["GET", `${input.wabaId}/phone_numbers`], ["GET", input.phoneNumberId],
    ["POST", `${input.wabaId}/subscribed_apps`], ["POST", `${input.phoneNumberId}/register`],
    ["GET", input.phoneNumberId], ["GET", `${input.wabaId}/subscribed_apps`], ["GET", "debug_token"],
  ];
  let position = 0, registered = false;
  const scopes = ["whatsapp_business_management", "whatsapp_business_messaging"];
  const phone = () => ({ id: input.phoneNumberId, display_phone_number: "synthetic-local-display", code_verification_status: "VERIFIED", platform_type: "CLOUD_API", status: registered ? "CONNECTED" : "PENDING", is_on_biz_app: false });
  return vi.fn(async (address: string, init?: RequestInit) => {
    const url = new URL(address), step = steps[position++];
    must(url.origin === "https://graph.facebook.com" && step && init?.method === step[0] && url.pathname === `/${config.graphVersion}/${step[1]}`, "UNEXPECTED_FAKE_META_REQUEST");
    const authorization = new Headers(init?.headers).get("Authorization");
    if (step[1] === "oauth/access_token") {
      must(authorization === null && url.searchParams.get("client_id") === config.appId && url.searchParams.get("client_secret") === config.appSecret && url.searchParams.get("code") === input.code, "FAKE_META_EXCHANGE_BINDING_REJECTED");
      return Response.json({ access_token: token });
    }
    if (step[1] === "debug_token") {
      must(authorization === `Bearer ${config.systemUserToken}` && url.searchParams.get("input_token") === token, "FAKE_META_DEBUG_BINDING_REJECTED");
      return Response.json({ data: { app_id: config.appId, is_valid: true, expires_at: 0, data_access_expires_at: 0, scopes, granular_scopes: scopes.map(scope => ({ scope, target_ids: [input.wabaId] })) } });
    }
    must(authorization === `Bearer ${token}`, "FAKE_META_ASSET_BINDING_REJECTED");
    if (step[0] === "POST") {
      const body = JSON.parse(String(init?.body));
      if (step[1].endsWith("/register")) {
        must(body.messaging_product === "whatsapp" && body.pin === input.pin && Object.keys(body).length === 2, "FAKE_META_REGISTRATION_REJECTED");
        registered = true;
      } else must(Object.keys(body).length === 0, "FAKE_META_SUBSCRIPTION_REJECTED");
      return Response.json({ success: true });
    }
    if (step[1] === input.wabaId) return Response.json({ id: input.wabaId });
    if (step[1] === input.phoneNumberId) return Response.json(phone());
    if (step[1].endsWith("/phone_numbers")) return Response.json({ data: [phone()] });
    return Response.json({ data: [{ whatsapp_business_api_data: { id: config.appId } }] });
  });
}

afterEach(() => {
  providers.model.mockReset(); providers.send.mockReset();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe.skipIf(!enabled)("isolated real HTTP company runtime journey", () => {
  it("uses real Auth/PostgREST/RLS and accounting, with only synthetic provider transports", async () => {
    const phase = required("C1_HTTP_E2E_PHASE");
    must(phase === "prepare" || phase === "answer", "LOCAL_HTTP_PHASE_REQUIRED");
    const artifact = resolve(process.cwd(), "artifacts/c1-http-e2e/runtime-result.json");
    async function handoff(data: Row) {
      await mkdir(resolve(artifact, ".."), { recursive: true });
      await writeFile(artifact, JSON.stringify(data, null, 2), "utf8");
    }
    const origin = localOrigin(required("C1_UI_TEST_STACK_URL"));
    const appOrigin = process.env.C1_UI_TEST_APP_URL ? localOrigin(required("C1_UI_TEST_APP_URL")) : null;
    const companyId = fixtureId("C1_UI_TEST_COMPANY_ID"), userId = fixtureId("C1_UI_TEST_USER_ID");
    const sessionId = fixtureId("C1_UI_TEST_SESSION_ID"), planVersionId = fixtureId("C1_UI_TEST_PLAN_VERSION_ID");
    const runId = fixtureId("C1_UI_TEST_RUN_ID");
    const serviceJwt = required("C1_UI_TEST_SERVICE_JWT"), customerJwt = required("C1_UI_TEST_CUSTOMER_JWT");
    const platformOwnerJwt = required("C1_UI_TEST_PLATFORM_OWNER_JWT"), anonJwt = required("C1_UI_TEST_ANON_JWT");
    const platformClaims = jwtClaims(platformOwnerJwt);
    must(platformClaims.role === "authenticated" && uuidPattern.test(String(platformClaims.sub)) && Number(platformClaims.exp) > Date.now() / 1000, "LOCAL_PLATFORM_AUTH_REQUIRED");
    const customerClaims = jwtClaims(customerJwt), serviceClaims = jwtClaims(serviceJwt);
    must(customerClaims.role === "authenticated" && customerClaims.sub === userId && customerClaims.session_id === sessionId && Number(customerClaims.exp) > Date.now() / 1000, "LOCAL_CUSTOMER_AUTH_BINDING_REQUIRED");
    must(serviceClaims.role === "service_role" && Number(serviceClaims.exp) > Date.now() / 1000, "LOCAL_SERVICE_JWT_REQUIRED");
    const db = fixtureDatabase(required("C1_UI_TEST_DB_CONTAINER"), runId);
    await db.verify();

    const nativeFetch = globalThis.fetch.bind(globalThis);
    let httpCalls = 0;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const backend = url.origin === origin && (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/auth/v1/"));
      const webhook = appOrigin !== null && url.origin === appOrigin && url.pathname === "/api/whatsapp/webhook";
      if (!backend && !webhook) throw Error("UNEXPECTED_LOCAL_HTTP_DESTINATION");
      httpCalls++;
      return nativeFetch(input, { ...init, redirect: "error", signal: init?.signal ?? AbortSignal.timeout(20_000) });
    });
    providers.model.mockImplementation(() => { throw Error("UNEXPECTED_MODEL_EXECUTION"); });
    providers.send.mockImplementation(() => { throw Error("UNEXPECTED_OUTBOUND_EXECUTION"); });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", serviceJwt);
    vi.stubEnv("WHATSAPP_WORKER_ENABLED", "true");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    vi.stubEnv("WHATSAPP_ROUTING_MODE", "tenant_registry");
    vi.stubEnv("WHATSAPP_WEBHOOK_DIAG_ENABLED", "false");
    const admin = createAdminClient() as SupabaseClient | null;
    must(admin, "REAL_HTTP_ADMIN_CLIENT_REQUIRED");
    const customer = createClient(origin, serviceJwt, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${customerJwt}` } } });
    const verifiedUser = await customer.auth.getUser(customerJwt);
    must(!verifiedUser.error && verifiedUser.data.user?.id === userId && verifiedUser.data.user.email_confirmed_at, "REAL_GOTRUE_CUSTOMER_REQUIRED");
    expect(await rpc(customer, "check_app_session", { p_touch: true })).toMatchObject({ ok: true });

    const owners = await db.rows(`SELECT m.company_id,m.user_id,c.status FROM public.company_members m JOIN public.companies c ON c.id=m.company_id JOIN auth.sessions s ON s.user_id=m.user_id WHERE m.company_id=${lit(companyId)}::uuid AND m.user_id=${lit(userId)}::uuid AND m.role='owner' AND m.status='active' AND s.id=${lit(sessionId)}::uuid`);
    must(owners.length === 1, "EXISTING_UI_COMPANY_OWNER_REQUIRED");
    const knowledge = await db.rows(`SELECT id,title,content,content_version,approved_version,approved_for_answers,status,usage_role FROM public.knowledge_sources WHERE company_id=${lit(companyId)}::uuid ORDER BY id`);
    const approved = knowledge.filter(row => row.usage_role === "knowledge" && row.status === "ready" && row.approved_for_answers === true && row.approved_version === row.content_version);
    must(approved.length > 0, "UI_APPROVED_KNOWLEDGE_REQUIRED");
    // Never approve or rewrite browser-created knowledge in the fixture.
    const question = `${String(approved[0].title)} ${String(approved[0].content)}`.trim().slice(0, 900);
    must(question.length > 1, "UI_KNOWLEDGE_QUESTION_REQUIRED");
    const plans = await db.rows(`SELECT v.*,p.code FROM public.billing_plan_versions v JOIN public.billing_plans p ON p.id=v.plan_id WHERE v.id=${lit(planVersionId)}::uuid AND v.status='published'`);
    must(plans.length === 1 && ["noor_basic", "noor_premium", "lina_basic", "lina_premium", "dana_basic", "dana_premium"].includes(String(plans[0].code)), "UI_PUBLISHED_CANONICAL_PLAN_REQUIRED");
    const plan = plans[0], amount = Number(plan.amount_baisa);
    must(Number.isSafeInteger(amount) && amount > 0 && Number(plan.period_days) > 0, "UI_PUBLISHED_PLAN_PRICE_REQUIRED");

    if (phase === "prepare") {
    // Customer trials remain hard-disabled. This isolated local ACTIVE fixture is
    // explicit synthetic setup for the paid worker; it does not prove trial rollout.
    // The product correctly protects status changes even from a direct SQL UPDATE.
    // Preserve that boundary and provision through its existing authorized RPC.
    await expect(db.sql(`UPDATE public.companies SET status='active' WHERE id=${lit(companyId)}::uuid AND status='setup';`)).rejects.toThrow("SQLSTATE_42501");
    const platformOwner = createClient(origin, anonJwt, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${platformOwnerJwt}` } } });
    expect(await rpc(platformOwner, "admin_set_company_status", { p_company_id: companyId, p_status: "active" })).toMatchObject({ id: companyId, status: "active" });
    const orderId = randomUUID(), attemptId = randomUUID(), otherCompanyId = randomUUID(), otherSourceId = randomUUID();
    const specialReference = `synthetic-http-${runId}`;
    const providerOrderId = String(BigInt(`0x${randomBytes(6).toString("hex")}`) + BigInt(1));
    const providerTransactionId = String(BigInt(`0x${randomBytes(6).toString("hex")}`) + BigInt(1));
    const account = "74002", merchant = "84001";
    vi.stubEnv("PAYMOB_MERCHANT_OWNER_ID", merchant);
    vi.stubEnv("PAYMOB_INTEGRATION_ID_LIVE", account);
    vi.stubEnv("PAYMOB_INTEGRATION_ID_TEST", "74001");
    await db.sql(`BEGIN;
      INSERT INTO public.billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,provider_account_ref,provider_environment,provider_amount,provider_amount_unit,special_reference,client_op_id,input_fingerprint,status,product_code,purchase_purpose,created_by,deadline_policy_approved)
      SELECT ${lit(orderId)}::uuid,${lit(companyId)}::uuid,id,amount_baisa,currency,period_days,period_unit,period_count,${lit(account)},'live',amount_baisa,'paymob_amount',${lit(specialReference)},${lit(`synthetic-http-op-${runId}`)},${lit(`synthetic-http-fingerprint-${runId}`)},'locked','velora_ai_staff','initial',${lit(userId)}::uuid,true FROM public.billing_plan_versions WHERE id=${lit(planVersionId)}::uuid;
      INSERT INTO public.billing_payment_attempts(id,order_id,company_id,status,provider_order_id) VALUES(${lit(attemptId)}::uuid,${lit(orderId)}::uuid,${lit(companyId)}::uuid,'provider_submitted',${lit(providerOrderId)});
      INSERT INTO public.ai_budget_accounts(scope,company_id,limit_baisa,enabled) VALUES('company_live',${lit(companyId)}::uuid,25,true);
      INSERT INTO public.companies(id,display_name,status,created_by) SELECT ${lit(otherCompanyId)}::uuid,'Synthetic foreign HTTP tenant','active',user_id FROM public.platform_admins WHERE role='owner' AND status='active' LIMIT 1;
      INSERT INTO public.knowledge_sources(id,company_id,kind,title,content,status,created_by) SELECT ${lit(otherSourceId)}::uuid,${lit(otherCompanyId)}::uuid,'text','Synthetic foreign knowledge','Foreign tenant must remain unreadable','ready',user_id FROM public.platform_admins WHERE role='owner' AND status='active' LIMIT 1;
      COMMIT;`);

    // Stage a real HMAC-verified local callback through the production receiver.
    // All signed fields are synthetic; no processor or financial endpoint is called.
    const signedObject = buildProcessedObj({ id: Number(providerTransactionId), amount_cents: amount, integration_id: Number(account), owner: Number(merchant), is_live: true, order: { id: Number(providerOrderId), merchant_order_id: specialReference } });
    const hmacSecret = `synthetic-receipt-${randomUUID()}`, signature = signProcessedObj(signedObject, hmacSecret);
    const callbackBody = { type: "TRANSACTION", obj: signedObject };
    const verified = verifyAndMapProcessedCallback({ body: callbackBody, hmacQueryParam: signature, hmacSecret });
    must(verified.ok, "SYNTHETIC_RECEIPT_SIGNATURE_REJECTED");
    expect(await receivePaymobWebhook({ deps: { webhookEnabled: true, hmacSecret, providerEnvironment: "live", findOrderByProviderOrderId, insertProviderEvent }, rawBody: JSON.stringify(callbackBody), hmacQueryParam: signature })).toMatchObject({ status: 200, eventStored: true });
    const evidence = buildPaymobHmacSettlementEvidence({ companyId, orderId, paymentAttemptId: attemptId, providerAccountRef: account, providerTransactionId, specialReference, amountBaisa: amount, providerEnvironment: "live", observationKey: observationKeyFromVerified(verified.observation) });
    expect(await rpc(admin, "billing_settle_paymob_hmac_verified", { p_evidence: evidence })).toMatchObject({ outcome: "granted" });
    const entitlement = await rpc(customer, "billing_read_company_operational_entitlement", { p_company_id: companyId });
    expect(entitlement).toMatchObject({ ok: true, active: true, environment: "live", plan_version_id: planVersionId });
    const subscriptions = await db.rows(`SELECT id,status,paid_through FROM public.billing_subscriptions WHERE company_id=${lit(companyId)}::uuid AND environment='live'`);
    must(subscriptions.length === 1 && subscriptions[0].status === "active", "HTTP_SETTLEMENT_SUBSCRIPTION_REQUIRED");
    const subscriptionId = String(subscriptions[0].id);

    const config = { enabled: true, appId: "111", configId: "444", appSecret: `synthetic-meta-${randomUUID()}`, systemUserToken: `synthetic-system-${randomUUID()}`, graphVersion: "v25.0" };
    const signup: SignupCompletionInput = { attemptId: randomUUID(), nonce: randomBytes(32).toString("hex"), code: `synthetic-code-${randomUUID()}`, wabaId: String(BigInt(`0x${randomBytes(10).toString("hex")}`) + BigInt(1)), phoneNumberId: String(BigInt(`0x${randomBytes(10).toString("hex")}`) + BigInt(1)), pin: "123456" };
    const startArgs = { p_company_id: companyId, p_attempt_id: signup.attemptId, p_nonce: signup.nonce, p_keep_on_phone: false, p_app_id: config.appId, p_config_id: config.configId, p_graph_version: config.graphVersion };
    expect(await rpc(customer, "whatsapp_start_embedded_signup", { ...startArgs, p_company_id: otherCompanyId })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await rpc(customer, "whatsapp_embedded_signup_readiness", { p_company_id: companyId })).toMatchObject({ ok: true });
    const started = await rpc(customer, "whatsapp_start_embedded_signup", startArgs);
    must(started.ok === true && started.attempt_id === signup.attemptId, "REAL_HTTP_SIGNUP_START_REQUIRED");
    const businessToken = `synthetic-business-${randomUUID()}`;
    const metaInput = { ...signup, keepOnPhone: false }, graph = fakeMetaHttp(config, metaInput, businessToken);
    const identity = { companyId, userId, sessionId };
    const signupPorts = createSignupPorts(identity, signup, config, customer, admin);
    signupPorts.provider = input => onboardMetaSignup(config, input, graph);
    expect(await finishEmbeddedSignup(identity, signup, config, signupPorts)).toEqual({ ok: true });
    expect(graph).toHaveBeenCalledTimes(10);
    expect(await finishEmbeddedSignup(identity, signup, config, signupPorts)).toMatchObject({ ok: false, code: "CONSUMED" });
    expect(graph).toHaveBeenCalledTimes(10);
    const links = await db.rows(`SELECT id,status,authorization_status,generation,access_secret_id FROM public.whatsapp_company_links WHERE company_id=${lit(companyId)}::uuid`);
    must(links.length === 1 && links[0].status === "verified" && links[0].authorization_status === "active" && links[0].access_secret_id, "REAL_HTTP_VERIFIED_LINK_REQUIRED");
    const linkId = String(links[0].id);
    const vault = await db.rows(`SELECT EXISTS(SELECT 1 FROM vault.secrets WHERE id=${lit(links[0].access_secret_id)}::uuid) saved,EXISTS(SELECT 1 FROM vault.secrets WHERE id=${lit(links[0].access_secret_id)}::uuid AND secret=${lit(businessToken)}) plaintext`);
    expect(vault).toEqual([{ saved: true, plaintext: false }]);

    // Deliberately longer than an E.164 telephone number; never a real contact.
    const recipient = "90000000000000000001", inboundWaId = `synthetic-local-in-${randomUUID()}`;
    const webhookSecret = process.env.C1_UI_TEST_WEBHOOK_SECRET?.trim() || config.appSecret;
    vi.stubEnv("WHATSAPP_APP_SECRET", webhookSecret);
    const inboundBody = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: signup.wabaId, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: signup.phoneNumberId }, contacts: [{ wa_id: recipient, profile: { name: "Synthetic local customer" } }], messages: [{ id: inboundWaId, from: recipient, type: "text", timestamp: String(Math.floor(Date.now() / 1000)), text: { body: question } }] } }] }] });
    const webhookAddress = `${appOrigin ?? origin}/api/whatsapp/webhook`;
    async function ingress() {
      const request = new Request(webhookAddress, { method: "POST", body: inboundBody, headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", webhookSecret).update(inboundBody).digest("hex")}` } });
      return appOrigin ? fetch(request) : receiveWebhook(request);
    }
    expect((await ingress()).status).toBe(200);
    expect((await ingress()).status).toBe(200);
    const inbound = await db.rows(`SELECT j.id job_id,m.id message_id,m.conversation_id,c.automation_allowed,c.control_revision FROM public.whatsapp_inbound_jobs j JOIN public.whatsapp_messages m ON m.id=j.message_id JOIN public.whatsapp_conversations c ON c.id=m.conversation_id WHERE m.company_id=${lit(companyId)}::uuid AND m.wa_message_id=${lit(inboundWaId)}`);
    must(inbound.length === 1 && inbound[0].automation_allowed === false, "REAL_HTTP_ATOMIC_INBOUND_REQUIRED");
    const conversationId = String(inbound[0].conversation_id), jobId = String(inbound[0].job_id);
    const inbox = await rpc(customer, "whatsapp_inbox_page", { p_company_id: companyId, p_limit: 40, p_before: null });
    must(inbox.ok === true && Array.isArray(inbox.conversations) && inbox.conversations.some((row: Row) => row.id === conversationId), "REAL_HTTP_PREPARED_INBOX_REQUIRED");
    expect(await rpc(customer, "whatsapp_inbox_page", { p_company_id: otherCompanyId, p_limit: 40, p_before: null })).toMatchObject({ ok: false });
    const foreignKnowledge = await customer.from("knowledge_sources").select("id").eq("company_id", otherCompanyId).eq("id", otherSourceId);
    must(!foreignKnowledge.error && foreignKnowledge.data?.length === 0, "CUSTOMER_FOREIGN_KNOWLEDGE_NOT_DENIED");
    const finalKnowledge = await db.rows(`SELECT id,title,content,content_version,approved_version,approved_for_answers,status,usage_role FROM public.knowledge_sources WHERE company_id=${lit(companyId)}::uuid ORDER BY id`);
    must(JSON.stringify(finalKnowledge) === JSON.stringify(knowledge), "UI_APPROVED_KNOWLEDGE_CHANGED");
    expect(providers.model).not.toHaveBeenCalled(); expect(providers.send).not.toHaveBeenCalled();
    await handoff({ phase: "prepare", runId, companyId, userId, planVersionId, subscriptionId, linkId, conversationId, jobId, otherCompanyId, otherSourceId, inboundMessageId: inbound[0].message_id, replyText: "Synthetic local answer from approved business knowledge.", signupStatus: "completed", subscriptionStatus: "active", jobStatus: "pending", automationStatus: "paused", syntheticActivation: true, customerTrialEnabled: false, modelCalls: 0, sendCalls: 0, httpCalls, messageCount: 1 });
    return;
    }

    // The browser must deliberately Resume Noura between prepare and answer.
    // This phase never grants automation or changes conversation control itself.
    const prepared = JSON.parse(await readFile(artifact, "utf8")) as Row;
    const jobId = fixtureId("C1_UI_TEST_JOB_ID"), conversationId = fixtureId("C1_UI_TEST_CONVERSATION_ID");
    must(prepared.phase === "prepare" && prepared.runId === runId && prepared.companyId === companyId && prepared.userId === userId && prepared.planVersionId === planVersionId && prepared.jobId === jobId && prepared.conversationId === conversationId, "PREPARED_BROWSER_HANDOFF_REQUIRED");
    const otherCompanyId = String(prepared.otherCompanyId), otherSourceId = String(prepared.otherSourceId);
    const subscriptionId = String(prepared.subscriptionId), linkId = String(prepared.linkId);
    must([otherCompanyId, otherSourceId, subscriptionId, linkId].every(value => uuidPattern.test(value)), "PREPARED_SAFE_IDS_REQUIRED");
    const resumed = await db.rows(`SELECT j.id job_id,m.id message_id,m.body,c.automation_allowed,c.phone_number_id,c.customer_wa_id FROM public.whatsapp_inbound_jobs j JOIN public.whatsapp_messages m ON m.id=j.message_id JOIN public.whatsapp_conversations c ON c.id=m.conversation_id WHERE j.id=${lit(jobId)}::uuid AND j.company_id=${lit(companyId)}::uuid AND c.id=${lit(conversationId)}::uuid AND c.company_id=${lit(companyId)}::uuid`);
    must(resumed.length === 1 && resumed[0].automation_allowed === true && resumed[0].body === question, "ACTUAL_BROWSER_RESUME_REQUIRED");
    const recipient = String(resumed[0].customer_wa_id), phoneNumberId = String(resumed[0].phone_number_id);
    const currentEntitlement = await rpc(customer, "billing_read_company_operational_entitlement", { p_company_id: companyId });
    expect(currentEntitlement).toMatchObject({ ok: true, active: true, environment: "live", plan_version_id: planVersionId });
    const claim = await rpc(admin, "claim_whatsapp_inbound_job", { p_job_id: jobId, p_lease_seconds: 120 });
    must(claim.ok === true && claim.company_id === companyId && typeof claim.claim_token === "string", "REAL_HTTP_JOB_CLAIM_REQUIRED");
    const binding = { jobId, claimToken: claim.claim_token, companyId, locale: "en" as const };
    const answerText = "Synthetic local answer from approved business knowledge.";
    let modelCalls = 0, sendCalls = 0;
    providers.model.mockImplementation(async (input: { model: string; system: string; prompt: string }) => {
      must(++modelCalls === 1 && input.prompt.includes(String(approved[0].content).trim()), "UNEXPECTED_LOCAL_MODEL_PAYLOAD");
      return { status: "success", text: answerText, actualModelId: input.model, requestId: "synthetic-http-model-request", responseId: "synthetic-http-model-response", latencyMs: 2, usage: { promptTokens: 20, completionTokens: 10, cachedTokens: 5, cacheWriteTokens: 3, reasoningTokens: 4, totalTokens: 30 } };
    });
    const outboundWaId = `synthetic-local-out-${randomUUID()}`;
    providers.send.mockImplementation(async (input: { toWaId: string; phoneNumberId: string; accessToken: string; body: string }) => {
      must(++sendCalls === 1 && input.toWaId === recipient && input.phoneNumberId === phoneNumberId && input.accessToken.startsWith("synthetic-business-") && input.body === answerText, "UNEXPECTED_LOCAL_OUTBOUND_PAYLOAD");
      return { ok: true, waMessageId: outboundWaId };
    });
    const result = await runInboundWorkerAnswer(binding, createIntegrationPorts(binding));
    expect(result).toMatchObject({ ok: true, jobCompleted: true, sendAccepted: true, delivered: false });
    expect(modelCalls).toBe(1); expect(sendCalls).toBe(1);
    const accounting = await db.rows(`SELECT id,status,total_tokens,cache_write_tokens,cost_baisa,answer_plan_version_id FROM public.ai_usage_ledger WHERE worker_job_id=${lit(jobId)}::uuid`);
    must(accounting.length === 1, "DURABLE_HTTP_AI_LEDGER_REQUIRED");
    expect(accounting[0]).toMatchObject({ status: "success", total_tokens: 30, cache_write_tokens: 3, answer_plan_version_id: planVersionId });
    expect(Number(accounting[0].cost_baisa)).toBeGreaterThan(0);
    const jobs = await db.rows(`SELECT status,usage_status,usage_subscription_id FROM public.whatsapp_inbound_jobs WHERE id=${lit(jobId)}::uuid`);
    expect(jobs).toMatchObject([{ status: "completed", usage_status: "accepted", usage_subscription_id: subscriptionId }]);
    const budgets = await db.rows(`SELECT id,spent_baisa,held_baisa FROM public.ai_budget_accounts WHERE scope='company_live' AND company_id=${lit(companyId)}::uuid`);
    must(budgets.length === 1, "DURABLE_HTTP_COMPANY_BUDGET_REQUIRED");
    expect(Number(budgets[0].spent_baisa)).toBeGreaterThan(0); expect(Number(budgets[0].held_baisa)).toBe(0);
    expect(Number(budgets[0].spent_baisa)).toBe(Number(accounting[0].cost_baisa));
    const quota = await rpc(customer, "billing_read_company_usage", { p_company_id: companyId });
    must(quota.ok === true && quota.data !== null && typeof quota.data === "object", "REAL_HTTP_USAGE_COUNTER_REQUIRED");
    const quotaData = quota.data as Row;
    expect(quotaData).toMatchObject({ successful_automated_outbound: 1, held_outbound_capacity: 0 });

    // C1 service-role clients have read access only. Even unchanged-value CRUD
    // must fail; no test resets lifetime counters or overwrites usage evidence.
    for (const [table, id, update] of [
      ["ai_budget_accounts", String(budgets[0].id), { enabled: true }],
      ["ai_usage_ledger", String(accounting[0].id), { status: "success" }],
    ] as const) {
      const denied = await admin.from(table).update(update).eq("id", id);
      must(denied.error?.code === "42501", "C1_DIRECT_SERVICE_ACCOUNTING_WRITE_NOT_DENIED");
    }
    expect(await rpc(customer, "whatsapp_inbox_page", { p_company_id: otherCompanyId, p_limit: 40, p_before: null })).toMatchObject({ ok: false });
    const foreignKnowledge = await customer.from("knowledge_sources").select("id").eq("company_id", otherCompanyId).eq("id", otherSourceId);
    must(!foreignKnowledge.error && foreignKnowledge.data?.length === 0, "CUSTOMER_FOREIGN_KNOWLEDGE_NOT_DENIED");
    const foreignRetrieval = await admin.rpc("whatsapp_retrieve_approved_knowledge", { p_company_id: otherCompanyId, p_job_id: jobId, p_claim_token: claim.claim_token, p_question: question });
    must(!foreignRetrieval.error && foreignRetrieval.data?.ok === false, "WORKER_FOREIGN_KNOWLEDGE_NOT_DENIED");
    const inbox = await rpc(customer, "whatsapp_inbox_page", { p_company_id: companyId, p_limit: 40, p_before: null });
    const thread = await rpc(customer, "whatsapp_thread_page", { p_company_id: companyId, p_conversation_id: conversationId, p_limit: 40, p_before: null });
    must(inbox.ok === true && Array.isArray(inbox.conversations) && inbox.conversations.some((row: Row) => row.id === conversationId), "REAL_HTTP_INBOX_REQUIRED");
    must(thread.ok === true && Array.isArray(thread.messages) && thread.messages.length === 2, "REAL_HTTP_RESPONSE_THREAD_REQUIRED");
    must(thread.messages.some((row: Row) => row.direction === "outbound" && row.body === answerText && row.delivery_state === "accepted"), "REAL_HTTP_ACCEPTED_RESPONSE_REQUIRED");
    const finalKnowledge = await db.rows(`SELECT id,title,content,content_version,approved_version,approved_for_answers,status,usage_role FROM public.knowledge_sources WHERE company_id=${lit(companyId)}::uuid ORDER BY id`);
    must(JSON.stringify(finalKnowledge) === JSON.stringify(knowledge), "UI_APPROVED_KNOWLEDGE_CHANGED");

    // Only safe IDs/statuses/counts go to the ignored browser handoff artifact.
    // The browser can refresh the Inbox and deliberately exercise Take Over.
    await handoff({ phase: "answer", runId, companyId, userId, planVersionId, subscriptionId, linkId, conversationId, jobId, ledgerId: accounting[0].id, inboundMessageId: resumed[0].message_id, signupStatus: "completed", subscriptionStatus: "active", jobStatus: "completed", usageStatus: "accepted", aiStatus: "success", sendStatus: "accepted", deliveryStatus: "accepted", syntheticActivation: true, customerTrialEnabled: false, modelCalls, sendCalls, httpCalls, messageCount: 2, successfulAutomatedOutbound: quotaData.successful_automated_outbound, heldOutboundCapacity: quotaData.held_outbound_capacity, totalTokens: accounting[0].total_tokens });
  }, 180_000);
});

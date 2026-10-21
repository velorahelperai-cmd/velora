// Explicit node --test only; excluded from Vitest's default test/spec pattern.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, sep, basename } from "node:path";
import { spawnSync } from "node:child_process";
import {
  localEnvironment,
  guardedEnvironment,
  sandboxGuardedEnvironment,
  SANDBOX_REQUIRED_FIELD_NAMES,
  consumeSubmittedPaymobSandboxConfig,
  verifyPaymobSandboxDatabaseIdentity,
  startPaymobSandboxTestRunner,
  evaluatePaymobSandboxIngressRequest,
  startPaymobSandboxIngress,
  redactPaymobSandboxText,
  sanitizePaymobSandboxCorrelationId,
  formatPaymobSandboxLogEntry,
  assertPortsFree,
  assertNoEnvironmentFiles,
} from "./local-http-safety.mjs";
import { clickHydratedControl } from "./local-http-browser-journey.mjs";
test("client control is clicked once only after its real handler exists", async () => {
  const element = {}; let evaluations = 0, clicks = 0;
  await clickHydratedControl({
    waitFor: async () => {},
    evaluate: async inspect => { if (++evaluations === 2) element.__reactProps$synthetic = { onClick() {} }; return inspect(element); },
    click: async () => { assert.equal(typeof element.__reactProps$synthetic?.onClick, "function"); clicks++; },
  });
  assert.equal(evaluations, 2); assert.equal(clicks, 1);
});
test("guard preloads through NODE_OPTIONS even with Windows spaces and separators", () => {
  const result = spawnSync(process.execPath, ["-e", "require('node:assert/strict').throws(()=>fetch('https://api.openai.com'),/LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/)"], { env: guardedEnvironment(resolve("."), {}), windowsHide: true, encoding: "utf8" });
  assert.equal(result.status, 0, "the child must load the guard rather than failing to find its path");
});
test("allowlist excludes parent provider credentials, preload and proxy", () => {
  const env = localEnvironment({ PATH: "runtime", NODE_OPTIONS: "unsafe", HTTP_PROXY: "external", OPENAI_API_KEY: "synthetic" });
  assert.equal(env.PATH, "runtime"); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.HTTP_PROXY, undefined); assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.NEXT_TELEMETRY_DISABLED, "1");
});
test("busy ports are refused without stopping their owner", async () => {
  const server = createServer(); await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  try { await assert.rejects(assertPortsFree([server.address().port]), /LOCAL_TEST_PORT_BUSY/); assert.equal(server.listening, true); }
  finally { await new Promise(ok => server.close(ok)); }
});
test("environment files are rejected by presence, without consuming values", async () => {
  const folder = await mkdtemp(join(tmpdir(), "velora-safety-"));
  try {
    await writeFile(join(folder, ".env.example"), "template"); await assertNoEnvironmentFiles(folder);
    await writeFile(join(folder, ".env.local"), "synthetic-only"); await assert.rejects(assertNoEnvironmentFiles(folder), /LOCAL_TEST_ENV_FILES_PRESENT/);
  } finally {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep) || !basename(folder).startsWith("velora-safety-")) throw Error("REFUSING_TEMP_CLEANUP_OUTSIDE_TEST_ROOT");
    await rm(folder, { recursive: true });
  }
});
test("provider fetch/HTTPS/TCP are blocked before native dispatch", () => {
  const script = `const a=require('node:assert/strict'),h=require('node:https'),n=require('node:net');for(const url of ['https://api.openai.com/v1/responses','https://generativelanguage.googleapis.com/v1beta','https://graph.facebook.com','https://oman.paymob.com']){a.throws(()=>fetch(url),/LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);a.throws(()=>h.request(url),/LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);}a.throws(()=>new n.Socket().connect(443,'api.openai.com'),/LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);`;
  const result = spawnSync(process.execPath, ["--require", resolve("scripts/integration/local-http-network-guard.cjs"), "-e", script], { env: localEnvironment(), windowsHide: true, encoding: "utf8" });
  assert.equal(result.status, 0, "provider transports must be denied without a network attempt");
});
test("smart onboarding ports work while other HTTP destinations remain denied", () => {
  const script = `const a=require('node:assert/strict'),h=require('node:http');(async()=>{const s=h.createServer((_,r)=>r.end('local'));await new Promise(ok=>s.listen(3330,'127.0.0.1',ok));try{a.equal(await (await fetch('http://127.0.0.1:3330')).text(),'local');for(const port of [3320,3340,3341]){const r=h.request('http://127.0.0.1:'+port);r.on('error',()=>{});r.destroy();}for(const url of ['http://127.0.0.1:9999','https://127.0.0.1:3330','http://example.com:3330'])a.throws(()=>fetch(url),/LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);}finally{await new Promise(ok=>s.close(ok));}})().catch(e=>{console.error(e);process.exitCode=1;});`;
  const result = spawnSync(process.execPath, ["-e", script], { env: guardedEnvironment(resolve("."), {}), windowsHide: true, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});
test("orchestrator requires an explicit run flag and import performs no startup", () => {
  const imported = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./scripts/integration/local-http-e2e.mjs')"], { env: localEnvironment(), windowsHide: true, encoding: "utf8" });
  assert.equal(imported.status, 0); assert.equal(imported.stdout, "");
  const unbound = spawnSync(process.execPath, ["scripts/integration/local-http-e2e.mjs"], { env: localEnvironment(), windowsHide: true, encoding: "utf8" });
  assert.equal(unbound.status, 1); assert.match(unbound.stderr, /LOCAL_HTTP_OPT_IN_REQUIRED/);
});
test("paymob sandbox ingress allows only webhook and pinned test order return while blocking admin, auth, other orders, and server actions", async () => {
  const pinnedOrderId = "22222222-2222-4333-8444-555555555555";
  const otherOrderId = "99999999-2222-4333-8444-555555555555";

  assert.equal(evaluatePaymobSandboxIngressRequest({ method: "POST", url: "/api/billing/paymob/webhook?hmac=abc123", pinnedOrderId }).allow, true);
  assert.equal(evaluatePaymobSandboxIngressRequest({ method: "GET", url: "/api/billing/paymob/webhook", pinnedOrderId }).allow, false);
  assert.equal(evaluatePaymobSandboxIngressRequest({ method: "GET", url: `/app/subscription/orders/${pinnedOrderId}?success=true&id=4321`, pinnedOrderId }).allow, true);
  assert.equal(evaluatePaymobSandboxIngressRequest({ method: "GET", url: `/api/billing/paymob/return?order_id=${pinnedOrderId}&success=true`, pinnedOrderId }).allow, true);
  assert.equal(evaluatePaymobSandboxIngressRequest({ method: "GET", url: "/_next/static/chunks/main.js", pinnedOrderId }).allow, true);

  for (const blocked of [
    { method: "GET", url: "/" },
    { method: "GET", url: "/admin" },
    { method: "GET", url: "/admin/billing" },
    { method: "GET", url: "/login" },
    { method: "GET", url: "/setup" },
    { method: "GET", url: "/app/subscription" },
    { method: "GET", url: `/app/subscription/orders/${otherOrderId}` },
    { method: "GET", url: `/api/billing/paymob/return?order_id=${otherOrderId}` },
    { method: "POST", url: `/app/subscription/orders/${pinnedOrderId}` },
    { method: "GET", url: `/app/subscription/orders/${pinnedOrderId}`, headers: { "next-action": "action_id" } },
    { method: "GET", url: "/_next/static/chunks/main.js.map" },
    { method: "GET", url: "/.env" },
  ]) {
    const decision = evaluatePaymobSandboxIngressRequest({ ...blocked, pinnedOrderId });
    assert.equal(decision.allow, false, `Expected ${blocked.method} ${blocked.url} to be denied`);
  }

  const logs = [];
  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(`upstream:${req.method}:${req.url}:${req.headers["cookie"] ?? "no-cookie"}`);
  });
  await new Promise(ok => upstream.listen(0, "127.0.0.1", ok));
  const upstreamPort = upstream.address().port;
  const ingress = await startPaymobSandboxIngress({
    listenPort: 0,
    upstreamPort,
    pinnedOrderId,
    correlationId: "corr-ingress-test-01",
    onLog: entry => logs.push(entry),
  });

  try {
    const base = `http://127.0.0.1:${ingress.port}`;
    const webhookRes = await fetch(`${base}/api/billing/paymob/webhook?hmac=secret_sig_value`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "sb-access-token=secret" },
      body: JSON.stringify({ type: "TRANSACTION" }),
    });
    assert.equal(webhookRes.status, 200);
    assert.equal(await webhookRes.text(), "upstream:POST:/api/billing/paymob/webhook?hmac=secret_sig_value:no-cookie");

    const returnRes = await fetch(`${base}/app/subscription/orders/${pinnedOrderId}?success=true&id=4321`, {
      headers: { host: "sandbox-trial.trycloudflare.com", cookie: "foreign-tunnel-cookie=must-not-forward" },
      redirect: "manual",
    });
    assert.equal(returnRes.status, 303);
    assert.equal(
      returnRes.headers.get("location"),
      `http://127.0.0.1:${upstreamPort}/app/subscription/orders/${pinnedOrderId}`,
    );

    const adminRes = await fetch(`${base}/admin`);
    assert.equal(adminRes.status, 403);

    const otherOrderRes = await fetch(`${base}/app/subscription/orders/${otherOrderId}`);
    assert.equal(otherOrderRes.status, 403);

    const serializedLogs = JSON.stringify(logs);
    assert.equal(serializedLogs.includes("secret_sig_value"), false);
    assert.equal(logs.every(l => l.correlationId === "corr-ingress-test-01" && typeof l.timestamp === "string"), true);
  } finally {
    await ingress.close();
    await new Promise(ok => upstream.close(ok));
  }
});
test("paymob sandbox network guard isolates c1_ui_integration, blocks live mode, and restricts outbound to oman.paymob.com", () => {
  assert.throws(() => sandboxGuardedEnvironment(resolve("."), {}, { database: "postgres" }), /SANDBOX_ISOLATED_DB_REQUIRED/);
  assert.throws(() => sandboxGuardedEnvironment(resolve("."), { BILLING_PAYMOB_LIVE_ENABLED: "true" }), /SANDBOX_LIVE_MODE_BLOCKED/);
  assert.throws(() => sandboxGuardedEnvironment(resolve("."), { PAYMOB_SECRET_KEY_TEST: "om_sk_live_forbidden" }), /SANDBOX_LIVE_MODE_BLOCKED/);

  const sandboxEnv = sandboxGuardedEnvironment(resolve("."), {});
  const script = `
    const a = require('node:assert/strict');
    const h = require('node:https');
    const n = require('node:net');
    for (const url of ['https://api.openai.com/v1/responses', 'https://accept.paymob.com/v1/intention/', 'https://oman.paymob.com/admin']) {
      a.throws(() => fetch(url), /LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);
      a.throws(() => h.request(url), /LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);
    }
    a.throws(() => new n.Socket().connect(443, 'api.openai.com'), /LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);
    a.throws(() => new n.Socket().connect('\\\\\\\\.\\\\pipe\\\\velora-paymob-test-123'), /SANDBOX_SECURE_PIPE_ACCESS_BLOCKED/);
    process.env.VELORA_SANDBOX_DATABASE = 'other_db';
    a.throws(() => fetch('https://oman.paymob.com/v1/intention/'), /SANDBOX_ISOLATED_DB_REQUIRED/);
    process.env.VELORA_SANDBOX_DATABASE = 'c1_ui_integration';
    process.env.PAYMOB_LIVE_ENABLED = 'true';
    a.throws(() => fetch('https://oman.paymob.com/v1/intention/'), /SANDBOX_LIVE_MODE_BLOCKED/);
  `;
  const result = spawnSync(process.execPath, ["-e", script], { env: sandboxEnv, windowsHide: true, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
test("credentials are consumed in-memory only after explicit user Submit and secrets are redacted from logs", async () => {
  const validPipeName = "velora-paymob-test-" + "a".repeat(32);
  const readySnapshot = {
    state: "READY_FOR_LOCAL_PRIVATE_CONSUMER",
    operatorTestOmrVerified: true,
    environment: "Test",
    currency: "OMR",
    pipeName: validPipeName,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    requiredNames: [...SANDBOX_REQUIRED_FIELD_NAMES],
  };

  const memEnv = await consumeSubmittedPaymobSandboxConfig({
    statusSnapshot: readySnapshot,
    consumePipe: async () => ({
      PAYMOB_SECRET_KEY_TEST: "om_sk_test_memory_only",
      PAYMOB_PUBLIC_KEY_TEST: "om_pk_test_memory_only",
      PAYMOB_HMAC_SECRET: "hmac_memory_only",
      PAYMOB_INTEGRATION_ID_TEST: "71610",
      PAYMOB_MERCHANT_OWNER_ID: "302852",
      PAYMOB_OMR_UNITS_PER_OMR: "1000",
    }),
  });
  assert.equal(memEnv.PAYMOB_SECRET_KEY_TEST, "om_sk_test_memory_only");
  assert.equal(memEnv.BILLING_PAYMOB_LIVE_ENABLED, "false");
  assert.equal(memEnv.PAYMOB_OMR_CONVERSION_VERIFIED, "true");

  const redacted = redactPaymobSandboxText("Authorization: Token syn_tok_value_998877, Bearer syn_bearer_value_112233 ?hmac=deadbeef&clientSecret=om_csk_test_abc");
  assert.equal(redacted.includes("syn_tok_value_998877"), false);
  assert.equal(redacted.includes("syn_bearer_value_112233"), false);
  assert.equal(redacted.includes("deadbeef"), false);
  assert.equal(redacted.includes("om_csk_test_abc"), false);
  assert.equal(redacted, "Authorization: Token [REDACTED], Bearer [REDACTED] ?hmac=[REDACTED]&clientSecret=[REDACTED]");

  assert.equal(
    sanitizePaymobSandboxCorrelationId("corr_Token syn_tok_value_998877", "fallback-corr"),
    "fallback-corr",
  );
  const entry = formatPaymobSandboxLogEntry({
    correlationId: "corr_om_sk_test_secret999",
    stage: "webhook_receive",
    code: "ok",
  });
  assert.equal(entry.correlationId, "paymob-sandbox-uncorrelated");
});

test("rejects foreign absolute URLs, pre-normalization path traversal, and terminates stalled upstream connections on timeout", async () => {
  const pinnedOrderId = "22222222-2222-4333-8444-555555555555";
  for (const blocked of [
    { method: "POST", url: "https://evil.example/api/billing/paymob/webhook" },
    { method: "GET", url: `https://evil.example/app/subscription/orders/${pinnedOrderId}` },
    { method: "POST", url: "/admin/../api/billing/paymob/webhook" },
    { method: "POST", url: "/api/billing/paymob/%2e%2e/paymob/webhook" },
    { method: "GET", url: `/app/subscription/orders/${pinnedOrderId}/../${pinnedOrderId}` },
  ]) {
    const decision = evaluatePaymobSandboxIngressRequest({ ...blocked, pinnedOrderId });
    assert.equal(decision.allow, false, `Expected ${blocked.method} ${blocked.url} to be denied before normalization`);
  }

  let upstreamSocketDestroyed = false;
  const stalledUpstream = createHttpServer((req) => {
    req.socket.on("close", () => {
      upstreamSocketDestroyed = true;
    });
  });
  await new Promise(ok => stalledUpstream.listen(0, "127.0.0.1", ok));
  const upstreamPort = stalledUpstream.address().port;
  const ingress = await startPaymobSandboxIngress({
    listenPort: 0,
    upstreamPort,
    pinnedOrderId,
    timeoutMs: 80,
    onLog: () => {},
  });
  try {
    const res = await fetch(`http://127.0.0.1:${ingress.port}/api/billing/paymob/webhook?hmac=abc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "TRANSACTION" }),
      signal: AbortSignal.timeout(1500),
    });
    assert.equal(res.status, 504);
    assert.equal(await res.text(), "SANDBOX_INGRESS_UPSTREAM_TIMEOUT");
    await new Promise(r => setTimeout(r, 30));
    assert.equal(upstreamSocketDestroyed, true);
  } finally {
    await ingress.close();
    await new Promise(ok => stalledUpstream.close(ok));
  }
});

test("blocks servername=oman.paymob.com from bypassing a mismatched host using fake socket/TLS stubs with zero external calls", () => {
  const sandboxEnv = {
    ...sandboxGuardedEnvironment(resolve("."), {}),
    NODE_OPTIONS: "",
  };
  const guardPath = resolve("scripts/integration/paymob-sandbox-network-guard.cjs");
  const script = `
    const a = require('node:assert/strict');
    const net = require('node:net');
    const tls = require('node:tls');
    const https = require('node:https');
    const { EventEmitter } = require('node:events');
    const calls = [];
    net.Socket.prototype.connect = function (...args) {
      calls.push({ kind: 'net', args });
      return this;
    };
    tls.connect = function (...args) {
      calls.push({ kind: 'tls', args });
      return new EventEmitter();
    };
    const guardPath = ${JSON.stringify(guardPath)};
    delete require.cache[guardPath];
    require(guardPath);

    a.throws(() => tls.connect({ host: 'evil.example.com', port: 443, servername: 'oman.paymob.com' }), /LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);
    a.throws(() => tls.connect({ hostname: 'evil.example.com', port: 443, servername: 'oman.paymob.com' }), /LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);
    a.throws(() => tls.connect({ host: 'oman.paymob.com', port: 443, servername: 'evil.example.com' }), /LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);
    a.throws(() => tls.connect({ port: 443, servername: 'oman.paymob.com' }), /LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);
    a.throws(() => tls.connect(443, 'evil.example.com', { servername: 'oman.paymob.com' }), /LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);
    a.throws(() => new net.Socket().connect({ host: 'evil.example.com', port: 443, servername: 'oman.paymob.com' }), /LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);
    a.throws(() => https.request('https://oman.paymob.com/v1/intention/', { servername: 'evil.example.com' }), /LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);
    a.throws(() => https.request('https://oman.paymob.com/v1/intention/', { host: 'evil.example.com' }), /LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED/);
    a.equal(calls.length, 0);

    tls.connect({ host: 'oman.paymob.com', port: 443, servername: 'oman.paymob.com' });
    new net.Socket().connect({ host: 'oman.paymob.com', port: 443 });
    a.equal(calls.length, 2);
  `;
  const result = spawnSync(process.execPath, ["-e", script], { env: sandboxEnv, windowsHide: true, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("unified consumer contract rejects invalid/expired dates and missing required fields before invoking consumePipe", async () => {
  const validPipeName = "velora-paymob-test-" + "a".repeat(32);
  const fullRequiredNames = [...SANDBOX_REQUIRED_FIELD_NAMES];
  let consumeCalls = 0;
  const mustNotConsume = async () => {
    consumeCalls++;
    throw Error("MUST_NOT_CALL_CONSUME_PIPE");
  };

  for (const invalidStatus of [
    { state: "WAITING_FOR_USER_ENTRY", operatorTestOmrVerified: true, pipeName: validPipeName, expiresAt: new Date(Date.now() + 60_000).toISOString(), requiredNames: fullRequiredNames },
    { state: "READY_FOR_LOCAL_PRIVATE_CONSUMER", operatorTestOmrVerified: false, pipeName: validPipeName, expiresAt: new Date(Date.now() + 60_000).toISOString(), requiredNames: fullRequiredNames },
    { state: "READY_FOR_LOCAL_PRIVATE_CONSUMER", operatorTestOmrVerified: true, pipeName: validPipeName, expiresAt: "not-a-valid-date", requiredNames: fullRequiredNames },
    { state: "READY_FOR_LOCAL_PRIVATE_CONSUMER", operatorTestOmrVerified: true, pipeName: validPipeName, expiresAt: "", requiredNames: fullRequiredNames },
    { state: "READY_FOR_LOCAL_PRIVATE_CONSUMER", operatorTestOmrVerified: true, pipeName: validPipeName, expiresAt: new Date(Date.now() - 1000).toISOString(), requiredNames: fullRequiredNames },
    { state: "READY_FOR_LOCAL_PRIVATE_CONSUMER", operatorTestOmrVerified: true, pipeName: validPipeName, expiresAt: new Date(Date.now() + 60_000).toISOString(), requiredNames: fullRequiredNames.slice(0, 4) },
    { state: "READY_FOR_LOCAL_PRIVATE_CONSUMER", operatorTestOmrVerified: true, pipeName: "invalid-pipe", expiresAt: new Date(Date.now() + 60_000).toISOString(), requiredNames: fullRequiredNames },
  ]) {
    await assert.rejects(
      consumeSubmittedPaymobSandboxConfig({ statusSnapshot: invalidStatus, consumePipe: mustNotConsume }),
    );
  }
  assert.equal(consumeCalls, 0, "consumePipe must never be called when pre-checks fail");

  // Also reject missing payload fields (e.g. missing owner or OMR units) after consumePipe
  await assert.rejects(
    consumeSubmittedPaymobSandboxConfig({
      statusSnapshot: {
        state: "READY_FOR_LOCAL_PRIVATE_CONSUMER",
        operatorTestOmrVerified: true,
        pipeName: validPipeName,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        requiredNames: fullRequiredNames,
      },
      consumePipe: async () => ({
        PAYMOB_SECRET_KEY_TEST: "om_sk_test_synthetic",
        PAYMOB_PUBLIC_KEY_TEST: "om_pk_test_synthetic",
        PAYMOB_HMAC_SECRET: "hmac_synthetic",
        PAYMOB_INTEGRATION_ID_TEST: "71610",
        PAYMOB_MERCHANT_OWNER_ID: "",
        PAYMOB_OMR_UNITS_PER_OMR: "1000",
      }),
    }),
    /TEST_SETTINGS_MISSING/,
  );
});

test("sandbox database identity probes enforce isolation without requiring a machine fixture", async () => {
  // 1. Negative database identity probes are rejected
  await assert.rejects(
    verifyPaymobSandboxDatabaseIdentity({
      probe: async () => ({ database: "postgres", cronDatabase: "postgres", cronJobs: "off", internal: true, postgresHostPorts: 0 }),
    }),
    /SANDBOX_ISOLATED_DB_REQUIRED/,
  );
  await assert.rejects(
    verifyPaymobSandboxDatabaseIdentity({
      probe: async () => ({ database: "c1_ui_integration", cronDatabase: "c1_ui_integration", cronJobs: "off", internal: false, postgresHostPorts: 0 }),
    }),
    /SANDBOX_ISOLATED_DB_REQUIRED/,
  );
  await assert.rejects(
    verifyPaymobSandboxDatabaseIdentity({
      probe: async () => ({ database: "c1_ui_integration", cronDatabase: "c1_ui_integration", cronJobs: "off", internal: true, postgresHostPorts: 1 }),
    }),
    /SANDBOX_ISOLATED_DB_REQUIRED/,
  );

  // Portable contract check; native retained-fixture acceptance has its own receipt.
  const identity = await verifyPaymobSandboxDatabaseIdentity({
    probe: async () => ({database:"c1_ui_integration",cronDatabase:"c1_ui_integration",cronJobs:"off",internal:true,postgresHostPorts:0}),
  });
  assert.equal(identity.database,"c1_ui_integration");

});

// Runner/return regression: these fail if signed provider query is replayed or a borrowed listener is used.
test("sandbox return drops provider signatures and all display-only query values", () => {
 const id="22222222-2222-4333-8444-555555555555";
 const result=evaluatePaymobSandboxIngressRequest({method:"GET",url:"/app/subscription/orders/"+id+"?hmac=SYNTHETIC&success=true&id=123&access_token=SYNTHETIC",pinnedOrderId:id});
 assert.equal(result.canonicalReturnPath,"/app/subscription/orders/"+id);
 const api=evaluatePaymobSandboxIngressRequest({method:"GET",url:"/api/billing/paymob/return?order_id="+id+"&hmac=SYNTHETIC&success=true",pinnedOrderId:id});
 assert.equal(api.canonicalReturnPath,"/api/billing/paymob/return?order_id="+id);
});
test("sandbox runner refuses missing native stack binding before consuming a handoff", async () => {
 let consumed=0;
 await assert.rejects(startPaymobSandboxTestRunner({root:resolve("."),databaseIdentity:{probe:async()=>({database:"c1_ui_integration",cronDatabase:"c1_ui_integration",cronJobs:"off",internal:true,postgresHostPorts:0})},consumer:{statusSnapshot:{},consumePipe:async()=>{consumed++;return {}}}}),/SANDBOX_NATIVE_STACK_BINDING_REQUIRED/);
 assert.equal(consumed,0);
});

test("sandbox runner leaves an unrelated busy app listener alive and never consumes credentials", async () => {
 const unrelated=createHttpServer((_req,res)=>res.end("unrelated-listener-preserved"));
 await new Promise((ok,fail)=>{unrelated.once("error",fail);unrelated.listen(3120,"127.0.0.1",ok)});
 let consumed=0,verified=0;
 try {
  await assert.rejects(startPaymobSandboxTestRunner({root:resolve("."),appPort:3120,listenPort:0,localStack:{url:"http://127.0.0.1:3130",anonKey:"not-consumed",serviceRoleKey:"not-consumed",verify:async()=>{verified++;return{}}},consumer:{consumePipe:async()=>{consumed++;return{}}}}),/LOCAL_TEST_PORT_BUSY_3120/);
  assert.equal(consumed,0);assert.equal(verified,0);
  assert.equal(await(await fetch("http://127.0.0.1:3120")).text(),"unrelated-listener-preserved");
 }finally{unrelated.closeAllConnections();await new Promise(ok=>unrelated.close(ok));}
});

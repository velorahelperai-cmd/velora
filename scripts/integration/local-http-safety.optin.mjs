// Explicit node --test only; excluded from Vitest's default test/spec pattern.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, sep, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { localEnvironment, guardedEnvironment, assertPortsFree, assertNoEnvironmentFiles } from "./local-http-safety.mjs";
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

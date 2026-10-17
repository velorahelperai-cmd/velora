import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { isolatedEnvironment, assertNoRuntimeEnvFiles, assertRequiredResults } from "./safety.mjs";

test("only runtime environment survives; credentials, flags and injected Node options do not", () => {
  const env = isolatedEnvironment({ PATH: "runtime", OPENAI_API_KEY: "synthetic", VELORA_IG_POSTGRES: "1", NODE_OPTIONS: "--require=unsafe" });
  assert.equal(env.PATH, "runtime");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.VELORA_IG_POSTGRES, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NEXT_TELEMETRY_DISABLED, "1");
});
test("any Next runtime env file aborts without reading its contents", () => {
  const root = mkdtempSync(resolve(tmpdir(), "velora-ci-"));
  try {
    writeFileSync(resolve(root, ".env.example"), "example");
    assert.doesNotThrow(() => assertNoRuntimeEnvFiles(root));
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local", ".env.test"]) {
      writeFileSync(resolve(root, name), "synthetic");
      assert.throws(() => assertNoRuntimeEnvFiles(root), /CI_RUNTIME_ENV_FILES_PRESENT/);
      rmSync(resolve(root, name));
    }
  } finally { rmSync(root, { recursive: true }); }
});
test("aggregate requires quality+security+secrets; skipped, cancelled, failed, missing deny", () => {
  const success = {
    quality: { result: "success" },
    security: { result: "success" },
    secrets: { result: "success" },
  };
  assert.doesNotThrow(() => assertRequiredResults(success));
  for (const result of ["failure", "skipped", "cancelled", undefined]) {
    assert.throws(
      () => assertRequiredResults({ ...success, quality: { result } }),
      /CI_REQUIRED_CHECK_FAILED/,
    );
  }
  assert.throws(
    () => assertRequiredResults({ quality: { result: "success" }, security: { result: "success" } }),
    /CI_REQUIRED_CHECK_FAILED_secrets/,
  );
  assert.throws(() => assertRequiredResults({ quality: { result: "success" } }), /CI_REQUIRED_CHECK_FAILED/);
  assert.throws(() => assertRequiredResults({}), /CI_REQUIRED_CHECK_FAILED/);
  assert.throws(
    () => assertRequiredResults({ ...success, future: { result: "failure" } }),
    /CI_REQUIRED_CHECK_FAILED/,
  );
});
test("PR workflow includes quality, security, and secrets gates without path skips or bypasses", () => {
  const workflow = readFileSync(".github/workflows/quality-gates.yml", "utf8");
  assert.match(workflow, /pull_request:\s+branches: \[main\]/);
  assert.match(workflow, /merge_group:/);
  assert.match(workflow, /check: \[typecheck, lint, unit, contracts, build, safety\]/);
  assert.match(workflow, /name: secrets \/ pinned Gitleaks/);
  assert.match(
    workflow,
    /name: quality-gate[\s\S]*if: \$\{\{ always\(\) \}\}[\s\S]*needs: \[quality, security, secrets\]/,
  );
  assert.match(workflow, /npm audit --audit-level=moderate/);
  assert.match(workflow, /VELORA_CI_RECEIPT_DIR:\s*\$\{\{\s*runner\.temp\s*\}\}\/velora-ci-receipts/);
  // Deny GitHub secrets.* context / bypass patterns — job name `secrets` is required.
  assert.doesNotMatch(workflow, /upload-artifact|pull_request_target|paths-ignore:|continue-on-error:|secrets\.|contents: write|\|\| true/);
  for (const action of workflow.matchAll(/uses: ([^\s]+)@([^\s]+)/g)) assert.match(action[2], /^[a-f0-9]{40}$/);
});
test("preload denies real fetch, HTTPS, TCP, TLS, UDP and DNS before network execution", () => {
  const guard = resolve("scripts/ci/offline-network-guard.cjs");
  const program = `const assert=require('node:assert/strict');
    const deny=/CI_EXTERNAL_NETWORK_BLOCKED/;
    for(const run of [()=>fetch('https://example.invalid'),()=>require('node:https').request('https://example.invalid'),()=>require('node:net').connect(443,'example.invalid'),()=>require('node:tls').connect(443,'example.invalid'),()=>require('node:dgram').createSocket('udp4'),()=>require('node:dns').lookup('example.invalid')]) assert.throws(run,deny);
    assert.throws(()=>require('node:dns/promises').lookup('example.invalid'),deny);`;
  execFileSync(process.execPath, ["--require", guard, "-e", program], { env: isolatedEnvironment(), stdio: "pipe" });
});
test("actual CI discovery selects source tests and never native/archived suites", () => {
  const guard = resolve("scripts/ci/offline-network-guard.cjs");
  const output = execFileSync(process.execPath, ["--require", guard, "node_modules/vitest/vitest.mjs", "list", "--filesOnly", "--config", "vitest.ci.config.ts"], {
    env: isolatedEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000,
  });
  const files = output.replaceAll("\\", "/").split("\n").map(line => line.trim()).filter(line => /\.test\.(?:ts|tsx)$/.test(line));
  assert.ok(files.length > 0);
  assert.ok(files.some(file => file.includes("src/lib/auth/")));
  for (const file of files) {
    assert.match(file, /(?:^|\/)src\//);
    assert.doesNotMatch(file, /postgres|local-sql|live-offer-sql|artifacts|scripts\//);
  }
});

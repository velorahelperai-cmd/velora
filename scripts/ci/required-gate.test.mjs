import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isolatedEnvironment } from "./safety.mjs";

const entrypoint = fileURLToPath(new URL("./required-gate.mjs", import.meta.url));
const success = {
  quality: { result: "success" },
  security: { result: "success" },
  secrets: { result: "success" },
};

function runGate(value) {
  const env = isolatedEnvironment();
  if (value !== undefined) env.CI_REQUIRED_RESULTS = value;
  const child = spawnSync(process.execPath, [entrypoint], {
    env, encoding: "utf8", timeout: 10000, windowsHide: true,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  return child;
}

test("required gate CLI exits successfully only with successful required jobs including secrets", () => {
  for (const needs of [success, { ...success, future: { result: "success" } }]) {
    const child = runGate(JSON.stringify(needs));
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), "All required Velora checks succeeded.");
    assert.equal(child.stderr, "");
  }
});

for (const job of ["quality", "security", "secrets", "future"]) {
  for (const result of ["failure", "cancelled", "skipped", "pending", undefined]) {
    test(`required gate CLI rejects ${job} result ${String(result)}`, () => {
      const child = runGate(JSON.stringify({ ...success, [job]: { result } }));
      assert.equal(child.status, 1);
      assert.equal(child.stdout, "");
      assert.match(child.stderr, new RegExp(`CI_REQUIRED_CHECK_FAILED_${job}`));
    });
  }
}

test("required gate CLI fails closed for absent, malformed or incomplete workflow input", () => {
  for (const value of [undefined, "", "{", "null", "[]", "{}", "true", '"success"',
    JSON.stringify({ quality: success.quality, security: success.security }),
    JSON.stringify({ quality: success.quality, secrets: success.secrets }),
    JSON.stringify({ security: success.security, secrets: success.secrets })]) {
    const child = runGate(value);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.notEqual(child.stderr, "");
  }
});

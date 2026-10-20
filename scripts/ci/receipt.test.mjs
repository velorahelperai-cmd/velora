import {randomUUID} from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isolatedEnvironment, assertRequiredResults } from "./safety.mjs";
import {
  aggregateLocalReceipts,
  buildCheckReceipt,
  captureCandidateIdentity,
  candidateIdentityKey,
  gateNeedsFromAggregate,
  outcomeFromProcess,
  writeCheckReceipt,
  loadReceiptsFromDir,
  RUN_CHECKS,
} from "./receipt.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const runEntrypoint = resolve(root, "scripts/ci/run.mjs");

function cleanCandidate(overrides = {}) {
  return {
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    workingTreeState: "clean",
    dirtyPathCount: 0,
    dirtyPathFingerprint: "clean",
    capturedAt: "2026-10-17T00:00:00.000Z",
    ...overrides,
  };
}

function receiptFor(checkName, outcome, exitStatus, candidate = cleanCandidate()) {
  const processResult =
    outcome === "Pass"
      ? { status: 0 }
      : outcome === "Fail"
        ? { status: exitStatus ?? 1 }
        : outcome === "Blocked"
          ? { error: Error("CI_CHECK_START_FAILED"), status: null }
          : { status: null };
  const built = buildCheckReceipt({
    runId: `run-${checkName}`,
    checkName,
    candidate,
    startedAt: "2026-10-17T00:00:00.000Z",
    endedAt: "2026-10-17T00:00:01.000Z",
    processResult,
    reasonCode: outcome === "Pass" ? "CI_CHECK_OK" : undefined,
  });
  if (outcome === "NotRun") {
    return {
      ...built,
      outcome: "NotRun",
      exitStatus: null,
      reasonCode: "CI_CHECK_NOT_RUN",
    };
  }
  return built;
}

function initGitRepo(dir) {
  // Neutralize developer global excludes so .env.local appears as untracked in the sandbox.
  writeFileSync(join(dir, ".git-empty-global"), "");
  writeFileSync(join(dir, ".git-empty-system"), "");
  const env = isolatedEnvironment({
    PATH: process.env.PATH,
    Path: process.env.Path,
    GIT_CONFIG_GLOBAL: join(dir, ".git-empty-global"),
    GIT_CONFIG_SYSTEM: join(dir, ".git-empty-system"),
  });
  const run = (args) => {
    const child = spawnSync("git", args, { cwd: dir, env, encoding: "utf8", windowsHide: true });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  };
  run(["init"]);
  run(["config", "user.email", "ci@example.invalid"]);
  run(["config", "user.name", "ci"]);
  writeFileSync(join(dir, "README.md"), "base\n");
  run(["add", "README.md"]);
  run(["commit", "-m", "init"]);
}

test("outcome mapping: Pass/Fail match exit status; start/timeout/signal never Pass", () => {
  assert.deepEqual(outcomeFromProcess({ status: 0 }), {
    outcome: "Pass",
    exitStatus: 0,
    reasonCode: "CI_CHECK_OK",
  });
  assert.deepEqual(outcomeFromProcess({ status: 2 }), {
    outcome: "Fail",
    exitStatus: 2,
    reasonCode: "CI_CHECK_FAILED",
  });
  assert.equal(outcomeFromProcess({ error: Error("spawn ENOENT") }).outcome, "Blocked");
  assert.equal(outcomeFromProcess({ timedOut: true, status: null, signal: "SIGTERM" }).outcome, "Blocked");
  assert.equal(outcomeFromProcess({ signal: "SIGKILL", status: null }).outcome, "Blocked");
  assert.equal(outcomeFromProcess({ status: null }).outcome, "NotRun");
  assert.notEqual(outcomeFromProcess({ timedOut: true }).outcome, "Pass");
  assert.notEqual(outcomeFromProcess({ error: Error("x") }).outcome, "Pass");
});

test("receipt from successful and failed process results preserves exitStatus and outcome", () => {
  const pass = buildCheckReceipt({
    checkName: "lint",
    candidate: cleanCandidate(),
    processResult: { status: 0 },
    startedAt: "2026-10-17T01:00:00.000Z",
    endedAt: "2026-10-17T01:00:02.000Z",
  });
  assert.equal(pass.outcome, "Pass");
  assert.equal(pass.exitStatus, 0);
  assert.equal(pass.check, "lint");
  assert.equal(pass.scope, RUN_CHECKS.lint.scope);
  assert.equal(pass.durationMs, 2000);
  assert.ok(candidateIdentityKey(pass.candidate));

  const fail = buildCheckReceipt({
    checkName: "unit",
    candidate: cleanCandidate(),
    processResult: { status: 1 },
  });
  assert.equal(fail.outcome, "Fail");
  assert.equal(fail.exitStatus, 1);
});

test("synthetic secrets in reason text are redacted before receipt persistence", () => {
  const dir = mkdtempSync(join(tmpdir(), "velora-receipt-"));
  try {
    const secret = "ghp_" + randomUUID().replaceAll("-", "") + randomUUID().slice(0, 4);
    const receipt = buildCheckReceipt({
      checkName: "safety",
      candidate: cleanCandidate(),
      processResult: { status: 1 },
      reasonCode: `token=${secret} Bearer ${secret}`,
    });
    const path = writeCheckReceipt(dir, receipt);
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes(secret), false);
    assert.match(raw, /\[REDACTED\]/);
    assert.doesNotMatch(raw, /stdout|stderr/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregate accepts matching Pass set and rejects missing/mixed/stale/NotRun/Blocked", () => {
  const candidate = cleanCandidate();
  const allPass = Object.keys(RUN_CHECKS).map((name) => receiptFor(name, "Pass", 0, candidate));
  const ok = aggregateLocalReceipts(allPass, { expectedCandidate: candidate });
  assert.equal(ok.ok, true);
  assert.equal(ok.outcome, "Pass");
  assert.ok(ok.limitations.includes("production_not_proven"));

  assert.equal(
    aggregateLocalReceipts(allPass.slice(1), { expectedCandidate: candidate }).code,
    "CI_RECEIPT_MISSING_typecheck",
  );

  const dirtyOther = cleanCandidate({
    workingTreeState: "dirty",
    dirtyPathCount: 1,
    dirtyPathFingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assert.equal(
    aggregateLocalReceipts(
      [...allPass.slice(0, 5), receiptFor("safety", "Pass", 0, dirtyOther)],
      { expectedCandidate: candidate },
    ).code,
    "CI_RECEIPT_CANDIDATE_MISMATCH",
  );

  const mixed = [
    ...Object.keys(RUN_CHECKS).slice(0, 5).map((name) => receiptFor(name, "Pass", 0, candidate)),
    receiptFor("safety", "Pass", 0, dirtyOther),
  ];
  assert.equal(aggregateLocalReceipts(mixed).code, "CI_RECEIPT_CANDIDATE_MIXED");

  const withNotRun = Object.keys(RUN_CHECKS).map((name, i) =>
    receiptFor(name, i === 0 ? "NotRun" : "Pass", i === 0 ? null : 0, candidate),
  );
  const notRunAgg = aggregateLocalReceipts(withNotRun, { expectedCandidate: candidate });
  assert.equal(notRunAgg.ok, false);
  assert.notEqual(notRunAgg.outcome, "Pass");

  const withBlocked = Object.keys(RUN_CHECKS).map((name, i) =>
    receiptFor(name, i === 1 ? "Blocked" : "Pass", i === 1 ? null : 0, candidate),
  );
  assert.equal(aggregateLocalReceipts(withBlocked, { expectedCandidate: candidate }).ok, false);

  const stale = aggregateLocalReceipts(allPass, {
    expectedCandidate: candidate,
    maxAgeMs: 1000,
    now: "2026-10-18T00:00:00.000Z",
  });
  assert.equal(stale.code, "CI_RECEIPT_STALE");
});

test("gateNeedsFromAggregate requires secrets; assertRequiredResults denies incomplete sets", () => {
  const candidate = cleanCandidate();
  const allPass = Object.keys(RUN_CHECKS).map((name) => receiptFor(name, "Pass", 0, candidate));
  const aggregate = aggregateLocalReceipts(allPass, { expectedCandidate: candidate });
  assert.throws(
    () => assertRequiredResults(gateNeedsFromAggregate(aggregate)),
    /CI_REQUIRED_CHECK_FAILED_security|CI_REQUIRED_CHECK_FAILED_secrets/,
  );
  assert.throws(
    () => assertRequiredResults(gateNeedsFromAggregate(aggregate, { security: { result: "success" } })),
    /CI_REQUIRED_CHECK_FAILED_secrets/,
  );
  assert.doesNotThrow(() =>
    assertRequiredResults(
      gateNeedsFromAggregate(aggregate, {
        security: { result: "success" },
        secrets: { result: "success" },
      }),
    ),
  );
  assert.throws(
    () =>
      assertRequiredResults({
        quality: { result: "failure" },
        security: { result: "success" },
        secrets: { result: "success" },
      }),
    /CI_REQUIRED_CHECK_FAILED_quality/,
  );
});

test("content-aware dirty identity: same path + same HEAD + different bytes invalidates key", () => {
  const dir = mkdtempSync(join(tmpdir(), "velora-content-id-"));
  try {
    initGitRepo(dir);
    const probe = join(dir, "probe-content.txt");
    writeFileSync(probe, "alpha-bytes\n");
    const first = captureCandidateIdentity(dir);
    assert.equal(first.workingTreeState, "dirty");
    const key1 = candidateIdentityKey(first);
    assert.ok(key1);

    writeFileSync(probe, "beta-bytes-changed\n");
    const second = captureCandidateIdentity(dir);
    assert.equal(second.workingTreeState, "dirty");
    const key2 = candidateIdentityKey(second);
    assert.ok(key2);
    assert.notEqual(key1, key2);
    assert.equal(first.headSha, second.headSha);

    const staleReceipt = receiptFor("lint", "Pass", 0, first);
    const liveAgg = aggregateLocalReceipts([staleReceipt], { expectedCandidate: second });
    assert.equal(liveAgg.ok, false);
    assert.equal(liveAgg.code, "CI_RECEIPT_CANDIDATE_MISMATCH");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MM staged index change with identical worktree bytes invalidates candidate identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "velora-mm-index-"));
  try {
    initGitRepo(dir);
    const env = isolatedEnvironment({
      PATH: process.env.PATH,
      Path: process.env.Path,
      GIT_CONFIG_GLOBAL: join(dir, ".git-empty-global"),
      GIT_CONFIG_SYSTEM: join(dir, ".git-empty-system"),
    });
    const run = (args) => {
      const child = spawnSync("git", args, { cwd: dir, env, encoding: "utf8", windowsHide: true });
      assert.equal(child.status, 0, child.stderr || child.stdout);
    };
    const tracked = join(dir, "tracked.txt");
    writeFileSync(tracked, "committed-base\n");
    run(["add", "tracked.txt"]);
    run(["commit", "-m", "track"]);
    writeFileSync(tracked, "staged-v1\n");
    run(["add", "tracked.txt"]);
    writeFileSync(tracked, "worktree-mm-fixed\n");
    const first = captureCandidateIdentity(dir);
    assert.equal(first.workingTreeState, "dirty");
    const key1 = candidateIdentityKey(first);
    assert.ok(key1);
    const worktreeBytes = readFileSync(tracked);

    writeFileSync(tracked, "staged-v2-only-index-change\n");
    run(["add", "tracked.txt"]);
    writeFileSync(tracked, worktreeBytes);
    const status = spawnSync("git", ["status", "--porcelain=v1"], {
      cwd: dir,
      env,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.match(status.stdout.replaceAll("\\", "/"), /^MM\s+tracked\.txt/m);

    const second = captureCandidateIdentity(dir);
    assert.equal(second.workingTreeState, "dirty");
    assert.equal(second.headSha, first.headSha);
    assert.deepEqual(readFileSync(tracked), worktreeBytes);
    const key2 = candidateIdentityKey(second);
    assert.ok(key2);
    assert.notEqual(key1, key2);
    assert.equal(
      aggregateLocalReceipts([receiptFor("unit", "Pass", 0, first)], { expectedCandidate: second }).code,
      "CI_RECEIPT_CANDIDATE_MISMATCH",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("private .env.local in synthetic project is never hashed into candidate identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "velora-env-id-"));
  try {
    initGitRepo(dir);
    const envPath = join(dir, ".env.local");
    const secret = "SYNTHETIC_ENV_VALUE_MUST_NOT_APPEAR=" + "x".repeat(40);
    writeFileSync(envPath, `${secret}\n`);
    writeFileSync(join(dir, "safe.txt"), "visible\n");
    const before = readFileSync(envPath);
    const m0 = statSync(envPath).mtimeMs;
    utimesSync(envPath, new Date(m0), new Date(m0));
    const normalizedMtime = statSync(envPath).mtimeMs;

    const candidate = captureCandidateIdentity(dir);
    assert.notEqual(candidate.workingTreeState, "unknown");
    const key = candidateIdentityKey(candidate);
    assert.ok(key);
    assert.equal(JSON.stringify(candidate).includes(secret), false);
    assert.equal(statSync(envPath).mtimeMs, normalizedMtime);
    assert.deepEqual(readFileSync(envPath), before);

    writeFileSync(envPath, `${secret}\nCHANGED\n`);
    const afterEnvChange = captureCandidateIdentity(dir);
    // Excluded env byte change must not alone alter identity when other dirty set unchanged.
    assert.equal(candidateIdentityKey(afterEnvChange), key);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run.mjs unknown check fails closed; synthetic project env never opened by identity helpers", () => {
  const dir = mkdtempSync(join(tmpdir(), "velora-run-receipt-"));
  const sandbox = mkdtempSync(join(tmpdir(), "velora-env-sandbox-"));
  try {
    const unknown = spawnSync(process.execPath, [runEntrypoint, "not-a-check"], {
      cwd: root,
      env: isolatedEnvironment(),
      encoding: "utf8",
      windowsHide: true,
    });
    assert.notEqual(unknown.status, 0);

    const passReceipt = buildCheckReceipt({
      checkName: "contracts",
      candidate: cleanCandidate(),
      processResult: { status: 0 },
    });
    const failReceipt = buildCheckReceipt({
      checkName: "contracts",
      candidate: passReceipt.candidate,
      processResult: { status: 3 },
    });
    writeCheckReceipt(dir, { ...passReceipt, runId: "probe-pass" });
    writeCheckReceipt(dir, { ...failReceipt, runId: "probe-fail" });
    const loaded = loadReceiptsFromDir(dir);
    assert.ok(loaded.some((r) => r.outcome === "Pass" && r.exitStatus === 0));
    assert.ok(loaded.some((r) => r.outcome === "Fail" && r.exitStatus === 3));

    initGitRepo(sandbox);
    const localEnv = join(sandbox, ".env.local");
    writeFileSync(localEnv, "SYNTHETIC_LOCAL=1\n");
    const m0 = statSync(localEnv).mtimeMs;
    utimesSync(localEnv, new Date(m0), new Date(m0));
    const normalizedMtime = statSync(localEnv).mtimeMs;
    const bytes0 = readFileSync(localEnv);
    captureCandidateIdentity(sandbox);
    const env = isolatedEnvironment({ PATH: "x", SECRET_FROM_PARENT: "nope" });
    assert.equal(env.SECRET_FROM_PARENT, undefined);
    assert.equal(statSync(localEnv).mtimeMs, normalizedMtime);
    assert.deepEqual(readFileSync(localEnv), bytes0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("parent credentials are not forwarded by isolatedEnvironment used for checks", () => {
  const env = isolatedEnvironment({
    PATH: "runtime",
    OPENAI_API_KEY: "synthetic-key",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    VELORA_WP01B_DATABASE_URL: "postgresql://127.0.0.1/x",
    NODE_OPTIONS: "--require=evil",
  });
  assert.equal(env.PATH, "runtime");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.VELORA_WP01B_DATABASE_URL, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
});

test("receipt tooling never spawns container runtime / browsers / external providers", () => {
  // Behavioral boundary: spawn/exec of docker|playwright|providers — not the English word in comments.
  const sources = [
    readFileSync(resolve(root, "scripts/ci/receipt.mjs"), "utf8"),
    readFileSync(resolve(root, "scripts/ci/run.mjs"), "utf8"),
    readFileSync(resolve(root, "scripts/ci/aggregate-receipts.mjs"), "utf8"),
  ].join("\n");
  assert.doesNotMatch(sources, /(?:spawnSync|spawn|execFileSync|execSync)\s*\(\s*["'`](?:docker|playwright|chromium|puppeteer)/i);
  assert.doesNotMatch(sources, /openai\.com|stripe\.com|twilio\.com|supabase\.co/i);
  assert.match(readFileSync(resolve(root, "scripts/ci/run.mjs"), "utf8"), /spawnSync\(process\.execPath/);
});

test("dirty working-tree identity differs from clean HEAD-only identity", () => {
  const clean = cleanCandidate();
  const dirty = cleanCandidate({
    workingTreeState: "dirty",
    dirtyPathCount: 2,
    dirtyPathFingerprint: "cccccccccccccccccccccccccccccccc",
  });
  assert.notEqual(candidateIdentityKey(clean), candidateIdentityKey(dirty));
  assert.match(candidateIdentityKey(dirty), /\|dirty\|/);
});

test("aggregate rejects missing required secrets job evidence shape via gateNeeds", () => {
  const candidate = cleanCandidate();
  const allPass = Object.keys(RUN_CHECKS).map((name) => receiptFor(name, "Pass", 0, candidate));
  const aggregate = aggregateLocalReceipts(allPass, { expectedCandidate: candidate });
  const needs = gateNeedsFromAggregate(aggregate, { security: { result: "success" } });
  assert.equal(needs.secrets.result, "failure");
  assert.throws(() => assertRequiredResults(needs), /CI_REQUIRED_CHECK_FAILED_secrets/);
});

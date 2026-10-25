import { spawnSync } from "node:child_process";
import { verifyWorkspace } from "../consolidation/guard.mjs";
console.log(JSON.stringify(verifyWorkspace()));
import {candidateContextArgument,loadGateContext,snapshotCandidateIdentity} from './candidate-snapshot.mjs';
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { assertNoRuntimeEnvFiles, isolatedEnvironment } from "./safety.mjs";
import {
  buildCheckReceipt,
  captureCandidateIdentity,
  writeCheckReceipt,
} from "./receipt.mjs";

const commands = {
  typecheck: ["node_modules/typescript/bin/tsc", "--noEmit"],
  lint: ["node_modules/eslint/bin/eslint.js", ".", "--max-warnings=0"],
  unit: ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.ci.config.ts", "--maxWorkers=1", "--reporter=dot", "--silent"],
  contracts: ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.ci.config.ts", "src/lib/channels/contract.test.ts", "src/lib/access", "src/lib/auth", "src/lib/billing/catalog-backend", "src/lib/tenancy/business-authority", "src/lib/tenancy/setup-draft", "--maxWorkers=1", "--reporter=dot", "--silent"],
  build: ["node_modules/next/dist/bin/next", "build", "--webpack"],
  safety: ["--test", "scripts/ci/safety.test.mjs", "scripts/ci/required-gate.test.mjs", "scripts/ci/security.test.mjs", "scripts/ci/dependency-compatibility.test.mjs", "scripts/ci/receipt.test.mjs", "scripts/integration/local-auth-confirmation.test.mjs", "src/lib/logging/logger.test.mjs", "scripts/consolidation/guard.test.mjs", "scripts/ci/pre-push.test.mjs", "scripts/ci/candidate-snapshot.test.mjs"],
};

const checkName = process.argv[2];
const command = commands[checkName];
if (!command) throw Error("CI_UNKNOWN_CHECK");

const context=loadGateContext(candidateContextArgument());
const cwd = context?.snapshot ?? process.cwd();
const runId = randomUUID();
const candidate = context ? snapshotCandidateIdentity(context) : captureCandidateIdentity(cwd);
const receiptDir = process.env.VELORA_CI_RECEIPT_DIR
  ? resolve(process.env.VELORA_CI_RECEIPT_DIR)
  : null;
const timeoutRaw = process.env.VELORA_CI_CHECK_TIMEOUT_MS;
const timeoutMs = timeoutRaw !== undefined && timeoutRaw !== ""
  ? Number(timeoutRaw)
  : undefined;

function persistReceipt(processResult, reasonCode, startedAt, endedAt) {
  if (!receiptDir) return null;
  try {
    const receipt = buildCheckReceipt({
      runId,
      checkName,
      candidate,
      startedAt,
      endedAt,
      processResult,
      reasonCode,
      evidenceRef: receiptDir.replaceAll("\\", "/"),
    });
    return writeCheckReceipt(receiptDir, receipt);
  } catch {
    // Receipt persistence must not invent a Pass; surface write failure as blocked exit.
    return null;
  }
}

const startedAt = new Date().toISOString();
try {
  // Name-only presence check — never opens or mutates developer .env* files.
  assertNoRuntimeEnvFiles(cwd);
} catch (error) {
  const endedAt = new Date().toISOString();
  const written = persistReceipt(
    { error: error instanceof Error ? error : Error("CI_RUNTIME_ENV_FILES_PRESENT"), status: null, signal: null },
    "CI_RUNTIME_ENV_FILES_PRESENT",
    startedAt,
    endedAt,
  );
  if (receiptDir && !written) {
    console.error("CI_RECEIPT_WRITE_FAILED");
  }
  console.error("CI_RUNTIME_ENV_FILES_PRESENT");
  process.exit(1);
}

const guard = resolve(cwd,"scripts/ci/offline-network-guard.cjs").replaceAll("\\", "/");
// Isolated child env: runtime names only — no parent secrets, no .env loading.
const env = { ...isolatedEnvironment(), NODE_OPTIONS: `--require="${guard}"` };
if (receiptDir) env.VELORA_CI_RECEIPT_DIR = receiptDir;

const spawnOpts = {
  cwd,
  env,
  stdio: "inherit",
  windowsHide: true,
  // Never capture stdout/stderr into receipts.
};
if (Number.isFinite(timeoutMs) && timeoutMs > 0) spawnOpts.timeout = timeoutMs;

if (checkName === "typecheck") {
  // A clean checkout has no ignored Next ambient/route declarations. Generate
  // them offline first, as required by the installed Next.js TypeScript guide.
  const types = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "typegen"], spawnOpts);
  if (types.error || types.timedOut || types.signal || (types.status ?? 1) !== 0) {
    const endedAt = new Date().toISOString();
    const written = persistReceipt(types, undefined, startedAt, endedAt);
    if (receiptDir && !written) console.error("CI_RECEIPT_WRITE_FAILED");
    if (types.error) {
      console.error("CI_TYPEGEN_START_FAILED");
      process.exit(1);
    }
    process.exit(types.status ?? 1);
  }
}

const child = spawnSync(process.execPath, command, spawnOpts);
const endedAt = new Date().toISOString();
const written = persistReceipt(child, undefined, startedAt, endedAt);
if (receiptDir && !written) {
  console.error("CI_RECEIPT_WRITE_FAILED");
  process.exit(1);
}
if (child.error) {
  console.error("CI_CHECK_START_FAILED");
  process.exit(1);
}
process.exit(child.status ?? 1);

/**
 * Aggregate redacted local check receipts for a single candidate identity.
 * Exit 0 only when every required check receipt is Pass with exitStatus 0.
 * Does not prove secret history, hosted enforcement, Production, or external acceptance.
 */
import { resolve } from "node:path";
import {
  aggregateLocalReceipts,
  captureCandidateIdentity,
  gateNeedsFromAggregate,
  loadReceiptsFromDir,
  RUN_CHECKS,
} from "./receipt.mjs";
import { assertRequiredResults } from "./safety.mjs";

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

const dir = resolve(argValue("--dir") ?? process.env.VELORA_CI_RECEIPT_DIR ?? ".ci-receipts");
const requireArg = argValue("--require");
const requiredChecks = requireArg
  ? requireArg.split(",").map((s) => s.trim()).filter(Boolean)
  : Object.keys(RUN_CHECKS);
const maxAgeMsRaw = argValue("--max-age-ms");
const maxAgeMs = maxAgeMsRaw !== null ? Number(maxAgeMsRaw) : 24 * 60 * 60 * 1000;
const useLiveCandidate = process.argv.includes("--match-live-candidate");

let expectedCandidate = null;
if (useLiveCandidate) {
  expectedCandidate = captureCandidateIdentity(process.cwd());
}

let receipts;
try {
  receipts = loadReceiptsFromDir(dir);
} catch {
  console.error("CI_RECEIPTS_UNREADABLE");
  process.exit(1);
}

const aggregate = aggregateLocalReceipts(receipts, {
  requiredChecks,
  expectedCandidate,
  maxAgeMs: Number.isFinite(maxAgeMs) ? maxAgeMs : null,
});

// Honest console summary — redacted codes only, no stdout bodies.
console.log(JSON.stringify({
  ok: aggregate.ok,
  code: aggregate.code,
  outcome: aggregate.outcome,
  candidateKey: aggregate.candidateKey,
  limitations: aggregate.limitations,
  checks: Object.fromEntries(
    Object.entries(aggregate.checks).map(([name, row]) => [
      name,
      { outcome: row.outcome, exitStatus: row.exitStatus, reasonCode: row.reasonCode },
    ]),
  ),
}, null, 2));

if (!aggregate.ok) process.exit(1);

// Optional: when --gate is set, enforce quality+security+secrets university shape.
// Local aggregate alone does not invent a security or secrets Pass.
if (process.argv.includes("--gate")) {
  const securityResult = argValue("--security-result");
  const secretsResult = argValue("--secrets-result");
  if (securityResult !== "success") {
    console.error("CI_REQUIRED_CHECK_FAILED_security");
    process.exit(1);
  }
  if (secretsResult !== "success") {
    console.error("CI_REQUIRED_CHECK_FAILED_secrets");
    process.exit(1);
  }
  try {
    assertRequiredResults(gateNeedsFromAggregate(aggregate, {
      security: { result: "success" },
      secrets: { result: "success" },
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "CI_REQUIRED_CHECK_FAILED");
    process.exit(1);
  }
}

console.log("Local receipt aggregate accepted for the declared candidate and scope only.");
process.exit(0);

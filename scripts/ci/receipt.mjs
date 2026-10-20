/**
 * WP10A — redacted local verification receipts bound to a candidate identity.
 * Does not run product app, container runtimes, browsers, or integration fixtures.
 * Never stores raw stdout/stderr. Never reads or mutates developer .env* files.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { redactLogText } from "../../src/lib/logging/redaction.mjs";
import { isolatedEnvironment } from "./safety.mjs";

/** Checks owned by scripts/ci/run.mjs — keep names aligned with that entrypoint. */
export const RUN_CHECKS = Object.freeze({
  typecheck: { name: "typecheck", scope: "ci/quality/typecheck" },
  lint: { name: "lint", scope: "ci/quality/lint" },
  unit: { name: "unit", scope: "ci/quality/unit" },
  contracts: { name: "contracts", scope: "ci/quality/contracts" },
  build: { name: "build", scope: "ci/quality/build" },
  safety: { name: "safety", scope: "ci/quality/safety" },
});

export const OUTCOMES = Object.freeze(["Pass", "Fail", "Blocked", "NotRun"]);

export const AGGREGATE_LIMITATIONS = Object.freeze([
  "secret_history_not_proven",
  "hosted_enforcement_not_proven",
  "production_not_proven",
  "external_acceptance_not_proven",
]);

const SHA_RE = /^[a-f0-9]{40}$/i;
const MAX_DIRTY_PATHS = 200;

/** Paths never hashed into candidate identity (private env / receipts / runtime). */
function isExcludedIdentityPath(relPath) {
  const p = relPath.replaceAll("\\", "/");
  const base = p.split("/").pop() ?? p;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (p === ".ci-receipts" || p.startsWith(".ci-receipts/")) return true;
  if (p.startsWith(".git/")) return true;
  if (base.endsWith(".pem") || base.endsWith(".key")) return true;
  return false;
}

function gitText(cwd, args) {
  const child = spawnSync("git", args, {
    cwd,
    env: isolatedEnvironment(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  if (child.error || child.status !== 0 || child.signal) return null;
  return child.stdout ?? "";
}

function gitBuffer(cwd, args) {
  const child = spawnSync("git", args, {
    cwd,
    env: isolatedEnvironment(),
    encoding: "buffer",
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error || child.status !== 0 || child.signal) return null;
  return child.stdout ?? Buffer.alloc(0);
}

/**
 * Parse `git status --porcelain=v1 -z` into ordered entries.
 * Rename/copy lines contribute both source and dest path slots.
 */
export function parsePorcelainZ(porcelain) {
  if (porcelain === null) return null;
  if (porcelain.length === 0) return [];
  const parts = porcelain.split("\0").filter((p) => p.length > 0);
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (line.length < 3) continue;
    const xy = line.slice(0, 2);
    const pathPart = line.slice(3).replaceAll("\\", "/");
    const renameOrCopy = xy[0] === "R" || xy[0] === "C" || xy[1] === "R" || xy[1] === "C";
    if (renameOrCopy) {
      const dest = (parts[++i] ?? "").replaceAll("\\", "/");
      entries.push({ xy, path: pathPart, role: "rename-source" });
      if (dest) entries.push({ xy, path: dest, role: "rename-dest" });
    } else {
      entries.push({ xy, path: pathPart, role: "path" });
    }
  }
  return entries;
}

/**
 * Safe digests for one dirty path: index (staged) object identity + worktree bytes when present.
 * C02: MM with unchanged worktree but different staged blob must change the fingerprint.
 * Excluded paths never read bytes from worktree or index.
 */
function contentDigestForPath(root, relPath, xy) {
  const normalized = relPath.replaceAll("\\", "/");
  if (isExcludedIdentityPath(normalized)) {
    return { kind: "excluded", digest: "excluded", stagedDigest: "excluded", worktreeDigest: "excluded" };
  }
  const abs = resolve(root, normalized);
  const rootResolved = resolve(root);
  if (!abs.startsWith(rootResolved + sep) && abs !== rootResolved) {
    return { kind: "unsafe", digest: null, stagedDigest: null, worktreeDigest: null };
  }

  const indexXy = xy[0] ?? " ";
  const workXy = xy[1] ?? " ";
  // Prefer stable index object id (mode+OID) when the path has an index stage.
  let stagedDigest = "none";
  let stagedKind = "none";
  if (indexXy !== " " && indexXy !== "?" && indexXy !== "!") {
    const ls = gitText(root, ["ls-files", "-s", "--", normalized]);
    if (ls === null) {
      return { kind: "index-unreadable", digest: null, stagedDigest: null, worktreeDigest: null };
    }
    const indexLine = ls
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .filter(Boolean)
      .find((l) => {
        const tab = l.indexOf("\t");
        const path = (tab >= 0 ? l.slice(tab + 1) : "").replaceAll("\\", "/");
        return path === normalized;
      });
    if (indexLine) {
      // format: <mode> <object> <stage>\t<path>
      const meta = indexLine.split("\t")[0] ?? indexLine;
      const parts = meta.trim().split(/\s+/);
      if (parts.length >= 3 && /^[a-f0-9]{40,64}$/i.test(parts[1])) {
        stagedDigest = `${parts[0]}:${parts[1].toLowerCase()}:${parts[2]}`;
        stagedKind = "index-oid";
      }
    }
    if (stagedKind === "none") {
      // Fallback: hash staged blob bytes without printing them.
      const staged = gitBuffer(root, ["show", `:${normalized}`]);
      if (staged) {
        stagedDigest = createHash("sha256").update(staged).digest("hex");
        stagedKind = "staged-bytes";
      } else if (indexXy === "D") {
        stagedDigest = "deleted";
        stagedKind = "deleted";
      } else {
        return { kind: "staged-missing", digest: null, stagedDigest: null, worktreeDigest: null };
      }
    }
  }

  let worktreeDigest = "none";
  let workKind = "none";
  if (workXy === "D" || (indexXy === "D" && !existsSync(abs))) {
    worktreeDigest = "deleted";
    workKind = "deleted";
  } else if (workXy === "?" || workXy !== " " || existsSync(abs)) {
    if (!existsSync(abs)) {
      if (workXy !== " " && workXy !== "?" && indexXy !== "D") {
        return { kind: "worktree-missing", digest: null, stagedDigest: null, worktreeDigest: null };
      }
    } else {
      try {
        const st = statSync(abs);
        if (!st.isFile()) {
          return { kind: "not-file", digest: null, stagedDigest: null, worktreeDigest: null };
        }
        if (st.size > 8 * 1024 * 1024) {
          return { kind: "too-large", digest: null, stagedDigest: null, worktreeDigest: null };
        }
        const bytes = readFileSync(abs);
        worktreeDigest = createHash("sha256").update(bytes).digest("hex");
        workKind = "worktree";
      } catch {
        return { kind: "unreadable", digest: null, stagedDigest: null, worktreeDigest: null };
      }
    }
  }

  if (stagedKind === "none" && workKind === "none") {
    return { kind: "empty", digest: null, stagedDigest: null, worktreeDigest: null };
  }
  const digest = createHash("sha256")
    .update(`${xy}\t${normalized}\t${stagedDigest}\t${worktreeDigest}`, "utf8")
    .digest("hex");
  return {
    kind: `${stagedKind}+${workKind}`,
    digest,
    stagedDigest,
    worktreeDigest,
  };
}

function fingerprintDirtyContent(root, entries) {
  const lines = [];
  for (const entry of entries) {
    if (isExcludedIdentityPath(entry.path)) {
      lines.push(`${entry.xy}\t${entry.path}\texcluded\texcluded\texcluded`);
      continue;
    }
    const dig = contentDigestForPath(root, entry.path, entry.xy);
    if (!dig.digest) {
      return { ok: false, reason: dig.kind, fingerprint: null };
    }
    lines.push(
      `${entry.xy}\t${entry.path}\t${dig.kind}\t${dig.stagedDigest}\t${dig.worktreeDigest}\t${dig.digest}`,
    );
  }
  lines.sort();
  // Re-read porcelain mid-flight detection: caller may re-capture; fail closed if empty hash.
  if (lines.length === 0) {
    return { ok: false, reason: "empty-snapshot", fingerprint: null };
  }
  return {
    ok: true,
    reason: "ok",
    fingerprint: createHash("sha256").update(lines.join("\n"), "utf8").digest("hex").slice(0, 32),
  };
}

/**
 * Candidate identity for a working tree. HEAD alone is insufficient when dirty.
 * Dirty identity hashes safe source bytes (staged/unstaged/untracked) + index XY state.
 * Private env / receipt / ignored runtime paths are excluded before any byte read.
 * Incomplete or truncated snapshots fail closed (workingTreeState=unknown).
 */
export function captureCandidateIdentity(cwd = process.cwd()) {
  const root = resolve(cwd);
  const head = (gitText(root, ["rev-parse", "HEAD"]) || "").trim().toLowerCase();
  const headSha = SHA_RE.test(head) ? head : null;
  const porcelain = gitText(root, ["status", "--porcelain=v1", "-z"]);
  if (porcelain === null || !headSha) {
    return {
      headSha,
      workingTreeState: "unknown",
      dirtyPathCount: 0,
      dirtyPathFingerprint: null,
      capturedAt: new Date().toISOString(),
    };
  }
  const entries = parsePorcelainZ(porcelain);
  if (entries === null) {
    return {
      headSha,
      workingTreeState: "unknown",
      dirtyPathCount: 0,
      dirtyPathFingerprint: null,
      capturedAt: new Date().toISOString(),
    };
  }
  // Fail closed when porcelain exceeds the complete-snapshot budget (no silent truncate).
  if (entries.length > MAX_DIRTY_PATHS) {
    return {
      headSha,
      workingTreeState: "unknown",
      dirtyPathCount: entries.length,
      dirtyPathFingerprint: null,
      capturedAt: new Date().toISOString(),
    };
  }
  if (entries.length === 0) {
    return {
      headSha,
      workingTreeState: "clean",
      dirtyPathCount: 0,
      dirtyPathFingerprint: "clean",
      capturedAt: new Date().toISOString(),
    };
  }
  const hashed = fingerprintDirtyContent(root, entries);
  if (!hashed.ok) {
    return {
      headSha,
      workingTreeState: "unknown",
      dirtyPathCount: entries.length,
      dirtyPathFingerprint: null,
      capturedAt: new Date().toISOString(),
    };
  }
  return {
    headSha,
    workingTreeState: "dirty",
    dirtyPathCount: entries.length,
    dirtyPathFingerprint: hashed.fingerprint,
    capturedAt: new Date().toISOString(),
  };
}

export function candidateIdentityKey(candidate) {
  if (!candidate?.headSha || !SHA_RE.test(candidate.headSha)) return null;
  if (candidate.workingTreeState !== "clean" && candidate.workingTreeState !== "dirty") return null;
  if (candidate.workingTreeState === "clean") return `${candidate.headSha.toLowerCase()}|clean`;
  if (!candidate.dirtyPathFingerprint || candidate.dirtyPathFingerprint === "clean") return null;
  return `${candidate.headSha.toLowerCase()}|dirty|${candidate.dirtyPathFingerprint}|${candidate.dirtyPathCount}`;
}

export function candidatesMatch(a, b) {
  const ka = candidateIdentityKey(a);
  const kb = candidateIdentityKey(b);
  return Boolean(ka && kb && ka === kb);
}

/**
 * Map spawnSync / process observation to an honest outcome.
 * Start failure, timeout, and signals never become Pass.
 */
export function outcomeFromProcess(result = {}) {
  const { error = null, status = null, signal = null, timedOut = false } = result;
  if (timedOut) {
    return { outcome: "Blocked", exitStatus: null, reasonCode: "CI_CHECK_TIMEOUT" };
  }
  if (error) {
    const code = error.code === "ETIMEDOUT" ? "CI_CHECK_TIMEOUT" : "CI_CHECK_START_FAILED";
    return { outcome: "Blocked", exitStatus: null, reasonCode: code };
  }
  if (signal) {
    return { outcome: "Blocked", exitStatus: null, reasonCode: "CI_CHECK_SIGNAL" };
  }
  if (status === 0) {
    return { outcome: "Pass", exitStatus: 0, reasonCode: "CI_CHECK_OK" };
  }
  if (status === null || status === undefined) {
    return { outcome: "NotRun", exitStatus: null, reasonCode: "CI_CHECK_NOT_RUN" };
  }
  return { outcome: "Fail", exitStatus: status, reasonCode: "CI_CHECK_FAILED" };
}

export function resolveCheck(checkName) {
  const meta = RUN_CHECKS[checkName];
  if (!meta) return null;
  return meta;
}

/**
 * Build a redacted receipt. Callers must not pass stdout/stderr bodies.
 */
export function buildCheckReceipt(input) {
  const meta = resolveCheck(input.checkName);
  if (!meta) throw Error("CI_UNKNOWN_CHECK");
  const processOutcome = outcomeFromProcess(input.processResult ?? {});
  const startedAt = input.startedAt ?? new Date().toISOString();
  const endedAt = input.endedAt ?? startedAt;
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  const durationMs =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.min(86400000, Math.max(0, Math.round(endMs - startMs)))
      : 0;
  const reasonSource = input.reasonCode ?? processOutcome.reasonCode;
  const reason = redactLogText(String(reasonSource ?? "CI_CHECK_UNKNOWN"));
  const evidenceRef =
    typeof input.evidenceRef === "string" && input.evidenceRef.length > 0 && input.evidenceRef.length <= 512
      ? redactLogText(input.evidenceRef.replaceAll("\\", "/"))
      : null;
  const candidate = input.candidate ?? null;
  const identityKey = candidate ? candidateIdentityKey(candidate) : null;
  return {
    schema: "velora.ci.check_receipt.v1",
    runId: typeof input.runId === "string" && input.runId.length > 0 ? input.runId : randomUUID(),
    check: meta.name,
    scope: meta.scope,
    candidate: candidate
      ? {
          headSha: candidate.headSha,
          workingTreeState: candidate.workingTreeState,
          dirtyPathCount: candidate.dirtyPathCount,
          dirtyPathFingerprint: candidate.dirtyPathFingerprint,
          capturedAt: candidate.capturedAt,
          identityKey,
        }
      : null,
    startedAt,
    endedAt,
    durationMs,
    exitStatus: processOutcome.exitStatus,
    outcome: processOutcome.outcome,
    reasonCode: reason,
    evidenceRef,
    limitations: [...AGGREGATE_LIMITATIONS],
  };
}

export function ensureReceiptDir(dir) {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Receipt workspace helper: creates/writes only under receiptDir.
 * Never copies, opens, or deletes developer .env* under the project root.
 */
export function writeCheckReceipt(receiptDir, receipt) {
  if (!receipt || receipt.schema !== "velora.ci.check_receipt.v1") {
    throw Error("CI_RECEIPT_INVALID");
  }
  if (!OUTCOMES.includes(receipt.outcome)) throw Error("CI_RECEIPT_INVALID_OUTCOME");
  const dir = ensureReceiptDir(receiptDir);
  const safeCheck = String(receipt.check).replace(/[^a-z0-9_-]/gi, "_");
  const fileName = `${receipt.runId}_${safeCheck}.json`;
  const path = join(dir, fileName);
  const body = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(path, body, { encoding: "utf8", flag: "wx" });
  return path.replaceAll("\\", "/");
}

export function readCheckReceipt(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const receipt = JSON.parse(raw);
  if (!receipt || receipt.schema !== "velora.ci.check_receipt.v1") throw Error("CI_RECEIPT_INVALID");
  if (!OUTCOMES.includes(receipt.outcome)) throw Error("CI_RECEIPT_INVALID_OUTCOME");
  return receipt;
}

export function loadReceiptsFromDir(receiptDir) {
  const dir = resolve(receiptDir);
  const names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  return names.map((name) => {
    const full = join(dir, name);
    const st = statSync(full);
    if (!st.isFile()) throw Error("CI_RECEIPT_INVALID");
    return readCheckReceipt(full);
  });
}

/**
 * Aggregate only actual receipts that match the required candidate + scopes.
 * Missing, mixed-candidate, wrong-scope, NotRun/Blocked-as-success are rejected.
 */
export function aggregateLocalReceipts(receipts, options = {}) {
  const requiredChecks = options.requiredChecks ?? Object.keys(RUN_CHECKS);
  const expectedCandidate = options.expectedCandidate ?? null;
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : null;
  const now = Date.parse(options.now ?? new Date().toISOString());

  if (!Array.isArray(receipts) || receipts.length === 0) {
    return {
      ok: false,
      code: "CI_RECEIPTS_MISSING",
      outcome: "Blocked",
      limitations: [...AGGREGATE_LIMITATIONS],
      checks: {},
    };
  }

  const expectedKey = expectedCandidate ? candidateIdentityKey(expectedCandidate) : null;
  if (expectedCandidate && !expectedKey) {
    return {
      ok: false,
      code: "CI_CANDIDATE_IDENTITY_INCOMPLETE",
      outcome: "Blocked",
      limitations: [...AGGREGATE_LIMITATIONS],
      checks: {},
    };
  }

  const byCheck = new Map();
  let observedCandidateKey = expectedKey;
  for (const receipt of receipts) {
    if (!receipt || receipt.schema !== "velora.ci.check_receipt.v1") {
      return {
        ok: false,
        code: "CI_RECEIPT_INVALID",
        outcome: "Blocked",
        limitations: [...AGGREGATE_LIMITATIONS],
        checks: {},
      };
    }
    const meta = resolveCheck(receipt.check);
    if (!meta || receipt.scope !== meta.scope) {
      return {
        ok: false,
        code: "CI_RECEIPT_SCOPE_MISMATCH",
        outcome: "Blocked",
        limitations: [...AGGREGATE_LIMITATIONS],
        checks: {},
      };
    }
    const got = receipt.candidate?.identityKey ?? candidateIdentityKey(receipt.candidate);
    if (!got) {
      return {
        ok: false,
        code: "CI_CANDIDATE_IDENTITY_INCOMPLETE",
        outcome: "Blocked",
        limitations: [...AGGREGATE_LIMITATIONS],
        checks: {},
      };
    }
    if (expectedKey && got !== expectedKey) {
      return {
        ok: false,
        code: "CI_RECEIPT_CANDIDATE_MISMATCH",
        outcome: "Blocked",
        limitations: [...AGGREGATE_LIMITATIONS],
        checks: {},
      };
    }
    if (!observedCandidateKey) observedCandidateKey = got;
    else if (observedCandidateKey !== got) {
      return {
        ok: false,
        code: "CI_RECEIPT_CANDIDATE_MIXED",
        outcome: "Blocked",
        limitations: [...AGGREGATE_LIMITATIONS],
        checks: {},
      };
    }
    if (maxAgeMs !== null && Number.isFinite(now)) {
      const ended = Date.parse(receipt.endedAt);
      if (!Number.isFinite(ended) || now - ended > maxAgeMs || ended > now + 60_000) {
        return {
          ok: false,
          code: "CI_RECEIPT_STALE",
          outcome: "Blocked",
          limitations: [...AGGREGATE_LIMITATIONS],
          checks: {},
        };
      }
    }
    // One receipt per check; prefer newest endedAt if duplicates.
    const prev = byCheck.get(receipt.check);
    if (!prev || Date.parse(receipt.endedAt) >= Date.parse(prev.endedAt)) {
      byCheck.set(receipt.check, receipt);
    }
  }

  const checks = {};
  let allPass = true;
  for (const name of requiredChecks) {
    const receipt = byCheck.get(name);
    if (!receipt) {
      return {
        ok: false,
        code: `CI_RECEIPT_MISSING_${name}`,
        outcome: "Blocked",
        limitations: [...AGGREGATE_LIMITATIONS],
        checks,
      };
    }
    checks[name] = {
      outcome: receipt.outcome,
      exitStatus: receipt.exitStatus,
      reasonCode: receipt.reasonCode,
      evidenceRef: receipt.evidenceRef,
      runId: receipt.runId,
    };
    // Skipped / NotRun / Blocked must never count as successful integration evidence.
    if (receipt.outcome !== "Pass" || receipt.exitStatus !== 0) allPass = false;
  }

  return {
    ok: allPass,
    code: allPass ? "CI_RECEIPTS_OK" : "CI_RECEIPTS_NOT_ALL_PASS",
    outcome: allPass ? "Pass" : "Fail",
    limitations: [...AGGREGATE_LIMITATIONS],
    candidateKey: observedCandidateKey,
    checks,
  };
}

/** Map aggregate / receipt outcomes into the GitHub needs-shaped result used by assertRequiredResults. */
export function gateNeedsFromAggregate(aggregate, extraJobs = {}) {
  const qualityResult = aggregate?.ok === true && aggregate.outcome === "Pass" ? "success" : "failure";
  return {
    quality: { result: qualityResult },
    security: extraJobs.security ?? { result: "failure" },
    secrets: extraJobs.secrets ?? { result: "failure" },
    ...extraJobs,
  };
}

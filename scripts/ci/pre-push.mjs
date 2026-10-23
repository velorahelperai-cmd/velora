import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyWorkspace, git, ORIGIN } from '../consolidation/guard.mjs';
import { assertNoRuntimeEnvFiles, isolatedEnvironment } from './safety.mjs';

const sha = value => /^[a-f0-9]{40}$/.test(value ?? '');
export function parsePush(input, head) {
  const lines = input.trim().split('\n').filter(Boolean);
  if (lines.length !== 1) throw Error('PRE_PUSH_SINGLE_MAIN_UPDATE_REQUIRED');
  const [localRef, localSha, remoteRef, remoteSha, extra] = lines[0].trim().split(/\s+/);
  if (extra || localRef !== 'refs/heads/main' || remoteRef !== 'refs/heads/main'
    || !sha(localSha) || localSha === '0'.repeat(40) || localSha !== head
    || !sha(remoteSha) || remoteSha === '0'.repeat(40)) throw Error('PRE_PUSH_MAIN_SOURCE_INVALID');
  return { head: localSha, base: remoteSha };
}
export function gatePlan(npmCli) {
  return [
    { id: 'dependencies/install', category: 'dependencies', args: [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'] },
    ...['typecheck', 'lint', 'unit', 'contracts', 'build', 'safety'].map(check => ({ id: check, category: check, args: ['scripts/ci/run.mjs', check] })),
    { id: 'security', category: 'security', args: ['scripts/ci/security.mjs'] },
    { id: 'dependencies/audit', category: 'dependencies', args: [npmCli, 'audit', '--audit-level=moderate'] },
    { id: 'secrets/install', category: 'secret_scanning', args: ['scripts/ci/gitleaks-install.mjs'] },
    { id: 'secrets/self-test', category: 'secret_scanning', args: ['scripts/ci/gitleaks.mjs', 'self-test'] },
    { id: 'secrets/tree', category: 'secret_scanning', args: ['scripts/ci/gitleaks.mjs', 'tree'] },
    { id: 'secrets/range', category: 'secret_scanning', args: ['scripts/ci/gitleaks.mjs', 'range'] },
  ];
}
export function runGates(plan, runner, assertCandidate = () => {}) {
  const passed = [];
  for (const gate of plan) {
    assertCandidate();
    const result = runner(gate);
    if (result?.error || result?.signal || result?.status !== 0) throw Error('PRE_PUSH_GATE_FAILED:' + gate.id);
    assertCandidate();
    passed.push(gate.id);
  }
  return passed;
}
function candidateTree() {
  const changed = spawnSync('git', ['diff', '--quiet'], { windowsHide: true });
  if (changed.status !== 0 || git('ls-files', '--others', '--exclude-standard', '-z')) throw Error('PRE_PUSH_UNSTAGED_OR_UNTRACKED_FILES');
  return git('write-tree');
}
const digest = value => createHash('sha256').update(value).digest('hex');
function readReceipt(file) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } }
export function receiptMatches(receipt, identity, required) {
  return receipt?.result === 'PASS' && receipt.tree === identity.tree && receipt.base === identity.base
    && receipt.owner === identity.owner && receipt.task === identity.task && receipt.node === identity.node
    && receipt.platform === identity.platform && receipt.installFingerprint === identity.installFingerprint
    && Array.isArray(receipt.passed) && receipt.passed.length === required.length
    && new Set(receipt.passed).size === required.length && required.every(id => receipt.passed.includes(id));
}
function main() {
  const ownership = verifyWorkspace();
  const mode = process.argv[2];
  if (mode === 'install') {
    git('config', '--local', 'core.hooksPath', '.githooks');
    console.log('Git pre-push installed: .githooks/pre-push'); return;
  }
  assertNoRuntimeEnvFiles(process.cwd());
  const head = git('rev-parse', 'HEAD');
  let base;
  if (mode === 'check') {
    const remote = spawnSync('git', ['-c', 'credential.username=velorahelperai-cmd', 'ls-remote', 'origin', 'refs/heads/main'],
      { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, windowsHide: true });
    if (remote.status !== 0) throw Error('PRE_PUSH_REMOTE_MAIN_UNVERIFIED');
    base = remote.stdout.trim().split(/\s+/)[0];
    if (!sha(base)) throw Error('PRE_PUSH_REMOTE_MAIN_UNVERIFIED');
  } else {
    if (mode !== 'origin' || process.argv[3] !== ORIGIN) throw Error('PRE_PUSH_ORIGIN_MISMATCH');
    base = parsePush(readFileSync(0, 'utf8'), head).base;
  }
  git('merge-base', '--is-ancestor', base, head);
  const lock = JSON.parse(readFileSync('.git/velora-writer-lock.json', 'utf8'));
  git('merge-base', '--is-ancestor', lock.publicationBase, base);
  const tree = candidateTree();
  if (mode !== 'check' && git('rev-parse', 'HEAD^{tree}') !== tree) throw Error('PRE_PUSH_HEAD_TREE_MISMATCH');
  const npmCli = process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath
    : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(npmCli)) throw Error('PRE_PUSH_NPM_RUNTIME_MISSING');
  const directory = resolve('.git/velora-pre-push', tree);
  mkdirSync(directory, { recursive: true });
  const installFingerprint = () => existsSync('node_modules/.package-lock.json') ? digest(readFileSync('node_modules/.package-lock.json')) : 'missing';
  const identity = { tree, base, owner: ownership.owner, task: ownership.task, node: process.version, platform: process.platform,
    installFingerprint: installFingerprint() };
  const plan = gatePlan(npmCli);
  const allIds = plan.map(gate => gate.id);
  const treePlan = plan.filter(gate => gate.id !== 'secrets/range');
  const treeIds = treePlan.map(gate => gate.id);
  const fullFile = join(directory, 'full.json');
  const treeFile = join(directory, 'tree.json');
  const current = readReceipt(fullFile);
  const assertCandidate = () => {
    verifyWorkspace();
    if (candidateTree() !== tree || git('rev-parse', 'HEAD') !== head) throw Error('PRE_PUSH_CANDIDATE_CHANGED');
  };
  assertCandidate();
  if (mode !== 'check' && current?.head === head && receiptMatches(current, identity, allIds)) {
    console.log('Pre-push PASS: exact commit/tree and unchanged task/runtime receipt verified.'); return;
  }
  const childEnv = { ...isolatedEnvironment(), VELORA_WRITER_ID: ownership.owner,
    VELORA_CI_RECEIPT_DIR: join(directory, 'checks'), SECRET_SCAN_BASE: base };
  const runner = gate => {
    console.log('PRE_PUSH_GATE ' + gate.id);
    return spawnSync(process.execPath, gate.args, { env: childEnv, stdio: 'inherit', windowsHide: true });
  };
  const cached = readReceipt(treeFile);
  let passed;
  if (receiptMatches(cached, identity, treeIds)) {
    passed = [...treeIds];
    console.log('Pre-push: reusing passing checks for identical staged tree, task, dependencies and Node runtime.');
  } else {
    passed = runGates(treePlan, runner, assertCandidate);
    identity.installFingerprint = installFingerprint();
    writeFileSync(treeFile, JSON.stringify({ ...identity, passed, result: 'PASS', testedAt: new Date().toISOString() }, null, 2) + '\n');
  }
  if (mode !== 'check') {
    passed.push(...runGates(plan.filter(gate => gate.id === 'secrets/range'), runner, assertCandidate));
    writeFileSync(fullFile, JSON.stringify({ ...identity, head, passed, result: 'PASS', testedAt: new Date().toISOString() }, null, 2) + '\n');
  }
  console.log('Pre-push PASS: ' + (mode === 'check' ? 'staged candidate tree; commit-range scan remains mandatory in Git hook.' : 'exact commit, all mandatory gates.') );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    const code = /^[A-Z_]+(?::[\w/-]+)?$/.test(error.message) ? error.message : 'PRE_PUSH_VERIFICATION_FAILED';
    console.error(JSON.stringify({ stage: 'pre_push', error_code: code })); process.exitCode = 1;
  }
}

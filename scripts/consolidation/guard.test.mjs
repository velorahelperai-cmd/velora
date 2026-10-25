import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkspace, normalizeScope, overlaps, reservationFingerprint, ORIGIN, REPOSITORY } from './guard.mjs';
import { writerRequest, runWriterRequest } from './writer.mjs';
const commit = 'a'.repeat(40);
const local = () => ({ env: {}, platform: 'win32', directoryMatches: true, gitRootMatches: true, commonDirectoryMatches: true,
  origin: ORIGIN, branch: 'main', account: 'velorahelperai-cmd', writable: true, status: '', writer: 'writer-A',
  task: 'TRANSITION', registry: { schemaVersion: 2, deliveryOwner: null, deliveryTask: null,
    reservations: [{ owner: 'writer-A', task: 'TRANSITION', paths: ['src/a.ts'], publicationBase: commit }] } });
test('local main accepts an explicitly assigned writer without a pinned Codex session', () => {
  assert.equal(validateWorkspace(local()).owner, 'writer-A');
  const c = local(); c.writer = c.registry.reservations[0].owner = 'cursor-owner'; assert.equal(validateWorkspace(c).owner, 'cursor-owner');
});
for (const [name, patch, code] of [
  ['wrong directory', { directoryMatches: false }, 'WORKING_DIRECTORY_MISMATCH'],
  ['wrong git root', { gitRootMatches: false }, 'GIT_ROOT_MISMATCH'],
  ['foreign git metadata', { commonDirectoryMatches: false }, 'GIT_ROOT_MISMATCH'],
  ['foreign origin', { origin: 'https://github.com/foreign/repo.git' }, 'ORIGIN_MISMATCH'],
  ['legacy branch', { branch: 'codex/desktop-consolidation-20261015' }, 'BRANCH_MISMATCH'],
  ['wrong account', { account: 'other-account' }, 'GITHUB_ACCOUNT_MISMATCH'],
  ['denied write permission', { writable: false }, 'WORKSPACE_PERMISSION_DENIED'],
  ['foreign writer', { writer: 'writer-B' }, 'PATH_RESERVATION_REQUIRED'],
  ['missing writer', { writer: undefined }, 'WRITER_ID_INVALID'],
  ['unresolved index', { status: 'UU protected.ts' }, 'UNRESOLVED_INDEX_CONFLICT'],
]) test('local guard rejects ' + name, () => assert.throws(() => validateWorkspace({ ...local(), ...patch }), new RegExp(code)));
test('legacy receipt alone never grants file ownership', () => {
  for (const registry of [undefined, null, { schemaVersion: 1, reservations: [] }])
    assert.throws(() => validateWorkspace({ ...local(), registry,
      lock: { owner: 'writer-A', status: 'active' } }), /RESERVATION_REGISTRY_INVALID/);
});
test('independent paths may coexist but overlap blocks both owners', () => {
  const c = local();
  c.registry.reservations.push({ owner: 'writer-B', task: 'OTHER', paths: ['src/b.ts'], publicationBase: commit });
  assert.equal(validateWorkspace(c).task, 'TRANSITION');
  assert.equal(validateWorkspace({ ...c, writer: 'writer-B', task: 'OTHER' }).task, 'OTHER');
  c.registry.reservations[1].paths = ['src/**'];
  assert.throws(() => validateWorkspace(c), /OVERLAPPING_RESERVATIONS/);
});
test('task selection and publication baseline are mandatory for delivery identity', () => {
  const c = local();
  c.registry.reservations.push({ owner: c.writer, task: 'OTHER', paths: ['src/b.ts'], publicationBase: commit });
  assert.throws(() => validateWorkspace({ ...c, task: undefined }), /TASK_ID_REQUIRED/);
  assert.throws(() => validateWorkspace({ ...c, task: 'FOREIGN' }), /TASK_RESERVATION_REQUIRED/);
  assert.equal(validateWorkspace(c).task, 'TRANSITION');
  delete c.registry.reservations[0].publicationBase;
  assert.throws(() => validateWorkspace(c), /PUBLICATION_BASE_REQUIRED/);
});
test('delivery requires the selected task claim and paused other writers', () => {
  const c = local();
  assert.throws(() => validateWorkspace(c, { delivery: true }), /DELIVERY_OWNERSHIP_REQUIRED/);
  c.registry.deliveryOwner = c.writer; c.registry.deliveryTask = c.task;
  assert.equal(validateWorkspace(c, { delivery: true }).task, c.task);
  c.registry.deliveryTask = 'OTHER';
  assert.throws(() => validateWorkspace(c, { delivery: true }), /DELIVERY_OWNERSHIP_REQUIRED/);
  c.registry.deliveryTask = c.task;
  c.registry.reservations.push({ owner: 'writer-B', task: 'OTHER', paths: ['src/b.ts'], publicationBase: commit });
  assert.throws(() => validateWorkspace(c, { delivery: true }), /ACTIVE_WRITERS_MUST_PAUSE/);
});
test('scope parsing rejects traversal and Git metadata including Windows case aliases', () => {
  for (const value of ['../a', '/a', 'C:\\a', '.git/config', '.GIT/**', 'a/../b', 'a/*'])
    assert.throws(() => normalizeScope(value));
  assert.equal(normalizeScope('Src/A.ts'), 'src/a.ts');
  assert.equal(overlaps('src/**', 'SRC/a.ts'), true);
  assert.equal(overlaps('src/a.ts', 'src/b.ts'), false);
  const c = local(); c.registry.reservations.push({ owner: 'writer-B', task: 'OTHER', paths: [] });
  assert.throws(() => validateWorkspace(c), /RESERVATION_REGISTRY_INVALID/);
});
test('lease identity is order-stable and changes with task, scope, baseline or delivery', () => {
  const a = local().registry;
  a.reservations[0].paths.push('src/z.ts');
  a.reservations.push({ owner: 'writer-A', task: 'OTHER', paths: ['tests/b.ts', 'tests/a.ts'], publicationBase: commit });
  const b = structuredClone(a);
  b.reservations.reverse(); b.reservations.forEach(x => x.paths.reverse());
  assert.equal(reservationFingerprint(a), reservationFingerprint(b));
  for (const mutate of [x => x.reservations[0].task = 'OTHER',
    x => x.reservations[0].paths.push('src/b.ts'), x => x.reservations[0].publicationBase = 'b'.repeat(40),
    x => { x.deliveryOwner = 'writer-A'; x.deliveryTask = 'TRANSITION'; }]) {
    const changed = structuredClone(a); mutate(changed);
    assert.notEqual(reservationFingerprint(a), reservationFingerprint(changed));
  }
});
test('writer helper delegates explicit paths and current identity to the registry API', () => {
  const seen = [];
  const api = { basicLocalCheck: () => 'actual-owner', reservePaths: value => { seen.push(value); return value; },
    releasePaths: value => { seen.push(value); return value; } };
  const request = writerRequest(['acquire', '--paths=src/a.ts,src/b.ts'], { VELORA_TASK_ID: 'TASK' });
  runWriterRequest(request, {}, api);
  runWriterRequest(writerRequest(['release', '--task=TASK'], {}), {}, api);
  assert.deepEqual(seen, [{ owner: 'actual-owner', task: 'TASK', paths: ['src/a.ts', 'src/b.ts'] },
    { owner: 'actual-owner', task: 'TASK' }]);
  assert.throws(() => writerRequest(['acquire', '--handoff', 'old-whole-repo'], { VELORA_TASK_ID: 'TASK' }), /RESERVATION_INPUT_INVALID/);
  assert.throws(() => writerRequest(['release'], {}), /TASK_ID_REQUIRED/);
  assert.throws(() => writerRequest(['acquire', '--task=TASK', '--paths=.git/config'], {}), /GIT_METADATA_RESERVED/);
  assert.throws(() => runWriterRequest({ action: 'unknown', task: 'TASK' }, {}, api), /WRITER_ACTION_INVALID/);
});
const ci = () => ({ platform: 'linux', origin: ORIGIN, head: commit, workspaceMatches: true,
  env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_SHA: commit, GITHUB_REF: 'refs/heads/main' } });
test('GitHub main and main-target PR/merge queue retain source checks', () => {
  assert.equal(validateWorkspace(ci()).mode, 'github_ci');
  for (const extra of [{ GITHUB_REF: 'refs/pull/1/merge', GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' },
    { GITHUB_REF: 'refs/heads/gh-readonly-queue/main/pr-1', GITHUB_EVENT_NAME: 'merge_group' }])
    assert.equal(validateWorkspace({ ...ci(), env: { ...ci().env, ...extra } }).mode, 'github_ci');
});
test('GitHub rejects foreign repo, branch, commit and local environment spoofing', () => {
  for (const extra of [{ GITHUB_REPOSITORY: 'foreign/repo' }, { GITHUB_REF: 'refs/heads/other' }, { GITHUB_SHA: '' }])
    assert.throws(() => validateWorkspace({ ...ci(), env: { ...ci().env, ...extra } }));
  assert.throws(() => validateWorkspace({ ...ci(), head: 'b'.repeat(40) }), /COMMIT_MISMATCH/);
  assert.throws(() => validateWorkspace({ ...ci(), workspaceMatches: false }), /GIT_ROOT_MISMATCH/);
  assert.throws(() => validateWorkspace({ ...ci(), platform: 'win32' }), /PLATFORM_MISMATCH/);
});
const vercel = () => ({ platform: 'linux', env: { VERCEL: '1', VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'velorahelperai-cmd', VERCEL_GIT_REPO_SLUG: 'velora', VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_SHA: commit, VERCEL_GIT_COMMIT_REF: 'main' } });
test('Vercel accepts exact main source in production and preview without .git', () => {
  for (const VERCEL_ENV of ['production', 'preview']) assert.equal(validateWorkspace({ ...vercel(), env: { ...vercel().env, VERCEL_ENV } }).mode, 'vercel_build');
});
test('Vercel rejects foreign source, branch, absent SHA and Windows spoofing', () => {
  for (const extra of [{ VERCEL_GIT_REPO_OWNER: 'foreign' }, { VERCEL_GIT_COMMIT_REF: 'other' },
    { VERCEL_GIT_COMMIT_SHA: '' }, { VERCEL_ENV: 'unknown' }])
    assert.throws(() => validateWorkspace({ ...vercel(), env: { ...vercel().env, ...extra } }));
  assert.throws(() => validateWorkspace({ ...vercel(), platform: 'win32' }), /PLATFORM_MISMATCH/);
});

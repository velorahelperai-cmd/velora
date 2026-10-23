import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkspace, ROOT, ORIGIN, REPOSITORY, WRITER_SCOPE } from './guard.mjs';
const commit = 'a'.repeat(40);
const local = () => ({ env: {}, platform: 'win32', directoryMatches: true, gitRootMatches: true, commonDirectoryMatches: true,
  origin: ORIGIN, branch: 'main', account: 'velorahelperai-cmd', writable: true, status: '', writer: 'writer-A',
  lock: { schemaVersion: 1, owner: 'writer-A', root: ROOT, status: 'active', scope: WRITER_SCOPE, branch: 'main',
    task: 'TRANSITION', handoff: 'explicit owner handoff', acquiredAt: '2026-10-23T05:00:00Z' } });
test('local main accepts an explicitly assigned writer without a pinned Codex session', () => {
  assert.equal(validateWorkspace(local()).owner, 'writer-A');
  const c = local(); c.writer = c.lock.owner = 'cursor-owner'; assert.equal(validateWorkspace(c).owner, 'cursor-owner');
});
for (const [name, patch, code] of [
  ['wrong directory', { directoryMatches: false }, 'WORKING_DIRECTORY_MISMATCH'],
  ['wrong git root', { gitRootMatches: false }, 'GIT_ROOT_MISMATCH'],
  ['foreign git metadata', { commonDirectoryMatches: false }, 'GIT_ROOT_MISMATCH'],
  ['foreign origin', { origin: 'https://github.com/foreign/repo.git' }, 'ORIGIN_MISMATCH'],
  ['legacy branch', { branch: 'codex/desktop-consolidation-20261015' }, 'BRANCH_MISMATCH'],
  ['wrong account', { account: 'other-account' }, 'GITHUB_ACCOUNT_MISMATCH'],
  ['denied write permission', { writable: false }, 'WORKSPACE_PERMISSION_DENIED'],
  ['foreign writer', { writer: 'writer-B' }, 'WRITER_OWNERSHIP_MISMATCH'],
  ['missing writer', { writer: undefined }, 'WRITER_OWNERSHIP_MISMATCH'],
  ['unresolved index', { status: 'UU protected.ts' }, 'UNRESOLVED_INDEX_CONFLICT'],
]) test('local guard rejects ' + name, () => assert.throws(() => validateWorkspace({ ...local(), ...patch }), new RegExp(code)));
test('absent, released and partial-scope locks cannot grant ownership', () => {
  for (const lock of [null, { ...local().lock, status: 'released' }, { ...local().lock, scope: 'one-file' }])
    assert.throws(() => validateWorkspace({ ...local(), lock }), /WRITER_LOCK_INVALID/);
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

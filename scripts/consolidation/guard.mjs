import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = 'C:\\Users\\DELL\\Desktop\\Velora new';
export const ORIGIN = 'https://github.com/velorahelperai-cmd/velora.git';
export const REPOSITORY = 'velorahelperai-cmd/velora';
export const WRITER_SCOPE = 'entire-repository-including-generated-output';
const sha = value => /^[a-f0-9]{40}$/.test(value ?? '');
const requireThat = (condition, code) => { if (!condition) throw Error(code); };

export function validateWorkspace(c) {
  const e = c.env ?? {};
  if (e.GITHUB_ACTIONS === 'true') {
    requireThat(c.platform === 'linux', 'PLATFORM_MISMATCH');
    requireThat(e.GITHUB_REPOSITORY === REPOSITORY, 'REPOSITORY_MISMATCH');
    requireThat(c.origin === ORIGIN || c.origin === ORIGIN.slice(0, -4), 'ORIGIN_MISMATCH');
    requireThat(c.workspaceMatches, 'GIT_ROOT_MISMATCH');
    requireThat(sha(e.GITHUB_SHA) && c.head === e.GITHUB_SHA, 'COMMIT_MISMATCH');
    const main = e.GITHUB_REF === 'refs/heads/main'
      || (e.GITHUB_EVENT_NAME === 'pull_request' && e.GITHUB_BASE_REF === 'main')
      || (e.GITHUB_EVENT_NAME === 'merge_group' && e.GITHUB_REF?.startsWith('refs/heads/gh-readonly-queue/main/'));
    requireThat(main, 'BRANCH_MISMATCH');
    return { stage: 'workspace_guard', mode: 'github_ci', repository: REPOSITORY, commit: c.head };
  }
  if (e.VERCEL === '1') {
    requireThat(c.platform === 'linux', 'PLATFORM_MISMATCH');
    requireThat(e.VERCEL_GIT_PROVIDER === 'github' && e.VERCEL_GIT_REPO_OWNER === 'velorahelperai-cmd'
      && e.VERCEL_GIT_REPO_SLUG === 'velora', 'REPOSITORY_MISMATCH');
    requireThat(['production', 'preview'].includes(e.VERCEL_ENV) && sha(e.VERCEL_GIT_COMMIT_SHA), 'DEPLOYMENT_SOURCE_MISSING');
    requireThat(e.VERCEL_GIT_COMMIT_REF === 'main', 'BRANCH_MISMATCH');
    return { stage: 'workspace_guard', mode: 'vercel_build', repository: REPOSITORY, commit: e.VERCEL_GIT_COMMIT_SHA };
  }
  requireThat(c.platform === 'win32', 'PLATFORM_MISMATCH');
  requireThat(c.directoryMatches, 'WORKING_DIRECTORY_MISMATCH');
  requireThat(c.gitRootMatches && c.commonDirectoryMatches, 'GIT_ROOT_MISMATCH');
  requireThat(c.origin === ORIGIN, 'ORIGIN_MISMATCH');
  requireThat(c.branch === 'main', 'BRANCH_MISMATCH');
  requireThat(c.account === 'velorahelperai-cmd', 'GITHUB_ACCOUNT_MISMATCH');
  requireThat(c.writable, 'WORKSPACE_PERMISSION_DENIED');
  const lock = c.lock;
  requireThat(lock?.schemaVersion === 1 && lock.status === 'active'
    && lock.scope === WRITER_SCOPE && lock.root?.toLowerCase() === ROOT.toLowerCase()
    && lock.branch === 'main' && typeof lock.task === 'string' && lock.task.length > 0
    && typeof lock.handoff === 'string' && lock.handoff.length > 0
    && Number.isFinite(Date.parse(lock.acquiredAt)), 'WRITER_LOCK_INVALID');
  requireThat(typeof c.writer === 'string' && /^[\w.:-]{1,128}$/.test(c.writer)
    && c.writer === lock.owner, 'WRITER_OWNERSHIP_MISMATCH');
  requireThat(!(c.status ?? '').split('\n').some(line => /^(UU|AA|DD|AU|UA|DU|UD) /.test(line)), 'UNRESOLVED_INDEX_CONFLICT');
  return { stage: 'workspace_guard', mode: 'local', error_code: null, root: ROOT, branch: 'main', owner: lock.owner, task: lock.task };
}

export function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}
const same = (a, b) => realpathSync(resolve(a)).toLowerCase() === realpathSync(resolve(b)).toLowerCase();
export function readLocalContext(env = process.env) {
  const directoryMatches = same(process.cwd(), ROOT);
  requireThat(directoryMatches, 'WORKING_DIRECTORY_MISMATCH');
  let writable = true;
  try { accessSync(ROOT, constants.W_OK); accessSync(resolve('.git'), constants.W_OK); } catch { writable = false; }
  const file = resolve('.git/velora-writer-lock.json');
  return { env, platform: process.platform, directoryMatches, gitRootMatches: same(git('rev-parse', '--show-toplevel'), ROOT),
    commonDirectoryMatches: same(git('rev-parse', '--git-common-dir'), resolve(ROOT, '.git')),
    origin: git('remote', 'get-url', 'origin'), branch: git('branch', '--show-current'),
    account: git('config', '--get', 'credential.username'), writable, status: git('status', '--porcelain=v1', '--untracked-files=normal'),
    writer: env.VELORA_WRITER_ID ?? env.CODEX_THREAD_ID,
    lock: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null };
}
export function verifyWorkspace(env = process.env) {
  let c;
  if (env.GITHUB_ACTIONS === 'true') {
    c = { env, platform: process.platform, origin: git('remote', 'get-url', 'origin'), head: git('rev-parse', 'HEAD'),
      workspaceMatches: !!env.GITHUB_WORKSPACE && same(git('rev-parse', '--show-toplevel'), env.GITHUB_WORKSPACE) };
  } else if (env.VERCEL === '1') c = { env, platform: process.platform };
  else c = readLocalContext(env);
  return validateWorkspace(c);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(verifyWorkspace())); }
  catch (error) {
    const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'WORKSPACE_VERIFICATION_FAILED';
    console.error(JSON.stringify({ stage: 'workspace_guard', error_code: code })); process.exitCode = 1;
  }
}

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const root = 'C:\\Users\\DELL\\Desktop\\Velora new';
const branch = 'codex/desktop-consolidation-20261015';
const owner = '01a160e9-558f-7183-88ac-89307520f011';
function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function fail(code) { console.error(JSON.stringify({ stage: 'workspace_guard', error_code: code })); process.exit(1); }
try {
  if (process.env.GITHUB_ACTIONS === 'true') {
    if (process.env.GITHUB_REPOSITORY !== 'velorahelperai-cmd/velora') fail('REPOSITORY_MISMATCH');
    console.log(JSON.stringify({ stage: 'workspace_guard', mode: 'github_ci', repository: process.env.GITHUB_REPOSITORY }));
  } else if (process.env.VERCEL === '1') {
    // Vercel strips .git and deploys on Linux. Its system metadata identifies
    // the Git source; local checkout/author restrictions still apply below.
    if (process.env.VERCEL_GIT_PROVIDER !== 'github'
      || process.env.VERCEL_GIT_REPO_OWNER !== 'velorahelperai-cmd'
      || process.env.VERCEL_GIT_REPO_SLUG !== 'velora') fail('REPOSITORY_MISMATCH');
    if (!['production', 'preview'].includes(process.env.VERCEL_ENV)
      || !/^[a-f0-9]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA ?? '')
      || !process.env.VERCEL_GIT_COMMIT_REF?.trim()) fail('DEPLOYMENT_SOURCE_MISSING');
    if (process.env.VERCEL_ENV === 'production'
      && process.env.VERCEL_GIT_COMMIT_REF !== 'main') fail('PRODUCTION_BRANCH_MISMATCH');
    console.log(JSON.stringify({ stage: 'workspace_guard', mode: 'vercel_build', repository: 'velorahelperai-cmd/velora', commit: process.env.VERCEL_GIT_COMMIT_SHA }));
  } else {
    if (process.platform !== 'win32') fail('PLATFORM_MISMATCH');
    const canonical = realpathSync(root).toLowerCase();
    if (realpathSync(process.cwd()).toLowerCase() !== canonical) fail('WORKING_DIRECTORY_MISMATCH');
    if (realpathSync(resolve(git('rev-parse', '--show-toplevel'))).toLowerCase() !== canonical) fail('GIT_ROOT_MISMATCH');
    if (git('remote', 'get-url', 'origin') !== 'https://github.com/velorahelperai-cmd/velora.git') fail('ORIGIN_MISMATCH');
    if (git('branch', '--show-current') !== branch) fail('BRANCH_MISMATCH');
    if (process.env.CODEX_THREAD_ID !== owner) fail('WRITER_OWNERSHIP_MISMATCH');
    const status = git('status', '--porcelain=v1', '--untracked-files=normal');
    if (status.split('\n').some(line => /^(UU|AA|DD|AU|UA|DU|UD) /.test(line))) fail('UNRESOLVED_INDEX_CONFLICT');
    console.log(JSON.stringify({ stage: 'workspace_guard', error_code: null, root, branch, owner, dirtyPaths: status ? status.split('\n').length : 0 }));
  }
} catch { fail('WORKSPACE_VERIFICATION_FAILED'); }

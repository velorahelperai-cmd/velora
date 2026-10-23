import { openSync, closeSync, unlinkSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readLocalContext, validateWorkspace, verifyWorkspace, WRITER_SCOPE, ROOT, git } from './guard.mjs';

const claim = resolve('.git/velora-writer-claim.lock');
const file = resolve('.git/velora-writer-lock.json');
let fd;
try {
  const action = process.argv[2];
  if (!['acquire', 'release'].includes(action)) throw Error('WRITER_ACTION_INVALID');
  const c = readLocalContext();
  if (action === 'release') verifyWorkspace();
  else {
    const handoff = process.argv[3] === '--handoff' ? process.argv.slice(4).join(' ').trim() : '';
    if (!handoff) throw Error('EXPLICIT_HANDOFF_REFERENCE_REQUIRED');
    c.lock = { schemaVersion: 1, owner: c.writer, root: ROOT, scope: WRITER_SCOPE, branch: 'main',
      task: process.env.VELORA_TASK_ID, status: 'active', handoff, acquiredAt: new Date().toISOString() };
    validateWorkspace(c);
  }
  fd = openSync(claim, 'wx');
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (action === 'acquire') {
    if (previous && previous.status !== 'released') throw Error('ACTIVE_WRITER_MUST_RELEASE');
    writeFileSync(file, JSON.stringify({ ...c.lock, head: git('rev-parse', 'HEAD'),
      publicationBase: git('rev-parse', 'refs/remotes/origin/main'), previousOwner: previous?.owner ?? null }, null, 2) + '\n');
  } else {
    if (previous?.owner !== c.writer || previous.status !== 'active') throw Error('WRITER_OWNERSHIP_CHANGED');
    writeFileSync(file, JSON.stringify({ ...previous, status: 'released', releasedAt: new Date().toISOString() }, null, 2) + '\n');
  }
  console.log(JSON.stringify({ stage: 'writer_ownership', action, owner: c.writer, scope: WRITER_SCOPE }));
} catch (error) {
  console.error(JSON.stringify({ stage: 'writer_ownership', error_code: /^[A-Z_]+$/.test(error.message) ? error.message : 'WRITER_OPERATION_FAILED' }));
  process.exitCode = 1;
} finally {
  if (fd !== undefined) { closeSync(fd); unlinkSync(claim); }
}

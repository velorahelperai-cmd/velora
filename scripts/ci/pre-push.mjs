import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { indexManifest, extractIndex, assertManifestUnchanged, assertSnapshot, capturePreserved, assertPreserved, gateInvocation, assertApprovedDelta } from './candidate-snapshot.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyWorkspace, git, overlaps, ORIGIN } from '../consolidation/guard.mjs';
import { assertNoRuntimeEnvFiles, isolatedEnvironment } from './safety.mjs';

const sha = value => /^[a-f0-9]{40}$/.test(value ?? '');
export function parsePush(input, head, source) {
  const lines = input.trim().split('\n').filter(Boolean);
  if (lines.length !== 1) throw Error('PRE_PUSH_SINGLE_MAIN_UPDATE_REQUIRED');
  const [localRef, localSha, remoteRef, remoteSha, extra] = lines[0].trim().split(/\s+/);
  const verifiedMain = source?.symbolicHead === 'refs/heads/main' && source?.mainHead === head;
  if ((source !== undefined && !verifiedMain) || (localRef === 'HEAD' && !verifiedMain)
    || extra || !['refs/heads/main', 'HEAD'].includes(localRef) || remoteRef !== 'refs/heads/main'
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
const digest = value => createHash('sha256').update(value).digest('hex');
export function deliveryIdentity(ownership) {
  if (ownership?.mode !== 'local' || typeof ownership.owner !== 'string' || !ownership.owner
    || typeof ownership.task !== 'string' || !ownership.task.trim()
    || !sha(ownership.publicationBase)
    || !/^[a-f0-9]{64}$/.test(ownership.reservationFingerprint ?? '')) {
    throw Error('PRE_PUSH_OWNERSHIP_INVALID');
  }
  return { owner: ownership.owner, task: ownership.task, publicationBase: ownership.publicationBase,
    reservationFingerprint: ownership.reservationFingerprint };
}
export function assertSameOwnership(expected, current) {
  if (JSON.stringify(deliveryIdentity(expected)) !== JSON.stringify(deliveryIdentity(current))) {
    throw Error('PRE_PUSH_OWNERSHIP_CHANGED');
  }
}
export function assertCandidatePathsOwned(paths, ownership) {
  if (!Array.isArray(ownership.paths) || !ownership.paths.length
    || paths.some(path => !ownership.paths.some(scope => overlaps(scope, path)))) {
    throw Error('PRE_PUSH_UNLEASED_PATH');
  }
}
export function receiptMatches(receipt, identity, required) {
  if (typeof identity.task !== 'string' || !identity.task.trim()
    || !sha(identity.publicationBase) || !/^[a-f0-9]{64}$/.test(identity.reservationFingerprint ?? '')) return false;
  return receipt?.result === 'PASS' && receipt.tree === identity.tree && receipt.base === identity.base
    && receipt.owner === identity.owner && receipt.task === identity.task
    && receipt.publicationBase === identity.publicationBase
    && receipt.reservationFingerprint === identity.reservationFingerprint && receipt.node === identity.node
    && receipt.platform === identity.platform && receipt.installFingerprint === identity.installFingerprint
    && Array.isArray(receipt.passed) && receipt.passed.length === required.length
    && new Set(receipt.passed).size === required.length && required.every(id => receipt.passed.includes(id));
}
export function assertCanonicalDrivers(root,manifest) {
  for (const entry of manifest.entries.filter(entry => entry.path.startsWith('scripts/ci/') || entry.path.startsWith('.githooks/') || entry.path === 'scripts/consolidation/guard.mjs' || entry.path === 'src/lib/logging/redaction.mjs')) {
    const value=spawnSync('git',['hash-object','--path='+entry.path,entry.path],{cwd:root,encoding:'utf8',env:{...isolatedEnvironment(),GIT_OPTIONAL_LOCKS:'0'},windowsHide:true});
    if(value.status!==0||value.stdout.trim()!==entry.oid)throw Error('PRE_PUSH_DRIVER_NOT_STAGED');
  }
}
function main() {
  // Never let inherited Git redirect options re-point canonical ownership checks.
  for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE'])delete process.env[key];
  process.env.GIT_OPTIONAL_LOCKS='0';
  const mode=process.argv[2];
  const ownership=verifyWorkspace(process.env,{delivery:mode!=='install'});
  if(mode==='install'){git('config','--local','core.hooksPath','.githooks');console.log('Git pre-push installed: .githooks/pre-push');return;}
  const root=realpathSync(process.cwd());assertNoRuntimeEnvFiles(root);
  const head=git('rev-parse','HEAD');let base;
  if(mode==='check'){
    const remote=spawnSync('git',['-c','credential.username=velorahelperai-cmd','ls-remote','origin','refs/heads/main'],{encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},windowsHide:true});
    if(remote.status!==0)throw Error('PRE_PUSH_REMOTE_MAIN_UNVERIFIED');
    base=remote.stdout.trim().split(/\s+/)[0];if(!sha(base))throw Error('PRE_PUSH_REMOTE_MAIN_UNVERIFIED');
  }else{
    if(mode!=='origin'||process.argv[3]!==ORIGIN)throw Error('PRE_PUSH_ORIGIN_MISMATCH');
    base=parsePush(readFileSync(0,'utf8'),head,{
      symbolicHead:git('symbolic-ref','--quiet','HEAD'),
      mainHead:git('rev-parse','refs/heads/main'),
    }).base;
  }
  git('merge-base','--is-ancestor',base,head);git('merge-base','--is-ancestor',ownership.publicationBase,base);
  const manifest=indexManifest(root,{writeObjects:true}),tree=manifest.tree;
  if(mode!=='check'&&git('rev-parse','HEAD^{tree}')!==tree)throw Error('PRE_PUSH_HEAD_TREE_MISMATCH');
  const approvedFile=resolve('.git/velora-pre-push/approved.json');
  if(!existsSync(approvedFile))throw Error('PRE_PUSH_APPROVED_MANIFEST_REQUIRED');
  const approvedBytes=readFileSync(approvedFile),approved=JSON.parse(approvedBytes);
  if(approved.schemaVersion!==1||approved.owner!==ownership.owner||approved.task!==ownership.task||approved.publicationBase!==ownership.publicationBase)throw Error('PRE_PUSH_APPROVED_MANIFEST_INVALID');
  const changed=git('diff','--no-renames','--name-only','-z',base,tree).split('\0').filter(Boolean);
  assertApprovedDelta(changed,approved.paths);assertCandidatePathsOwned(changed,ownership);
  const entries=new Map(manifest.entries.map(entry=>[entry.path,entry.oid]));
  for(const path of approved.paths)if((entries.get(path)??null)!==approved.blobs?.[path])throw Error('PRE_PUSH_APPROVED_BLOB_CHANGED');
  assertCanonicalDrivers(root,manifest);
  const preserved=capturePreserved(root,approved.paths);
  const indexDigest=digest(readFileSync('.git/index'));
  const snapshot=realpathSync(mkdtempSync(join(tmpdir(),'velora-candidate-')));
  const extracted=extractIndex(root,snapshot);
  if(JSON.stringify(extracted)!==JSON.stringify(manifest))throw Error('PRE_PUSH_CANDIDATE_CHANGED');
  const directory=resolve('.git/velora-pre-push',tree,Date.now()+'-'+snapshot.split(/[\\/]/).pop());mkdirSync(directory,{recursive:true});
  const context={schemaVersion:1,canonical:root,snapshot,head,base,manifest,ownership:deliveryIdentity(ownership)};
  const contextFile=join(directory,'context.json');const contextBytes=JSON.stringify(context);writeFileSync(contextFile,contextBytes);
  writeFileSync(join(directory,'preserved.json'),JSON.stringify(preserved,null,2)+'\n');
  const assertCandidate=()=>{
    assertSameOwnership(ownership,verifyWorkspace(process.env,{delivery:true}));
    if(git('rev-parse','HEAD')!==head||digest(readFileSync('.git/index'))!==indexDigest||!readFileSync(approvedFile).equals(approvedBytes)||readFileSync(contextFile,'utf8')!==contextBytes)throw Error('PRE_PUSH_CANDIDATE_CHANGED');
    assertManifestUnchanged(root,manifest);assertSnapshot(snapshot,manifest);assertPreserved(root,preserved,approved.paths);
  };
  const npmCli=process.env.npm_execpath?.endsWith('npm-cli.js')?process.env.npm_execpath:join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  if(!existsSync(npmCli))throw Error('PRE_PUSH_NPM_RUNTIME_MISSING');
  const plan=gatePlan(npmCli).filter(gate=>mode!=='check'||gate.id!=='secrets/range');
  const childEnv={...isolatedEnvironment(),GIT_OPTIONAL_LOCKS:'0',VELORA_WRITER_ID:ownership.owner,VELORA_TASK_ID:ownership.task,VELORA_CI_RECEIPT_DIR:join(directory,'checks'),SECRET_SCAN_BASE:base};
  const runner=gate=>{
    console.log('PRE_PUSH_GATE '+gate.id);const invocation=gateInvocation(gate,context,contextFile);const start=Date.now();
    const result=spawnSync(process.execPath,invocation.args,{cwd:invocation.cwd,env:childEnv,stdio:'inherit',windowsHide:true});
    console.log('PRE_PUSH_GATE_DURATION '+gate.id+' '+(Date.now()-start)+'ms');return result;
  };
  // Live operations only: a saved JSON receipt cannot authorize this run or skip a gate.
  const passed=runGates(plan,runner,assertCandidate);
  const installFile=join(snapshot,'node_modules/.package-lock.json');
  const identity={tree,base,head,...deliveryIdentity(ownership),node:process.version,platform:process.platform,installFingerprint:existsSync(installFile)?digest(readFileSync(installFile)):'missing'};
  writeFileSync(join(directory,mode==='check'?'tree.json':'full.json'),JSON.stringify({...identity,snapshot,contextFile,passed,result:'PASS',preservedFingerprint:digest(JSON.stringify(preserved)),testedAt:new Date().toISOString()},null,2)+'\n');
  console.log('Pre-push PASS: '+(mode==='check'?'exact staged snapshot; range and all gates remain mandatory in Git hook.':'exact commit/tree; all13 live gates; excluded work preserved.'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    const code = /^[A-Z_]+(?::[\w/-]+)?$/.test(error.message) ? error.message : 'PRE_PUSH_VERIFICATION_FAILED';
    console.error(JSON.stringify({ stage: 'pre_push', error_code: code })); process.exitCode = 1;
  }
}

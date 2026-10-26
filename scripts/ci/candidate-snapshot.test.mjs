import {pathToFileURL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {extractIndex,indexManifest,assertSnapshot,assertManifestUnchanged,safeSourcePath,validateEntries} from './candidate-snapshot.mjs';
import {gatePlan,runGates,assertCandidatePathsOwned,parsePush,assertCanonicalDrivers} from './pre-push.mjs';
import {capturePreserved,assertPreserved,gateInvocation,assertApprovedDelta} from './candidate-snapshot.mjs';

test('gate execution separates published dependencies from canonical guarded drivers',()=>{
 const context={canonical:resolve('original'),snapshot:resolve('snapshot')};
 assert.equal(gateInvocation({id:'dependencies/install',args:['npm-cli','ci']},context,'context.json').cwd,context.snapshot);
 const invocation=gateInvocation({id:'unit',args:['scripts/ci/run.mjs','unit']},context,'context.json');
 assert.equal(invocation.cwd,context.canonical);assert.equal(invocation.args[0],join(context.snapshot,'scripts/ci/run.mjs'));
 assert.deepEqual(invocation.args.slice(-2),['--candidate-context','context.json']);
});
test('unleased excluded work remains content-bound and unauthorized changes block delivery',t=>{
 const {root,git}=fixture(t);writeFileSync(join(root,'unready.js'),'keep');
 const before=capturePreserved(root,['keep.txt']);assertPreserved(root,before,['keep.txt']);
 writeFileSync(join(root,'unready.js'),'changed');assert.throws(()=>assertPreserved(root,before,['keep.txt']),/PRE_PUSH_PRESERVED_WORK_CHANGED/);
 git('add','unready.js');
});
test('approved delta includes deletions and rejects any accidentally staged excluded tool',()=>{
 assertApprovedDelta(['removed.txt'],['removed.txt']);
 assert.throws(()=>assertApprovedDelta(['src/lib/account-deletion/actions.ts'],['src/app.ts']),/PRE_PUSH_UNAPPROVED_PATH/);
});
test('guarded driver code cannot depend on unselected working changes',t=>{
 const {root,git}=fixture(t);mkdirSync(join(root,'scripts/ci'),{recursive:true});const file=join(root,'scripts/ci/driver.mjs');writeFileSync(file,'export const value=1;\n');git('add','scripts/ci/driver.mjs');
 const manifest=indexManifest(root);assertCanonicalDrivers(root,manifest);writeFileSync(file,'throw Error("unpublished");\n');assert.throws(()=>assertCanonicalDrivers(root,manifest),/PRE_PUSH_DRIVER_NOT_STAGED/);
});
test('preservation rejects a generated cache junction before traversing its target',t=>{
 const {root,directory}=fixture(t);const outside=join(directory,'private-target');mkdirSync(outside);writeFileSync(join(outside,'file.txt'),'must not be opened');mkdirSync(join(root,'scripts/account-deletion'),{recursive:true});symlinkSync(outside,join(root,'scripts/account-deletion/.vite'),'junction');assert.throws(()=>capturePreserved(root,[]),/SNAPSHOT_ROOT_INVALID|PRE_PUSH_PRESERVED_POINTER/);
});
test('unselected edits in a staged file are preserved through commit and source mutation is rejected',t=>{
 const {root,git}=fixture(t);writeFileSync(join(root,'keep.txt'),'staged');git('add','keep.txt');writeFileSync(join(root,'keep.txt'),'later unstaged');
 const before=capturePreserved(root,['keep.txt']);git('commit','--quiet','-m','synthetic candidate');assertPreserved(root,before,['keep.txt']);
 writeFileSync(join(root,'keep.txt'),'lost later edit');assert.throws(()=>assertPreserved(root,before,['keep.txt']),/PRE_PUSH_PRESERVED_WORK_CHANGED/);
});

function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'velora-proposal-synthetic-'));
 t.after(()=>{const actual=realpathSync(directory);assert.equal(dirname(actual).toLowerCase(),realpathSync(tmpdir()).toLowerCase());assert.ok(basename(actual).startsWith('velora-proposal-synthetic-'));rmSync(actual,{recursive:true,force:true});});
 const root=join(directory,'source');const snapshot=join(directory,'snapshot');mkdirSync(root);mkdirSync(snapshot);
 const git=(...args)=>execFileSync('git',args,{cwd:root,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true});
 git('init','--quiet');git('config','user.email','synthetic@example.invalid');git('config','user.name','Synthetic');git('config','core.autocrlf','false');
 writeFileSync(join(root,'keep.txt'),'baseline\n');writeFileSync(join(root,'removed.txt'),'original\n');git('add','.');git('commit','--quiet','-m','synthetic baseline');
 return {directory,root,snapshot,git};
}
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');

test('snapshot uses staged blob, excludes unrelated broken WIP, preserves original/index bytes',t=>{
 const {root,snapshot,git}=fixture(t);writeFileSync(join(root,'keep.txt'),'published\n');git('add','keep.txt');
 writeFileSync(join(root,'keep.txt'),'unsaved later version\n');writeFileSync(join(root,'unready.test.js'),'throw Error("unready")');
 mkdirSync(join(root,'scripts'));writeFileSync(join(root,'scripts','unready-migration.sql'),'synthetic only');
 const before={index:digest(join(root,'.git','index')),source:digest(join(root,'keep.txt')),wip:digest(join(root,'unready.test.js')),status:git('status','--porcelain=v1','--untracked-files=all')};
 const manifest=extractIndex(root,snapshot);assert.equal(readFileSync(join(snapshot,'keep.txt'),'utf8'),'published\n');
 assert.ok(!manifest.entries.some(entry=>entry.path.includes('unready')));
 assert.deepEqual({index:digest(join(root,'.git','index')),source:digest(join(root,'keep.txt')),wip:digest(join(root,'unready.test.js')),status:git('status','--porcelain=v1','--untracked-files=all')},before);
});
test('staged additions/deletions are represented; unstaged deletion is excluded',t=>{
 const {root,snapshot,git}=fixture(t);git('rm','removed.txt');writeFileSync(join(root,'added.txt'),'new\n');git('add','added.txt');rmSync(join(root,'keep.txt'));
 const manifest=extractIndex(root,snapshot);assert.deepEqual(manifest.entries.map(x=>x.path),['added.txt','keep.txt']);
 assert.equal(readFileSync(join(snapshot,'keep.txt'),'utf8'),'baseline\n');
});
test('index drift invalidates snapshot even with same HEAD',t=>{
 const {root,snapshot,git}=fixture(t);const manifest=extractIndex(root,snapshot);writeFileSync(join(root,'keep.txt'),'changed\n');git('add','keep.txt');assert.throws(()=>assertManifestUnchanged(root,manifest),/SNAPSHOT_INDEX_CHANGED/);
});
test('read-only tree construction matches Git write-tree including nested and executable files',t=>{
 const {root,git}=fixture(t);mkdirSync(join(root,'nested'));writeFileSync(join(root,'nested','file.txt'),'nested\n');git('add','nested/file.txt');git('update-index','--chmod=+x','nested/file.txt');
 const before=digest(join(root,'.git','index'));const manifest=indexManifest(root);assert.equal(digest(join(root,'.git','index')),before);assert.equal(manifest.tree,git('write-tree').trim());
});
test('changed, missing and unexpected snapshot source fail closed',t=>{
 const {root,snapshot}=fixture(t);const manifest=extractIndex(root,snapshot);
 writeFileSync(join(snapshot,'keep.txt'),'wrong');assert.throws(()=>assertSnapshot(snapshot,manifest),/SNAPSHOT_SOURCE_CHANGED/);
 writeFileSync(join(snapshot,'keep.txt'),'baseline\n');writeFileSync(join(snapshot,'untracked.js'),'wrong');assert.throws(()=>assertSnapshot(snapshot,manifest),/SNAPSHOT_UNEXPECTED_SOURCE/);
 rmSync(join(snapshot,'untracked.js'));rmSync(join(snapshot,'keep.txt'));assert.throws(()=>assertSnapshot(snapshot,manifest),/SNAPSHOT_SOURCE_MISSING/);
});
test('private paths, traversal, Windows aliases, case collisions and git links are denied',()=>{
 for(const path of ['../outside','a/../outside','C:/outside','a\\outside','.git/config','source:stream','con.txt','a.','name ','/root','.ENV.local','credentials.json'])assert.throws(()=>safeSourcePath(path));
 const entry={mode:'100644',type:'blob',oid:'a'.repeat(40),path:'a.txt'};
 assert.throws(()=>validateEntries([entry,{...entry,path:'A.txt'}]),/SNAPSHOT_CASE_COLLISION/);
 assert.throws(()=>validateEntries([{...entry,mode:'120000'}]),/SNAPSHOT_UNSUPPORTED_ENTRY/);
 assert.throws(()=>validateEntries([{...entry,mode:'160000',type:'commit'}]),/SNAPSHOT_UNSUPPORTED_ENTRY/);
 assert.throws(()=>validateEntries([entry,{...entry,path:'a.txt/nested'}]),/SNAPSHOT_PATH_COLLISION/);
});
test('runtime output directory pointers are rejected before any recursive read',t=>{
 const {directory,root,snapshot}=fixture(t);const manifest=extractIndex(root,snapshot);const outside=join(directory,'outside');mkdirSync(outside);symlinkSync(outside,join(snapshot,'node_modules'),'junction');assert.throws(()=>assertSnapshot(snapshot,manifest),/SNAPSHOT_POINTER_DETECTED/);
});
test('private staged files and nonempty destination are rejected before extraction',t=>{
 const {root,snapshot,git}=fixture(t);writeFileSync(join(snapshot,'already-there'),'keep');assert.throws(()=>extractIndex(root,snapshot),/SNAPSHOT_DESTINATION_NOT_EMPTY/);
 writeFileSync(join(root,'.env.local'),'synthetic non-secret');git('add','.env.local');assert.throws(()=>indexManifest(root),/SNAPSHOT_PRIVATE_PATH/);
});
test('destination inside original worktree or Git metadata is rejected without writing',t=>{
 const {root}=fixture(t);for(const path of [join(root,'empty'),join(root,'.git','empty')]){mkdirSync(path);assert.throws(()=>extractIndex(root,path),/SNAPSHOT_SOURCE_DESTINATION_OVERLAP/);}
});
test('a forged manifest tree cannot borrow the entries of another candidate',t=>{
 const {root,snapshot}=fixture(t);const manifest=extractIndex(root,snapshot);assert.throws(()=>assertSnapshot(snapshot,{...manifest,tree:'b'.repeat(40)}),/SNAPSHOT_MANIFEST_TREE_MISMATCH/);
});
test('all13 gates remain required; every failure and snapshot drift deny simulated delivery',()=>{
 const plan=gatePlan('npm-cli');assert.equal(plan.length,13);assert.equal(plan.filter(gate=>gate.id!=='secrets/range').length,12);
 for(const gate of plan)assert.throws(()=>runGates(plan,current=>({status:current.id===gate.id?1:0})),/PRE_PUSH_GATE_FAILED/);
 let seen=0;assert.throws(()=>runGates(plan,()=>({status:0}),()=>{if(++seen===2)throw Error('SNAPSHOT_SOURCE_CHANGED');}),/SNAPSHOT_SOURCE_CHANGED/);
 assertCandidatePathsOwned(['removed.txt'],{paths:['removed.txt']});assert.throws(()=>assertCandidatePathsOwned(['removed.txt'],{paths:['other.txt']}),/PRE_PUSH_UNLEASED_PATH/);
 assert.throws(()=>parsePush(`refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`,'c'.repeat(40)),/PRE_PUSH_MAIN_SOURCE_INVALID/);
 assert.equal(resolve('.').length>0,true);
});

test('disjoint working edits and new files do not drift a frozen candidate',t=>{
 const {root,directory}=fixture(t);const approved=['keep.txt'];
 writeFileSync(join(root,'writer.txt'),'initial');
 const before=capturePreserved(root,approved,[],['writer.txt','parallel/**']);
 const frozen=indexManifest(root);const snapshot=join(directory,'parallel-frozen');mkdirSync(snapshot);
 extractIndex(root,snapshot);
 writeFileSync(join(root,'writer.txt'),'writer continues');mkdirSync(join(root,'parallel'));
 writeFileSync(join(root,'parallel','new.txt'),'new work');
 assertPreserved(root,before,approved,['writer.txt','parallel/**']);
 assertManifestUnchanged(root,frozen);assertSnapshot(snapshot,frozen);
 assert.equal(readFileSync(join(root,'writer.txt'),'utf8'),'writer continues');
 assert.equal(readFileSync(join(root,'parallel','new.txt'),'utf8'),'new work');
 assert.throws(()=>assertPreserved(root,before,approved,['keep.txt']),/PRE_PUSH_MUTABLE_SCOPE_OVERLAP/);
});

test('one coordinator runs frozen gates while another writer acquires edits and releases its scope',async t=>{
 const {root,directory,snapshot,git}=fixture(t);
 const guardPath=join(directory,'delivery-guard.mjs');
 const code=readFileSync(new URL('../consolidation/guard.mjs',import.meta.url),'utf8')
  .replace(/export const ROOT = .*?;/,'export const ROOT = '+JSON.stringify(root)+';')
  .replace("const publicationBase = git('rev-parse', 'HEAD');","const publicationBase = '"+'a'.repeat(40)+"';");
 writeFileSync(guardPath,code);const api=await import(pathToFileURL(guardPath).href);
 const env={VELORA_WRITER_ID:'publisher',VELORA_TASK_ID:'PACKAGE'};
 api.reservePaths({owner:'publisher',task:'PACKAGE',paths:['keep.txt']});
 api.reservePaths({owner:'writer',task:'WORK',paths:['writer.txt']});
 api.claimDelivery('publisher','PACKAGE');writeFileSync(join(root,'writer.txt'),'initial');
 const manifest=extractIndex(root,snapshot),head=git('rev-parse','HEAD');
 const before=capturePreserved(root,['keep.txt'],[],api.reservationStatus(env).deliveryMutableScopes);
 const fingerprint=api.reservationStatus(env).deliveryReservationFingerprint;
 const assertFrozen=()=>{
  const current=api.reservationStatus(env);assert.equal(current.deliveryReservationFingerprint,fingerprint);
  assert.equal(git('rev-parse','HEAD'),head);assertManifestUnchanged(root,manifest);assertSnapshot(snapshot,manifest);
  assertPreserved(root,before,['keep.txt'],current.deliveryMutableScopes);
 };
 const passed=runGates(gatePlan('npm-cli'),gate=>{
  if(gate.id==='unit'){
   api.reservePaths({owner:'writer',task:'WORK',paths:['parallel/**']});
   writeFileSync(join(root,'writer.txt'),'edited while gates run');mkdirSync(join(root,'parallel'));
   writeFileSync(join(root,'parallel','new.txt'),'new concurrent work');
   api.releasePaths({owner:'writer',task:'WORK'});
  }
  return {status:0};
 },assertFrozen);
 assert.equal(passed.length,13);assert.equal(readFileSync(join(root,'writer.txt'),'utf8'),'edited while gates run');
 assert.equal(readFileSync(join(root,'parallel','new.txt'),'utf8'),'new concurrent work');
 assert.throws(()=>api.reservePaths({owner:'other',task:'BAD',paths:['keep.txt']}),/DELIVERY_PATH_CONFLICT/);
 assert.throws(()=>api.claimDelivery('other','SECOND'),/DELIVERY_ALREADY_CLAIMED/);
 git('add','writer.txt');assert.throws(()=>assertManifestUnchanged(root,manifest),/SNAPSHOT_INDEX_CHANGED/);
 api.endDelivery('publisher');api.releasePaths({owner:'publisher',task:'PACKAGE'});
});

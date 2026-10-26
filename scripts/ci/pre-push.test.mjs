import {deliveryIdentityFingerprint} from '../consolidation/guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePush, gatePlan, runGates, receiptMatches, withConcurrentScopes, deliveryIdentity, assertSameOwnership, assertCandidatePathsOwned } from './pre-push.mjs';
const head = 'a'.repeat(40), base = 'b'.repeat(40);
test('only the exact current main commit may update existing remote main', () => {
  assert.deepEqual(parsePush('refs/heads/main ' + head + ' refs/heads/main ' + base + '\n', head), { head, base });
  for (const input of ['', 'refs/heads/other ' + head + ' refs/heads/main ' + base,
    'refs/heads/main ' + '0'.repeat(40) + ' refs/heads/main ' + base,
    'refs/heads/main ' + base + ' refs/heads/main ' + base,
    'refs/heads/main ' + head + ' refs/heads/other ' + base,
    'refs/heads/main ' + head + ' refs/heads/main ' + '0'.repeat(40)])
    assert.throws(() => parsePush(input, head));
});
test('pre-push plan includes all nine mandatory CI categories and pinned secret scans', () => {
  const plan = gatePlan('npm-cli');
  assert.deepEqual([...new Set(plan.map(g => g.category))].sort(),
    ['typecheck', 'lint', 'unit', 'contracts', 'build', 'safety', 'security', 'secret_scanning', 'dependencies'].sort());
  assert.ok(plan.some(g => g.args.includes('--audit-level=moderate')));
  for (const mode of ['self-test', 'tree', 'range']) assert.ok(plan.some(g => g.args.includes(mode)));
});
test('passing runner completes every gate in order', () => {
  const plan = gatePlan('npm-cli'), seen = [];
  assert.deepEqual(runGates(plan, gate => { seen.push(gate.id); return { status: 0 }; }), plan.map(g => g.id));
  assert.deepEqual(seen, plan.map(g => g.id));
});
test('each failing, killed or unstarted mandatory gate blocks subsequent gates', () => {
  const plan = gatePlan('npm-cli');
  for (let at = 0; at < plan.length; at++) for (const failure of [{ status: 1 }, { status: null, signal: 'SIGTERM' }, { error: Error('spawn failed') }]) {
    const seen = [];
    assert.throws(() => runGates(plan, gate => { seen.push(gate.id); return seen.length === at + 1 ? failure : { status: 0 }; }), /PRE_PUSH_GATE_FAILED/);
    assert.equal(seen.length, at + 1);
  }
});
test('candidate drift blocks receipt creation even when a command returns zero', () => {
  let calls = 0;
  assert.throws(() => runGates(gatePlan('npm-cli'), () => ({ status: 0 }), () => { if (++calls === 2) throw Error('drift'); }), /drift/);
});
test('receipts cannot cover a different tree, base, writer, task, runtime, install or missing gate', () => {
  const id = { tree: head, base, owner: 'writer', task: 'task', publicationBase: base, reservationFingerprint: 'c'.repeat(64), node: 'v24', platform: 'win32', installFingerprint: 'locked' };
  const receipt = { ...id, result: 'PASS', passed: ['build', 'security'] };
  assert.equal(receiptMatches(receipt, id, ['build', 'security']), true);
  for (const key of Object.keys(id)) assert.equal(receiptMatches(receipt, { ...id, [key]: 'different' }, ['build']), false);
  assert.equal(receiptMatches(receipt, id, ['missing']), false);
  assert.equal(receiptMatches({ ...receipt, result: 'FAIL' }, id, ['build']), false);
});

test('missing task or lease identity never matches a legacy receipt', () => {
  const identity = { tree: head, base, owner: 'writer', node: 'v24', platform: 'win32', installFingerprint: 'locked' };
  assert.equal(receiptMatches({ ...identity, result: 'PASS', passed: ['build'] }, identity, ['build']), false);
});
test('delivery identity rejects absent task and fences scope changes during a gate', () => {
  const ownership = { mode: 'local', owner: 'writer', task: 'TASK', publicationBase: base, reservationFingerprint: 'c'.repeat(64) };
  assert.equal(deliveryIdentity(ownership).task, 'TASK');
  assert.throws(() => deliveryIdentity({ ...ownership, task: undefined }), /PRE_PUSH_OWNERSHIP_INVALID/);
  assertSameOwnership(ownership, { ...ownership });
  for (const patch of [{ task: 'OTHER' }, { owner: 'other' }, { publicationBase: head }, { reservationFingerprint: 'd'.repeat(64) }])
    assert.throws(() => assertSameOwnership(ownership, { ...ownership, ...patch }), /PRE_PUSH_OWNERSHIP_CHANGED/);
});
test('candidate paths must be covered by the delivery owner leases', () => {
  const ownership = { paths: ['src/a.ts', 'tests/**'] };
  assertCandidatePathsOwned(['src/a.ts', 'tests/nested/a.test.ts'], ownership);
  assert.throws(() => assertCandidatePathsOwned(['src/other.ts'], ownership), /PRE_PUSH_UNLEASED_PATH/);
  assert.throws(() => assertCandidatePathsOwned(['src/a.ts'], { paths: [] }), /PRE_PUSH_UNLEASED_PATH/);
});

// Verified HEAD alias regression; keep the existing delivery gates unchanged.
{
const head='a'.repeat(40), base='b'.repeat(40), zero='0'.repeat(40);
const context={symbolicHead:'refs/heads/main',mainHead:head};
const line=(localRef='HEAD',localSha=head,remoteRef='refs/heads/main',remoteSha=base)=>[localRef,localSha,remoteRef,remoteSha].join(' ');
test('canonical main retains compatible two-argument API',()=>assert.deepEqual(parsePush(line('refs/heads/main'),head),{head,base}));
for(const ref of ['HEAD','refs/heads/main']) {
 test(ref+' accepts verified current main',()=>assert.deepEqual(parsePush(line(ref)+'\r\n',head,context),{head,base}));
 for(const [label,ctx] of [['detached',{...context,symbolicHead:null}],['other branch',{...context,symbolicHead:'refs/heads/other'}],['main SHA differs',{...context,mainHead:base}],['missing main SHA',{symbolicHead:context.symbolicHead}]])
  test(ref+' rejects '+label,()=>assert.throws(()=>parsePush(line(ref),head,ctx)));
 for(const [label,input] of [['wrong local SHA',line(ref,base)],['local deletion SHA',line(ref,zero)],['bad local SHA',line(ref,'bad')],['other target',line(ref,head,'refs/heads/other')],['remote deletion SHA',line(ref,head,'refs/heads/main',zero)],['bad remote SHA',line(ref,head,'refs/heads/main','bad')],['extra field',line(ref)+' extra'],['additional update',line(ref)+'\n'+line(ref)]])
  test(ref+' rejects '+label,()=>assert.throws(()=>parsePush(input,head,context)));
}
test('HEAD requires verified context',()=>assert.throws(()=>parsePush(line(),head)));
for(const ref of ['refs/heads/other','refs/tags/main','(delete)','head',''])
 test('rejects source '+JSON.stringify(ref),()=>assert.throws(()=>parsePush(line(ref),head,context)));
test('rejects empty updates',()=>assert.throws(()=>parsePush('',head,context)));

}

test('delivery receipt identity ignores disjoint registry activity but binds package lease',()=>{
 const registry={reservations:[{owner:'A',task:'PACKAGE',paths:['src/a.ts'],publicationBase:base}],deliveryOwner:'A',deliveryTask:'PACKAGE'};
 const ownership=()=>({mode:'local',owner:'A',task:'PACKAGE',publicationBase:base,reservationFingerprint:deliveryIdentityFingerprint(registry)});
 const frozen=ownership();registry.reservations.push({owner:'B',task:'WORK',paths:['src/b.ts'],publicationBase:base});
 assert.doesNotThrow(()=>assertSameOwnership(frozen,ownership()));registry.reservations[1].paths.push('src/c.ts');
 assert.doesNotThrow(()=>assertSameOwnership(frozen,ownership()));registry.reservations.pop();
 assert.doesNotThrow(()=>assertSameOwnership(frozen,ownership()));registry.reservations[0].paths.push('src/extra.ts');
 assert.throws(()=>assertSameOwnership(frozen,ownership()),/PRE_PUSH_OWNERSHIP_CHANGED/);
});

test('scope observation tolerates a disjoint lease appearing during a working-file read',()=>{
 const owned={mode:'local',owner:'A',task:'PACKAGE',publicationBase:base,reservationFingerprint:'a'.repeat(64)};
 let reads=0,observations=0;const read=()=>({...owned,mutableScopes:++reads===1?[]:['writer/**']});
 const result=withConcurrentScopes(read,scopes=>{observations++;if(!scopes.length)throw Error('PRE_PUSH_PRESERVED_WORK_CHANGED');return 'preserved';});
 assert.equal(result.result,'preserved');assert.equal(observations,2);
 assert.throws(()=>withConcurrentScopes(()=>({...owned,mutableScopes:[]}),()=>{throw Error('PRE_PUSH_PRESERVED_POINTER');}),/PRE_PUSH_PRESERVED_POINTER/);
 let changed=false;assert.throws(()=>withConcurrentScopes(()=>({...owned,mutableScopes:[],reservationFingerprint:changed?'b'.repeat(64):owned.reservationFingerprint}),()=>{changed=true;}),/PRE_PUSH_OWNERSHIP_CHANGED/);
});

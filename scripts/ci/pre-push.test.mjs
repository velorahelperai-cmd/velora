import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePush, gatePlan, runGates, receiptMatches } from './pre-push.mjs';
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
  const id = { tree: head, base, owner: 'writer', task: 'task', node: 'v24', platform: 'win32', installFingerprint: 'locked' };
  const receipt = { ...id, result: 'PASS', passed: ['build', 'security'] };
  assert.equal(receiptMatches(receipt, id, ['build', 'security']), true);
  for (const key of Object.keys(id)) assert.equal(receiptMatches(receipt, { ...id, [key]: 'different' }, ['build']), false);
  assert.equal(receiptMatches(receipt, id, ['missing']), false);
  assert.equal(receiptMatches({ ...receipt, result: 'FAIL' }, id, ['build']), false);
});

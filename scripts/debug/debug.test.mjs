import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, commandFor, localUrl } from './debug.mjs';

test('TypeScript location, unknown cause and recurrence are evidence-bound', () => {
  const [error] = diagnose('src/demo.ts(4,7): error TS2322: Type number is not assignable to string.', 'types', 'TS2322 known record');
  assert.equal(error.file, 'src/demo.ts');
  assert.equal(error.line, 4);
  assert.equal(error.code, 'TS2322');
  assert.equal(error.cause.status, 'UNKNOWN');
  assert.equal(error.previousRecord, true);
  assert.ok(error.verification);
});
test('structured browser/network events and runtime stacks retain locations', () => {
  const [error] = diagnose(JSON.stringify({ category: 'network', message: 'HTTP 503', file: '/api/demo', line: 2 }), 'network');
  assert.equal(error.file, '/api/demo');
  assert.equal(error.category, 'network');
  assert.equal(diagnose('TypeError: boom\n at work (C:/repo/src/a.ts:9:2)', 'runtime')[0].line, 9);
});
test('logs redact credentials and do not invent success from empty evidence', () => {
  assert.ok(!JSON.stringify(diagnose('Error: token=unsafe-secret', 'runtime')).includes('unsafe-secret'));
  assert.equal(diagnose('', 'build').length, 0);
});
test('passing test names containing error words and fail zero are not errors', () => {
  assert.equal(diagnose('✔ error handling works (2ms)\n✓ handles failures\nℹ fail 0', 'test').length, 0);
});
test('targeted commands reject empty targets, options and traversal', () => {
  for (const paths of [[], ['--fix'], ['../foreign.ts']]) assert.throws(() => commandFor('lint', paths));
  assert.ok(commandFor('test', ['src/example.test.ts']).includes('--maxWorkers=1'));
  assert.throws(() => commandFor('build', []));
});
test('browser collection is restricted to numeric IPv4 loopback', () => {
  assert.equal(localUrl('http://127.0.0.1:3720/demo').hostname, '127.0.0.1');
  for (const url of ['https://example.com', 'http://localhost', 'http://127.0.0.1@evil.com', 'file:///a']) assert.throws(() => localUrl(url));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { diagnose, collectBrowser } from './debug.mjs';

test('real TypeScript failure detected and minimal correction passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'velora-debug-'));
  const file = join(dir, 'probe.ts');
  try {
    writeFileSync(file, 'const count: number = "wrong";');
    const args = ['node_modules/typescript/bin/tsc', '--ignoreConfig', '--noEmit', '--skipLibCheck', '--pretty', 'false', file];
    const red = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(red.status, 2);
    assert.equal(diagnose(red.stdout, 'types')[0].code, 'TS2322');
    writeFileSync(file, 'const count: number = 1;');
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000, windowsHide: true }).status, 0);
  } finally { rmSync(file, { force: true }); rmdirSync(dir); }
});
test('real ESLint failure reports the rule and source location, correction passes', () => {
  const args = ['node_modules/eslint/bin/eslint.js', '--stdin', '--stdin-filename', 'scripts/debug/probe.mjs', '--format', 'json', '--max-warnings=0'];
  const red = spawnSync(process.execPath, args, { input: 'const unused = 1;', encoding: 'utf8', timeout: 120000, windowsHide: true });
  assert.equal(red.status, 1);
  const [record] = diagnose(red.stdout, 'lint');
  assert.equal(record.line, 1);
  assert.match(record.code, /no-unused-vars/);
  assert.equal(spawnSync(process.execPath, args, { input: 'export const value = 1;', encoding: 'utf8', timeout: 120000, windowsHide: true }).status, 0);
});
test('real Chromium captures console, runtime and HTTP failures on a temporary local server', { skip: !process.env.VELORA_DEBUG_PLAYWRIGHT }, async () => {
  const server = createServer((req, res) => {
    if (req.url === '/fail') { res.writeHead(503); res.end('Unavailable'); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<script>console.error("LOCAL_DEBUG_CONSOLE");fetch("/fail");setTimeout(()=>{throw Error("LOCAL_DEBUG_RUNTIME")},0)</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const events = await collectBrowser(`http://127.0.0.1:${server.address().port}`, resolve(process.env.VELORA_DEBUG_PLAYWRIGHT), 300);
    assert.ok(events.some(e => e.category === 'browser' && e.message.includes('LOCAL_DEBUG_CONSOLE')));
    assert.ok(events.some(e => e.category === 'runtime' && e.message.includes('LOCAL_DEBUG_RUNTIME')));
    assert.ok(events.some(e => e.category === 'network' && e.message === 'HTTP 503'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

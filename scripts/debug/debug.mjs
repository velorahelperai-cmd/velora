import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { redactLogText } from '../../src/lib/logging/redaction.mjs';
import { isolatedEnvironment } from '../ci/safety.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const categories = new Set(['types', 'lint', 'runtime', 'browser', 'network', 'supabase', 'react', 'build', 'test']);
const lessons = 'C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/08-LESSONS.md';
const ledger = resolve(root, 'docs/TROUBLESHOOTING.md');
function history() {
  return [ledger, lessons].filter(existsSync).map(p => readFileSync(p, 'utf8')).join('\n');
}
export function diagnose(text, category, previous = '') {
  if (!categories.has(category)) throw Error('UNKNOWN_CATEGORY');
  if (category === 'lint') {
    try {
      const results = JSON.parse(text);
      if (Array.isArray(results)) return results.flatMap(result => (result.messages ?? []).flatMap(msg => diagnose(JSON.stringify({ file: result.filePath, line: msg.line, code: msg.ruleId ?? 'ESLINT_PARSE', message: msg.message }), 'lint', previous)));
    } catch { /* Fall through to text diagnostics. */ }
  }
  const safe = redactLogText(text).replace(/\u001b\[[0-9;]*m/g, '');
  const lines = safe.split(/\r?\n/).filter(x => x.trim() && !/^\s*[✔✓]/u.test(x) && !/^\s*(?:ℹ\s*)?fail(?:ed)?\s+0\b/iu.test(x));
  return lines.filter(line => /error|fail|exception|\bTS\d+|\bHTTP [45]\d\d|"message"|"code"/i.test(line)).slice(0, 100).map(line => {
    let event = {};
    try { event = JSON.parse(line); } catch { /* Text logs are valid input. */ }
    if (!event || typeof event !== 'object') event = {};
    const location = line.match(/([^\s()]+)\((\d+),(\d+)\)/)
      ?? line.match(/([^\s()]+):(\d+):(\d+)/)
      ?? safe.match(/at .*?\(?([^\s()]+):(\d+):(\d+)\)?/);
    const code = String(event.code ?? event.error_code ?? line.match(/\b(?:TS\d{3,6}|[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/)?.[0] ?? 'UNCLASSIFIED');
    const file = event.file ?? location?.[1] ?? null;
    const message = String(event.message ?? event.error?.message ?? line).slice(0, 2000);
    const signature = createHash('sha256').update(`${category}|${code}|${file}|${message}`).digest('hex').slice(0, 16);
    return {
      signature, category, code, file, line: Number(event.line ?? location?.[2]) || null,
      message, cause: { status: 'UNKNOWN', detail: 'Inspect this evidence and the affected source; a matching signature is a lead, not proof of the same cause.' },
      impact: file ? `Observed at ${file}; dependent impact UNVERIFIED` : 'UNKNOWN: location/stack required',
      verification: 'Reproduce the original failure, fix the confirmed cause, rerun that check plus affected regression/security checks.',
      previousRecord: previous.includes(signature) || (code !== 'UNCLASSIFIED' && previous.includes(code)),
    };
  });
}
export function commandFor(kind, paths) {
  if (kind === 'types' && paths.length === 0) return ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false', '--pretty', 'false'];
  if (!['lint', 'test', 'node-test'].includes(kind) || !paths.length) throw Error('EXPLICIT_TARGETS_REQUIRED');
  for (const p of paths) {
    const rel = relative(root, resolve(root, p));
    if (p.startsWith('-') || isAbsolute(p) || rel.startsWith('..') || /[\r\n]/.test(p)) throw Error('INVALID_TARGET');
    if (kind === 'test' && (!p.replaceAll('\\', '/').startsWith('src/') || !/\.test\.tsx?$/.test(p))) throw Error('EXPLICIT_SOURCE_TEST_REQUIRED');
    if (kind === 'node-test' && !p.endsWith('.test.mjs')) throw Error('EXPLICIT_NODE_TEST_REQUIRED');
  }
  if (kind === 'lint') return ['node_modules/eslint/bin/eslint.js', ...paths, '--max-warnings=0', '--format', 'json'];
  if (kind === 'node-test') return ['--test', ...paths];
  return ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.ci.config.ts', '--maxWorkers=1', ...paths];
}
export function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw Error('NUMERIC_LOOPBACK_HTTP_REQUIRED');
  return url;
}
export async function collectBrowser(urlString, modulePath, duration = 2000) {
  const url = localUrl(urlString);
  if (!Number.isInteger(duration) || duration < 0 || duration > 30000) throw Error('DURATION_OUT_OF_RANGE');
  const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const events = [];
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const request = route.request();
      const target = new URL(request.url());
      if (target.origin !== url.origin || !['GET', 'HEAD'].includes(request.method())) {
        events.push({ category: 'network', code: 'DEBUG_REQUEST_BLOCKED', message: 'Collector blocked an external or mutating request', file: target.pathname });
        return route.abort();
      }
      return route.continue();
    });
    // WebSockets are not covered by ordinary request routing.
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    page.on('pageerror', error => events.push({ category: 'runtime', message: redactLogText(error.stack ?? error.message) }));
    page.on('console', msg => {
      if (msg.type() === 'error') events.push({ category: 'browser', message: redactLogText(msg.text()), file: msg.location().url.split('?')[0], line: msg.location().lineNumber + 1 });
    });
    page.on('response', response => {
      if (response.status() >= 400) events.push({ category: 'network', message: `HTTP ${response.status()}`, file: new URL(response.url()).pathname });
    });
    page.on('requestfailed', request => events.push({ category: 'network', message: request.failure()?.errorText ?? 'Request failed', file: new URL(request.url()).pathname }));
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(duration);
    return events.slice(0, 100);
  } finally { await browser.close(); }
}
async function main(args) {
  const [action, kind, ...paths] = args;
  if (action === 'lookup') {
    if (!kind) throw Error('SIGNATURE_REQUIRED');
    console.log(history().split(/\r?\n(?=#{1,3} )/).filter(x => x.toLowerCase().includes(kind.toLowerCase())).join('\n\n') || 'NO_KNOWN_RECORD');
    return;
  }
  if (action === 'analyze') {
    // Read sanitized, bounded evidence from stdin; never open arbitrary env files.
    const chunks = []; let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) throw Error('EVIDENCE_TOO_LARGE');
      chunks.push(chunk);
    }
    const records = diagnose(Buffer.concat(chunks).toString('utf8'), kind, history());
    console.log(JSON.stringify({ status: records.length ? 'EVIDENCE_FOUND' : 'NO_RECOGNIZED_EVIDENCE_NOT_A_PASS', records }, null, 2));
    return;
  }
  if (action === 'check') {
    const command = commandFor(kind, paths);
    // Lookup before execution; failures are never auto-retried or cached as passes.
    const previous = history();
    const env = { ...isolatedEnvironment(), NODE_OPTIONS: `--require="${resolve(root, 'scripts/ci/offline-network-guard.cjs').replaceAll('\\', '/')}"` };
    const result = spawnSync(process.execPath, command, { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 });
    const output = redactLogText(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    const category = kind === 'node-test' ? 'test' : kind;
    console.log(JSON.stringify({ status: result.status === 0 && !result.error ? 'PASS_TARGET_ONLY' : 'FAIL_OR_BLOCKED', exitCode: result.status, processError: result.error?.code ?? null, command, records: diagnose(output, category, previous), output }, null, 2));
    process.exitCode = result.status === 0 && !result.error ? 0 : 1;
    return;
  }
  if (action === 'browser') {
    if (!paths[0]) throw Error('PLAYWRIGHT_MODULE_PATH_REQUIRED');
    const previous = history();
    const events = await collectBrowser(kind, paths[0]);
    const records = events.flatMap(event => diagnose(JSON.stringify(event), event.category, previous));
    console.log(JSON.stringify({ status: records.length ? 'ERRORS_OBSERVED' : 'NO_ERRORS_IN_BOUNDED_SAMPLE', records }, null, 2));
    process.exitCode = records.length ? 1 : 0;
    return;
  }
  console.log('Usage: node scripts/debug/debug.mjs lookup CODE | analyze CATEGORY < sanitized.log | check lint FILE... | check test FILE.test.ts... | check node-test FILE.test.mjs... | check types | browser http://127.0.0.1:PORT/PATH ABSOLUTE_PLAYWRIGHT_INDEX_MJS');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(redactLogText(error.message)); process.exitCode = 1; });
}

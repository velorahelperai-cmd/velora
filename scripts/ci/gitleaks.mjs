// No provider validation, raw logs, finding snippets or secret-bearing reports.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, lstatSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { binary, version } from './gitleaks-install.mjs';
import { forbiddenTrackedPath } from './security-rules.mjs';
import {candidateContextArgument,loadGateContext} from './candidate-snapshot.mjs';
const source = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const context=loadGateContext(candidateContextArgument());
const fileRoot=context?.snapshot??root;
// Do not pass application credentials or scanner configuration overrides to child processes.
const env = {};
for (const name of ['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','HOME','USERPROFILE']) if (process.env[name]) env[name] = process.env[name];
// Trust only this selected checkout, including Git invoked internally by Gitleaks.
env.GIT_CONFIG_COUNT = '1'; env.GIT_CONFIG_KEY_0 = 'safe.directory'; env.GIT_CONFIG_VALUE_0 = root;
const git = args => execFileSync('git', ['-c', `safe.directory=${root}`, ...args], { cwd: root, env, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
const split = text => text.split('\0').filter(Boolean);
function scan(args) {
  if (execFileSync(binary, ['version'], { env, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim() !== version) throw new Error('Scanner version mismatch; run installer');
  const temporary = mkdtempSync(join(tmpdir(), 'velora-secret-report-'));
  try {
    const report = join(temporary, 'metadata.json');
    const ignore = join(temporary, 'empty-ignore'); writeFileSync(ignore, '');
    const run = spawnSync(binary, [...args, '--config', join(source,'gitleaks.toml'), '--ignore-gitleaks-allow', '--gitleaks-ignore-path', ignore, '--redact=100', '--no-banner', '--no-color', '--log-level=error', '--report-format=template', '--report-template', join(source,'gitleaks-report.tmpl'), '--report-path', report], { cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (run.error || ![0,1].includes(run.status)) throw new Error('Trusted scanner failed; raw output suppressed');
    const findings = JSON.parse(readFileSync(report, 'utf8'));
    for (const finding of findings) console.log(JSON.stringify(finding));
    console.log(`Gitleaks ${version}: findings=${findings.length}; exit=${run.status}; metadata only.`);
    return run.status;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
function snapshot(mode) {
  const indexed = context ? context.manifest.entries.map(entry=>entry.path) : split(git(['ls-files','-z']));
  console.log(`SCAN_SCOPE mode=${mode}; indexed=${indexed.length}`);
  const denied = indexed.filter(forbiddenTrackedPath);
  for (const file of denied) console.error(`PRIVATE_TRACKED_PATH ${file}`);
  if (denied.length) return 1;
  const files = mode === 'changes' ? [...new Set([...split(git(['diff','--name-only','-z','--diff-filter=ACMRT','HEAD'])), ...split(git(['ls-files','--others','--exclude-standard','-z']))])] : indexed;
  console.log(`SCAN_FILES selected=${files.length}; history=false; ignored local environment files are not copied.`);
  const temporary = mkdtempSync(join(tmpdir(), 'velora-secret-snapshot-'));
  try {
    for (const file of files) {
      const absolute = resolve(fileRoot, file);
      if (!absolute.startsWith(fileRoot + '\\') && !absolute.startsWith(fileRoot + '/')) throw new Error('Unsafe snapshot path');
      if (lstatSync(absolute).isSymbolicLink()) throw new Error('Symlink cannot be safely scanned');
      const target = join(temporary, file); mkdirSync(dirname(target), { recursive: true }); copyFileSync(absolute,target);
    }
    return scan(['dir', temporary]);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
export function main(mode = process.argv[2] ?? 'changes') {
  if (mode === 'self-test') {
    const temporary = mkdtempSync(join(tmpdir(),'velora-secret-synthetic-'));
    try {
      const sample = join(temporary,'sample.txt');
      writeFileSync(sample, 'Example configuration without credentials.\n');
      if (scan(['dir',temporary]) !== 0) throw new Error('Clean sample rejected');
      // Synthetic only; constructed so the fixture itself is not a credential literal.
      writeFileSync(sample, 'github_token = "' + 'ghp_' + 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5' + '"\n');
      if (scan(['dir',temporary]) !== 1) throw new Error('Synthetic secret not rejected');
      console.log('Trusted scanner self-test PASS: clean accepted, synthetic secret rejected.'); return 0;
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  if (mode === 'history') return scan(['git',root,'--log-opts=--all']);
  if (mode === 'range') {
    const base = process.env.SECRET_SCAN_BASE;
    if (!/^[a-f0-9]{40}$/.test(base ?? '')) throw new Error('Exact base commit required');
    if(context&&base!==context.base)throw new Error('Exact base commit required');
    return scan(['git',root,`--log-opts=${base}..HEAD`]);
  }
  if (['changes','tree'].includes(mode)) return snapshot(mode);
  throw new Error('Unknown scan mode');
}
try { process.exitCode = main(); } catch (error) { const known = ['Unsafe snapshot path','Symlink cannot be safely scanned','Scanner version mismatch; run installer','Trusted scanner failed; raw output suppressed']; console.error(`SECRET_GATE_ERROR: scan incomplete (${error.code ?? error.status ?? 'scanner'}; ${known.includes(error.message) ? error.message : 'raw output suppressed'}).`); process.exitCode = 2; }

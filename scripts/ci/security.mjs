import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { containsSecret, forbiddenTrackedPath } from "./security-rules.mjs";
import { assertNoRuntimeEnvFiles, isolatedEnvironment } from "./safety.mjs";
import { safeSourcePath } from "./source-paths.mjs";
import {join} from 'node:path';
// Legacy candidate contexts require the retired delivery controller; reject them explicitly.
if (process.argv.includes('--candidate-context')) throw new Error('CI_LEGACY_CANDIDATE_CONTEXT_UNSUPPORTED');

assertNoRuntimeEnvFiles(process.cwd());
const context=null;
const root=context?.snapshot??process.cwd();
const files = context ? context.manifest.entries.map(entry=>entry.path) : execFileSync("git", ["ls-files", "-z"], { env: isolatedEnvironment(), encoding: "utf8" }).split("\0").filter(Boolean);
const failures = [];
for (const file of files) {
  try { safeSourcePath(file); } catch { failures.push({ file, rule: "unsafe-path" }); continue; }
  if (forbiddenTrackedPath(file)) { failures.push({ file, rule: "private-path" }); continue; }
  // Never follow a tracked pointer into the permanently excluded knowledge store.
  if (/(?:^|\/)\.?obsidian(?:\/|$)/i.test(file)) continue;
  let stat;
  try { stat = lstatSync(join(root, file)); } catch (err) { if (err && err.code === "ENOENT") continue; throw err; }
  if (stat.isSymbolicLink()) { failures.push({ file, rule: "tracked-symlink" }); continue; }
  const content = readFileSync(join(root,file));
  if (content.includes(0)) continue;
  // Public anon examples may appear only in the explicit example template.
  if (containsSecret(content.toString("utf8"), file, { allowPublicAnon: file === ".env.example" })) failures.push({ file, rule: "secret-signature" });
}
for (const { file, rule } of failures) console.error(`CI_SECRET_CHECK_FAILED ${rule} ${file}`);
if (failures.length) process.exit(1);
console.log(`Tracked secret baseline passed (${files.length} paths; values never logged).`);

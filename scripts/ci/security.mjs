import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { containsSecret, forbiddenTrackedPath } from "./security-rules.mjs";
import { assertNoRuntimeEnvFiles, isolatedEnvironment } from "./safety.mjs";
import {join} from 'node:path';
import {candidateContextArgument,loadGateContext} from './candidate-snapshot.mjs';

assertNoRuntimeEnvFiles(process.cwd());
const context=loadGateContext(candidateContextArgument());
const root=context?.snapshot??process.cwd();
const files = context ? context.manifest.entries.map(entry=>entry.path) : execFileSync("git", ["ls-files", "-z"], { env: isolatedEnvironment(), encoding: "utf8" }).split("\0").filter(Boolean);
const failures = [];
for (const file of files) {
  if (forbiddenTrackedPath(file)) { failures.push({ file, rule: "private-path" }); continue; }
  // Never follow a tracked pointer into the permanently excluded knowledge store.
  if (/(?:^|\/)\.?obsidian(?:\/|$)/i.test(file)) continue;
  if (lstatSync(join(root,file)).isSymbolicLink()) { failures.push({ file, rule: "tracked-symlink" }); continue; }
  const content = readFileSync(join(root,file));
  if (content.includes(0)) continue;
  // Public anon examples may appear only in the explicit example template.
  if (containsSecret(content.toString("utf8"), file, { allowPublicAnon: file === ".env.example" })) failures.push({ file, rule: "secret-signature" });
}
for (const { file, rule } of failures) console.error(`CI_SECRET_CHECK_FAILED ${rule} ${file}`);
if (failures.length) process.exit(1);
console.log(`Tracked secret baseline passed (${files.length} paths; values never logged).`);

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertNoRuntimeEnvFiles, isolatedEnvironment } from "./safety.mjs";

const commands = {
  typecheck: ["node_modules/typescript/bin/tsc", "--noEmit"],
  lint: ["node_modules/eslint/bin/eslint.js", ".", "--max-warnings=0"],
  unit: ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.ci.config.ts", "--maxWorkers=1", "--reporter=dot", "--silent"],
  contracts: ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.ci.config.ts", "src/lib/channels/contract.test.ts", "src/lib/access", "src/lib/auth", "src/lib/billing/catalog-backend", "src/lib/tenancy/business-authority", "src/lib/tenancy/setup-draft", "--maxWorkers=1", "--reporter=dot", "--silent"],
  build: ["node_modules/next/dist/bin/next", "build", "--webpack"],
  safety: ["--test", "scripts/ci/safety.test.mjs", "scripts/ci/security.test.mjs", "scripts/ci/dependency-compatibility.test.mjs", "scripts/integration/local-auth-confirmation.test.mjs", "src/lib/logging/logger.test.mjs"],
};
const command = commands[process.argv[2]];
if (!command) throw Error("CI_UNKNOWN_CHECK");
assertNoRuntimeEnvFiles(process.cwd());
const guard = resolve("scripts/ci/offline-network-guard.cjs").replaceAll("\\", "/");
const env = { ...isolatedEnvironment(), NODE_OPTIONS: `--require="${guard}"` };
if (process.argv[2] === "typecheck") {
  // A clean checkout has no ignored Next ambient/route declarations. Generate
  // them offline first, as required by the installed Next.js TypeScript guide.
  const types = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "typegen"], { env, stdio: "inherit", windowsHide: true });
  if (types.error) throw Error("CI_TYPEGEN_START_FAILED");
  if (types.status !== 0) process.exit(types.status ?? 1);
}
const child = spawnSync(process.execPath, command, { env, stdio: "inherit", windowsHide: true });
if (child.error) throw Error("CI_CHECK_START_FAILED");
process.exit(child.status ?? 1);

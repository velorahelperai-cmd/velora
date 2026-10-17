import { readdirSync } from "node:fs";

const runtimeNames = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "SystemDrive", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "LANG"];
export function isolatedEnvironment(source = process.env) {
  const env = { NEXT_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", CI: "true" };
  for (const name of runtimeNames) if (source[name] !== undefined) env[name] = source[name];
  return env;
}
export function assertNoRuntimeEnvFiles(root) {
  if (readdirSync(root).some(name => (name === ".env" || name.startsWith(".env.")) && name !== ".env.example")) {
    throw Error("CI_RUNTIME_ENV_FILES_PRESENT");
  }
}
export function assertRequiredResults(needs) {
  for (const job of new Set(["quality", "security", "secrets", ...Object.keys(needs ?? {})])) {
    if (needs?.[job]?.result !== "success") throw Error(`CI_REQUIRED_CHECK_FAILED_${job}`);
  }
}

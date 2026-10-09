// Test tools only. No product settings, credentials or environment files are read.
import { readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
const exec = promisify(execFile);
const runtimeNames = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "SystemDrive", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
export function localEnvironment(source = process.env) {
  const env = { NEXT_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" };
  for (const name of runtimeNames) if (source[name] !== undefined) env[name] = source[name];
  return env;
}
export async function assertNoEnvironmentFiles(root) {
  const names = await readdir(root);
  if (names.some(name => (name === ".env" || name.startsWith(".env.")) && name !== ".env.example")) throw Error("LOCAL_TEST_ENV_FILES_PRESENT");
}
export async function assertPortsFree(ports) {
  const servers = [];
  try {
    for (const port of ports) {
      if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error("INVALID_LOCAL_TEST_PORT");
      const server = createServer(); servers.push(server);
      await new Promise((ok, fail) => { server.once("error", () => fail(Error(`LOCAL_TEST_PORT_BUSY_${port}`))); server.listen(port, "127.0.0.1", ok); });
    }
  } finally { await Promise.all(servers.map(server => new Promise(ok => server.listening ? server.close(ok) : ok()))); }
}
export function guardedEnvironment(root, extra) {
  // NODE_OPTIONS parses backslashes as escapes, unlike spawn's argv array.
  const guardPath = resolve(root, "scripts/integration/local-http-network-guard.cjs").replaceAll("\\", "/");
  return { ...localEnvironment(), ...extra, NODE_OPTIONS: `--require="${guardPath}"` };
}
/** Never submit fixture credentials to a listener outside our live Next subtree. */
export async function assertOwnedListener(child, port) {
  if (!child?.pid || child.exitCode !== null || child.killed) throw Error("LOCAL_NEXT_PROCESS_EXITED");
  if (process.platform !== "win32") throw Error("LOCAL_LISTENER_OWNERSHIP_PLATFORM_NOT_VERIFIED");
  const pid = Number(child.pid);
  const script = `$taskIds=[Collections.Generic.HashSet[int]]::new();[void]$taskIds.Add(${pid});$taskProcesses=@(Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId);for($taskI=0;$taskI -lt 8;$taskI++){foreach($taskP in $taskProcesses){if($taskIds.Contains([int]$taskP.ParentProcessId)){[void]$taskIds.Add([int]$taskP.ProcessId)}}};$taskListeners=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop);if($taskListeners.Count -eq 0 -or @($taskListeners|Where-Object{!$taskIds.Contains([int]$_.OwningProcess)}).Count -gt 0){exit 2};Write-Output 'OWNED';`;
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: localEnvironment(), windowsHide: true, timeout: 30000 });
  if (stdout.trim() !== "OWNED") throw Error("LOCAL_LISTENER_NOT_OWNED");
}

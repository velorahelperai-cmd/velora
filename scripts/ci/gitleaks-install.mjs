// Official release only; hashes pinned from that release's checksums manifest.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
export const version = '8.24.3';
export const toolDirectory = join(homedir(), '.cache', 'velora-gitleaks', version);
export const binary = join(toolDirectory, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
const releases = {
  win32: ['windows_x64.zip', '3f1a35578631dbfe633cc5b49e6c906e55ff14a4bfd7336a10fb27fe33b6dcd2'],
  linux: ['linux_x64.tar.gz', '9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c'],
};
export async function install() {
  if (process.arch !== 'x64' || !releases[process.platform]) throw new Error('Unsupported scanner platform');
  const [asset, digest] = releases[process.platform];
  const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_${asset}`);
  if (!response.ok) throw new Error('Official scanner download failed');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('Scanner checksum mismatch');
  const temporary = mkdtempSync(join(tmpdir(), 'velora-scanner-install-'));
  try {
    mkdirSync(toolDirectory, { recursive: true });
    const archive = join(temporary, asset); writeFileSync(archive, bytes);
    if (process.platform === 'win32') {
      // Paths are passed as environment data, not interpolated shell code.
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:VELORA_SCANNER_ARCHIVE -DestinationPath $env:VELORA_SCANNER_DEST -Force'], { env: { ...process.env, VELORA_SCANNER_ARCHIVE: archive, VELORA_SCANNER_DEST: toolDirectory }, stdio: 'pipe', windowsHide: true });
    } else execFileSync('tar', ['-xzf', archive, '-C', toolDirectory, 'gitleaks'], { stdio: 'pipe' });
    if (!existsSync(binary) || execFileSync(binary, ['version'], { encoding: 'utf8' }).trim() !== version) throw new Error('Scanner version mismatch');
    console.log(`Gitleaks ${version} installed; official archive SHA256 verified.`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/gitleaks-install.mjs')) await install();

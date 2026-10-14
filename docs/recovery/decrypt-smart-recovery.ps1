param(
  [Parameter(Mandatory=$true)][string]$KeyPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [string]$EncryptedPath = (Join-Path $PSScriptRoot 'smart-prerelease-20261014.enc.json'),
  [string]$ManifestPath = (Join-Path $PSScriptRoot 'smart-prerelease-20261014.manifest.json')
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Use PowerShell 7 with AES-GCM support.' }
if (Test-Path -LiteralPath $OutputPath) { throw 'Refusing to overwrite the output file.' }
$taskManifest = [IO.File]::ReadAllText($ManifestPath) | ConvertFrom-Json
$taskEnvelopeText = [IO.File]::ReadAllText($EncryptedPath).Replace("`r`n","`n")
$taskEnvelopeHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($taskEnvelopeText))).ToLowerInvariant()
if ($taskEnvelopeHash -ne $taskManifest.encryptedSha256) { throw 'Encrypted file integrity check failed.' }
$taskEnvelope = $taskEnvelopeText | ConvertFrom-Json
if ($taskEnvelope.version -ne 1 -or $taskEnvelope.algorithm -ne 'AES-256-GCM' -or $taskEnvelope.aad -ne 'VELORA-SCOPED-RECOVERY-V1') { throw 'Unsupported envelope.' }
$taskKey = [IO.File]::ReadAllBytes($KeyPath)
if ($taskKey.Length -ne 32) { throw 'Invalid recovery key length.' }
$taskCipher = [Convert]::FromBase64String($taskEnvelope.ciphertext)
$taskPlain = [byte[]]::new($taskCipher.Length)
$taskAes = [Security.Cryptography.AesGcm]::new($taskKey,16)
try {
  $taskAes.Decrypt([Convert]::FromBase64String($taskEnvelope.nonce),$taskCipher,[Convert]::FromBase64String($taskEnvelope.tag),$taskPlain,[Text.Encoding]::UTF8.GetBytes($taskEnvelope.aad))
  $taskHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($taskPlain)).ToLowerInvariant()
  if ($taskHash -ne $taskManifest.plaintextSha256) { throw 'Decrypted snapshot integrity check failed.' }
  $taskSnapshot = [Text.Encoding]::UTF8.GetString($taskPlain) | ConvertFrom-Json
  if ($taskSnapshot.companies.Count -ne $taskManifest.companies -or $taskSnapshot.company_members.Count -ne $taskManifest.companyMembers -or $taskSnapshot.functions.Count -ne $taskManifest.functionDefinitions) { throw 'Snapshot count check failed.' }
  $taskStream = [IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    if ($IsWindows) {
      $taskAcl = [Security.AccessControl.FileSecurity]::new()
      $taskAcl.SetAccessRuleProtection($true,$false)
      $taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
      $taskAcl.SetOwner($taskSid)
      $taskAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($taskSid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))
      Set-Acl -LiteralPath $OutputPath -AclObject $taskAcl
    } else {
      [IO.File]::SetUnixFileMode($OutputPath,([IO.UnixFileMode]::UserRead -bor [IO.UnixFileMode]::UserWrite))
    }
    $taskStream.Write($taskPlain,0,$taskPlain.Length)
  } finally { $taskStream.Dispose() }
  Write-Output 'Verified scoped snapshot decrypted. No SQL was executed.'
} finally {
  $taskAes.Dispose()
  [Security.Cryptography.CryptographicOperations]::ZeroMemory($taskKey)
  [Security.Cryptography.CryptographicOperations]::ZeroMemory($taskPlain)
}

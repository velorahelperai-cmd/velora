#requires -Version 7.0
param([switch]$SelfCheck)
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'WINDOWS_DPAPI_REQUIRED'}
$configRoot=Join-Path $env:LOCALAPPDATA 'Velora\LocalCustomer'
$configFile=Join-Path $configRoot 'thawani-live.clixml'
$approvalFile=Join-Path $configRoot 'one-order-approval.json'
if($SelfCheck){
 $value=ConvertTo-SecureString 'synthetic-self-check' -AsPlainText -Force
 $cipher=ConvertFrom-SecureString $value
 if($cipher.Contains('synthetic-self-check')){throw 'DPAPI_SELF_CHECK_FAILED'}
 ConvertTo-SecureString $cipher | Out-Null
 Write-Host 'PASS: Windows DPAPI available; no credential was requested or saved.';exit 0
}
[IO.Directory]::CreateDirectory($configRoot) | Out-Null
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$directory=Get-Item -LiteralPath $configRoot
$acl=[IO.FileSystemAclExtensions]::GetAccessControl($directory,[Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true,$false)
foreach($entry in $acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier])){$acl.RemoveAccessRuleSpecific($entry)}
$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.SetAccessRule($rule);[IO.FileSystemAclExtensions]::SetAccessControl($directory,$acl)
Write-Host 'Local Live setup. Paste values here only; do not send them in chat.'
Write-Host 'Keys are stored with Windows DPAPI for your Windows user, outside Git.'
Write-Host 'This does not create a checkout, change a webhook, or approve an amount.'
$existing=if(Test-Path -LiteralPath $configFile){Import-Clixml -LiteralPath $configFile}else{$null}
$approval=if(Test-Path -LiteralPath $approvalFile){Get-Content -LiteralPath $approvalFile -Raw | ConvertFrom-Json}else{$null}
$approved=$approval -and $approval.AccountId -eq '177ef439-3fb0-4e3e-96b8-2a9e8661386d' -and $approval.Currency -eq 'OMR' -and $approval.AmountBaisa -eq 100 -and $approval.MaxOrders -eq 1 -and $approval.Environment -eq 'live' -and $approval.MerchantExpected -eq 'Caramela / Vision Future Investments LLC' -and [Guid]::TryParse([string]$approval.GrantId,[ref]([Guid]::Empty))
function Read-PrivateValue([string]$label,$previous){
 $value=Read-Host ($label + ' (hidden; Enter retains existing value)') -AsSecureString
 if($value.Length -eq 0 -and $previous){return $previous}
 if($value.Length -eq 0){throw 'A_REQUIRED_VALUE_WAS_NOT_PROVIDED'}
 return $value
}
$publicKey=Read-PrivateValue 'Thawani LIVE publishable key' $existing.ThawaniPublicKey
$secretKey=Read-PrivateValue 'Thawani LIVE secret key' $existing.ThawaniSecretKey
$supabasePublic=Read-PrivateValue 'Velora Supabase publishable key' $existing.SupabasePublicKey
$supabaseService=Read-PrivateValue 'Velora Supabase server service-role key (server only)' $existing.SupabaseServiceKey
$broker=if($existing.BrokerKey){$existing.BrokerKey}else{$bytes=New-Object byte[] 32;[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes);ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force}
$config=[PSCustomObject]@{Version=1;AccountId='177ef439-3fb0-4e3e-96b8-2a9e8661386d';MerchantExpected='Caramela / Vision Future Investments LLC';SupabaseUrl='https://vmpifljyozsbtssxhoxd.supabase.co';GrantId=$(if($approved){$approval.GrantId}elseif($existing.GrantId){$existing.GrantId}else{[Guid]::NewGuid().ToString()});ApprovedBaisa=$(if($approved){100}else{0});ThawaniPublicKey=$publicKey;ThawaniSecretKey=$secretKey;SupabasePublicKey=$supabasePublic;SupabaseServiceKey=$supabaseService;BrokerKey=$broker}
$temporary=$configFile+'.tmp';$config | Export-Clixml -LiteralPath $temporary
Move-Item -LiteralPath $temporary -Destination $configFile -Force
$configItem=Get-Item -LiteralPath $configFile
$fileAcl=[IO.FileSystemAclExtensions]::GetAccessControl($configItem,[Security.AccessControl.AccessControlSections]::Access)
$fileAcl.SetAccessRuleProtection($true,$false)
foreach($entry in $fileAcl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier])){$fileAcl.RemoveAccessRuleSpecific($entry)}
$fileAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow'))
[IO.FileSystemAclExtensions]::SetAccessControl($configItem,$fileAcl)
Write-Host 'Saved encrypted configuration. No key value was printed.'
Write-Host 'Amount approval and native Live settlement readiness are still separate checks.'

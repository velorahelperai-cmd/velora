#requires -Version 7.5
[CmdletBinding()]
param(
 [ValidateSet('Start','Status','Restart','Stop')][string]$Mode='Start',
 [string]$OwnerId=$(if($env:CODEX_THREAD_ID){$env:CODEX_THREAD_ID}else{'interactive-windows-user'}),
 $WebSession,
 [ValidateRange(10,180)][int]$ReadyTimeoutSeconds=90,
 [switch]$InspectOnly
)
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'CONFIG_INVALID: WINDOWS_DPAPI_REQUIRED'}
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if($repo -ne 'C:\Users\DELL\Desktop\Velora new'){throw 'CANONICAL_CHECKOUT_REQUIRED'}
. (Join-Path $PSScriptRoot 'runtime.ps1')
$root=Join-Path $env:LOCALAPPDATA 'Velora\LocalCustomer'
$configFile=Join-Path $root 'thawani-live.clixml'
$receiptFile=Join-Path $root 'runtime-3330.json'
function Reveal-ForProcess([Security.SecureString]$value){$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value);try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}}
# This is the only credential loader. Never print or persist the returned values.
function Read-LocalEnvironment([string]$ConfigFile){
 if(!(Test-Path -LiteralPath $ConfigFile -PathType Leaf)){throw 'CONFIG_MISSING: DPAPI_FILE_MISSING'}
 try{$config=Import-Clixml -LiteralPath $ConfigFile}catch{throw 'CONFIG_INVALID: DPAPI_UNREADABLE_FOR_CURRENT_WINDOWS_USER'}
 if($config.Version -ne 1){throw 'CONFIG_INVALID: DPAPI_VERSION_UNSUPPORTED'}
 $values=@{NODE_ENV='development';NEXT_PUBLIC_SITE_URL='http://127.0.0.1:3330';LOG_LEVEL='warn';NEXT_PUBLIC_LOG_LEVEL='warn';NEXT_TELEMETRY_DISABLED='1'}
 foreach($pair in @(@('SupabasePublicKey','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),@('SupabaseServiceKey','SUPABASE_SERVICE_ROLE_KEY'),@('BrokerKey','VELORA_SESSION_BROKER_KEY'))){
  $secure=$config.($pair[0])
  if($secure -isnot [Security.SecureString] -or $secure.Length -eq 0){throw "CONFIG_MISSING: $($pair[1])"}
  try{$values[$pair[1]]=Reveal-ForProcess $secure}catch{throw 'CONFIG_INVALID: DPAPI_DECRYPT_FAILED'}
 }
 $values.NEXT_PUBLIC_SUPABASE_URL=[string]$config.SupabaseUrl
 Test-LocalEnvironment $values
 # Explicit off values override inherited variables AND Next dotenv files.
 foreach($name in @('WHATSAPP_WORKER_ENABLED','WHATSAPP_FIXED_ACK_ENABLED','WHATSAPP_RECEIVE_ENABLED','WHATSAPP_AUTO_PIN_ENABLED','BILLING_EMAIL_WORKER_ENABLED','BILLING_ES02_THAWANI_TEST_ENABLED','AI_LIVE_ANSWERING','AI_LIVE_ANSWERING_ENABLED')){$values[$name]='false'}
 foreach($name in @('VELORA_LOCAL_CUSTOMER_MODE','NEXT_PUBLIC_LOCAL_LIVE_CUSTOMER','THAWANI_ENVIRONMENT','THAWANI_SECRET_KEY_LIVE','THAWANI_PUBLIC_KEY_LIVE','THAWANI_SECRET_KEY_TEST','THAWANI_PUBLIC_KEY_TEST','THAWANI_TEST_ACCOUNT_ID','VELORA_LOCAL_LIVE_ACCOUNT_ID','VELORA_LOCAL_LIVE_GRANT_ID','VELORA_LOCAL_LIVE_APPROVED_BAISA','AI_GEMINI_API_KEY','GEMINI_API_KEY','AI_OPENAI_API_KEY','OPENAI_API_KEY','WHATSAPP_ACCESS_TOKEN','WHATSAPP_WORKER_SECRET')){$values[$name]=''}
 $values.WHATSAPP_ALLOW_EXTERNAL_SEND='false';$values.WHATSAPP_TEST_ALLOW_EXTERNAL_SEND='false'
 return $values
}

if($InspectOnly){$Mode='Status'}
$mutex=[Threading.Mutex]::new($false,'Local\Velora-Canonical-Runtime-3330')
$locked=$false
try{
 try{$locked=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
 if(!$locked){throw 'PORT_IN_USE: ANOTHER_LAUNCHER_OPERATION_IS_RUNNING'}
 $owner=Get-LocalOwner $OwnerId
 $listeners=@(Get-LocalListeners)
 $receipt=Read-LocalReceipt $receiptFile
 if($listeners.Count -eq 1 -and $receipt -and $receipt.listenerPid -eq 0 -and (Test-LocalRoot $receipt $repo $owner)){
  # Recover an interrupted launch only through the original PID + creation time.
  $pending=Get-LocalProcess $listeners[0].OwningProcess
  if($pending -and $pending.executable -eq $receipt.executable -and (Test-LocalDescendant $pending.id $receipt.rootPid $receipt.rootStarted)){
   $receipt.listenerPid=$pending.id;$receipt.listenerStarted=$pending.started
   Save-LocalReceipt $receiptFile $receipt
  }
 }
 if($listeners.Count -gt 0 -and !(Test-LocalRuntime $receipt $repo $owner $listeners)){throw 'PORT_IN_USE: UNVERIFIED_OR_OTHER_OWNER; STOP_FROM_ORIGINAL_SESSION'}
 if($Mode -eq 'Stop'){
  if($listeners.Count){Stop-LocalRuntime $receipt $repo $owner}
  elseif($receipt -and (Test-LocalRoot $receipt $repo $receipt.owner)){throw 'PORT_IN_USE: RECORDED_PROCESS_ALIVE_WITHOUT_VERIFIED_LISTENER'}
  Write-Output 'STOPPED: verified runtime stopped or port already free';exit 0
 }
 $values=Read-LocalEnvironment $configFile
 $fingerprint=Get-LocalFingerprint $repo $configFile
 if($listeners.Count -gt 0 -and $receipt.fingerprint -ne $fingerprint -and $Mode -ne 'Restart'){throw 'CONFIG_INVALID: RUNTIME_INPUTS_CHANGED; SAME_OWNER_MUST_RESTART'}
 if($Mode -eq 'Restart'){
  if($listeners.Count -gt 0){Stop-LocalRuntime $receipt $repo $owner; $listeners=@()}
  elseif($receipt -and (Test-LocalRoot $receipt $repo $owner)){throw 'PORT_IN_USE: RECORDED_PROCESS_ALIVE_WITHOUT_VERIFIED_LISTENER'}
 }
 if($listeners.Count -eq 0){
  if($Mode -eq 'Status'){Write-Output 'STOPPED: port 3330 is free; run -Mode Start';exit 3}
  if($receipt -and (Test-LocalRoot $receipt $repo $receipt.owner)){throw 'PORT_IN_USE: RECORDED_PROCESS_STARTING_OR_UNHEALTHY'}
  # The launch primitive restores this process's environment before readiness checks.
  $childId=Start-LocalNext $repo $values
  $process=Get-LocalProcess $childId
  if(!$process){throw 'APPLICATION_ERROR: NEXT_PROCESS_EXITED'}
  $receipt=[pscustomobject]@{version=1;rootPid=$childId;rootStarted=$process.started;executable=$process.executable;project=$repo;port=3330;mode='development';owner=$owner;fingerprint=$fingerprint;listenerPid=0;listenerStarted=''}
  Save-LocalReceipt $receiptFile $receipt
  $deadline=[DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
  do{
   $listeners=@(Get-LocalListeners)
   if($listeners.Count){break}
   if(!(Get-LocalProcess $childId)){throw 'APPLICATION_ERROR: NEXT_PROCESS_EXITED'}
   Start-Sleep -Milliseconds 300
  }while([DateTime]::UtcNow -lt $deadline)
  if($listeners.Count -ne 1 -or !(Test-LocalDescendant $listeners[0].OwningProcess $receipt.rootPid $receipt.rootStarted)){throw 'PORT_IN_USE: LISTENER_NOT_PROVEN'}
  $listener=Get-LocalProcess $listeners[0].OwningProcess
  $receipt.listenerPid=$listener.id;$receipt.listenerStarted=$listener.started
  Save-LocalReceipt $receiptFile $receipt
 }else{Write-Output 'REUSED: verified runtime; no second Next.js instance started'}
 if(!(Test-LocalRuntime $receipt $repo $owner @(Get-LocalListeners))){throw 'PORT_IN_USE: RUNTIME_IDENTITY_CHANGED'}
 $result=Invoke-LocalReadiness $values $WebSession $ReadyTimeoutSeconds
 $result | ForEach-Object {Write-Output $_}
 Write-Output 'Customer entry: http://127.0.0.1:3330/setup'
 Write-Output 'AUTH_REDIRECT_ALLOWLIST_NOT_VERIFIED: callback http://127.0.0.1:3330/auth/callback; hosted provider settings need external read-only verification.'
 if(@($result | Where-Object {$_ -match '^(CONFIG_|AUTH_UNAVAILABLE|DATABASE_TIMEOUT|NETWORK_UNAVAILABLE|APPLICATION_ERROR)'}).Count){exit 2}
}catch{
 # DPAPI/HTTP/process API exceptions can contain sensitive values. Do not echo them.
 $safe=[string]$_.Exception.Message
 if($safe -match '^(PORT_IN_USE|CONFIG_MISSING|CONFIG_INVALID|AUTH_UNAVAILABLE|SESSION_EXPIRED|DATABASE_TIMEOUT|NETWORK_UNAVAILABLE|APPLICATION_ERROR): [A-Z0-9_ ;=./-]+$'){Write-Output $safe}
 else{Write-Output "APPLICATION_ERROR: LOCAL_LAUNCHER_FAILED line=$($_.InvocationInfo.ScriptLineNumber) type=$($_.Exception.GetType().Name)"}
 exit 2
}finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose();$values=$null}

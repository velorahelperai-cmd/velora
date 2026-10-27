param([switch]$InspectOnly)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if($repo -ne 'C:\Users\DELL\Desktop\Velora new'){throw 'CANONICAL_CHECKOUT_REQUIRED'}
$configFile=Join-Path $env:LOCALAPPDATA 'Velora\LocalCustomer\thawani-live.clixml'
if(!$InspectOnly -and !(Test-Path -LiteralPath $configFile)){Write-Host 'Run scripts/live-customer/configure.ps1 first. Never put keys in chat.';exit 2}
function Reveal-ForProcess([Security.SecureString]$value){$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value);try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}}
$vars=@{NODE_ENV='development';VELORA_LOCAL_CUSTOMER_MODE='live';NEXT_PUBLIC_LOCAL_LIVE_CUSTOMER='1';NEXT_PUBLIC_SITE_URL='http://127.0.0.1:3330';THAWANI_ENVIRONMENT='live';BILLING_ES02_THAWANI_TEST_ENABLED='false';THAWANI_SECRET_KEY_TEST='';THAWANI_PUBLIC_KEY_TEST='';THAWANI_TEST_ACCOUNT_ID='';LOG_LEVEL='warn';NEXT_PUBLIC_LOG_LEVEL='warn';THAWANI_SECRET_KEY_LIVE='';THAWANI_PUBLIC_KEY_LIVE='';VELORA_LOCAL_LIVE_ACCOUNT_ID='';VELORA_LOCAL_LIVE_GRANT_ID='';VELORA_LOCAL_LIVE_APPROVED_BAISA='';NEXT_PUBLIC_SUPABASE_URL='';NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='';SUPABASE_SERVICE_ROLE_KEY='';VELORA_SESSION_BROKER_KEY=''}
if(!$InspectOnly){
 $c=Import-Clixml -LiteralPath $configFile
 if($c.Version -ne 1){throw 'LOCAL_CONFIG_VERSION_UNSUPPORTED'}
 $vars.NEXT_PUBLIC_SUPABASE_URL=$c.SupabaseUrl
 $vars.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=Reveal-ForProcess $c.SupabasePublicKey
 $vars.SUPABASE_SERVICE_ROLE_KEY=Reveal-ForProcess $c.SupabaseServiceKey
 $vars.VELORA_SESSION_BROKER_KEY=Reveal-ForProcess $c.BrokerKey
 $vars.THAWANI_SECRET_KEY_LIVE=Reveal-ForProcess $c.ThawaniSecretKey
 $vars.THAWANI_PUBLIC_KEY_LIVE=Reveal-ForProcess $c.ThawaniPublicKey
 $vars.VELORA_LOCAL_LIVE_ACCOUNT_ID=$c.AccountId;$vars.VELORA_LOCAL_LIVE_GRANT_ID=$c.GrantId
 $vars.VELORA_LOCAL_LIVE_APPROVED_BAISA=[string]$c.ApprovedBaisa
}
$previous=@{}
try{
 foreach($name in $vars.Keys){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process');[Environment]::SetEnvironmentVariable($name,[string]$vars[$name],'Process')}
 Push-Location $repo
 node scripts/consolidation/guard.mjs
 if($LASTEXITCODE -ne 0){throw 'WORKSPACE_GUARD_REJECTED'}
 Write-Host 'Local customer entry: http://127.0.0.1:3330/login?next=%2Faccount%2Fbusinesses%2Fnew'
 if($InspectOnly){Write-Host 'BLOCKED: credentials are not loaded; this is the real app with authentication/charging unavailable.'}
 & node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3330
 if($LASTEXITCODE -ne 0){throw 'LOCAL_APP_STOPPED_WITH_ERROR'}
}finally{Pop-Location;foreach($name in $vars.Keys){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}}

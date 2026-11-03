param()
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\DELL\Desktop\Velora new'
Set-Location $repo

$configFile = Join-Path $env:LOCALAPPDATA 'Velora\LocalCustomer\thawani-live.clixml'
if (!(Test-Path -LiteralPath $configFile)) {
    Write-Error "Local credentials file not found: $configFile"
    exit 1
}

function Reveal-ForProcess([Security.SecureString]$value) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($value)
    try {
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

$c = Import-Clixml -LiteralPath $configFile

$env:NODE_ENV = 'development'
$env:PORT = '3000'
$env:NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
$env:NEXT_PUBLIC_SUPABASE_URL = $c.SupabaseUrl
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = Reveal-ForProcess $c.SupabasePublicKey
$env:SUPABASE_SERVICE_ROLE_KEY = Reveal-ForProcess $c.SupabaseServiceKey
$env:VELORA_SESSION_BROKER_KEY = Reveal-ForProcess $c.BrokerKey
$env:WHATSAPP_WORKER_ENABLED = 'false'
$env:AI_GEMINI_LIVE_ANSWER_ENABLED = 'false'

Write-Host "Starting Velora local server at http://localhost:3000 ..."
& npx next dev -p 3000

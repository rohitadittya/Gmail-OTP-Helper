$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $projectDir ".env"
$templatePath = Join-Path $projectDir "manifest.template.json"
$manifestPath = Join-Path $projectDir "manifest.json"

$clientId = $env:GOOGLE_OAUTH_CLIENT_ID
if (-not $clientId) {
    if (-not (Test-Path -LiteralPath $envPath)) {
        throw "Missing .env. Copy .env.example to .env and set GOOGLE_OAUTH_CLIENT_ID, or set the process environment variable."
    }
    $clientIdEntry = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*GOOGLE_OAUTH_CLIENT_ID\s*=' } | Select-Object -First 1
    if (-not $clientIdEntry) {
        throw "Set GOOGLE_OAUTH_CLIENT_ID in the process environment or in .env."
    }
    $clientId = ($clientIdEntry -replace '^\s*GOOGLE_OAUTH_CLIENT_ID\s*=\s*', '').Trim().Trim('"').Trim("'")
}

$clientId = $clientId.Trim().Trim('"').Trim("'")
if ($clientId -notmatch '^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$') {
    throw "GOOGLE_OAUTH_CLIENT_ID does not look like a Google OAuth client ID."
}

$manifest = Get-Content -LiteralPath $templatePath -Raw | ConvertFrom-Json
$manifest.oauth2.client_id = $clientId
$json = ConvertTo-Json -InputObject $manifest -Depth 20
[System.IO.File]::WriteAllText($manifestPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Output "Generated manifest.json. Load this folder in Chrome."

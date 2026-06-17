param(
  [string]$EnvFile = ".env.local"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root $EnvFile

if (-not (Test-Path -LiteralPath $envPath)) {
  $examplePath = Join-Path $root ".env.example"
  Copy-Item -LiteralPath $examplePath -Destination $envPath
  Write-Host "Created $EnvFile from .env.example."
  Write-Host "Edit DATABASE_URL in $EnvFile, then run this script again."
  exit 1
}

Get-Content -LiteralPath $envPath | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) {
    return
  }

  $parts = $line.Split("=", 2)
  if ($parts.Count -ne 2) {
    return
  }

  $name = $parts[0].Trim()
  $value = $parts[1].Trim().Trim('"').Trim("'")
  [Environment]::SetEnvironmentVariable($name, $value, "Process")
}

$apiPort = if ($env:API_PORT) { $env:API_PORT } else { "8081" }
$webPort = if ($env:WEB_PORT) { $env:WEB_PORT } else { "8080" }
$basePath = if ($env:BASE_PATH) { $env:BASE_PATH } else { "/" }
$apiProxyTarget = if ($env:API_PROXY_TARGET) { $env:API_PROXY_TARGET } else { "http://127.0.0.1:$apiPort" }

if (-not $env:DATABASE_URL -or $env:DATABASE_URL -like "postgres://USER:*") {
  throw "DATABASE_URL is missing or still uses the placeholder in $EnvFile."
}

Write-Host "Building shared libraries and API..."
pnpm.cmd run typecheck:libs
pnpm.cmd --filter "@workspace/api-server" run build

Write-Host "Starting API on http://127.0.0.1:$apiPort"
$env:PORT = $apiPort
$rootForCommand = $root.Replace("'", "''")
$apiCommand = "Set-Location -LiteralPath '$rootForCommand'; node artifacts/api-server/dist/index.mjs"
$apiProcess = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", $apiCommand -PassThru

Write-Host "Starting web app on http://127.0.0.1:$webPort"
$env:PORT = $webPort
$env:BASE_PATH = $basePath
$env:API_PROXY_TARGET = $apiProxyTarget
pnpm.cmd --filter "@workspace/webjal-studio" run dev

if ($apiProcess -and -not $apiProcess.HasExited) {
  Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
}

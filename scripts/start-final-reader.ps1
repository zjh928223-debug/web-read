param(
  [string]$ReaderRoot = "E:\read-web",
  [string]$ReaderUrl = "http://127.0.0.1:4173",
  [int]$StartupTimeoutSeconds = 30,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

function Test-HttpOk {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-HttpOk -Url $Url) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return $false
}

$ReaderRoot = (Resolve-Path -LiteralPath $ReaderRoot).Path
$distIndex = Join-Path $ReaderRoot "dist\index.html"
if (-not (Test-Path -LiteralPath $distIndex)) {
  throw "Production build not found: $distIndex. Run npm run build first."
}

$logRoot = Join-Path $ReaderRoot ".codex\startup-logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

# Keep the subtitle workflow service available for the production reader.
$serviceLauncher = Join-Path $PSScriptRoot "start-latest-reader.ps1"
if (Test-Path -LiteralPath $serviceLauncher) {
  & $serviceLauncher -ServiceOnly -NoOpen
}

if (-not (Test-HttpOk -Url $ReaderUrl)) {
  $readerRootLiteral = "'" + ($ReaderRoot -replace "'", "''") + "'"
  $previewCommand = "Set-Location -LiteralPath $readerRootLiteral; npm run preview -- --host 127.0.0.1 --port 4173"
  Start-Process -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $previewCommand) `
    -WorkingDirectory $ReaderRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot "read-web-preview.out.log") `
    -RedirectStandardError (Join-Path $logRoot "read-web-preview.err.log")
}

if (-not (Wait-HttpOk -Url $ReaderUrl -TimeoutSeconds $StartupTimeoutSeconds)) {
  throw "Production reader did not become ready. See logs under $logRoot"
}

if (-not $NoOpen) {
  Start-Process $ReaderUrl
}

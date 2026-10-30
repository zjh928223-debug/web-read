param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
  $projectRoot = Split-Path -Parent $PSScriptRoot
  $tailscale = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (-not (Test-Path -LiteralPath $tailscale)) { throw 'Tailscale is not installed.' }
  $statusText = & $tailscale status --json
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale status.' }
  $status = ($statusText -join "`n") | ConvertFrom-Json
  if ($status.BackendState -ne 'Running') { throw 'Open Tailscale and connect before starting Read-Web.' }
  $dnsName = ([string]$status.Self.DNSName).TrimEnd('.')
  if (-not $dnsName) { throw 'Tailscale has no DNS name for this Windows computer.' }
  $macUrl = "https://${dnsName}:5184/"

  $serveText = & $tailscale serve status --json
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale Serve configuration.' }
  $serve = ($serveText -join "`n") | ConvertFrom-Json
  $webProperty = $serve.PSObject.Properties['Web']
  $entry = if ($null -ne $webProperty) { $webProperty.Value.PSObject.Properties["${dnsName}:5184"] } else { $null }
  if ($null -eq $entry) {
    & $tailscale serve --bg --https=5184 http://127.0.0.1:5184
    if ($LASTEXITCODE -ne 0) { throw 'Cannot configure the Tailscale 5184 entry.' }
  } elseif ($entry.Value.Handlers.'/'.Proxy -ne 'http://127.0.0.1:5184') {
    throw 'Tailscale port 5184 points to an unexpected service; refusing to replace it.'
  }

  $activePath = Join-Path $projectRoot '.codex\runtime-state\optimization\active-release.json'
  $active = Get-Content -LiteralPath $activePath -Raw | ConvertFrom-Json
  $manifest = Get-Content -LiteralPath $active.manifestPath -Raw | ConvertFrom-Json
  $pythonPath = [string]$manifest.runtime.pythonIdentity.executable
  if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) { throw 'The published Python runtime is missing.' }

  Write-Host 'Starting the published Read-Web version on 5184...'
  & (Join-Path $PSScriptRoot 'launch-optimization-preview.ps1') -UseActiveRelease -NoOpen -BootstrapPython $pythonPath -FrontDoorPublicOrigin $macUrl
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/health' -TimeoutSec 10
  if ($health.status -ne 'ready') { throw 'Read-Web backend is not ready.' }
  Write-Host 'Read-Web is ready. Windows: http://127.0.0.1:5184/'
  Write-Host "Mac (Tailscale connected): $macUrl"
  if (-not $NoOpen) { Start-Process 'http://127.0.0.1:5184/' }
} catch {
  Write-Host "Read-Web startup failed: $($_.Exception.Message)" -ForegroundColor Red
  if (-not $NoOpen) { Read-Host 'Press Enter to close' | Out-Null }
  exit 1
}
